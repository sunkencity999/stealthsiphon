/**
 * Bounded, concurrent, polite crawler. Results are persisted so an agent gets
 * a compact summary (url, title, description, size) and pulls full content
 * for only the pages it cares about.
 */
const crypto = require('crypto');
const cheerio = require('cheerio');
const config = require('../config');
const { fetchRaw } = require('./scrape');
const content = require('./content');
const robots = require('./robots');
const store = require('./store');
const { parseUrl } = require('./safety');
const { SiphonError, E, normalizeError } = require('./errors');

const LIMITS = { maxPages: 200, maxDepth: 5, concurrency: 5 };
const DEFAULTS = { maxPages: 20, maxDepth: 2, concurrency: 3 };
const SKIP_EXT = /\.(jpe?g|png|gif|webp|svg|ico|pdf|zip|gz|tgz|rar|7z|mp[34]|m4a|wav|avi|mov|mkv|webm|woff2?|ttf|eot|css|js|json|xml|rss|exe|dmg|pkg|iso|docx?|xlsx?|pptx?)$/i;

const running = new Map(); // id -> { promise, cancel: boolean }

/** Convert a glob ("/blog/**", "*.html") into a RegExp over the URL path+query. */
function globToRegex(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*') {
            if (glob[i + 1] === '*') { re += '.*'; i++; } else re += '[^/]*';
        } else if (c === '?') re += '.';
        else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + re + '$', 'i');
}

function matchesAny(patterns, url) {
    const u = new URL(url);
    const target = u.pathname + u.search;
    return patterns.some(p => (p.includes('://') ? globToRegex(p).test(url) : globToRegex(p).test(target)));
}

function normalizeForVisit(url) {
    const u = new URL(url);
    u.hash = '';
    // Drop common tracking params so we don't crawl duplicates
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_|ref$)/i.test(k)) u.searchParams.delete(k);
    u.pathname = u.pathname.replace(/\/index\.html?$/i, '/');
    if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
    return u.href;
}

async function sitemapUrls(startUrl, max) {
    const urls = [];
    const queue = (await robots.getSitemaps(startUrl)).slice(0, 5);
    const seen = new Set();
    const { httpFetch } = require('./http');
    while (queue.length && urls.length < max && seen.size < 10) {
        const sm = queue.shift();
        if (seen.has(sm)) continue;
        seen.add(sm);
        try {
            const res = await httpFetch(sm, { timeoutMs: 15000 });
            if (res.status >= 400 || !res.body) continue;
            const $ = cheerio.load(res.body, { xmlMode: true });
            $('sitemap > loc').each((_i, el) => queue.push($(el).text().trim()));
            $('url > loc').each((_i, el) => { if (urls.length < max) urls.push($(el).text().trim()); });
        } catch { /* ignore broken sitemaps */ }
    }
    return urls;
}

function resolveOptions(opts) {
    const clamp = (v, def, max) => Math.min(Math.max(parseInt(v ?? def, 10) || def, 1), max);
    return {
        maxPages: clamp(opts.maxPages, DEFAULTS.maxPages, LIMITS.maxPages),
        maxDepth: Math.min(Math.max(parseInt(opts.maxDepth ?? DEFAULTS.maxDepth, 10) || 0, 0), LIMITS.maxDepth),
        concurrency: clamp(opts.concurrency, DEFAULTS.concurrency, LIMITS.concurrency),
        include: [].concat(opts.include || []),
        exclude: [].concat(opts.exclude || []),
        sameDomain: opts.sameDomain !== false,
        useSitemap: !!opts.useSitemap,
        format: opts.format === 'text' || opts.format === 'html' ? opts.format : 'markdown',
        mainContent: opts.mainContent !== false,
        selector: opts.selector,
        mode: opts.mode || 'auto',
        respectRobots: opts.respectRobots ?? config.respectRobotsByDefault,
        userAgent: opts.userAgent,
    };
}

async function runCrawl(id, startUrl, o, control) {
    const start = new URL(startUrl);
    const visited = new Set();
    const queue = [{ url: normalizeForVisit(startUrl), depth: 0 }];
    let ok = 0, failed = 0, seq = 0, active = 0;
    const crawlDelay = o.respectRobots ? await robots.getCrawlDelayMs(startUrl).catch(() => 0) : 0;

    if (o.useSitemap) {
        for (const u of await sitemapUrls(startUrl, o.maxPages * 3)) {
            try { queue.push({ url: normalizeForVisit(u), depth: 1 }); } catch { /* skip */ }
        }
    }

    const accept = (url) => {
        let u;
        try { u = new URL(url); } catch { return false; }
        if (!['http:', 'https:'].includes(u.protocol)) return false;
        if (o.sameDomain && u.hostname.replace(/^www\./, '') !== start.hostname.replace(/^www\./, '')) return false;
        if (SKIP_EXT.test(u.pathname)) return false;
        if (o.include.length && !matchesAny(o.include, url)) return false;
        if (o.exclude.length && matchesAny(o.exclude, url)) return false;
        return true;
    };

    const processOne = async ({ url, depth }) => {
        const mySeq = seq++;
        const base = { crawl_id: id, url, depth, seq: mySeq, fetched_at: new Date().toISOString() };
        try {
            const raw = await fetchRaw(url, { mode: o.mode, respectRobots: o.respectRobots, userAgent: o.userAgent });
            if (raw.body === null) throw new SiphonError(E.BAD_REQUEST, `Skipped binary content (${raw.contentType})`);
            const isHtml = /html/i.test(raw.contentType) || raw.mode === 'browser';
            let body = raw.body, title = null, description = null, links = [];
            if (isHtml) {
                const meta = content.extractMetadata(raw.body, raw.finalUrl);
                title = meta.title || null;
                description = meta.description || null;
                if (o.format === 'markdown') body = content.htmlToMarkdown(raw.body, raw.finalUrl, { mainContent: o.mainContent, selector: o.selector }).markdown;
                else if (o.format === 'text') body = content.htmlToText(raw.body, { selector: o.selector });
                if (depth < o.maxDepth) links = content.extractLinks(raw.body, raw.finalUrl, { limit: 2000 }).map(l => l.url);
            }
            store.crawls.addPage({ ...base, status: raw.status < 400 ? 'ok' : 'http_error', http_status: raw.status, title, description, content: body, chars: body.length, links_found: links.length });
            if (raw.status < 400) ok++; else failed++;
            for (const link of links) {
                let norm;
                try { norm = normalizeForVisit(link); } catch { continue; }
                if (visited.has(norm) || !accept(norm)) continue;
                // Skip robots-disallowed links up front so they don't consume the page budget
                if (o.respectRobots && !(await robots.isAllowed(norm).catch(() => true))) continue;
                queue.push({ url: norm, depth: depth + 1 });
            }
        } catch (err) {
            const e = normalizeError(err);
            failed++;
            store.crawls.addPage({ ...base, status: e.code === E.ROBOTS_DISALLOWED ? 'robots_disallowed' : 'error', error: `${e.code}: ${e.message}` });
        }
        store.crawls.progress(id, ok, failed);
        if (crawlDelay) await new Promise(r => setTimeout(r, crawlDelay));
    };

    await new Promise((resolve) => {
        const launch = () => {
            if (control.cancel) { if (active === 0) resolve(); return; }
            while (active < o.concurrency && queue.length && visited.size < o.maxPages) {
                const item = queue.shift();
                if (visited.has(item.url)) continue;
                if (item.depth > 0 && !accept(item.url)) continue;
                visited.add(item.url);
                active++;
                processOne(item).finally(() => { active--; launch(); });
            }
            if (active === 0 && (queue.length === 0 || visited.size >= o.maxPages)) resolve();
        };
        launch();
    });
    return { ok, failed, cancelled: control.cancel };
}

/**
 * Start a crawl. Returns immediately with the id, or waits up to waitMs for
 * completion and returns the summary.
 */
async function startCrawl(opts) {
    const startUrl = parseUrl(opts.url).href;
    const o = resolveOptions(opts);
    const id = crypto.randomUUID();
    store.crawls.create({ id, startUrl, options: o });
    const control = { cancel: false };
    const promise = runCrawl(id, startUrl, o, control)
        .then(r => store.crawls.finish(id, { status: r.cancelled ? 'cancelled' : 'completed', ok: r.ok, failed: r.failed }))
        .catch(err => store.crawls.finish(id, { status: 'failed', error: normalizeError(err).message, ok: 0, failed: 0 }))
        .finally(() => running.delete(id));
    running.set(id, { promise, control });

    const waitMs = opts.waitMs === undefined ? 120000 : Math.max(0, opts.waitMs);
    if (waitMs > 0) {
        let timer;
        await Promise.race([promise, new Promise(r => { timer = setTimeout(r, waitMs); })]);
        clearTimeout(timer);
    }
    return getCrawl(id);
}

function getCrawl(id, { includePages = true } = {}) {
    const c = store.crawls.get(id);
    if (!c) throw new SiphonError(E.NOT_FOUND, `No crawl ${id}`, { status: 404 });
    const out = {
        crawlId: c.id,
        startUrl: c.start_url,
        status: c.status,
        createdAt: c.created_at,
        finishedAt: c.finished_at,
        pagesOk: c.pages_ok,
        pagesFailed: c.pages_failed,
        options: c.options,
    };
    if (c.error) out.error = c.error;
    if (includePages) out.pages = store.crawls.pages(id);
    return out;
}

function getCrawlPage(id, url, { offset = 0, maxChars } = {}) {
    if (!store.crawls.get(id)) throw new SiphonError(E.NOT_FOUND, `No crawl ${id}`, { status: 404 });
    let p = store.crawls.page(id, url);
    if (!p) { try { p = store.crawls.page(id, normalizeForVisit(url)); } catch { /* ignore */ } }
    if (!p) throw new SiphonError(E.NOT_FOUND, `URL not in crawl ${id}: ${url}`, { status: 404 });
    const page = content.paginate(p.content || '', { offset, maxChars });
    const out = { crawlId: id, url: p.url, depth: p.depth, status: p.status, httpStatus: p.http_status, title: p.title, ...page };
    if (p.error) out.error = p.error;
    return out;
}

function cancelCrawl(id) {
    const r = running.get(id);
    if (!r) return false;
    r.control.cancel = true;
    return true;
}

async function waitForCrawl(id) {
    const r = running.get(id);
    if (r) await r.promise;
}

/** Legacy helper: crawl and return { url: content } map. */
async function crawlToMap(url, depth, options = {}) {
    const result = await startCrawl({ url, maxDepth: Math.max(0, depth - 1), maxPages: 50, format: options.extractFormat === 'text' ? 'text' : 'html', ...options, waitMs: 10 * 60 * 1000 });
    const map = {};
    for (const p of result.pages) if (p.status === 'ok') map[p.url] = store.crawls.page(result.crawlId, p.url).content;
    return { map, crawlId: result.crawlId, pages: result.pages.length };
}

module.exports = { startCrawl, getCrawl, getCrawlPage, cancelCrawl, waitForCrawl, crawlToMap, globToRegex, resolveOptions, LIMITS };
