/**
 * Turn raw HTML into agent-friendly output: clean Markdown (main content only),
 * plain text, metadata (OpenGraph, JSON-LD, ...), and a link inventory.
 */
const cheerio = require('cheerio');
const { JSDOM, VirtualConsole } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const TurndownService = require('turndown');
const { gfm } = require('turndown-plugin-gfm');

const NOISE_SELECTORS = 'script, style, noscript, template, svg, canvas, iframe, link, meta';
// Boilerplate that Readability sometimes keeps (wiki infoboxes, edit links, cookie banners, ...)
const CHROME_SELECTORS = '.infobox, .navbox, .vertical-navbox, .sidebar, .mw-editsection, sup.reference, .reference, .noprint, .mw-jump-link, '
    + '[role="navigation"], [aria-label="breadcrumb"], .cookie-banner, #cookie-banner, .cookie-consent, [id*="cookie-consent"]';

function makeTurndown() {
    const td = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
        emDelimiter: '_',
    });
    td.use(gfm);
    // Table cells must be single-line in GFM; collapse block content inside cells
    td.addRule('tableCellCompact', {
        filter: ['th', 'td'],
        replacement: (text, node) => {
            const index = Array.prototype.indexOf.call(node.parentNode.childNodes, node);
            const cell = text.replace(/\s*\n+\s*/g, ' ').replace(/\|/g, '\\|').trim();
            return (index === 0 ? '| ' : ' ') + cell + ' |';
        },
    });
    td.remove(['script', 'style', 'noscript', 'template', 'iframe', 'form', 'button', 'select', 'input', 'textarea']);
    // Links: drop title attributes (token waste) and links with no visible text
    td.addRule('compactLinks', {
        filter: (node) => node.nodeName === 'A' && node.getAttribute('href'),
        replacement: (text, node) => {
            const label = text.replace(/\s*\n+\s*/g, ' ').trim();
            if (!label) return '';
            const href = node.getAttribute('href');
            if (/^(javascript|data):/i.test(href)) return label;
            return `[${label}](${href.replace(/\)/g, '%29').replace(/ /g, '%20')})`;
        },
    });
    // Drop images with no alt text (pure decoration / tracking pixels)
    td.addRule('images', {
        filter: 'img',
        replacement: (_c, node) => {
            const alt = (node.getAttribute('alt') || '').trim();
            const src = node.getAttribute('src') || '';
            if (!alt || !src || src.startsWith('data:')) return '';
            return `![${alt.replace(/[\[\]]/g, '')}](${src})`;
        },
    });
    return td;
}
const turndown = makeTurndown();

function collapseMarkdown(md) {
    return md
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function makeDom(html, url) {
    const virtualConsole = new VirtualConsole(); // swallow CSS parse noise
    return new JSDOM(html, { url, virtualConsole });
}

/** Absolutize href/src attributes so Markdown links work out of context. */
function absolutize(doc, baseUrl) {
    for (const el of doc.querySelectorAll('a[href]')) {
        try { el.setAttribute('href', new URL(el.getAttribute('href'), baseUrl).href); } catch { /* ignore */ }
    }
    for (const el of doc.querySelectorAll('img[src]')) {
        try { el.setAttribute('src', new URL(el.getAttribute('src'), baseUrl).href); } catch { /* ignore */ }
    }
}

/**
 * HTML -> Markdown.
 * @param {string} html
 * @param {string} url  base URL for resolving links
 * @param {{mainContent?: boolean, selector?: string}} opts
 */
function htmlToMarkdown(html, url, { mainContent = true, selector } = {}) {
    const dom = makeDom(html, url);
    const doc = dom.window.document;
    try {
        absolutize(doc, url);
        doc.querySelectorAll(NOISE_SELECTORS).forEach(n => n.remove());

        if (selector) {
            const nodes = [...doc.querySelectorAll(selector)];
            const md = nodes.map(n => turndown.turndown(n.outerHTML)).join('\n\n---\n\n');
            return { markdown: collapseMarkdown(md), title: doc.title || '', matched: nodes.length };
        }

        if (mainContent) {
            doc.querySelectorAll(CHROME_SELECTORS).forEach(n => n.remove());
            const clone = doc.cloneNode(true);
            const article = new Readability(clone, { charThreshold: 200 }).parse();
            if (article && article.content && (article.textContent || '').trim().length > 200) {
                let md = turndown.turndown(article.content);
                const title = article.title || doc.title || '';
                if (title && !md.startsWith('# ')) md = `# ${title}\n\n${md}`;
                return { markdown: collapseMarkdown(md), title, byline: article.byline || undefined, excerpt: article.excerpt || undefined };
            }
        }

        // Fallback: whole body minus obvious chrome
        doc.querySelectorAll('nav, footer, header[role="banner"], aside, [aria-hidden="true"], [hidden]').forEach(n => n.remove());
        const body = doc.body ? doc.body.innerHTML : html;
        return { markdown: collapseMarkdown(turndown.turndown(body)), title: doc.title || '' };
    } finally {
        dom.window.close();
    }
}

function htmlToText(html, { selector } = {}) {
    const $ = cheerio.load(html);
    $(NOISE_SELECTORS).remove();
    const root = selector ? $(selector) : $('body').length ? $('body') : $.root();
    // Insert line breaks at block boundaries before taking text
    root.find('br').replaceWith('\n');
    root.find('p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, header, footer, blockquote, pre').each((_i, el) => {
        $(el).prepend('\n').append('\n');
    });
    return root.text().replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractMetadata(html, url) {
    const $ = cheerio.load(html);
    const meta = (sel) => $(sel).attr('content') || undefined;
    const og = {};
    $('meta[property^="og:"]').each((_i, el) => { og[$(el).attr('property').slice(3)] = $(el).attr('content'); });
    const twitter = {};
    $('meta[name^="twitter:"]').each((_i, el) => { twitter[$(el).attr('name').slice(8)] = $(el).attr('content'); });
    const jsonLd = [];
    $('script[type="application/ld+json"]').each((_i, el) => {
        try { jsonLd.push(JSON.parse($(el).contents().text())); } catch { /* ignore malformed */ }
    });
    let canonical = $('link[rel="canonical"]').attr('href');
    try { if (canonical) canonical = new URL(canonical, url).href; } catch { /* ignore */ }
    const feeds = $('link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"]')
        .map((_i, el) => { try { return new URL($(el).attr('href'), url).href; } catch { return null; } }).get().filter(Boolean);

    const out = {
        title: ($('title').first().text() || og.title || '').trim() || undefined,
        description: meta('meta[name="description"]') || og.description,
        canonical,
        lang: $('html').attr('lang') || undefined,
        author: meta('meta[name="author"]'),
        published: meta('meta[property="article:published_time"]') || meta('meta[name="date"]'),
        modified: meta('meta[property="article:modified_time"]'),
        keywords: meta('meta[name="keywords"]'),
        robots: meta('meta[name="robots"]'),
        feeds: feeds.length ? feeds : undefined,
        openGraph: Object.keys(og).length ? og : undefined,
        twitter: Object.keys(twitter).length ? twitter : undefined,
        jsonLd: jsonLd.length ? jsonLd : undefined,
    };
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
}

/** Inventory of links with anchor text and internal/external flag. */
function extractLinks(html, url, { limit = 500 } = {}) {
    const $ = cheerio.load(html);
    const base = new URL(url);
    const seen = new Map();
    $('a[href]').each((_i, el) => {
        const raw = ($(el).attr('href') || '').trim();
        if (!raw || raw.startsWith('#') || /^(javascript|mailto|tel|data):/i.test(raw)) return;
        let abs;
        try { abs = new URL(raw, base); } catch { return; }
        if (!['http:', 'https:'].includes(abs.protocol)) return;
        abs.hash = '';
        const href = abs.href;
        const text = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 200) || ($(el).attr('aria-label') || $(el).attr('title') || '').trim();
        if (seen.has(href)) {
            const prev = seen.get(href);
            if (!prev.text && text) prev.text = text;
            return;
        }
        const link = { url: href, text, internal: abs.hostname === base.hostname };
        const rel = $(el).attr('rel');
        if (rel) link.rel = rel;
        seen.set(href, link);
    });
    return [...seen.values()].slice(0, limit);
}

/** Slice long content so agents can page through it within a token budget. */
function paginate(content, { offset = 0, maxChars } = {}) {
    const total = content.length;
    if (!maxChars || maxChars <= 0) return { content, totalChars: total, offset: 0, truncated: false };
    const start = Math.max(0, Math.min(offset, total));
    let end = Math.min(total, start + maxChars);
    // Prefer to cut at a paragraph or line boundary
    if (end < total) {
        const para = content.lastIndexOf('\n\n', end);
        const line = content.lastIndexOf('\n', end);
        if (para > start + maxChars * 0.5) end = para;
        else if (line > start + maxChars * 0.5) end = line;
    }
    const out = { content: content.slice(start, end), totalChars: total, offset: start, truncated: end < total };
    if (end < total) out.nextOffset = end;
    return out;
}

/**
 * Heuristic: does this HTML look like a client-rendered shell that needs JS?
 */
function looksLikeJsShell(html) {
    if (!html) return true;
    const $ = cheerio.load(html);
    const hasScripts = $('script').filter((_i, el) => {
        const type = ($(el).attr('type') || '').toLowerCase();
        return !type || /javascript|module/.test(type);
    }).length > 0;
    const rootEmpty = ['#root', '#app', '#__next', '#__nuxt', '[ng-app]', '#svelte'].some(sel => {
        const el = $(sel);
        return el.length && el.text().trim().length < 50;
    });
    $('script, style, noscript, template, svg').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    if (text.length < 250) return hasScripts || rootEmpty;
    if (/enable javascript|javascript is (required|disabled)|you need to enable javascript/i.test(html) && text.length < 1500) return true;
    return rootEmpty && text.length < 1500;
}

module.exports = { htmlToMarkdown, htmlToText, extractMetadata, extractLinks, paginate, looksLikeJsShell };
