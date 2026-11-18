/**
 * Test setup: isolated data dir, private networks allowed (the fixture server
 * runs on 127.0.0.1), no politeness delays. Must be required before src/.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'siphon-test-'));
process.env.ALLOW_PRIVATE_NETWORKS = 'true';
process.env.ALLOW_PRIVATE_WEBHOOKS = 'true';
process.env.PER_HOST_MIN_INTERVAL_MS = '0';
process.env.PER_HOST_CONCURRENCY = '8';
process.env.RESPECT_ROBOTS = 'true';
process.env.STEALTHSIPHON_API_KEY = '';

const page = (title, body, extraHead = '') => `<!doctype html><html lang="en"><head><title>${title}</title>${extraHead}</head>
<body><nav><a href="/">Home</a> <a href="/about">About</a></nav><main><article><h1>${title}</h1>${body}</article></main>
<footer>Footer junk <a href="https://external.example.org/x">External</a></footer></body></html>`;

const LOREM = '<p>' + 'StealthSiphon test content sentence that is long enough to count as an article. '.repeat(8) + '</p>';

/**
 * Start a fixture site. `state` is mutable so tests can change content.
 * Returns { url, server, state, requests, close() }.
 */
async function startFixture() {
    const state = { watched: 'Version one of the watched content.', webhooks: [] };
    const requests = [];
    const server = http.createServer((req, res) => {
        requests.push(req.url);
        const u = new URL(req.url, 'http://x');
        const send = (status, body, type = 'text/html; charset=utf-8', headers = {}) => {
            res.writeHead(status, { 'Content-Type': type, ...headers });
            res.end(body);
        };
        switch (true) {
            case u.pathname === '/robots.txt':
                return send(200, 'User-agent: *\nDisallow: /private\nSitemap: ' + `http://127.0.0.1:${server.address().port}/sitemap.xml`, 'text/plain');
            case u.pathname === '/sitemap.xml':
                return send(200, `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
                    ${[1, 2, 3].map(i => `<url><loc>http://127.0.0.1:${server.address().port}/sitemapped/${i}</loc></url>`).join('')}</urlset>`, 'application/xml');
            case u.pathname === '/':
                return send(200, page('Home Page', LOREM + '<ul>' + Array.from({ length: 12 }, (_, i) => `<li><a href="/docs/${i}">Doc ${i}</a></li>`).join('') +
                    '<li><a href="/blog/post-1">Blog</a></li><li><a href="/private/secret">Secret</a></li><li><a href="/file.pdf">PDF</a></li><li><a href="mailto:a@b.c">Mail</a></li></ul>',
                    '<meta name="description" content="Fixture home"><meta property="og:title" content="OG Home"><link rel="canonical" href="/"><script type="application/ld+json">{"@type":"WebSite","name":"Fixture"}</script>'));
            case u.pathname.startsWith('/docs/'): {
                const n = parseInt(u.pathname.split('/')[2], 10);
                return send(200, page(`Doc ${n}`, LOREM + `<a href="/docs/${n}/child">Child of ${n}</a>`));
            }
            case u.pathname.startsWith('/blog/'):
            case u.pathname.startsWith('/sitemapped/'):
            case u.pathname === '/about':
                return send(200, page(`Page ${u.pathname}`, LOREM));
            case u.pathname === '/private/secret':
                return send(200, page('Secret', LOREM));
            case u.pathname === '/products':
                return send(200, page('Products', `<div class="product"><h2 class="name">Widget</h2><span class="price">$19.99</span><a class="link" href="/p/1">view</a><span class="tag">a</span><span class="tag">b</span></div>
                    <div class="product"><h2 class="name">Gadget</h2><span class="price">$5</span><a class="link" href="/p/2">view</a></div>`));
            case u.pathname === '/json':
                return send(200, JSON.stringify({ hello: 'world', n: 1 }), 'application/json');
            case u.pathname === '/missing':
                return send(404, page('Not Found', '<p>nope</p>'));
            case u.pathname === '/redirect':
                return send(302, '', 'text/plain', { Location: '/about' });
            case u.pathname === '/watched':
                return send(200, page('Watched', `<div id="w"><p>${state.watched}</p></div>` + LOREM));
            case u.pathname === '/js-app':
                return send(200, `<!doctype html><html><head><title>JS App</title></head><body><div id="root"></div>
                    <script>setTimeout(() => { document.getElementById('root').innerHTML = '<h1>Rendered by JS</h1><p>' + 'Client side content. '.repeat(30) + '</p>'; }, 50);</script></body></html>`);
            case u.pathname === '/form':
                return send(200, `<!doctype html><html><head><title>Form</title></head><body><h1>Search</h1>
                    <input id="q" name="q" placeholder="Search terms"><button id="go" onclick="document.getElementById('out').textContent='You searched: ' + document.getElementById('q').value">Go</button>
                    <select id="color"><option value="red">Red</option><option value="blue">Blue</option></select><div id="out"></div></body></html>`);
            case u.pathname === '/binary':
                return send(200, Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]), 'application/pdf');
            case u.pathname === '/hook' && req.method === 'POST': {
                let body = '';
                req.on('data', c => { body += c; });
                req.on('end', () => { state.webhooks.push(JSON.parse(body)); send(200, 'ok', 'text/plain'); });
                return;
            }
            default:
                return send(404, 'not found', 'text/plain');
        }
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}`;
    return { url, server, state, requests, close: () => new Promise(r => { server.closeAllConnections?.(); server.close(r); }) };
}

module.exports = { startFixture };
