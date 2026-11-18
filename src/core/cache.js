/**
 * Small in-memory LRU cache with TTL. Agents frequently re-request the same
 * page (e.g. read page, then extract from it); this makes repeats free.
 */
const config = require('../config');

class TtlCache {
    constructor({ max = config.cacheMaxEntries, ttlMs = config.cacheTtlMs } = {}) {
        this.max = max;
        this.ttlMs = ttlMs;
        this.map = new Map();
        this.hits = 0;
        this.misses = 0;
    }

    get(key) {
        const entry = this.map.get(key);
        if (!entry || entry.expires < Date.now()) {
            if (entry) this.map.delete(key);
            this.misses++;
            return undefined;
        }
        // refresh LRU position
        this.map.delete(key);
        this.map.set(key, entry);
        this.hits++;
        return entry.value;
    }

    set(key, value, ttlMs = this.ttlMs) {
        if (ttlMs <= 0 || this.max <= 0) return;
        this.map.delete(key);
        this.map.set(key, { value, expires: Date.now() + ttlMs });
        while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    }

    clear() { this.map.clear(); }

    stats() { return { entries: this.map.size, hits: this.hits, misses: this.misses }; }
}

module.exports = { TtlCache };
