const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  runSystemSelfAudit,
  appendSystemSelfAuditHistory,
  readSystemSelfAuditHistory,
  SYSTEM_SELF_AUDIT_ALLOWED_SERVICES
} = require('../backend/system/system-self-audit-service');

test('system self audit summarizes connectors scheduler and vps services without touching real trading', async () => {
  const calls = [];
  const result = await runSystemSelfAudit({
    env: {
      BINANCE_API_KEY: 'k',
      BINANCE_SECRET: 's',
      DEEPSEEK_API_KEY: 'd',
      FINNHUB_API_KEY: 'f',
      ALPHA_VANTAGE_API_KEY: 'a',
      MT5_CONNECTOR_ENABLED: 'true',
      TRAINING_BACKEND_LOOP_ENABLED: 'true',
      TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'true',
      SYSTEM_SELF_AUDIT_REMEDIATION_ENABLED: 'false'
    },
    botState: {
      tradingRealEnabled: true,
      trainingEnabled: true,
      killSwitch: false,
      paperMode: false
    },
    riskValidation: { ok: true, issues: [] },
    deps: {
      getTrainingLoopStatus: () => ({ active: true, loopEnabled: true, enabled: true, ticksRun: 8, lastError: null }),
      readTrainingStateSnapshot: () => ({ available: true, state: { positions: [{}, {}], activePairs: [{}, {}], closedTrades: [{}, {}, {}], lessons: [{}] } }),
      testServiceStatus: async (service) => {
        calls.push(service);
        return { ok: true, service, active: true };
      }
    },
    now: () => new Date('2026-06-02T10:00:00.000Z')
  });

  assert.equal(result.ok, true);
  assert.equal(result.safety.realTradingTouched, false);
  assert.equal(result.remediation.enabled, false);
  assert.equal(result.summary.severity, 'ok');
  assert.equal(result.connectors.binance.configured, true);
  assert.equal(result.training.schedulerActive, true);
  assert.deepEqual(calls, SYSTEM_SELF_AUDIT_ALLOWED_SERVICES);
});

test('system self audit auto prepares only allowed vps services when remediation is enabled', async () => {
  const restarts = [];
  const result = await runSystemSelfAudit({
    env: {
      TRAINING_BACKEND_LOOP_ENABLED: 'true',
      TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'true',
      SYSTEM_SELF_AUDIT_REMEDIATION_ENABLED: 'true'
    },
    botState: { tradingRealEnabled: false, trainingEnabled: true, killSwitch: false, paperMode: true },
    riskValidation: { ok: true, issues: [] },
    deps: {
      getTrainingLoopStatus: () => ({ active: false, loopEnabled: true, enabled: true, ticksRun: 0, lastError: null }),
      readTrainingStateSnapshot: () => ({ available: false, reason: 'missing_state' }),
      testServiceStatus: async (service) => ({ ok: service !== 'quant-mt5-terminal.service', service, active: service !== 'quant-mt5-terminal.service' }),
      restartAllowedService: async (service) => {
        restarts.push(service);
        return { ok: true, service, action: 'restart' };
      }
    },
    now: () => new Date('2026-06-02T10:05:00.000Z')
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.severity, 'warning');
  assert.equal(result.remediation.enabled, true);
  assert.deepEqual(restarts, ['quant-mt5-terminal.service']);
  assert.equal(result.remediation.actions.length, 1);
  assert.equal(result.remediation.actions[0].service, 'quant-mt5-terminal.service');
  assert.equal(result.findings.some((f) => f.code === 'training_scheduler_inactive'), true);
  assert.equal(result.findings.some((f) => f.code === 'training_state_unavailable'), true);
});

test('system self audit history is append only and clamps reads', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-self-audit-'));
  const file = path.join(dir, 'history.jsonl');
  appendSystemSelfAuditHistory(file, { ts: '2026-06-02T10:00:00.000Z', ok: true, summary: { severity: 'ok' } });
  appendSystemSelfAuditHistory(file, { ts: '2026-06-02T10:01:00.000Z', ok: true, summary: { severity: 'warning' } });

  const read = readSystemSelfAuditHistory(file, 1);

  assert.equal(read.ok, true);
  assert.equal(read.exists, true);
  assert.equal(read.entries.length, 1);
  assert.equal(read.entries[0].summary.severity, 'warning');
  assert.ok(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).length >= 2);
});
