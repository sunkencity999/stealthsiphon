require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const content = require('../src/core/content');
const { extractFromHtml, normalizeSpec } = require('../src/core/extract');

const ARTICLE = `<html><head><title>T</title><meta name="description" content="D">
<meta property="og:title" content="OG"><script type="application/ld+json">{"@type":"Article","headline":"H"}</script>
<link rel="canonical" href="/canon"></head><body>
<nav><a href="/nav">Nav link</a></nav>
<article><h1>Headline</h1>${'<p>Body paragraph with enough words to be considered the main article content by readability. </p>'.repeat(6)}
<p>See <a href="/rel" title="noise">relative link</a> and <img src="/i.png" alt="An image"> <img src="/pixel.gif"></p>
<table><tr><th>A</th><th>B</th></tr><tr><td><p>multi</p><p>line</p></td><td>2</td></tr></table></article>
<footer>Copyright junk</footer><script>var x = 1;</script></body></html>`;

test('htmlToMarkdown keeps main content, absolutizes links, drops chrome and titles', () => {
    const { markdown, title } = content.htmlToMarkdown(ARTICLE, 'https://site.test/dir/page');
    assert.equal(title, 'T');
    assert.match(markdown, /Body paragraph/);
    assert.match(markdown, /\[relative link\]\(https:\/\/site\.test\/rel\)/);
    assert.doesNotMatch(markdown, /noise/, 'link titles removed');
    assert.match(markdown, /!\[An image\]\(https:\/\/site\.test\/i\.png\)/);
    assert.doesNotMatch(markdown, /pixel\.gif/, 'alt-less images dropped');
    assert.doesNotMatch(markdown, /Copyright junk|Nav link|var x/);
    assert.match(markdown, /\| multi line \| 2 \|/, 'table cells collapsed to one line');
});

test('htmlToMarkdown with selector returns only matching elements', () => {
    const r = content.htmlToMarkdown(ARTICLE, 'https://site.test/', { selector: 'table' });
    assert.equal(r.matched, 1);
    assert.doesNotMatch(r.markdown, /Body paragraph/);
});

test('htmlToText produces readable text without scripts', () => {
    const t = content.htmlToText('<body><h1>A</h1><p>B <b>c</b></p><script>bad()</script><ul><li>x</li><li>y</li></ul></body>');
    assert.equal(t, 'A\n\nB c\n\nx\n\ny');
});

test('extractMetadata reads meta, OpenGraph, JSON-LD and canonical', () => {
    const m = content.extractMetadata(ARTICLE, 'https://site.test/x');
    assert.equal(m.title, 'T');
    assert.equal(m.description, 'D');
    assert.equal(m.canonical, 'https://site.test/canon');
    assert.equal(m.openGraph.title, 'OG');
    assert.deepEqual(m.jsonLd, [{ '@type': 'Article', headline: 'H' }]);
});

test('extractLinks dedupes, resolves, flags internal, skips mailto/js', () => {
    const html = '<a href="/a">A</a><a href="/a#x">A again</a><a href="https://other.test/">O</a><a href="mailto:x@y">M</a><a href="javascript:void 0">J</a>';
    const links = content.extractLinks(html, 'https://site.test/');
    assert.deepEqual(links, [
        { url: 'https://site.test/a', text: 'A', internal: true },
        { url: 'https://other.test/', text: 'O', internal: false },
    ]);
});

test('paginate cuts at paragraph boundaries and reports nextOffset', () => {
    const text = 'para one is here.\n\npara two is here.\n\npara three is here.';
    const p1 = content.paginate(text, { maxChars: 30 });
    assert.equal(p1.content, 'para one is here.');
    assert.equal(p1.truncated, true);
    const p2 = content.paginate(text, { offset: p1.nextOffset, maxChars: 1000 });
    assert.equal(p2.truncated, false);
    assert.equal(p1.content + p2.content, text);
    assert.equal(content.paginate(text, {}).truncated, false);
});

test('looksLikeJsShell distinguishes SPA shells from small static pages', () => {
    assert.equal(content.looksLikeJsShell('<html><body><div id="root"></div><script src="/app.js"></script></body></html>'), true);
    assert.equal(content.looksLikeJsShell('<html><body><p>Small static page with no scripts.</p></body></html>'), false);
    assert.equal(content.looksLikeJsShell(ARTICLE), false);
});

test('CSS extraction: fields, @attr shorthand, list mode, number and all', () => {
    const html = `<div class="p"><h2>Widget</h2><span class="price">$1,299.50</span><a href="/w">x</a><i>a</i><i>b</i></div>
                  <div class="p"><h2>Gadget</h2><span class="price">n/a</span><a href="/g">x</a></div>`;
    const one = extractFromHtml(html, 'https://s.test/', { fields: { name: 'h2', link: 'a@href' } });
    assert.deepEqual(one.data, { name: 'Widget', link: 'https://s.test/w' });
    const list = extractFromHtml(html, 'https://s.test/', {
        list: '.p', fields: { name: 'h2', price: { selector: '.price', type: 'number' }, tags: { selector: 'i', all: true }, missing: '.nope' },
    });
    assert.equal(list.count, 2);
    assert.deepEqual(list.items[0], { name: 'Widget', price: 1299.5, tags: ['a', 'b'], missing: null });
    assert.deepEqual(list.items[1], { name: 'Gadget', price: null, tags: [], missing: null });
});

test('normalizeSpec does not split attribute selectors containing @', () => {
    assert.deepEqual(normalizeSpec('a[href*="@"]'), { selector: 'a[href*="@"]' });
    assert.deepEqual(normalizeSpec('img.hero@src'), { selector: 'img.hero', attr: 'src' });
    assert.throws(() => extractFromHtml('<p></p>', 'https://s.test/', { fields: {} }), { code: 'BAD_REQUEST' });
});
