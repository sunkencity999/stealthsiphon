/**
 * Local LLM providers for schema-guided extraction.
 *
 *   lmstudio  LM Studio's OpenAI-compatible server (default http://127.0.0.1:1234)
 *   ollama    Ollama native API (default http://127.0.0.1:11434)
 *   openai    any other OpenAI-compatible endpoint (vLLM, llama.cpp server, LocalAI, a hosted API...)
 *   auto      (default) use whichever local server is running, preferring one with a model loaded
 *
 * All providers get the JSON Schema as a structured-output constraint and the
 * response is parsed defensively (code fences / <think> blocks are stripped).
 */
const axios = require('axios');
const config = require('../config');
const { SiphonError, E } = require('./errors');

const PROVIDERS = ['auto', 'lmstudio', 'ollama', 'openai'];
const PROBE_TTL_MS = 60000;
let probeCache = { at: 0, value: null };

const trim = (u) => String(u || '').replace(/\/+$/, '').replace(/\/v1$/, '');

function describeAxiosError(err) {
    if (err.response) return `HTTP ${err.response.status}: ${JSON.stringify(err.response.data).slice(0, 300)}`;
    return err.code || err.message;
}

// ---- discovery ----------------------------------------------------------------

async function lmstudioModels() {
    const base = trim(config.lmstudioUrl);
    // LM Studio's REST API reports load state; fall back to the OpenAI-style list
    try {
        const r = await axios.get(`${base}/api/v0/models`, { timeout: 1500 });
        return r.data.data
            .filter(m => m.type !== 'embeddings')
            .map(m => ({ id: m.id, loaded: m.state === 'loaded', type: m.type }));
    } catch {
        const r = await axios.get(`${base}/v1/models`, { timeout: 1500 });
        return r.data.data.filter(m => !/embed/i.test(m.id)).map(m => ({ id: m.id, loaded: undefined }));
    }
}

async function ollamaModels() {
    const base = trim(config.ollamaUrl);
    const [tags, ps] = await Promise.all([
        axios.get(`${base}/api/tags`, { timeout: 1500 }),
        axios.get(`${base}/api/ps`, { timeout: 1500 }).catch(() => ({ data: { models: [] } })),
    ]);
    const running = new Set((ps.data.models || []).map(m => m.name));
    return (tags.data.models || [])
        .filter(m => !/embed/i.test(m.name))
        .map(m => ({ id: m.name, loaded: running.has(m.name) }));
}

async function openaiModels() {
    const r = await axios.get(`${trim(config.openaiCompatUrl)}/v1/models`, { timeout: 3000, headers: authHeaders() });
    return r.data.data.map(m => ({ id: m.id, loaded: undefined }));
}

function authHeaders() {
    return config.openaiCompatApiKey ? { Authorization: `Bearer ${config.openaiCompatApiKey}` } : {};
}

/** Status of every provider (used by /api/health and auto selection). */
async function probe({ fresh = false } = {}) {
    if (!fresh && probeCache.value && Date.now() - probeCache.at < PROBE_TTL_MS) return probeCache.value;
    const check = async (name, fn, url) => {
        try {
            const models = await fn();
            return { provider: name, url, available: true, models };
        } catch (err) {
            return { provider: name, url, available: false, error: describeAxiosError(err) };
        }
    };
    const checks = [check('lmstudio', lmstudioModels, trim(config.lmstudioUrl)), check('ollama', ollamaModels, trim(config.ollamaUrl))];
    if (config.openaiCompatUrl) checks.push(check('openai', openaiModels, trim(config.openaiCompatUrl)));
    const value = await Promise.all(checks);
    probeCache = { at: Date.now(), value };
    return value;
}

function configuredModel(provider) {
    return { lmstudio: config.lmstudioModel, ollama: config.ollamaModel, openai: config.openaiCompatModel }[provider] || '';
}

/** Pick provider + model for a request. */
async function resolve({ provider = config.llmProvider, model } = {}) {
    if (!PROVIDERS.includes(provider)) {
        throw new SiphonError(E.BAD_REQUEST, `provider must be one of ${PROVIDERS.join(', ')}`, { status: 400 });
    }
    if (provider === 'openai') {
        if (!config.openaiCompatUrl) throw new SiphonError(E.LLM_ERROR, 'provider "openai" requires OPENAI_COMPAT_URL', { status: 400 });
        const m = model || config.openaiCompatModel;
        if (m) return { provider, model: m };
    }
    // An explicit provider with an explicit/configured model needs no probing
    if (provider !== 'auto' && (model || configuredModel(provider))) return { provider, model: model || configuredModel(provider) };

    const status = await probe();
    const candidates = status.filter(s => s.available && s.models.length && (provider === 'auto' || s.provider === provider));
    if (!candidates.length) {
        const detail = status.map(s => `${s.provider} @ ${s.url}: ${s.available ? 'no models installed' : s.error}`).join('; ');
        throw new SiphonError(E.LLM_ERROR, `No local LLM available (${detail}). Start LM Studio's server or Ollama, or set OPENAI_COMPAT_URL.`, { status: 503 });
    }
    // Prefer: configured model > a provider with a model already loaded > first available
    const order = provider === 'auto' ? ['openai', 'lmstudio', 'ollama'] : [provider];
    candidates.sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
    const withLoaded = candidates.find(c => c.models.some(m => m.loaded));
    const chosen = (provider === 'auto' && withLoaded) || candidates[0];
    const preferred = model || configuredModel(chosen.provider);
    const pick = preferred || (chosen.models.find(m => m.loaded) || chosen.models[0]).id;
    return { provider: chosen.provider, model: pick };
}

// ---- completion ------------------------------------------------------------------

/** Pull a JSON value out of model output that may include fences or reasoning. */
function parseJsonLoose(text) {
    let t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    try { return JSON.parse(t); } catch { /* try to locate the outermost object/array */ }
    const start = t.search(/[[{]/);
    const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (start !== -1 && end > start) {
        try { return JSON.parse(t.slice(start, end + 1)); } catch { /* fallthrough */ }
    }
    throw new SiphonError(E.LLM_ERROR, 'Model did not return valid JSON', { status: 502, details: { raw: String(text).slice(0, 500) } });
}

async function chatOpenAI(baseUrl, { model, messages, schema, headers = {} }) {
    const url = `${trim(baseUrl)}/v1/chat/completions`;
    const body = { model, messages, temperature: 0, stream: false };
    const withSchema = { ...body, response_format: { type: 'json_schema', json_schema: { name: 'extraction', strict: true, schema } } };
    try {
        const r = await axios.post(url, withSchema, { timeout: config.llmTimeoutMs, headers });
        return r.data.choices[0].message.content;
    } catch (err) {
        // Some servers/models reject json_schema; retry with a plain JSON instruction
        if (err.response && err.response.status === 400) {
            const fallback = { ...body, messages: [...messages, { role: 'user', content: `Respond with only JSON matching this schema:\n${JSON.stringify(schema)}` }] };
            const r = await axios.post(url, fallback, { timeout: config.llmTimeoutMs, headers });
            return r.data.choices[0].message.content;
        }
        throw err;
    }
}

async function chatOllama({ model, messages, schema }) {
    const r = await axios.post(`${trim(config.ollamaUrl)}/api/chat`, {
        model, messages, stream: false, format: schema, options: { temperature: 0 },
    }, { timeout: config.llmTimeoutMs });
    return r.data && r.data.message ? r.data.message.content : '';
}

/**
 * Ask a local model to return JSON matching `schema`.
 * @returns {Promise<{data, provider, model}>}
 */
async function completeJson({ prompt, schema, provider, model }) {
    const target = await resolve({ provider, model });
    const messages = [
        { role: 'system', content: 'You extract structured data from web pages. Reply with JSON only.' },
        { role: 'user', content: prompt },
    ];
    let text;
    try {
        if (target.provider === 'ollama') text = await chatOllama({ ...target, messages, schema });
        else if (target.provider === 'lmstudio') text = await chatOpenAI(config.lmstudioUrl, { ...target, messages, schema });
        else text = await chatOpenAI(config.openaiCompatUrl, { ...target, messages, schema, headers: authHeaders() });
    } catch (err) {
        if (err instanceof SiphonError) throw err;
        probeCache = { at: 0, value: null }; // server state may have changed
        throw new SiphonError(E.LLM_ERROR, `${target.provider} request failed (model ${target.model}): ${describeAxiosError(err)}`, { status: 502 });
    }
    return { data: parseJsonLoose(text), ...target };
}

module.exports = { completeJson, probe, resolve, parseJsonLoose, PROVIDERS, _resetProbe: () => { probeCache = { at: 0, value: null }; } };
