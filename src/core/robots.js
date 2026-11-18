/**
 * robots.txt support. Respected by default (configurable globally and per
 * request with respectRobots:false). Also exposes sitemaps for crawl seeding.
 */
const robotsParser = require('robots-parser');
const config = require('../config');
const { TtlCache } = require('./cache');
const { SiphonError, E } = require('./errors');

const cache = new TtlCache({ max: 500, ttlMs: 60 * 60 * 1000 });

async function getRobots(url) {
    const origin = new URL(url).origin;
    const cached = cache.get(origin);
    if (cached) return cached;
    const robotsUrl = origin + '/robots.txt';
    let body = '';
    try {
        // Lazy require to avoid a circular import
        const { httpFetch } = require('./http');
        const res = await httpFetch(robotsUrl, { timeoutMs: 10000 });
        // 4xx => no restrictions; 5xx => treat as allow too (lenient), per common practice
        if (res.status >= 200 && res.status < 300 && res.body) body = res.body;
    } catch {
        body = '';
    }
    const parsed = robotsParser(robotsUrl, body);
    cache.set(origin, parsed);
    return parsed;
}

async function isAllowed(url, userAgent = config.robotsUserAgent) {
    const robots = await getRobots(url);
    const allowed = robots.isAllowed(url, userAgent);
    return allowed === undefined ? true : allowed;
}

async function assertAllowed(url, respectRobots = config.respectRobotsByDefault) {
    if (!respectRobots) return;
    if (!(await isAllowed(url))) {
        throw new SiphonError(E.ROBOTS_DISALLOWED, `robots.txt disallows fetching ${url}. Pass respectRobots:false to override if you have permission.`, { status: 403 });
    }
}

async function getSitemaps(url) {
    const robots = await getRobots(url);
    const sitemaps = robots.getSitemaps();
    return sitemaps.length ? sitemaps : [new URL('/sitemap.xml', url).href];
}

async function getCrawlDelayMs(url) {
    const robots = await getRobots(url);
    const d = robots.getCrawlDelay(config.robotsUserAgent);
    return d ? Math.min(d * 1000, 30000) : 0;
}

module.exports = { isAllowed, assertAllowed, getSitemaps, getCrawlDelayMs, _cache: cache };
