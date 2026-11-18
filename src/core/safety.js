/**
 * Network safety: keeps the scraper from being used to reach localhost, the
 * LAN, or cloud metadata endpoints (SSRF). This matters doubly for agents,
 * since a page an agent reads can try to instruct it to fetch internal URLs.
 *
 * Three layers:
 *  1. assertSafeUrl()   - scheme + literal-host checks + DNS resolution check
 *  2. safeLookup()      - DNS hook used at connect time (defeats DNS rebinding)
 *  3. isBlockedHostLiteral() - cheap sync check used for browser subrequests
 */
const dns = require('dns');
const net = require('net');
const config = require('../config');
const { SiphonError, E } = require('./errors');

const BLOCKED_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback', 'metadata.google.internal', 'metadata']);

function ipv4ToInt(ip) {
    return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct, 10), 0) >>> 0;
}

const V4_BLOCKS = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [ipv4ToInt(base), bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0]);

function isPrivateIPv4(ip) {
    const n = ipv4ToInt(ip);
    return V4_BLOCKS.some(([base, mask]) => ((n & mask) >>> 0) === base);
}

function isPrivateIPv6(ip) {
    const lower = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (lower === '::' || lower === '::1') return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIPv4(mapped[1]);
    // ::ffff:7f00:1 style mapped addresses
    const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
        const hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16);
        return isPrivateIPv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    const first = parseInt(lower.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
    if ((first & 0xff00) === 0xff00) return true; // multicast
    if (lower.startsWith('64:ff9b:')) return true; // NAT64 can map to private v4
    if (lower.startsWith('2001:db8:')) return true; // documentation
    return false;
}

function isPrivateIP(ip) {
    const family = net.isIP(ip.replace(/^\[|\]$/g, ''));
    if (family === 4) return isPrivateIPv4(ip);
    if (family === 6) return isPrivateIPv6(ip);
    return false;
}

/** Sync check on the hostname alone (no DNS). */
function isBlockedHostLiteral(hostname) {
    if (config.allowPrivateNetworks) return false;
    const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (BLOCKED_HOSTNAMES.has(h) || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
    if (net.isIP(h)) return isPrivateIP(h);
    // Decimal / hex / octal IPv4 encodings like 2130706433 or 0x7f000001
    if (/^(0x[0-9a-f]+|\d+)$/i.test(h)) return true;
    if (/^[0-9a-fx.]+$/i.test(h) && h.split('.').some(p => /^0x|^0\d/i.test(p))) return true;
    return false;
}

/** Parse and validate a URL string. Throws SiphonError. Returns URL object. */
function parseUrl(input) {
    if (!input || typeof input !== 'string') throw new SiphonError(E.INVALID_URL, 'A URL string is required', { status: 400 });
    let url;
    try {
        url = new URL(input.trim());
    } catch {
        // Be forgiving with bare domains like "example.com/path"
        try {
            if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(input.trim())) url = new URL('https://' + input.trim());
        } catch { /* fallthrough */ }
        if (!url) throw new SiphonError(E.INVALID_URL, `Invalid URL: ${input}`, { status: 400 });
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new SiphonError(E.BLOCKED_URL, `Only http and https URLs are allowed (got ${url.protocol})`, { status: 400 });
    }
    if (url.username || url.password) {
        throw new SiphonError(E.BLOCKED_URL, 'URLs with embedded credentials are not allowed', { status: 400 });
    }
    url.hash = '';
    return url;
}

/** Full check: syntax, literal host, and every DNS answer. */
async function assertSafeUrl(input, { allowPrivate = config.allowPrivateNetworks } = {}) {
    const url = input instanceof URL ? input : parseUrl(input);
    if (allowPrivate) return url;
    if (isBlockedHostLiteral(url.hostname)) {
        throw new SiphonError(E.BLOCKED_URL, `Blocked private/internal host: ${url.hostname}`, { status: 403 });
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!net.isIP(host)) {
        let answers;
        try {
            answers = await dns.promises.lookup(host, { all: true, verbatim: true });
        } catch (err) {
            throw new SiphonError(E.NETWORK, `DNS lookup failed for ${host}: ${err.code || err.message}`, { status: 502 });
        }
        const bad = answers.find(a => isPrivateIP(a.address));
        if (bad) throw new SiphonError(E.BLOCKED_URL, `Host ${host} resolves to private address ${bad.address}`, { status: 403 });
    }
    return url;
}

/**
 * dns.lookup-compatible function for http(s).Agent that refuses private
 * addresses at connect time. Covers redirects and DNS rebinding.
 */
function safeLookup(hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err);
        if (!config.allowPrivateNetworks) {
            const bad = addresses.find(a => isPrivateIP(a.address));
            if (bad) {
                const e = new Error(`Blocked: ${hostname} resolves to private address ${bad.address}`);
                e.code = 'EBLOCKED';
                return callback(e);
            }
        }
        if (options.all) return callback(null, addresses);
        callback(null, addresses[0].address, addresses[0].family);
    });
}

module.exports = { parseUrl, assertSafeUrl, safeLookup, isBlockedHostLiteral, isPrivateIP };
