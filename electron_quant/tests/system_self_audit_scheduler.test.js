const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSystemSelfAuditSchedulerController,
  isSystemSelfAuditSchedulerEnabled,
  resolveSystemSelfAuditIntervalMs
} = require('../backend/system/system-self-audit-scheduler');

test('system self audit scheduler is read-only enabled by default with sane interval', () => {
  assert.equal(isSystemSelfAuditSchedulerEnabled({}), true);
  assert.equal(isSystemSelfAuditSchedulerEnabled({ SYSTEM_SELF_AUDIT_ENABLED: 'false' }), false);
  assert.equal(resolveSystemSelfAuditIntervalMs({}), 300000);
  assert.equal(resolveSystemSelfAuditIntervalMs({ SYSTEM_SELF_AUDIT_INTERVAL_MS: '15000' }), 15000);
  assert.equal(resolveSystemSelfAuditIntervalMs({ SYSTEM_SELF_AUDIT_INTERVAL_MS: '999' }), 300000);
});

test('system self audit scheduler starts runs once and records status', async () => {
  let intervalFn = null;
  let cleared = false;
  const runs = [];
  const scheduler = createSystemSelfAuditSchedulerController({
    timers: {
      setInterval(fn) {
        intervalFn = fn;
        return 'timer-1';
      },
      clearInterval(handle) {
        if (handle === 'timer-1') cleared = true;
      }
    },
    runAudit: async () => {
      runs.push(Date.now());
      return { ok: true, summary: { severity: 'ok' }, safety: { realTradingTouched: false } };
    },
    now: () => Date.parse('2026-06-02T11:00:00.000Z')
  });

  const started = scheduler.start({ env: { SYSTEM_SELF_AUDIT_INTERVAL_MS: '15000' } });
  assert.equal(started.ok, true);
  assert.equal(started.status.active, true);
  assert.equal(started.status.intervalMs, 15000);
  assert.equal(typeof intervalFn, 'function');

  const manual = await scheduler.runNow({ reason: 'manual' });
  assert.equal(manual.ok, true);
  assert.equal(scheduler.status().runs, 1);
  await intervalFn();
  assert.equal(scheduler.status().runs, 2);

  const stopped = scheduler.stop();
  assert.equal(stopped.status.active, false);
  assert.equal(cleared, true);
});
