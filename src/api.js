/**
 * REST API. All /api endpoints return JSON; errors are
 * { ok: false, error: { code, message } } with an appropriate HTTP status.
 */
const express = require('express');
const config = require('./config');
const { version } = require('../package.json');
const scrape = require('./core/scrape');
const { extract } = require('./core/extract');
const crawl = require('./core/crawl');
const browser = require('./core/browser');
const robots = require('./core/robots');
const scheduler = require('./scheduler');
const { exportRecord } = require('./exporters');
const { httpFetch } = require('./core/http');
const content = require('./core/content');
const { SiphonError, E, normalizeError, errorBody } = require('./core/errors');

const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bool = (v) => v === true || v === 'true' || v === '1';
const num = (v) => (v === undefined || v === '' ? undefined : Number(v));

/** Coerce query-string values for GET convenience endpoints. */
function fromQuery(q) {
    const o = { ...q };
    for (const k of ['mainContent', 'includeMetadata', 'scroll', 'respectRobots', 'useCache', 'fullPage']) if (k in o) o[k] = bool(o[k]);
    for (const k of ['maxChars', 'offset', 'waitMs', 'maxLinks', 'timeoutMs', 'width', 'height']) if (k in o) o[k] = num(o[k]);
    if ('includeLinks' in o) o.includeLinks = ['internal', 'external'].includes(o.includeLinks) ? o.includeLinks : bool(o.includeLinks);
    return o;
}

function createApiRouter() {
    const api = express.Router();

    // ---- meta ----------------------------------------------------------------
    api.get('/health', (_req, res) => {
        res.json({
            ok: true,
            version,
            browser: { available: browser.isAvailable(), path: browser.findChrome() },
            cache: scrape.pageCache.stats(),
            sessions: browser.listSessions().length,
            respectRobotsByDefault: config.respectRobotsByDefault,
            allowPrivateNetworks: config.allowPrivateNetworks,
        });
    });

    // ---- fetch / extract / screenshot -----------------------------------------
    api.get('/fetch', h(async (req, res) => res.json(await scrape.fetchPage(fromQuery(req.query)))));
    api.post('/fetch', h(async (req, res) => res.json(await scrape.fetchPage(req.body || {}))));
    api.post('/extract', h(async (req, res) => res.json(await extract(req.body || {}))));
    api.post('/links', h(async (req, res) => {
        const r = await scrape.fetchPage({ ...req.body, format: 'raw', includeLinks: req.body.filter || true, maxLinks: req.body.maxLinks || 1000, includeMetadata: false });
        res.json({ ok: r.ok, url: r.url, finalUrl: r.finalUrl, status: r.status, linkCount: r.linkCount, links: r.links || [] });
    }));
    const shot = h(async (req, res) => {
        const opts = req.method === 'GET' ? fromQuery(req.query) : req.body || {};
        const s = await scrape.screenshot(opts);
        if (bool(req.query.raw) || bool(opts.raw)) {
            res.type(s.mimeType).send(s.image);
        } else {
            res.json({ ok: true, finalUrl: s.finalUrl, status: s.status, title: s.title, mimeType: s.mimeType, tookMs: s.tookMs, base64: s.image.toString('base64') });
        }
    });
    api.get('/screenshot', shot);
    api.post('/screenshot', shot);
    api.get('/robots', h(async (req, res) => {
        const target = require('./core/safety').parseUrl(req.query.url).href;
        res.json({ url: target, allowed: await robots.isAllowed(target) });
    }));

    // ---- crawl ---------------------------------------------------------------
    api.post('/crawl', h(async (req, res) => res.status(202).json(await crawl.startCrawl({ waitMs: 0, ...req.body }))));
    api.get('/crawl', h(async (_req, res) => res.json(require('./core/store').crawls.list(50))));
    api.get('/crawl/:id', h(async (req, res) => res.json(crawl.getCrawl(req.params.id))));
    api.get('/crawl/:id/page', h(async (req, res) => res.json(crawl.getCrawlPage(req.params.id, req.query.url, { offset: num(req.query.offset), maxChars: num(req.query.maxChars) }))));
    api.post('/crawl/:id/cancel', h(async (req, res) => res.json({ ok: crawl.cancelCrawl(req.params.id) })));
    api.delete('/crawl/:id', h(async (req, res) => {
        crawl.cancelCrawl(req.params.id);
        res.json({ ok: require('./core/store').crawls.delete(req.params.id) });
    }));

    // ---- browser sessions --------------------------------------------------------
    api.post('/sessions', h(async (req, res) => res.status(201).json(await browser.openSession(req.body || {}))));
    api.get('/sessions', (_req, res) => res.json(browser.listSessions()));
    api.delete('/sessions/:id', h(async (req, res) => res.json({ ok: await browser.closeSession(req.params.id) })));
    const actions = {
        navigate: (id, b) => browser.sessionNavigate(id, b.url),
        click: (id, b) => browser.sessionClick(id, b),
        type: (id, b) => browser.sessionType(id, b),
        select: (id, b) => browser.sessionSelect(id, b),
        press: (id, b) => browser.sessionPress(id, b.key),
        scroll: (id, b) => browser.sessionScroll(id, b),
        wait: (id, b) => browser.sessionWait(id, b),
        snapshot: (id, b) => browser.sessionSnapshot(id, b),
        evaluate: (id, b) => browser.sessionEvaluate(id, b.expression),
        html: (id) => browser.sessionHtml(id),
        markdown: async (id, b) => {
            const page = await browser.sessionHtml(id);
            const md = content.htmlToMarkdown(page.html, page.url, { mainContent: b.mainContent !== false, selector: b.selector });
            return { url: page.url, title: page.title, ...content.paginate(md.markdown, { offset: b.offset, maxChars: b.maxChars }) };
        },
        screenshot: async (id, b) => {
            const s = await browser.sessionScreenshot(id, b);
            return { url: s.url, mimeType: `image/${b.type || 'png'}`, base64: s.image.toString('base64') };
        },
    };
    api.post('/sessions/:id/:action', h(async (req, res) => {
        const fn = actions[req.params.action];
        if (!fn) throw new SiphonError(E.NOT_FOUND, `Unknown session action ${req.params.action}. Valid: ${Object.keys(actions).join(', ')}`, { status: 404 });
        res.json(await fn(req.params.id, req.body || {}));
    }));

    // ---- scheduled tasks / watches -----------------------------------------------
    const taskRoutes = express.Router();
    taskRoutes.get('/', (_req, res) => res.json(scheduler.listTasks()));
    taskRoutes.post('/', h(async (req, res) => res.status(201).json(scheduler.createTask(req.body || {}))));
    taskRoutes.get('/:id', (req, res) => {
        const t = scheduler.getTask(req.params.id);
        if (!t) return res.status(404).json({ ok: false, error: { code: E.NOT_FOUND, message: 'Task not found' } });
        res.json(t);
    });
    taskRoutes.put('/:id', h(async (req, res) => {
        const t = scheduler.updateTask(req.params.id, req.body || {});
        if (!t) return res.status(404).json({ ok: false, error: { code: E.NOT_FOUND, message: 'Task not found' } });
        res.json(t);
    }));
    taskRoutes.delete('/:id', (req, res) => {
        if (!scheduler.deleteTask(req.params.id)) return res.status(404).json({ ok: false, error: { code: E.NOT_FOUND, message: 'Task not found' } });
        res.status(204).end();
    });
    taskRoutes.post('/:id/run', h(async (req, res) => {
        if (!scheduler.getTask(req.params.id)) throw new SiphonError(E.NOT_FOUND, 'Task not found', { status: 404 });
        if (bool(req.query.wait) || (req.body && req.body.wait)) return res.json(await scheduler.runTask(req.params.id));
        scheduler.runTask(req.params.id).catch(err => console.error(`[scheduler] ${err.message}`));
        res.status(202).json({ message: 'Task execution triggered' });
    }));
    taskRoutes.get('/:id/runs', h(async (req, res) => res.json(scheduler.getRuns(req.params.id, {
        limit: num(req.query.limit) || 20, changedOnly: bool(req.query.changedOnly), includeDiff: bool(req.query.includeDiff),
    }))));
    api.use('/tasks', taskRoutes);
    api.use('/scheduler/tasks', taskRoutes); // legacy path used by scheduler.html
    api.get('/runs/:id', h(async (req, res) => res.json(scheduler.getRun(Number(req.params.id), { includeContent: bool(req.query.includeContent), maxChars: num(req.query.maxChars) }))));
    api.get('/changes', h(async (req, res) => res.json(scheduler.recentChanges({ since: req.query.since, limit: num(req.query.limit) || 50 }))));

    // ---- legacy scrape endpoints -------------------------------------------------
    api.post('/scrape/headless', h(async (req, res) => {
        const b = req.body || {};
        const r = await scrape.fetchPage({ ...b, mode: 'browser', format: b.extractFormat === 'text' ? 'text' : 'html', respectRobots: b.bypassRobots ? false : b.respectRobots });
        res.json({ success: r.ok, content: r.content, contentType: r.format === 'text' ? 'text/plain' : 'text/html', status: r.status, url: r.finalUrl });
    }));
    api.post('/scrape/deep', h(async (req, res) => {
        const { url, depth = 2, ...options } = req.body || {};
        const safeDepth = Math.min(Math.max(parseInt(depth, 10) || 1, 1), 3);
        const { map, crawlId } = await crawl.crawlToMap(url, safeDepth, { ...options, respectRobots: options.bypassRobots ? false : options.respectRobots });
        res.json({ success: true, crawlId, results: map });
    }));

    api.use((_req, _res, next) => next(new SiphonError(E.NOT_FOUND, 'Unknown API endpoint', { status: 404 })));
    return api;
}

/** Legacy raw-content endpoints used by the original web UI. */
function createLegacyRouter() {
    const r = express.Router();

    r.get('/proxy', h(async (req, res) => {
        const url = req.query.url;
        await robots.assertAllowed(url, req.query.bypassRobots === 'true' ? false : config.respectRobotsByDefault);
        const out = await httpFetch(url, { userAgent: req.query.userAgent || config.userAgent });
        res.status(out.status).type(out.contentType || 'text/plain').send(out.buffer);
    }));

    r.get('/headless-proxy', h(async (req, res) => {
        const q = req.query;
        const respectRobots = q.bypassRobots === 'true' ? false : config.respectRobotsByDefault;
        if (q.extractFormat === 'screenshot') {
            const type = q.screenshotFormat === 'jpeg' ? 'jpeg' : 'png';
            const s = await scrape.screenshot({ url: q.url, fullPage: q.fullPage === 'true', type, waitForSelector: q.waitForSelector, waitMs: num(q.waitTime), respectRobots, userAgent: q.userAgent });
            return res.type(s.mimeType).send(s.image);
        }
        const p = await scrape.fetchPage({
            url: q.url, mode: 'browser', format: q.extractFormat === 'text' ? 'text' : 'html', includeMetadata: false,
            waitForSelector: q.waitForSelector && q.waitForSelector !== 'body' ? q.waitForSelector : undefined,
            waitMs: num(q.waitTime), respectRobots, userAgent: q.userAgent,
        });
        res.status(p.status).type(p.format === 'text' ? 'text/plain' : 'text/html').send(p.content);
    }));

    r.post('/export-to-db', h(async (req, res) => {
        const out = await exportRecord(req.body || {});
        res.json({ success: true, message: `Data exported to ${out.target} successfully`, id: out.id });
    }));
    return r;
}

/** Final error handler: stable JSON shape, no stack traces. */
function errorHandler(err, req, res, _next) {
    if (err && err.type === 'entity.parse.failed') err = new SiphonError(E.BAD_REQUEST, 'Invalid JSON body', { status: 400 });
    if (err && err.type === 'entity.too.large') err = new SiphonError(E.LIMIT, 'Request body too large', { status: 413 });
    const e = normalizeError(err);
    if (e.code === E.INTERNAL) console.error(`[api] ${req.method} ${req.path}:`, err);
    if (res.headersSent) return;
    const body = { ok: false, error: errorBody(e) };
    // Legacy UI reads `error` as a string and `message`
    if (!req.path.startsWith('/api/') || req.path.startsWith('/api/scrape') || req.path.startsWith('/api/scheduler')) {
        body.success = false;
        body.message = e.message;
    }
    res.status(e.status || 500).json(body);
}

module.exports = { createApiRouter, createLegacyRouter, errorHandler };
