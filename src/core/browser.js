/**
 * Real headless-browser support (puppeteer-core + an installed Chrome/Chromium).
 *
 *  - render():      load a page with JS, optionally wait/scroll, return HTML and/or screenshot
 *  - sessions:      persistent pages agents can drive step by step
 *                   (navigate / click / type / press / scroll / wait / snapshot / evaluate)
 *
 * Every request the page makes is screened by the network-safety layer.
 */
const fs = require('fs');
const crypto = require('crypto');
const config = require('../config');
const { assertSafeUrl, isBlockedHostLiteral } = require('./safety');
const { SiphonError, E } = require('./errors');

let puppeteer = null;
let browserPromise = null;

const CANDIDATE_PATHS = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

function findChrome() {
    if (config.chromePath) return fs.existsSync(config.chromePath) ? config.chromePath : null;
    const found = CANDIDATE_PATHS.find(p => { try { return fs.existsSync(p); } catch { return false; } });
    if (found) return found;
    // A full `puppeteer` install (with downloaded Chrome) also works if present
    try {
        const full = require('puppeteer');
        const p = full.executablePath();
        if (p && fs.existsSync(p)) return p;
    } catch { /* not installed */ }
    return null;
}

function isAvailable() {
    return !!findChrome();
}

async function getBrowser() {
    if (browserPromise) {
        const b = await browserPromise.catch(() => null);
        if (b && b.connected) return b;
        browserPromise = null;
    }
    const executablePath = findChrome();
    if (!executablePath) {
        throw new SiphonError(E.BROWSER_UNAVAILABLE, 'No Chrome/Chromium found. Install Google Chrome or set CHROME_PATH.', { status: 503 });
    }
    puppeteer = puppeteer || require('puppeteer-core');
    browserPromise = puppeteer.launch({
        executablePath,
        headless: config.browserHeadless,
        args: ['--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', '--disable-background-networking', '--mute-audio'],
        defaultViewport: { width: 1366, height: 900 },
    }).then(b => {
        b.on('disconnected', () => { browserPromise = null; });
        return b;
    }).catch(err => {
        browserPromise = null;
        throw new SiphonError(E.BROWSER_UNAVAILABLE, `Failed to launch browser: ${err.message}`, { status: 503 });
    });
    return browserPromise;
}

async function closeBrowser() {
    for (const id of [...sessions.keys()]) await closeSession(id).catch(() => {});
    if (!browserPromise) return;
    const b = await browserPromise.catch(() => null);
    browserPromise = null;
    if (b) await b.close().catch(() => {});
}

/** Block page requests to private hosts and heavy resource types. */
async function hardenPage(page, { blockResources = [] } = {}) {
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
        if (req.isInterceptResolutionHandled()) return;
        try {
            const u = new URL(req.url());
            if (u.protocol === 'data:' || u.protocol === 'blob:') return req.continue();
            if (!['http:', 'https:'].includes(u.protocol)) return req.abort('blockedbyclient');
            if (isBlockedHostLiteral(u.hostname)) return req.abort('blockedbyclient');
            if (blockResources.includes(req.resourceType())) return req.abort('blockedbyclient');
            if (req.isNavigationRequest() && !config.allowPrivateNetworks) {
                await assertSafeUrl(u.href); // DNS-level check for documents
            }
            return req.continue();
        } catch {
            return req.abort('blockedbyclient').catch(() => {});
        }
    });
}

async function autoScroll(page, { maxScrolls = 10, delayMs = 400 } = {}) {
    for (let i = 0; i < maxScrolls; i++) {
        const done = await page.evaluate(() => {
            const before = window.scrollY;
            window.scrollBy(0, window.innerHeight * 0.9);
            return window.scrollY === before || (window.innerHeight + window.scrollY) >= document.body.scrollHeight - 2;
        });
        await new Promise(r => setTimeout(r, delayMs));
        if (done) break;
    }
}

/**
 * Render a page in Chrome.
 * @returns {Promise<{finalUrl, status, html, screenshot?: Buffer, title, tookMs}>}
 */
async function render(url, {
    userAgent = config.userAgent,
    waitUntil = 'networkidle2',
    waitForSelector,
    waitMs = 0,
    scroll = false,
    timeoutMs = config.requestTimeoutMs,
    screenshot = false,
    fullPage = false,
    screenshotType = 'png',
    screenshotSelector,
    viewport,
    blockResources = ['media', 'font'],
    includeHtml = true,
} = {}) {
    await assertSafeUrl(url);
    const started = Date.now();
    const browser = await getBrowser();
    const context = await browser.createBrowserContext(); // isolated cookies per render
    const page = await context.newPage();
    try {
        await hardenPage(page, { blockResources: screenshot ? blockResources.filter(t => t !== 'font') : blockResources });
        if (userAgent) await page.setUserAgent(userAgent);
        if (viewport) await page.setViewport(viewport);
        let response;
        try {
            response = await page.goto(url, { waitUntil, timeout: timeoutMs });
        } catch (err) {
            // networkidle can time out on chatty pages; keep whatever has loaded
            if (!/timeout/i.test(err.message) || !page.url().startsWith('http')) throw err;
        }
        if (waitForSelector) await page.waitForSelector(waitForSelector, { timeout: Math.min(timeoutMs, 15000) }).catch(() => {});
        if (scroll) await autoScroll(page);
        if (waitMs) await new Promise(r => setTimeout(r, Math.min(waitMs, 30000)));

        const out = {
            finalUrl: page.url(),
            status: response ? response.status() : 200,
            title: await page.title().catch(() => ''),
            tookMs: 0,
        };
        if (includeHtml) out.html = await page.content();
        if (screenshot) {
            const opts = { type: screenshotType, fullPage: !!fullPage };
            if (screenshotType === 'jpeg') opts.quality = 80;
            if (screenshotSelector) {
                const el = await page.$(screenshotSelector);
                if (!el) throw new SiphonError(E.NOT_FOUND, `Selector not found for screenshot: ${screenshotSelector}`, { status: 404 });
                out.screenshot = Buffer.from(await el.screenshot({ type: screenshotType }));
            } else {
                out.screenshot = Buffer.from(await page.screenshot(opts));
            }
        }
        out.tookMs = Date.now() - started;
        return out;
    } catch (err) {
        if (err instanceof SiphonError) throw err;
        const code = /timeout/i.test(err.message) ? E.TIMEOUT : /ERR_BLOCKED_BY_CLIENT/.test(err.message) ? E.BLOCKED_URL : E.BROWSER_ERROR;
        throw new SiphonError(code, err.message, { status: code === E.BLOCKED_URL ? 403 : 502 });
    } finally {
        await context.close().catch(() => {});
    }
}

/**
 * Collect every <script> on a rendered page: inline bodies plus (optionally)
 * external script sources fetched from within the page context (same
 * cookies/origin as the page itself). The "read the JavaScript" primitive.
 */
async function collectScripts(url, {
    userAgent = config.userAgent,
    waitUntil = 'networkidle2',
    waitForSelector,
    waitMs = 0,
    timeoutMs = config.requestTimeoutMs,
    fetchExternal = false,
    maxExternal = 50,
} = {}) {
    await assertSafeUrl(url);
    const started = Date.now();
    const browser = await getBrowser();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    try {
        await hardenPage(page, { blockResources: ['media', 'font'] });
        if (userAgent) await page.setUserAgent(userAgent);
        let response;
        try {
            response = await page.goto(url, { waitUntil, timeout: timeoutMs });
        } catch (err) {
            if (!/timeout/i.test(err.message) || !page.url().startsWith('http')) throw err;
        }
        if (waitForSelector) await page.waitForSelector(waitForSelector, { timeout: Math.min(timeoutMs, 15000) }).catch(() => {});
        if (waitMs) await new Promise(r => setTimeout(r, Math.min(waitMs, 30000)));

        const scripts = await page.evaluate(() =>
            Array.from(document.querySelectorAll('script')).map((s) => ({
                src: s.src || null,
                type: s.type || 'text/javascript',
                inline: s.src ? '' : (s.textContent || ''),
            }))
        );

        if (fetchExternal) {
            let fetched = 0;
            for (const s of scripts) {
                if (!s.src || fetched >= maxExternal) continue;
                try {
                    s.body = await page.evaluate(async (u) => {
                        const r = await fetch(u);
                        return await r.text();
                    }, s.src);
                    fetched++;
                } catch (err) {
                    s.body = `/* fetch failed: ${err.message} */`;
                }
            }
        }

        return {
            finalUrl: page.url(),
            status: response ? response.status() : 200,
            title: await page.title().catch(() => ''),
            scripts,
            tookMs: Date.now() - started,
        };
    } catch (err) {
        if (err instanceof SiphonError) throw err;
        const code = /timeout/i.test(err.message) ? E.TIMEOUT : /ERR_BLOCKED_BY_CLIENT/.test(err.message) ? E.BLOCKED_URL : E.BROWSER_ERROR;
        throw new SiphonError(code, err.message, { status: code === E.BLOCKED_URL ? 403 : 502 });
    } finally {
        await context.close().catch(() => {});
    }
}

// ---------------------------------------------------------------------------
// Interactive sessions
// ---------------------------------------------------------------------------
const sessions = new Map(); // id -> { context, page, lastUsed, timer }

function touch(id) {
    const s = sessions.get(id);
    if (!s) return;
    s.lastUsed = Date.now();
    clearTimeout(s.timer);
    s.timer = setTimeout(() => closeSession(id).catch(() => {}), config.browserSessionIdleMs);
    s.timer.unref?.();
}

function getSession(id) {
    const s = sessions.get(id);
    if (!s) throw new SiphonError(E.NOT_FOUND, `No browser session ${id} (it may have expired after inactivity)`, { status: 404 });
    touch(id);
    return s;
}

async function openSession({ url, userAgent = config.userAgent, viewport } = {}) {
    if (sessions.size >= config.maxBrowserSessions) {
        throw new SiphonError(E.LIMIT, `Max ${config.maxBrowserSessions} browser sessions open; close one first`, { status: 429 });
    }
    const browser = await getBrowser();
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await hardenPage(page);
    if (userAgent) await page.setUserAgent(userAgent);
    if (viewport) await page.setViewport(viewport);
    const id = crypto.randomUUID();
    sessions.set(id, { context, page, lastUsed: Date.now(), created: new Date().toISOString() });
    touch(id);
    if (url) await sessionNavigate(id, url);
    return { sessionId: id, url: page.url() };
}

async function closeSession(id) {
    const s = sessions.get(id);
    if (!s) return false;
    clearTimeout(s.timer);
    sessions.delete(id);
    await s.context.close().catch(() => {});
    return true;
}

function listSessions() {
    return [...sessions.entries()].map(([id, s]) => ({ sessionId: id, url: s.page.url(), created: s.created, lastUsed: new Date(s.lastUsed).toISOString() }));
}

async function settle(page, ms = 800) {
    await Promise.race([
        page.waitForNetworkIdle({ idleTime: 400, timeout: 5000 }).catch(() => {}),
        new Promise(r => setTimeout(r, 5000)),
    ]);
    if (ms) await new Promise(r => setTimeout(r, Math.min(ms, 400)));
}

async function wrap(fn) {
    try {
        return await fn();
    } catch (err) {
        if (err instanceof SiphonError) throw err;
        throw new SiphonError(/timeout/i.test(err.message) ? E.TIMEOUT : E.BROWSER_ERROR, err.message, { status: 502 });
    }
}

async function sessionNavigate(id, url) {
    await assertSafeUrl(url);
    const { page } = getSession(id);
    return wrap(async () => {
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.requestTimeoutMs });
        await settle(page);
        return { url: page.url(), status: res ? res.status() : null, title: await page.title() };
    });
}

/** Resolve a target given as a CSS selector, visible text, or snapshot ref. */
async function resolveTarget(page, { selector, text, ref }) {
    if (ref) selector = `[data-siphon-ref="${String(ref).replace(/"/g, '')}"]`;
    if (selector) {
        const el = await page.waitForSelector(selector, { timeout: 5000, visible: true }).catch(() => null);
        if (el) return el;
        throw new SiphonError(E.NOT_FOUND, `No visible element matches ${ref ? 'ref ' + ref : 'selector ' + selector}`, { status: 404 });
    }
    if (text) {
        const escaped = String(text).replace(/"/g, '\\"');
        const el = await page.waitForSelector(`::-p-text("${escaped}")`, { timeout: 5000, visible: true }).catch(() => null);
        if (el) return el;
        throw new SiphonError(E.NOT_FOUND, `No visible element with text "${text}"`, { status: 404 });
    }
    throw new SiphonError(E.BAD_REQUEST, 'Provide selector, text, or ref', { status: 400 });
}

async function sessionClick(id, target) {
    const { page } = getSession(id);
    return wrap(async () => {
        const el = await resolveTarget(page, target);
        await el.click();
        await settle(page);
        return { url: page.url(), title: await page.title() };
    });
}

async function sessionType(id, { value, clear = true, submit = false, ...target }) {
    const { page } = getSession(id);
    return wrap(async () => {
        const el = await resolveTarget(page, target);
        if (clear) await el.evaluate(n => { if ('value' in n) n.value = ''; else n.textContent = ''; });
        await el.type(String(value ?? ''), { delay: 15 });
        if (submit) { await el.press('Enter'); await settle(page); }
        return { url: page.url(), title: await page.title() };
    });
}

async function sessionSelect(id, { values, ...target }) {
    const { page } = getSession(id);
    return wrap(async () => {
        const el = await resolveTarget(page, target);
        const selected = await el.select(...[].concat(values));
        return { selected };
    });
}

async function sessionPress(id, key) {
    const { page } = getSession(id);
    return wrap(async () => {
        await page.keyboard.press(key);
        await settle(page);
        return { url: page.url(), title: await page.title() };
    });
}

async function sessionScroll(id, { direction = 'down', amount, toBottom = false } = {}) {
    const { page } = getSession(id);
    return wrap(async () => {
        if (toBottom) await autoScroll(page, { maxScrolls: 20 });
        else await page.evaluate((dir, amt) => window.scrollBy(0, (dir === 'up' ? -1 : 1) * (amt || window.innerHeight * 0.9)), direction, amount);
        await settle(page, 300);
        return page.evaluate(() => ({ scrollY: Math.round(window.scrollY), scrollHeight: document.body.scrollHeight, viewportHeight: window.innerHeight }));
    });
}

async function sessionWait(id, { selector, text, ms } = {}) {
    const { page } = getSession(id);
    return wrap(async () => {
        if (selector) await page.waitForSelector(selector, { timeout: 15000 });
        else if (text) await page.waitForSelector(`::-p-text("${String(text).replace(/"/g, '\\"')}")`, { timeout: 15000 });
        else await new Promise(r => setTimeout(r, Math.min(ms || 1000, 30000)));
        return { url: page.url() };
    });
}

async function sessionHtml(id) {
    const { page } = getSession(id);
    return wrap(async () => ({ url: page.url(), title: await page.title(), html: await page.content() }));
}

async function sessionScreenshot(id, { fullPage = false, type = 'png' } = {}) {
    const { page } = getSession(id);
    return wrap(async () => ({ url: page.url(), image: Buffer.from(await page.screenshot({ type, fullPage, ...(type === 'jpeg' ? { quality: 80 } : {}) })) }));
}

async function sessionEvaluate(id, expression) {
    if (!config.allowEvaluate) throw new SiphonError(E.DISABLED, 'evaluate is disabled (ALLOW_EVALUATE=false)', { status: 403 });
    const { page } = getSession(id);
    return wrap(async () => {
        const result = await page.evaluate(`(async () => { return (${expression}); })()`);
        return { result: result === undefined ? null : result };
    });
}

/**
 * Compact, token-cheap view of the page: interactive elements tagged with
 * short refs (usable with click/type via {ref}) plus visible headings/text.
 */
async function sessionSnapshot(id, { maxElements = 150, maxTextChars = 4000 } = {}) {
    const { page } = getSession(id);
    return wrap(async () => {
        const data = await page.evaluate((maxEls, maxText) => {
            const visible = (el) => {
                const r = el.getBoundingClientRect();
                const st = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
            };
            const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || el.getAttribute('name') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
            const roleOf = (el) => el.getAttribute('role') || ({ A: 'link', BUTTON: 'button', SELECT: 'select', TEXTAREA: 'textbox' }[el.tagName]) ||
                (el.tagName === 'INPUT' ? (['checkbox', 'radio', 'submit', 'button'].includes(el.type) ? el.type : 'textbox') : el.tagName.toLowerCase());
            const els = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [contenteditable=true]')]
                .filter(visible).slice(0, maxEls);
            let n = 0;
            const elements = els.map(el => {
                const ref = 'e' + (++n);
                el.setAttribute('data-siphon-ref', ref);
                const item = { ref, role: roleOf(el), name: label(el) };
                if (el.tagName === 'A') item.href = el.href;
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { item.value = (el.value || '').slice(0, 80); if (el.type) item.type = el.type; }
                if (el.tagName === 'SELECT') item.options = [...el.options].slice(0, 20).map(o => o.textContent.trim());
                if (el.disabled) item.disabled = true;
                if (el.checked) item.checked = true;
                return item;
            });
            const headings = [...document.querySelectorAll('h1, h2, h3')].filter(visible).slice(0, 40).map(h => `${h.tagName.toLowerCase()}: ${h.innerText.trim().slice(0, 120)}`);
            const text = (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, maxText);
            return { url: location.href, title: document.title, headings, elements, text, scrollY: Math.round(scrollY), scrollHeight: document.body.scrollHeight };
        }, maxElements, maxTextChars);
        return data;
    });
}

module.exports = {
    isAvailable, findChrome, getBrowser, closeBrowser, render, collectScripts,
    openSession, closeSession, listSessions,
    sessionNavigate, sessionClick, sessionType, sessionSelect, sessionPress, sessionScroll, sessionWait,
    sessionHtml, sessionScreenshot, sessionEvaluate, sessionSnapshot,
};
