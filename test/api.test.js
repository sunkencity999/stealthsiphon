const { startFixture } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { createApp } = require('../src/server');

let fx, server, base;
test.before(async () => {
    fx = await startFixture();
    server = createApp().listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
    server.closeAllConnections?.();
    await new Promise(r => server.close(r));
    await fx.close();
    require('../src/core/store').closeDb();
});

const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('health and fetch endpoints', async () => {
    const h = await (await fetch(base + '/api/health')).json();
    assert.equal(h.ok, true);
    const r = await (await post('/api/fetch', { url: fx.url + '/about', mode: 'http', maxChars: 50 })).json();
    assert.equal(r.ok, true);
    assert.equal(r.truncated, true);
    const g = await (await fetch(`${base}/api/fetch?url=${encodeURIComponent(fx.url + '/about')}&mode=http&format=text&maxChars=20`)).json();
    assert.equal(g.format, 'text');
    assert.ok(g.content.length <= 20);
});

test('errors use a stable JSON shape without stack traces', async () => {
    const bad = await post('/api/fetch', { url: 'ftp://nope' });
    assert.equal(bad.status, 400);
    const body = await bad.json();
    assert.deepEqual(body, { ok: false, error: { code: 'BLOCKED_URL', message: 'Only http and https URLs are allowed (got ftp:)' } });
    const unknown = await fetch(base + '/api/nope');
    assert.equal(unknown.status, 404);
    const invalid = await fetch(base + '/api/fetch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
    assert.equal((await invalid.json()).error.code, 'BAD_REQUEST');
});

test('extract, links, crawl and task endpoints', async () => {
    const ex = await (await post('/api/extract', { url: fx.url + '/products', mode: 'http', list: '.product', fields: { name: '.name' } })).json();
    assert.deepEqual(ex.items.map(i => i.name), ['Widget', 'Gadget']);
    const links = await (await post('/api/links', { url: fx.url + '/', mode: 'http', filter: 'external' })).json();
    assert.deepEqual(links.links.map(l => l.url), ['https://external.example.org/x']);

    const started = await post('/api/crawl', { url: fx.url + '/', maxPages: 3, maxDepth: 1, mode: 'http' });
    assert.equal(started.status, 202);
    const { crawlId } = await started.json();
    await require('../src/core/crawl').waitForCrawl(crawlId);
    const done = await (await fetch(`${base}/api/crawl/${crawlId}`)).json();
    assert.equal(done.status, 'completed');
    assert.equal(done.pages.length, 3);

    const created = await post('/api/tasks', { name: 't', url: fx.url + '/about', schedule: '0 0 1 1 *', mode: 'http' });
    assert.equal(created.status, 201);
    const task = await created.json();
    const run = await (await post(`/api/tasks/${task.id}/run?wait=true`, {})).json();
    assert.equal(run.status, 'success');
    const legacyList = await (await fetch(base + '/api/scheduler/tasks')).json();
    assert.ok(legacyList.some(t => t.id === task.id));
    assert.equal((await fetch(`${base}/api/tasks/${task.id}`, { method: 'DELETE' })).status, 204);
});

test('legacy endpoints still serve the original UI', async () => {
    const proxied = await fetch(`${base}/proxy?url=${encodeURIComponent(fx.url + '/json')}`);
    assert.match(proxied.headers.get('content-type'), /^application\/json/);
    assert.deepEqual(await proxied.json(), { hello: 'world', n: 1 });
    const exp = await (await post('/export-to-db', { url: 'https://x.test', data: { a: 1 }, dbType: 'sqlite' })).json();
    assert.equal(exp.success, true);
    const legacyErr = await (await post('/export-to-db', { url: 'x', data: 1, dbType: 'oracle' })).json();
    assert.equal(legacyErr.success, false);
    assert.match(legacyErr.message, /dbType must be/);
    const index = await fetch(base + '/');
    assert.match(await index.text(), /<html/i);
    assert.equal((await fetch(base + '/scraped_data.db')).status, 404);
    assert.equal((await fetch(base + '/package.json')).status, 404);
});

test('host header and cross-origin guards', async () => {
    const http = require('http');
    const status = await new Promise((resolve) => {
        http.get({ host: '127.0.0.1', port: server.address().port, path: '/api/health', headers: { Host: 'attacker.test' } }, res => { res.resume(); resolve(res.statusCode); });
    });
    assert.equal(status, 403, 'DNS-rebinding style Host header rejected');
    const cross = await post('/api/fetch', { url: fx.url }, { Origin: 'https://evil.test' });
    assert.equal(cross.status, 403);
    config.corsOrigins = ['https://good.test'];
    try {
        const ok = await fetch(base + '/api/health', { headers: { Origin: 'https://good.test' } });
        assert.equal(ok.status, 200);
        assert.equal(ok.headers.get('access-control-allow-origin'), 'https://good.test');
    } finally {
        config.corsOrigins = [];
    }
});

test('API key protects /api, /mcp and legacy endpoints', async () => {
    config.apiKey = 'sekret';
    try {
        assert.equal((await fetch(base + '/api/health')).status, 401);
        assert.equal((await fetch(base + '/api/health', { headers: { Authorization: 'Bearer sekret' } })).status, 200);
        assert.equal((await fetch(base + '/api/health', { headers: { 'X-API-Key': 'sekret' } })).status, 200);
        assert.equal((await fetch(`${base}/proxy?url=x`)).status, 401);
        assert.equal((await post('/mcp', {})).status, 401);
        assert.equal((await fetch(base + '/')).status, 200, 'static UI stays public');
    } finally {
        config.apiKey = '';
    }
});

test('MCP over Streamable HTTP lists tools', async () => {
    const res = await post('/mcp', { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
        { Accept: 'application/json, text/event-stream' });
    assert.equal(res.status, 200);
    const init = await res.json();
    assert.equal(init.result.serverInfo.name, 'stealthsiphon');
    const list = await (await post('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { Accept: 'application/json, text/event-stream' })).json();
    assert.ok(list.result.tools.some(t => t.name === 'fetch_page'));
});
