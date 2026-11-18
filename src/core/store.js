/**
 * Persistent storage (SQLite via better-sqlite3): scheduled tasks, run
 * history with diffs, crawl jobs and their pages, and the legacy export table.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

let db = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    config TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS task_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    error TEXT,
    title TEXT,
    output_file TEXT,
    content_hash TEXT,
    changed INTEGER,
    diff TEXT,
    added_lines INTEGER,
    removed_lines INTEGER,
    pages INTEGER
);
CREATE INDEX IF NOT EXISTS idx_task_runs_task ON task_runs(task_id, id DESC);
CREATE TABLE IF NOT EXISTS crawls (
    id TEXT PRIMARY KEY,
    start_url TEXT NOT NULL,
    options TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    finished_at TEXT,
    pages_ok INTEGER DEFAULT 0,
    pages_failed INTEGER DEFAULT 0,
    error TEXT
);
CREATE TABLE IF NOT EXISTS crawl_pages (
    crawl_id TEXT NOT NULL,
    url TEXT NOT NULL,
    depth INTEGER NOT NULL,
    status TEXT NOT NULL,
    http_status INTEGER,
    title TEXT,
    description TEXT,
    content TEXT,
    chars INTEGER,
    links_found INTEGER,
    error TEXT,
    fetched_at TEXT,
    seq INTEGER,
    PRIMARY KEY (crawl_id, url)
);
CREATE TABLE IF NOT EXISTS scraped_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT,
    data TEXT,
    timestamp TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;

function getDb() {
    if (db) return db;
    fs.mkdirSync(config.dataDir, { recursive: true });
    db = new Database(path.join(config.dataDir, 'stealthsiphon.db'));
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
    // Crawls interrupted by a restart can never finish
    db.prepare(`UPDATE crawls SET status='interrupted', finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE status='running'`).run();
    return db;
}

function closeDb() {
    if (db) { db.close(); db = null; }
}

// ---- tasks -----------------------------------------------------------------
const tasks = {
    all: () => getDb().prepare('SELECT config FROM tasks ORDER BY created_at').all().map(r => JSON.parse(r.config)),
    get: (id) => { const r = getDb().prepare('SELECT config FROM tasks WHERE id=?').get(id); return r ? JSON.parse(r.config) : null; },
    save: (cfg) => getDb().prepare(`INSERT INTO tasks (id, config) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET config=excluded.config, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`).run(cfg.id, JSON.stringify(cfg)),
    delete: (id) => {
        const d = getDb();
        d.prepare('DELETE FROM task_runs WHERE task_id=?').run(id);
        return d.prepare('DELETE FROM tasks WHERE id=?').run(id).changes > 0;
    },
};

// ---- task runs ---------------------------------------------------------------
const runs = {
    insert: (r) => getDb().prepare(`INSERT INTO task_runs (task_id, started_at, finished_at, status, error, title, output_file, content_hash, changed, diff, added_lines, removed_lines, pages)
        VALUES (@task_id, @started_at, @finished_at, @status, @error, @title, @output_file, @content_hash, @changed, @diff, @added_lines, @removed_lines, @pages)`)
        .run({ error: null, title: null, output_file: null, content_hash: null, changed: null, diff: null, added_lines: null, removed_lines: null, pages: null, finished_at: null, ...r }).lastInsertRowid,
    list: (taskId, { limit = 20, changedOnly = false } = {}) => getDb().prepare(
        `SELECT * FROM task_runs WHERE task_id=? ${changedOnly ? 'AND changed=1' : ''} ORDER BY id DESC LIMIT ?`).all(taskId, limit),
    get: (id) => getDb().prepare('SELECT * FROM task_runs WHERE id=?').get(id),
    lastSuccessful: (taskId) => getDb().prepare(`SELECT * FROM task_runs WHERE task_id=? AND status='success' ORDER BY id DESC LIMIT 1`).get(taskId),
    recentChanges: ({ since, limit = 50 } = {}) => getDb().prepare(
        `SELECT r.*, t.config FROM task_runs r JOIN tasks t ON t.id = r.task_id
         WHERE r.changed=1 ${since ? 'AND r.finished_at > ?' : ''} ORDER BY r.id DESC LIMIT ?`).all(...(since ? [since, limit] : [limit])),
};

// ---- crawls --------------------------------------------------------------------
const crawls = {
    create: (c) => getDb().prepare(`INSERT INTO crawls (id, start_url, options, status, created_at) VALUES (?, ?, ?, 'running', ?)`)
        .run(c.id, c.startUrl, JSON.stringify(c.options), new Date().toISOString()),
    finish: (id, { status, error = null, ok, failed }) => getDb().prepare(
        `UPDATE crawls SET status=?, error=?, pages_ok=?, pages_failed=?, finished_at=? WHERE id=?`).run(status, error, ok, failed, new Date().toISOString(), id),
    progress: (id, ok, failed) => getDb().prepare('UPDATE crawls SET pages_ok=?, pages_failed=? WHERE id=?').run(ok, failed, id),
    get: (id) => {
        const r = getDb().prepare('SELECT * FROM crawls WHERE id=?').get(id);
        return r ? { ...r, options: JSON.parse(r.options) } : null;
    },
    list: (limit = 20) => getDb().prepare('SELECT id, start_url, status, created_at, finished_at, pages_ok, pages_failed FROM crawls ORDER BY created_at DESC LIMIT ?').all(limit),
    addPage: (p) => getDb().prepare(`INSERT OR REPLACE INTO crawl_pages (crawl_id, url, depth, status, http_status, title, description, content, chars, links_found, error, fetched_at, seq)
        VALUES (@crawl_id, @url, @depth, @status, @http_status, @title, @description, @content, @chars, @links_found, @error, @fetched_at, @seq)`)
        .run({ http_status: null, title: null, description: null, content: null, chars: null, links_found: null, error: null, ...p }),
    pages: (id) => getDb().prepare('SELECT url, depth, status, http_status, title, description, chars, links_found, error FROM crawl_pages WHERE crawl_id=? ORDER BY seq').all(id),
    page: (id, url) => getDb().prepare('SELECT * FROM crawl_pages WHERE crawl_id=? AND url=?').get(id, url),
    delete: (id) => {
        getDb().prepare('DELETE FROM crawl_pages WHERE crawl_id=?').run(id);
        return getDb().prepare('DELETE FROM crawls WHERE id=?').run(id).changes > 0;
    },
};

// ---- legacy export -------------------------------------------------------------
const exports_ = {
    insert: (url, data) => getDb().prepare('INSERT INTO scraped_data (url, data) VALUES (?, ?)').run(url, JSON.stringify(data)).lastInsertRowid,
};

module.exports = { getDb, closeDb, tasks, runs, crawls, exportsTable: exports_ };
