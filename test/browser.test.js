const { startFixture } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const browser = require('../src/core/browser');
const scrape = require('../src/core/scrape');

const skip = !browser.isAvailable() && 'Chrome not installed (set CHROME_PATH to run browser tests)';

let fx;
test.before(async () => { fx = await startFixture(); });
test.after(async () => { await browser.closeBrowser(); await fx.close(); require('../src/core/store').closeDb(); });

test('auto mode upgrades JS-rendered pages to the browser', { skip }, async () => {
    const http = await scrape.fetchPage({ url: fx.url + '/js-app', mode: 'http', useCache: false });
    assert.doesNotMatch(http.content, /Rendered by JS/);
    const auto = await scrape.fetchPage({ url: fx.url + '/js-app', mode: 'auto', useCache: false });
    assert.equal(auto.mode, 'browser');
    assert.match(auto.content, /# Rendered by JS/);
    assert.match(auto.warnings.join(), /JavaScript-rendered/);
});

test('screenshot returns real image bytes', { skip }, async () => {
    const png = await scrape.screenshot({ url: fx.url + '/products' });
    assert.deepEqual([...png.image.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    const jpg = await scrape.screenshot({ url: fx.url + '/products', type: 'jpeg', selector: '.product' });
    assert.deepEqual([...jpg.image.subarray(0, 2)], [0xff, 0xd8]);
});

test('interactive session: snapshot refs, type, click, select, evaluate', { skip }, async () => {
    const { sessionId } = await browser.openSession({ url: fx.url + '/form' });
    try {
        const snap = await browser.sessionSnapshot(sessionId);
        const input = snap.elements.find(e => e.role === 'textbox');
        const button = snap.elements.find(e => e.role === 'button' && e.name === 'Go');
        assert.ok(input && button);
        await browser.sessionType(sessionId, { ref: input.ref, value: 'redwoods' });
        await browser.sessionClick(sessionId, { ref: button.ref });
        const after = await browser.sessionSnapshot(sessionId);
        assert.match(after.text, /You searched: redwoods/);
        await browser.sessionClick(sessionId, { text: 'Go' });
        const sel = await browser.sessionSelect(sessionId, { selector: '#color', values: ['blue'] });
        assert.deepEqual(sel.selected, ['blue']);
        const ev = await browser.sessionEvaluate(sessionId, "document.querySelector('#color').value");
        assert.equal(ev.result, 'blue');
        await assert.rejects(browser.sessionClick(sessionId, { selector: '#does-not-exist' }), { code: 'NOT_FOUND' });
    } finally {
        assert.equal(await browser.closeSession(sessionId), true);
    }
    await assert.rejects(browser.sessionSnapshot(sessionId), { code: 'NOT_FOUND' });
});

test('browser blocks requests to private hosts when not allowed', { skip }, async () => {
    const config = require('../src/config');
    config.allowPrivateNetworks = false;
    try {
        await assert.rejects(browser.render(fx.url + '/'), { code: 'BLOCKED_URL' });
    } finally {
        config.allowPrivateNetworks = true;
    }
});
