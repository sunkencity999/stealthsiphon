const { startFixture } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const scheduler = require('../src/scheduler');
const store = require('../src/core/store');

let fx;
test.before(async () => { fx = await startFixture(); scheduler.start(); });
test.after(async () => { scheduler.stop(); await fx.close(); store.closeDb(); });

test('task lifecycle with change detection, diffs and webhook', async () => {
    const task = scheduler.createTask({
        name: 'watch', url: fx.url + '/watched', schedule: '0 0 1 1 *', selector: '#w', mode: 'http', webhookUrl: fx.url + '/hook',
    });
    assert.equal(task.format, 'markdown');
    assert.equal(task.notifyOn, 'change');
    assert.equal(scheduler.isLeader(), true);

    const first = await scheduler.runTask(task.id);
    assert.equal(first.status, 'success');
    assert.equal(first.changed, null, 'baseline has nothing to compare');
    assert.ok(fs.existsSync(first.outputFile));

    const same = await scheduler.runTask(task.id);
    assert.equal(same.changed, false);
    assert.equal(fx.state.webhooks.length, 0, 'no webhook when unchanged');

    fx.state.watched = 'Version two of the watched content.';
    const changed = await scheduler.runTask(task.id);
    assert.equal(changed.changed, true);
    assert.equal(changed.addedLines, 1);
    assert.equal(changed.removedLines, 1);

    const runs = scheduler.getRuns(task.id, { includeDiff: true, changedOnly: true });
    assert.equal(runs.length, 1);
    assert.match(runs[0].diff, /-Version one/);
    assert.match(runs[0].diff, /\+Version two/);

    assert.equal(fx.state.webhooks.length, 1);
    assert.equal(fx.state.webhooks[0].event, 'changed');
    assert.match(fx.state.webhooks[0].diff, /\+Version two/);

    const changes = scheduler.recentChanges({});
    assert.ok(changes.some(c => c.taskId === task.id));

    const full = scheduler.getRun(changed.runId, { includeContent: true });
    assert.match(full.content, /Version two/);

    assert.equal(scheduler.getTask(task.id).lastRun.runId, changed.runId);
    assert.equal(scheduler.deleteTask(task.id), true);
    assert.equal(scheduler.getTask(task.id), null);
});

test('failed runs are recorded with the real error', async () => {
    const task = scheduler.createTask({ name: 'broken', url: fx.url + '/missing', schedule: '0 0 1 1 *', mode: 'http' });
    const run = await scheduler.runTask(task.id);
    assert.equal(run.status, 'error');
    assert.match(run.error, /HTTP_STATUS: Target responded with HTTP 404/);
    scheduler.deleteTask(task.id);
});

test('legacy UI fields map onto the new model', () => {
    const t = scheduler.createTask({ name: 'legacy', url: fx.url + '/', schedule: '0 0 1 1 *', useHeadlessBrowser: true, bypassRobots: true, extractFormat: 'text', waitTime: '500' });
    assert.equal(t.mode, 'browser');
    assert.equal(t.respectRobots, false);
    assert.equal(t.format, 'text');
    assert.equal(t.waitMs, 500);
    assert.equal(t.useHeadlessBrowser, true);
    assert.equal(t.bypassRobots, true);
    const u = scheduler.updateTask(t.id, { schedule: '*/5 * * * *', active: false });
    assert.equal(u.schedule, '*/5 * * * *');
    assert.equal(u.active, false);
    scheduler.deleteTask(t.id);
});

test('validation errors', () => {
    assert.throws(() => scheduler.createTask({ name: 'x', url: fx.url, schedule: 'not cron' }), { code: 'BAD_REQUEST' });
    assert.throws(() => scheduler.createTask({ name: 'x', schedule: '* * * * *' }), { code: 'BAD_REQUEST' });
    assert.throws(() => scheduler.createTask({ name: 'x', url: 'file:///etc/passwd', schedule: '* * * * *' }), { code: 'BLOCKED_URL' });
});
