const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDefaultBotState } = require('../backend/services/bot-state-service');
const { createDefaultRiskConfig } = require('../backend/risk/risk-policy');
const { createBackendContext } = require('../backend/server/backend-context');
const { createApiRouter } = require('../backend/routes/api-router');

test('system self audit routes run audit persist status and expose history', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-self-audit-routes-'));
  const statusFile = path.join(dir, 'status.json');
  const historyFile = path.join(dir, 'history.jsonl');
  const context = createBackendContext({
    env: {
      BINANCE_API_KEY: 'k',
      BINANCE_SECRET: 's',
      DEEPSEEK_API_KEY: 'd',
      FINNHUB_API_KEY: 'f',
      ALPHA_VANTAGE_API_KEY: 'a',
      MT5_CONNECTOR_ENABLED: 'true',
      SYSTEM_SELF_AUDIT_ENABLED: 'true',
      SYSTEM_SELF_AUDIT_REMEDIATION_ENABLED: 'false',
      TRAINING_BACKEND_LOOP_ENABLED: 'true',
      TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'true'
    },
    botState: createDefaultBotState(),
    riskConfig: createDefaultRiskConfig(),
    deps: {
      systemSelfAuditStatusFile: statusFile,
      systemSelfAuditHistoryFile: historyFile,
      getTrainingLoopStatus: () => ({ active: true, loopEnabled: true, enabled: true, ticksRun: 2 }),
      readTrainingStateSnapshot: () => ({ available: true, state: { positions: [], activePairs: [], closedTrades: [], lessons: [] } }),
      testServiceStatus: async (service) => ({ ok: true, service, active: true })
    }
  });
  const router = createApiRouter(context);

  const run = await router.dispatch({ method: 'POST', pathname: '/api/system/self-audit/run', body: {} });
  assert.equal(run.status, 200);
  assert.equal(run.body.ok, true);
  assert.equal(run.body.safety.realTradingTouched, false);
  assert.equal(fs.existsSync(statusFile), true);
  assert.equal(fs.existsSync(historyFile), true);

  const status = await router.dispatch({ method: 'GET', pathname: '/api/system/self-audit/status' });
  assert.equal(status.status, 200);
  assert.equal(status.body.ok, true);
  assert.equal(status.body.available, true);
  assert.equal(status.body.audit.summary.severity, 'ok');

  const history = await router.dispatch({ method: 'GET', pathname: '/api/system/self-audit/history', body: { limit: 5 } });
  assert.equal(history.status, 200);
  assert.equal(history.body.entries.length, 1);
});

test('system self audit scheduler routes expose status and start without touching trading', async () => {
  let started = false;
  const context = createBackendContext({
    env: { SYSTEM_SELF_AUDIT_ENABLED: 'true' },
    deps: {
      systemSelfAuditScheduler: {
        status: () => ({ enabled: true, active: started, runs: 0, skipped: 0 }),
        start: () => {
          started = true;
          return { ok: true, status: { enabled: true, active: true, runs: 0, skipped: 0 } };
        },
        stop: () => {
          started = false;
          return { ok: true, status: { enabled: true, active: false, runs: 0, skipped: 0 } };
        }
      }
    }
  });
  const router = createApiRouter(context);

  const before = await router.dispatch({ method: 'GET', pathname: '/api/system/self-audit/scheduler/status' });
  assert.equal(before.status, 200);
  assert.equal(before.body.scheduler.active, false);

  const start = await router.dispatch({ method: 'POST', pathname: '/api/system/self-audit/scheduler/start', body: {} });
  assert.equal(start.status, 200);
  assert.equal(start.body.scheduler.active, true);
  assert.equal(start.body.safety.realTradingTouched, false);

  const stop = await router.dispatch({ method: 'POST', pathname: '/api/system/self-audit/scheduler/stop', body: {} });
  assert.equal(stop.status, 200);
  assert.equal(stop.body.scheduler.active, false);
});
