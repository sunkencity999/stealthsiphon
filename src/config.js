/**
 * Central configuration. Values come from environment variables (optionally a
 * .env file in the project root) and can be mutated at runtime (tests do this).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Minimal .env loader (no dependency). Existing env vars win.
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
        if (!m || line.trim().startsWith('#')) continue;
        const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
        if (process.env[m[1]] === undefined) process.env[m[1]] = value;
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

    // LLM extraction (Ollama)
    ollamaUrl: env('OLLAMA_URL', 'http://127.0.0.1:11434'),
    ollamaModel: env('OLLAMA_MODEL', 'llama3.1'),

    // Webhooks may target private networks only if explicitly allowed
    allowPrivateWebhooks: bool('ALLOW_PRIVATE_WEBHOOKS', false),

    // Optional DB export targets (legacy UI feature)
    mongoUrl: env('MONGODB_URL', ''),
    mysqlUrl: env('MYSQL_URL', ''),
};

module.exports = config;
