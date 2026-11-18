/**
 * Central configuration. Values come from environment variables (optionally a
 * .env file in the project root) and can be mutated at runtime (tests do this).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Parse .env text: KEY=value, optional quotes, full-line and inline (" #") comments. */
function parseDotenv(text) {
    const out = {};
    for (const line of text.split(/\r?\n/)) {
        if (/^\s*(#|$)/.test(line)) continue;
        const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i);
        if (!m) continue;
        let value = m[2].trim();
        const quoted = value.match(/^(['"])(.*?)\1/);
        if (quoted) value = quoted[2];
        else value = value.startsWith('#') ? '' : value.replace(/\s+#.*$/, '').trim();
        out[m[1]] = value;
    }
    return out;
}

// Minimal .env loader (no dependency). Existing env vars win.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
    for (const [k, v] of Object.entries(parseDotenv(fs.readFileSync(envFile, 'utf8')))) {
        if (process.env[k] === undefined) process.env[k] = v;
    }
}

const env = (name, fallback) => (process.env[name] !== undefined && process.env[name] !== '' ? process.env[name] : fallback);
const bool = (name, fallback) => {
    const v = env(name, undefined);
    return v === undefined ? fallback : /^(1|true|yes|on)$/i.test(v);
};
const int = (name, fallback) => {
    const v = parseInt(env(name, ''), 10);
    return Number.isFinite(v) ? v : fallback;
};

const config = {
    root: ROOT,
    dataDir: path.resolve(ROOT, env('DATA_DIR', 'data')),

    // Server
    host: env('HOST', '127.0.0.1'),
    port: int('PORT', 4200),
    apiKey: env('STEALTHSIPHON_API_KEY', ''),
    corsOrigins: env('CORS_ORIGINS', '').split(',').map(s => s.trim()).filter(Boolean),

    // Network safety
    allowPrivateNetworks: bool('ALLOW_PRIVATE_NETWORKS', false),
    maxResponseBytes: int('MAX_RESPONSE_BYTES', 15 * 1024 * 1024),
    requestTimeoutMs: int('REQUEST_TIMEOUT_MS', 30000),

    // Politeness
    respectRobotsByDefault: bool('RESPECT_ROBOTS', true),
    perHostConcurrency: int('PER_HOST_CONCURRENCY', 2),
    perHostMinIntervalMs: int('PER_HOST_MIN_INTERVAL_MS', 250),
    userAgent: env('USER_AGENT', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'),
    robotsUserAgent: env('ROBOTS_USER_AGENT', 'StealthSiphon'),

    // Cache
    cacheTtlMs: int('CACHE_TTL_MS', 5 * 60 * 1000),
    cacheMaxEntries: int('CACHE_MAX_ENTRIES', 200),

    // Browser
    chromePath: env('CHROME_PATH', ''),
    browserHeadless: bool('BROWSER_HEADLESS', true),
    maxBrowserSessions: int('MAX_BROWSER_SESSIONS', 5),
    browserSessionIdleMs: int('BROWSER_SESSION_IDLE_MS', 10 * 60 * 1000),
    allowEvaluate: bool('ALLOW_EVALUATE', true),

    // LLM extraction: auto | lmstudio | ollama | openai (any OpenAI-compatible server)
    llmProvider: env('LLM_PROVIDER', 'auto'),
    llmTimeoutMs: int('LLM_TIMEOUT_MS', 180000),
    lmstudioUrl: env('LMSTUDIO_URL', 'http://127.0.0.1:1234'),
    lmstudioModel: env('LMSTUDIO_MODEL', ''), // empty = the model currently loaded in LM Studio
    ollamaUrl: env('OLLAMA_URL', 'http://127.0.0.1:11434'),
    ollamaModel: env('OLLAMA_MODEL', ''), // empty = first installed model
    openaiCompatUrl: env('OPENAI_COMPAT_URL', ''),
    openaiCompatModel: env('OPENAI_COMPAT_MODEL', ''),
    openaiCompatApiKey: env('OPENAI_COMPAT_API_KEY', ''),

    // Webhooks may target private networks only if explicitly allowed
    allowPrivateWebhooks: bool('ALLOW_PRIVATE_WEBHOOKS', false),

    // Optional DB export targets (legacy UI feature)
    mongoUrl: env('MONGODB_URL', ''),
    mysqlUrl: env('MYSQL_URL', ''),
};

module.exports = config;
module.exports.parseDotenv = parseDotenv;
