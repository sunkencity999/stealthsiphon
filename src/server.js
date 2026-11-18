/**
 * HTTP server: web UI (public/), REST API (/api), MCP over Streamable HTTP
 * (/mcp), and legacy raw endpoints used by the original UI.
 */
const path = require('path');
const express = require('express');
const config = require('./config');
const { createApiRouter, createLegacyRouter, errorHandler } = require('./api');
const { createMcpServer } = require('./mcp');
const scheduler = require('./scheduler');
const browser = require('./core/browser');
const store = require('./core/store');
const exporters = require('./exporters');
const { SiphonError, E } = require('./core/errors');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * Reject requests whose Host header isn't ours when bound to loopback
 * (defeats DNS-rebinding attacks from web pages), and cross-origin browser
 * requests from origins not in CORS_ORIGINS (CSRF).
 */
function originGuard(req, res, next) {
    const hostHeader = (req.headers.host || '').toLowerCase();
    const hostname = hostHeader.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    if (LOOPBACK.has(config.host) && !LOOPBACK.has(hostname) && hostname !== config.host) {
        return next(new SiphonError(E.UNAUTHORIZED, `Host "${hostHeader}" not allowed`, { status: 403 }));
    }
    const origin = req.headers.origin;
    if (origin) {
        let sameOrigin = false;
        try { sameOrigin = new URL(origin).host.toLowerCase() === hostHeader; } catch { /* ignore */ }
        const allowed = sameOrigin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin);
        if (!allowed) return next(new SiphonError(E.UNAUTHORIZED, `Origin ${origin} not allowed (set CORS_ORIGINS)`, { status: 403 }));
        if (!sameOrigin) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, Mcp-Session-Id, Mcp-Protocol-Version');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
            res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
            if (req.method === 'OPTIONS') return res.status(204).end();
        }
    }
    next();
}

function apiKeyGuard(req, _res, next) {
    if (!config.apiKey) return next();
    const auth = req.headers.authorization || '';
    const key = req.headers['x-api-key'] || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
    if (key === config.apiKey) return next();
    next(new SiphonError(E.UNAUTHORIZED, 'Missing or invalid API key', { status: 401 }));
}

function createApp() {
    const app = express();
    app.disable('x-powered-by');
    app.use(originGuard);
    app.use(express.json({ limit: '5mb' }));

    // MCP over Streamable HTTP (stateless: a fresh server per request; browser
    // sessions and crawls live in shared module state keyed by id).
    app.post('/mcp', apiKeyGuard, async (req, res, next) => {
        try {
            const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
            const server = createMcpServer();
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
            res.on('close', () => { transport.close(); server.close(); });
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (err) {
            next(err);
        }
    });
    app.all('/mcp', (_req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed (stateless server: use POST)' }, id: null }));

    app.use('/api', apiKeyGuard, createApiRouter());
    app.use(['/proxy', '/headless-proxy', '/export-to-db'], apiKeyGuard);
    app.use(createLegacyRouter());

    app.use('/image', express.static(path.join(config.root, 'image')));
    app.use(express.static(path.join(config.root, 'public'), { extensions: ['html'] }));
    app.use((req, res, next) => {
        // SPA fallback only for extension-less paths; missing files get a real 404
        if (req.method !== 'GET' || path.extname(req.path)) return next(new SiphonError(E.NOT_FOUND, 'Not found', { status: 404 }));
        res.sendFile(path.join(config.root, 'public', 'index.html'));
    });
    app.use(errorHandler);
    return app;
}

async function shutdown(server) {
    scheduler.stop();
    await new Promise(r => (server ? server.close(() => r()) : r()));
    await browser.closeBrowser();
    await exporters.closeAll();
    store.closeDb();
}

function start() {
    const app = createApp();
    const sched = scheduler.start();
    const server = app.listen(config.port, config.host, () => {
        const base = `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${config.port}`;
        console.log(`StealthSiphon running at ${base}`);
        console.log(`  Web UI:   ${base}/`);
        console.log(`  REST API: ${base}/api/health`);
        console.log(`  MCP:      ${base}/mcp (Streamable HTTP)`);
        console.log(`  Browser:  ${browser.findChrome() || 'not found (set CHROME_PATH)'}`);
        console.log(`  Tasks:    ${sched.tasks} saved${sched.leader ? '' : ' (another process is running the scheduler)'}`);
        if (!LOOPBACK.has(config.host) && !config.apiKey) {
            console.warn('  WARNING: listening on a non-loopback address without STEALTHSIPHON_API_KEY.');
        }
    });
    let closing = false;
    const stop = async () => {
        if (closing) return;
        closing = true;
        console.log('Shutting down...');
        await shutdown(server).catch(() => {});
        process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return server;
}

if (require.main === module) start();

module.exports = { createApp, start, shutdown };
