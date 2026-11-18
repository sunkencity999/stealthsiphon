/**
 * Per-host politeness: bounded concurrency plus a minimum gap between request
 * starts. Prevents agents (which love parallel tool calls) from hammering a
 * site and getting the user's IP banned.
 */
const config = require('../config');

const hosts = new Map(); // host -> { active, queue: [], lastStart }

function state(host) {
    if (!hosts.has(host)) hosts.set(host, { active: 0, queue: [], lastStart: 0 });
    return hosts.get(host);
}

function pump(host) {
    const s = state(host);
    if (s.active >= config.perHostConcurrency || s.queue.length === 0) return;
    const wait = Math.max(0, s.lastStart + config.perHostMinIntervalMs - Date.now());
    if (wait > 0) {
        if (!s.timer) s.timer = setTimeout(() => { s.timer = null; pump(host); }, wait);
        return;
    }
    const next = s.queue.shift();
    s.active++;
    s.lastStart = Date.now();
    next();
    pump(host);
}

/** Run fn() under the per-host limiter for the given URL. */
async function withHostLimit(url, fn) {
    const host = new URL(url).host;
    const s = state(host);
    await new Promise(resolve => { s.queue.push(resolve); pump(host); });
    try {
        return await fn();
    } finally {
        s.active--;
        if (s.active === 0 && s.queue.length === 0 && !s.timer) hosts.delete(host);
        else pump(host);
    }
}

module.exports = { withHostLimit };
