const { startFixture } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const scrape = require('../src/core/scrape');
const { extract } = require('../src/core/extract');
const crawl = require('../src/core/crawl');

let fx;
test.before(async () => { fx = await startFixture(); });
test.after(async () => { await fx.close(); require('../src/core/store').closeDb(); });

test('fetchPage returns Markdown envelope with metadata and links', async () => {
    const r = await scrape.fetchPage({ url: fx.url + '/', mode: 'http', includeLinks: 'internal' });
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.equal(r.mode, 'http');
    assert.equal(r.format, 'markdown');
    assert.match(r.content, /^# Home Page/);
    assert.equal(r.metadata.description, 'Fixture home');
    assert.equal(r.metadata.openGraph.title, 'OG Home');
    assert.ok(r.links.every(l => l.internal));
    assert.ok(r.links.some(l => l.url.endsWith('/docs/3') && l.text === 'Doc 3'));
    assert.equal(typeof r.contentHash, 'string');
});

test('fetchPage paging, raw JSON, 404, redirect, binary', async () => {
    const p1 = await scrape.fetchPage({ url: fx.url + '/', mode: 'http', maxChars: 200 });
    assert.equal(p1.truncated, true);
    const p2 = await scrape.fetchPage({ url: fx.url + '/', mode: 'http', maxChars: 100000, offset: p1.nextOffset });
    assert.equal(p2.offset, p1.nextOffset);
    assert.equal(p1.totalChars, p2.totalChars);

    const j = await scrape.fetchPage({ url: fx.url + '/json', mode: 'http' });
    assert.deepEqual(JSON.parse(j.content), { hello: 'world', n: 1 });

    const missing = await scrape.fetchPage({ url: fx.url + '/missing', mode: 'http' });
    assert.equal(missing.ok, false);
    assert.equal(missing.status, 404);
    assert.equal(missing.error.code, 'HTTP_STATUS');

    const red = await scrape.fetchPage({ url: fx.url + '/redirect', mode: 'http' });
    assert.equal(red.finalUrl, fx.url + '/about');

    const bin = await scrape.fetchPage({ url: fx.url + '/binary', mode: 'http' });
    assert.equal(bin.format, 'binary');
    assert.match(bin.warnings[0], /Binary content/);
});

test('robots.txt is respected by default and can be overridden', async () => {
    await assert.rejects(scrape.fetchPage({ url: fx.url + '/private/secret', mode: 'http' }), { code: 'ROBOTS_DISALLOWED' });
    const r = await scrape.fetchPage({ url: fx.url + '/private/secret', mode: 'http', respectRobots: false });
    assert.equal(r.ok, true);
});

test('page cache serves repeats without hitting the network', async () => {
    const before = fx.requests.filter(u => u === '/about').length;
    await scrape.fetchPage({ url: fx.url + '/about', mode: 'http' });
    const again = await scrape.fetchPage({ url: fx.url + '/about', mode: 'http', format: 'text' });
    assert.equal(again.fromCache, true);
    assert.equal(fx.requests.filter(u => u === '/about').length, before + 1);
    const fresh = await scrape.fetchPage({ url: fx.url + '/about', mode: 'http', useCache: false });
    assert.equal(fresh.fromCache, false);
});

test('extract over HTTP (CSS list mode)', async () => {
    const r = await extract({ url: fx.url + '/products', mode: 'http', list: '.product', fields: { name: '.name', price: { selector: '.price', type: 'number' }, link: '.link@href' } });
    assert.equal(r.count, 2);
    assert.deepEqual(r.items[1], { name: 'Gadget', price: 5, link: fx.url + '/p/2' });
});

test('crawl is bounded by maxPages and depth, honors include/exclude and robots', async () => {
    const r = await crawl.startCrawl({ url: fx.url + '/', maxPages: 6, maxDepth: 1, mode: 'http' });
    assert.equal(r.status, 'completed');
    assert.equal(r.pages.length, 6);
    assert.ok(r.pages.every(p => p.depth <= 1));
    assert.ok(!r.pages.some(p => p.url.includes('/private/')), 'robots-disallowed URL never queued');
    assert.ok(!r.pages.some(p => p.url.endsWith('.pdf')));

    const filtered = await crawl.startCrawl({ url: fx.url + '/', maxPages: 50, maxDepth: 2, mode: 'http', include: ['/', '/docs/*'], exclude: ['/docs/1*'] });
    const urls = filtered.pages.map(p => new URL(p.url).pathname);
    assert.ok(urls.includes('/docs/2'));
    assert.ok(!urls.some(u => u.startsWith('/docs/1')), 'excluded /docs/1*');
    assert.ok(!urls.some(u => u.endsWith('/child')), 'include glob * does not cross /');
    assert.ok(!urls.includes('/blog/post-1'));

    const page = crawl.getCrawlPage(filtered.crawlId, fx.url + '/docs/2', { maxChars: 50 });
    assert.match(page.content, /^# Doc 2/);
    assert.equal(page.truncated, true);
});

test('crawl can seed from sitemap.xml and runs asynchronously', async () => {
    const started = await crawl.startCrawl({ url: fx.url + '/', maxPages: 10, maxDepth: 0, useSitemap: true, mode: 'http', waitMs: 0 });
    assert.equal(started.status, 'running');
    await crawl.waitForCrawl(started.crawlId);
    const done = crawl.getCrawl(started.crawlId);
    assert.equal(done.status, 'completed');
    assert.ok(done.pages.some(p => p.url.includes('/sitemapped/2')));
});

test('globToRegex semantics', () => {
    assert.ok(crawl.globToRegex('/docs/**').test('/docs/a/b'));
    assert.ok(!crawl.globToRegex('/docs/*').test('/docs/a/b'));
    assert.ok(crawl.globToRegex('*.html').test('page.html'));
});
