/**
 * Typed errors with stable machine-readable codes. Agents branch on `code`,
 * humans read `message`. Stack traces never leave the process.
 */
class SiphonError extends Error {
    constructor(code, message, { status = 500, details } = {}) {
        super(message);
        this.name = 'SiphonError';
        this.code = code;
        this.status = status;
        if (details !== undefined) this.details = details;
    }
}

const E = {
    INVALID_URL: 'INVALID_URL',
    BLOCKED_URL: 'BLOCKED_URL',
    ROBOTS_DISALLOWED: 'ROBOTS_DISALLOWED',
    TIMEOUT: 'TIMEOUT',
    NETWORK: 'NETWORK_ERROR',
    HTTP_STATUS: 'HTTP_STATUS',
    TOO_LARGE: 'RESPONSE_TOO_LARGE',
    BROWSER_UNAVAILABLE: 'BROWSER_UNAVAILABLE',
    BROWSER_ERROR: 'BROWSER_ERROR',
    NOT_FOUND: 'NOT_FOUND',
    BAD_REQUEST: 'BAD_REQUEST',
    LIMIT: 'LIMIT_EXCEEDED',
    LLM_ERROR: 'LLM_ERROR',
    UNAUTHORIZED: 'UNAUTHORIZED',
    DISABLED: 'DISABLED',
    INTERNAL: 'INTERNAL_ERROR',
};

/** Convert anything thrown into a SiphonError. */
function normalizeError(err) {
    if (err instanceof SiphonError) return err;
    const msg = err && err.message ? err.message : String(err);
    if (err && (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || /timeout/i.test(msg))) {
        return new SiphonError(E.TIMEOUT, msg, { status: 504 });
    }
    if (err && err.code === 'ERR_BAD_RESPONSE' && /maxContentLength/i.test(msg)) {
        return new SiphonError(E.TOO_LARGE, msg, { status: 502 });
    }
    if (err && ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'EHOSTUNREACH', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT'].includes(err.code)) {
        return new SiphonError(E.NETWORK, `${err.code}: ${msg}`, { status: 502 });
    }
    return new SiphonError(E.INTERNAL, msg, { status: 500 });
}

function errorBody(err) {
    const e = normalizeError(err);
    const body = { code: e.code, message: e.message };
    if (e.details !== undefined) body.details = e.details;
    return body;
}

module.exports = { SiphonError, E, normalizeError, errorBody };
