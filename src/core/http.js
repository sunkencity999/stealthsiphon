/**
 * Safe HTTP fetching. Every connection goes through safeLookup (blocks private
 * IPs even after redirects / DNS rebinding) and every redirect hop is checked.
 */
const http = require('http');
const https = require('https');
const axios = require('axios');
const config = require('../config');
const { assertSafeUrl, safeLookup, isBlockedHostLiteral } = require('./safety');
const { SiphonError, E, normalizeError } = require('./errors');
const { withHostLimit } = require('./limiter');

const httpAgent = new http.Agent({ keepAlive: true, lookup: safeLookup });
const httpsAgent = new https.Agent({ keepAlive: true, lookup: safeLookup });

const DEFAULT_HEADERS = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9',
};

function decodeBody(buffer, contentType) {
    let charset = (contentType.match(/charset=["']?([\w-]+)/i) || [])[1];
    if (!charset && /html|xml/i.test(contentType)) {
        const head = buffer.subarray(0, 2048).toString('latin1');
        charset = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
    }
    try {
        return new TextDecoder(charset || 'utf-8').decode(buffer);
    } catch {
        return new TextDecoder('utf-8').decode(buffer);
    }
}

function isTextual(contentType) {
    return !contentType || /^text\/|json|xml|javascript|html/i.test(contentType);
}

/**
 * Fetch a URL over plain HTTP.
 * @returns {Promise<{url, finalUrl, status, headers, contentType, body: string|null, buffer: Buffer, tookMs}>}
 */
async function httpFetch(url, { userAgent = config.userAgent, headers = {}, timeoutMs = config.requestTimeoutMs, method = 'GET', data, throwOnStatus = false, skipLimiter = false } = {}) {
    const safe = await assertSafeUrl(url);
    const started = Date.now();
    const doFetch = async () => {
        let response;
        try {
            response = await axios.request({
                url: safe.href,
                method,
                data,
                headers: { ...DEFAULT_HEADERS, 'User-Agent': userAgent, ...headers },
                responseType: 'arraybuffer',
                timeout: timeoutMs,
                maxContentLength: config.maxResponseBytes,
                maxBodyLength: config.maxResponseBytes,
                maxRedirects: 10,
                httpAgent,
                httpsAgent,
                proxy: false,
                decompress: true,
                validateStatus: () => true,
                beforeRedirect: (options) => {
                    if (isBlockedHostLiteral(options.hostname)) {
                        throw new SiphonError(E.BLOCKED_URL, `Redirect to blocked host ${options.hostname}`, { status: 403 });
                    }
                },
            });
        } catch (err) {
            if (err instanceof SiphonError) throw err;
            if (err.cause instanceof SiphonError) throw err.cause;
            if (err.code === 'EBLOCKED' || (err.cause && err.cause.code === 'EBLOCKED')) {
                throw new SiphonError(E.BLOCKED_URL, err.message, { status: 403 });
            }
            throw normalizeError(err);
        }
        const buffer = Buffer.from(response.data);
        const contentType = String(response.headers['content-type'] || '');
        const finalUrl = (response.request && response.request.res && response.request.res.responseUrl) || safe.href;
        const result = {
            url: safe.href,
            finalUrl,
            status: response.status,
            headers: response.headers,
            contentType,
            buffer,
            body: isTextual(contentType) ? decodeBody(buffer, contentType) : null,
            tookMs: Date.now() - started,
        };
        if (throwOnStatus && response.status >= 400) {
            throw new SiphonError(E.HTTP_STATUS, `Target responded with HTTP ${response.status}`, { status: 502, details: { status: response.status } });
        }
        return result;
    };
    return skipLimiter ? doFetch() : withHostLimit(safe.href, doFetch);
}

module.exports = { httpFetch, httpAgent, httpsAgent };
