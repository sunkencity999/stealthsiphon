/**
 * The main entry point: fetch a page (HTTP, browser, or auto) and shape it
 * into a consistent, agent-friendly result envelope.
 */
const crypto = require('crypto');
const config = require('../config');
const { httpFetch } = require('./http');
const browser = require('./browser');
const robots = require('./robots');
const { TtlCache } = require('./cache');
const { parseUrl } = require('./safety');
const { SiphonError, E } = require('./errors');
const content = require('./content');

const pageCache = new TtlCache();

const FORMATS = ['markdown', 'text', 'html', 'raw'];
const MODES = ['auto', 'http', 'browser'];
const BOT_WALL_STATUSES = new Set([403, 429, 503]);

function hash(s) {
    return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
}

/**
 * Fetch raw page content (HTML or other) with caching.
 * @returns {Promise<{finalUrl, status, contentType, body, mode, fromCache, tookMs, warnings: string[]}>}
 */
async function fetchRaw(url, opts = {}) {
    const {
        mode = 'auto',
        userAgent = config.userAgent,
        headers,
        waitForSelector, waitMs, scroll,
        timeoutMs = config.requestTimeoutMs,
        respectRobots = config.respectRobotsByDefault,
        useCache = true,
        cacheTtlMs,
    } = opts;
    if (!MODES.includes(mode)) throw new SiphonError(E.BAD_REQUEST, `mode must be one of ${MODES.join(', ')}`, { status: 400 });
    const href = parseUrl(url).href;
    await robots.assertAllowed(href, respectRobots);

    const key = JSON.stringify([href, mode, userAgent, headers || null, waitForSelector || null, waitMs || 0, !!scroll]);
    if (useCache) {
        const hit = pageCache.get(key);
        if (hit) return { ...hit, fromCache: true, warnings: [...hit.warnings] };
    }

    const warnings = [];
    const viaBrowser = async () => {
        const r = await browser.render(href, { userAgent, waitForSelector, waitMs, scroll, timeoutMs });
        return { finalUrl: r.finalUrl, status: r.status, contentType: 'text/html', body: r.html, mode: 'browser', tookMs: r.tookMs };
    };

    let result;
    if (mode === 'browser') {
        result = await viaBrowser();
    } else {
        const r = await httpFetch(href, { userAgent, headers, timeoutMs });
        result = { finalUrl: r.finalUrl, status: r.status, contentType: r.contentType, body: r.body, mode: 'http', tookMs: r.tookMs };
        if (r.body === null) {
            result.binary = { bytes: r.buffer.length };
            result.buffer = r.buffer;
        }
        const isHtml = /html/i.test(r.contentType) || (!r.contentType && /<html/i.test(r.body || ''));
        if (mode === 'auto' && isHtml) {
            const needsBrowser = BOT_WALL_STATUSES.has(r.status) || (r.status < 400 && content.looksLikeJsShell(r.body)) || waitForSelector || scroll;
            if (needsBrowser) {
                if (browser.isAvailable()) {
                    try {
                        const br = await viaBrowser();
                        br.tookMs += r.tookMs;
                        result = br;
                        warnings.push(BOT_WALL_STATUSES.has(r.status)
                            ? `HTTP fetch returned ${r.status}; retried with headless browser`
                            : 'Page looked JavaScript-rendered; used headless browser');
                    } catch (err) {
                        warnings.push(`Browser fallback failed (${err.code || 'ERROR'}: ${err.message}); returning plain HTTP result`);
                    }
                } else {
                    warnings.push('Page may require JavaScript but no Chrome is available (set CHROME_PATH)');
                }
            }
        }
    }
    result.warnings = warnings;
    if (useCache && result.status < 400) pageCache.set(key, result, cacheTtlMs);
    return { ...result, fromCache: false };
}

/**
 * Fetch a page and convert it to the requested format.
 * @param {object} opts see README "fetch options"
 */
async function fetchPage(opts) {
    const started = Date.now();
    const {
        url,
        format = 'markdown',
        mainContent = true,
        selector,
        includeMetadata = true,
        includeLinks = false, // false | true | 'internal' | 'external'
        maxLinks = 200,
        maxChars,
        offset = 0,
    } = opts;
    if (!FORMATS.includes(format)) throw new SiphonError(E.BAD_REQUEST, `format must be one of ${FORMATS.join(', ')}`, { status: 400 });

    const raw = await fetchRaw(url, opts);
    const isHtml = /html|xml/i.test(raw.contentType) && !/json/i.test(raw.contentType) && raw.body !== null;
    const out = {
        ok: raw.status < 400,
        url: parseUrl(url).href,
        finalUrl: raw.finalUrl,
        status: raw.status,
        mode: raw.mode,
        contentType: raw.contentType || null,
        format,
    };

    let body = '';
    let title;
    if (raw.body === null) {
        out.format = 'binary';
        raw.warnings.push(`Binary content (${raw.contentType || 'unknown type'}, ${raw.binary ? raw.binary.bytes : '?'} bytes) was not converted`);
    } else if (!isHtml || format === 'raw') {
        body = raw.body;
        if (format !== 'raw' && /json/i.test(raw.contentType)) {
            try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { /* leave as-is */ }
        }
    } else if (format === 'markdown') {
        const md = content.htmlToMarkdown(raw.body, raw.finalUrl, { mainContent, selector });
        body = md.markdown;
        title = md.title;
        if (selector && md.matched === 0) raw.warnings.push(`Selector "${selector}" matched no elements`);
    } else if (format === 'text') {
        body = content.htmlToText(raw.body, { selector });
    } else if (format === 'html') {
        if (selector) {
            const cheerio = require('cheerio');
            const $ = cheerio.load(raw.body);
            const parts = $(selector).map((_i, el) => $.html(el)).get();
            if (!parts.length) raw.warnings.push(`Selector "${selector}" matched no elements`);
            body = parts.join('\n');
        } else {
            body = raw.body;
        }
    }

    if (isHtml && includeMetadata) {
        out.metadata = content.extractMetadata(raw.body, raw.finalUrl);
        title = title || out.metadata.title;
    }
    out.title = title || (isHtml ? (raw.body.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() : undefined) || null;

    const page = content.paginate(body, { offset, maxChars });
    out.content = page.content;
    out.totalChars = page.totalChars;
    out.offset = page.offset;
    out.truncated = page.truncated;
    if (page.nextOffset !== undefined) out.nextOffset = page.nextOffset;
    out.contentHash = hash(body);

    if (isHtml && includeLinks) {
        let links = content.extractLinks(raw.body, raw.finalUrl, { limit: 5000 });
        if (includeLinks === 'internal') links = links.filter(l => l.internal);
        if (includeLinks === 'external') links = links.filter(l => !l.internal);
        out.linkCount = links.length;
        out.links = links.slice(0, maxLinks);
    }

    if (!out.ok) out.error = { code: E.HTTP_STATUS, message: `Target responded with HTTP ${raw.status}` };
    out.warnings = raw.warnings;
    out.fromCache = raw.fromCache;
    out.tookMs = Date.now() - started;
    return out;
}

/** Screenshot a page. Returns { image: Buffer, mimeType, finalUrl, title }. */
async function screenshot(opts) {
    const { url, fullPage = false, type = 'png', selector, width, height, waitForSelector, waitMs, respectRobots = config.respectRobotsByDefault, userAgent } = opts;
    const href = parseUrl(url).href;
    await robots.assertAllowed(href, respectRobots);
    if (!['png', 'jpeg'].includes(type)) throw new SiphonError(E.BAD_REQUEST, 'type must be png or jpeg', { status: 400 });
    const viewport = width || height ? { width: Math.min(width || 1366, 3840), height: Math.min(height || 900, 2160) } : undefined;
    const r = await browser.render(href, {
        screenshot: true, fullPage, screenshotType: type, screenshotSelector: selector,
        viewport, waitForSelector, waitMs, includeHtml: false, userAgent,
    });
    return { image: r.screenshot, mimeType: `image/${type}`, finalUrl: r.finalUrl, status: r.status, title: r.title, tookMs: r.tookMs };
}

module.exports = { fetchRaw, fetchPage, screenshot, pageCache, FORMATS, MODES };
