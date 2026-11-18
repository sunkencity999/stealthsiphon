/**
 * Scheduled tasks with run history and change detection.
 *
 * Each run stores the output to disk, hashes it, and diffs it against the
 * previous successful run. Tasks can POST a webhook when content changes, so
 * "watch this page" is just a task with notifyOn:'change'.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');
const axios = require('axios');
const { createTwoFilesPatch, diffLines } = require('diff');
const config = require('./config');
const store = require('./core/store');
const { fetchPage, screenshot } = require('./core/scrape');
const { crawlToMap } = require('./core/crawl');
const { assertSafeUrl, parseUrl } = require('./core/safety');
const { SiphonError, E, normalizeError } = require('./core/errors');

const jobs = new Map(); // id -> { job, key }
const runningTasks = new Set();
// Only one process (web server or a stdio MCP server) runs cron jobs at a time;
// the leader re-reads tasks from SQLite periodically so tasks created by any
// process get scheduled.
let leader = false;
let tickTimer = null;
const LOCK_FILE = () => path.join(config.dataDir, 'scheduler.lock');
const RECONCILE_MS = 30000;
const RESULTS_DIR = () => path.join(config.dataDir, 'results');
const MAX_DIFF_CHARS = 20000;

const TASK_FIELDS = ['name', 'url', 'schedule', 'active', 'format', 'mode', 'selector', 'mainContent', 'waitForSelector', 'waitMs',
    'followLinks', 'linkDepth', 'respectRobots', 'userAgent', 'webhookUrl', 'notifyOn', 'outputFormat', 'description',
    // legacy UI fields
    'useHeadlessBrowser', 'extractFormat', 'bypassRobots', 'waitTime'];

/** Map legacy UI fields onto the current task model. */
function normalizeTask(input, existing = {}) {
    const t = { ...existing };
    for (const k of TASK_FIELDS) if (input[k] !== undefined) t[k] = input[k];
    if (input.bypassRobots !== undefined && input.respectRobots === undefined) t.respectRobots = !input.bypassRobots;
    if (input.useHeadlessBrowser !== undefined && input.mode === undefined) t.mode = input.useHeadlessBrowser ? 'browser' : 'auto';
    if (input.extractFormat !== undefined && input.format === undefined) {
        t.format = { text: 'text', screenshot: 'screenshot', html: 'html' }[input.extractFormat] || 'html';
    }
    if (input.waitTime !== undefined && input.waitMs === undefined) t.waitMs = parseInt(input.waitTime, 10) || 0;
    t.format = t.format || 'markdown';
    t.mode = t.mode || 'auto';
    t.notifyOn = t.notifyOn || 'change';
    t.active = t.active !== false;
    return t;
}

function validate(t) {
    if (!t.name || !t.url || !t.schedule) throw new SiphonError(E.BAD_REQUEST, 'Missing required fields: name, url, schedule', { status: 400 });
    parseUrl(t.url);
    if (!cron.validate(t.schedule)) throw new SiphonError(E.BAD_REQUEST, `Invalid cron expression: ${t.schedule}`, { status: 400 });
    if (!['markdown', 'text', 'html', 'screenshot'].includes(t.format)) throw new SiphonError(E.BAD_REQUEST, 'format must be markdown, text, html, or screenshot', { status: 400 });
    if (!['change', 'always', 'never'].includes(t.notifyOn)) throw new SiphonError(E.BAD_REQUEST, 'notifyOn must be change, always, or never', { status: 400 });
    if (t.webhookUrl) parseUrl(t.webhookUrl);
}

function startJob(task) {
    if (!leader) return;
    stopJob(task.id);
    if (!task.active) return;
    const job = cron.schedule(task.schedule, () => {
        runTask(task.id).catch(err => console.error(`[scheduler] ${task.id}: ${err.message}`));
    }, { scheduled: true });
    jobs.set(task.id, { job, key: `${task.schedule}|${task.active}` });
}

function stopJob(id) {
    const entry = jobs.get(id);
    if (entry) { entry.job.stop(); jobs.delete(id); }
}

function pidAlive(pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function tryAcquireLock() {
    fs.mkdirSync(config.dataDir, { recursive: true });
    try {
        const pid = parseInt(fs.readFileSync(LOCK_FILE(), 'utf8'), 10);
        if (pid && pid !== process.pid && pidAlive(pid)) return false;
    } catch { /* no lock file */ }
    fs.writeFileSync(LOCK_FILE(), String(process.pid));
    return true;
}

function releaseLock() {
    try {
        if (parseInt(fs.readFileSync(LOCK_FILE(), 'utf8'), 10) === process.pid) fs.unlinkSync(LOCK_FILE());
    } catch { /* ignore */ }
}

/** Sync cron jobs with the tasks table. */
function reconcile() {
    if (!leader) return;
    const all = store.tasks.all();
    const ids = new Set(all.map(t => t.id));
    for (const id of [...jobs.keys()]) if (!ids.has(id)) stopJob(id);
    for (const t of all) {
        const entry = jobs.get(t.id);
        if (!t.active) { stopJob(t.id); continue; }
        if (!entry || entry.key !== `${t.schedule}|${t.active}`) startJob(t);
    }
}

function tick() {
    if (!leader) {
        leader = tryAcquireLock();
        if (leader) console.error(`[scheduler] this process (pid ${process.pid}) is now running scheduled tasks`);
    }
    reconcile();
}

function summarize(task) {
    const runs = store.runs.list(task.id, { limit: 1 });
    const last = runs[0];
    return {
        ...task,
        // Derived fields the legacy scheduler UI renders
        useHeadlessBrowser: task.mode === 'browser',
        bypassRobots: task.respectRobots === false,
        extractFormat: task.format === 'markdown' ? 'html' : task.format,
        lastRun: last ? runSummary(last) : undefined,
        nextRunHint: task.active ? task.schedule : null,
    };
}

function runSummary(r) {
    const out = {
        runId: r.id,
        timestamp: r.finished_at || r.started_at,
        startedAt: r.started_at,
        duration: r.finished_at ? (new Date(r.finished_at) - new Date(r.started_at)) / 1000 : null,
        status: r.status,
        changed: r.changed === null ? null : !!r.changed,
    };
    if (r.error) out.error = r.error;
    if (r.title) out.title = r.title;
    if (r.output_file) out.outputFile = r.output_file;
    if (r.content_hash) out.contentHash = r.content_hash;
    if (r.added_lines !== null) out.addedLines = r.added_lines;
    if (r.removed_lines !== null) out.removedLines = r.removed_lines;
    if (r.pages !== null) out.pagesScraped = r.pages;
    return out;
}

function createTask(input) {
    const task = normalizeTask(input);
    task.id = input.id || crypto.randomUUID();
    validate(task);
    store.tasks.save(task);
    startJob(task);
    return summarize(task);
}

function updateTask(id, updates) {
    const existing = store.tasks.get(id);
    if (!existing) return null;
    const task = normalizeTask(updates, existing);
    task.id = id;
    validate(task);
    store.tasks.save(task);
    startJob(task);
    return summarize(task);
}

function deleteTask(id) {
    stopJob(id);
    return store.tasks.delete(id);
}

function getTask(id) {
    const t = store.tasks.get(id);
    return t ? summarize(t) : null;
}

function listTasks() {
    return store.tasks.all().map(summarize);
}

async function executeTask(task) {
    const common = { url: task.url, mode: task.mode, respectRobots: task.respectRobots, userAgent: task.userAgent, waitForSelector: task.waitForSelector, waitMs: task.waitMs, useCache: false };
    if (task.format === 'screenshot') {
        const s = await screenshot({ ...common, fullPage: true });
        return { kind: 'binary', buffer: s.image, ext: 'png', title: s.title, comparable: crypto.createHash('sha256').update(s.image).digest('hex') };
    }
    if (task.followLinks) {
        const { map, pages } = await crawlToMap(task.url, parseInt(task.linkDepth || 2, 10), {
            format: task.format, mode: task.mode, selector: task.selector, respectRobots: task.respectRobots, userAgent: task.userAgent, mainContent: task.mainContent,
        });
        const text = Object.entries(map).map(([u, c]) => `### ${u}\n\n${c}`).join('\n\n');
        return { kind: 'json', data: map, ext: 'json', pages, comparable: text };
    }
    const r = await fetchPage({ ...common, format: task.format, selector: task.selector, mainContent: task.mainContent, includeMetadata: true });
    if (!r.ok) throw new SiphonError(r.error.code, r.error.message);
    const ext = { markdown: 'md', text: 'txt', html: 'html' }[task.format];
    return { kind: 'text', text: r.content, ext, title: r.title, comparable: r.content };
}

async function sendWebhook(task, payload) {
    if (!task.webhookUrl) return;
    try {
        if (!config.allowPrivateWebhooks) await assertSafeUrl(task.webhookUrl, { allowPrivate: false });
        await axios.post(task.webhookUrl, payload, { timeout: 15000 });
    } catch (err) {
        console.error(`[scheduler] webhook for task ${task.id} failed: ${err.message}`);
    }
}

/** Run a task now. Resolves with the run summary. */
async function runTask(id) {
    const task = store.tasks.get(id);
    if (!task) throw new SiphonError(E.NOT_FOUND, `No task ${id}`, { status: 404 });
    if (runningTasks.has(id)) throw new SiphonError(E.LIMIT, `Task ${id} is already running`, { status: 409 });
    runningTasks.add(id);
    const startedAt = new Date().toISOString();
    try {
        const result = await executeTask(task);
        const dir = path.join(RESULTS_DIR(), id);
        fs.mkdirSync(dir, { recursive: true });
        const ext = task.outputFormat && task.outputFormat !== 'auto' ? task.outputFormat : result.ext;
        const outputFile = path.join(dir, `${startedAt.replace(/:/g, '-')}.${ext}`);
        if (result.kind === 'binary') fs.writeFileSync(outputFile, result.buffer);
        else if (result.kind === 'json') fs.writeFileSync(outputFile, JSON.stringify(result.data, null, 2));
        else fs.writeFileSync(outputFile, result.text);

        const contentHash = crypto.createHash('sha256').update(result.comparable).digest('hex').slice(0, 16);
        const prev = store.runs.lastSuccessful(id);
        let changed = prev ? prev.content_hash !== contentHash : null;
        let diff = null, added = 0, removed = 0;
        if (changed && result.kind !== 'binary' && prev.output_file && fs.existsSync(prev.output_file)) {
            const prevText = readComparable(prev.output_file, result.kind);
            for (const part of diffLines(prevText, result.comparable)) {
                const n = part.count || 0;
                if (part.added) added += n;
                else if (part.removed) removed += n;
            }
            diff = createTwoFilesPatch('previous', 'current', prevText, result.comparable, prev.finished_at, startedAt, { context: 2 });
            if (diff.length > MAX_DIFF_CHARS) diff = diff.slice(0, MAX_DIFF_CHARS) + '\n... (diff truncated)';
        }
        const finishedAt = new Date().toISOString();
        const runId = store.runs.insert({
            task_id: id, started_at: startedAt, finished_at: finishedAt, status: 'success', title: result.title || null,
            output_file: outputFile, content_hash: contentHash, changed: changed === null ? null : changed ? 1 : 0,
            diff, added_lines: changed ? added : null, removed_lines: changed ? removed : null, pages: result.pages || 1,
        });
        const run = runSummary(store.runs.get(runId));
        if (task.notifyOn === 'always' || (task.notifyOn === 'change' && changed)) {
            await sendWebhook(task, { event: changed ? 'changed' : 'run', task: { id, name: task.name, url: task.url }, run, diff });
        }
        return run;
    } catch (err) {
        const e = normalizeError(err);
        const runId = store.runs.insert({ task_id: id, started_at: startedAt, finished_at: new Date().toISOString(), status: 'error', error: `${e.code}: ${e.message}` });
        if (task.notifyOn === 'always') await sendWebhook(task, { event: 'error', task: { id, name: task.name, url: task.url }, error: e.message });
        return runSummary(store.runs.get(runId));
    } finally {
        runningTasks.delete(id);
    }
}

function readComparable(file, kind) {
    const raw = fs.readFileSync(file, 'utf8');
    if (kind !== 'json') return raw;
    try { return Object.entries(JSON.parse(raw)).map(([u, c]) => `### ${u}\n\n${c}`).join('\n\n'); } catch { return raw; }
}

function getRuns(id, { limit = 20, changedOnly = false, includeDiff = false } = {}) {
    if (!store.tasks.get(id)) throw new SiphonError(E.NOT_FOUND, `No task ${id}`, { status: 404 });
    return store.runs.list(id, { limit, changedOnly }).map(r => (includeDiff && r.diff ? { ...runSummary(r), diff: r.diff } : runSummary(r)));
}

function getRun(runId, { includeContent = false, maxChars = 20000 } = {}) {
    const r = store.runs.get(runId);
    if (!r) throw new SiphonError(E.NOT_FOUND, `No run ${runId}`, { status: 404 });
    const out = { taskId: r.task_id, ...runSummary(r) };
    if (r.diff) out.diff = r.diff;
    if (includeContent && r.output_file && fs.existsSync(r.output_file) && !/\.(png|jpe?g)$/.test(r.output_file)) {
        const text = fs.readFileSync(r.output_file, 'utf8');
        out.content = text.slice(0, maxChars);
        out.truncated = text.length > maxChars;
    }
    return out;
}

function recentChanges({ since, limit } = {}) {
    return store.runs.recentChanges({ since, limit }).map(r => {
        const t = JSON.parse(r.config);
        return { taskId: r.task_id, name: t.name, url: t.url, ...runSummary(r), diff: r.diff };
    });
}

/** Import task JSON files from the pre-SQLite scheduler (one time). */
function importLegacyTasks() {
    const legacyDir = path.join(config.root, 'scheduled_tasks');
    if (!fs.existsSync(legacyDir)) return 0;
    let n = 0;
    for (const f of fs.readdirSync(legacyDir).filter(f => f.endsWith('.json'))) {
        try {
            const cfg = JSON.parse(fs.readFileSync(path.join(legacyDir, f), 'utf8'));
            if (!cfg.id || store.tasks.get(cfg.id)) continue;
            const task = normalizeTask(cfg);
            task.id = cfg.id;
            validate(task);
            store.tasks.save(task);
            n++;
        } catch (err) {
            console.error(`[scheduler] could not import ${f}: ${err.message}`);
        }
    }
    return n;
}

function start() {
    const imported = importLegacyTasks();
    if (imported) console.error(`[scheduler] imported ${imported} legacy task(s)`);
    tick();
    clearInterval(tickTimer);
    tickTimer = setInterval(tick, RECONCILE_MS);
    tickTimer.unref();
    return { tasks: store.tasks.all().length, leader };
}

function stop() {
    clearInterval(tickTimer);
    tickTimer = null;
    for (const id of [...jobs.keys()]) stopJob(id);
    if (leader) releaseLock();
    leader = false;
}

const isLeader = () => leader;

module.exports = { start, stop, isLeader, createTask, updateTask, deleteTask, getTask, listTasks, runTask, getRuns, getRun, recentChanges, normalizeTask };
