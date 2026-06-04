const test = require('node:test');
const assert = require('node:assert/strict');

const { createDefaultRiskConfig } = require('../backend/risk/risk-policy');
const { createBackendContext } = require('../backend/server/backend-context');
const { createApiRouter } = require('../backend/routes/api-router');

function context(overrides = {}) {
  return createBackendContext({
    env: {
      REAL_TRADING: 'true',
      BINANCE_API_KEY: 'key',
      BINANCE_SECRET: 'secret',
      REAL_AUTONOMOUS_SCHEDULER_ENABLED: 'true',
      REAL_AUTONOMOUS_MAX_NOTIONAL_USDT: '6',
      REAL_AUTONOMOUS_MIN_CONFIDENCE: '50',
      ...overrides.env
    },
    botState: {
      tradingRealEnabled: true,
      trainingEnabled: true,
      killSwitch: false,
      paperMode: false
    },
    riskConfig: createDefaultRiskConfig(),
    deps: overrides.deps || {}
  });
}

test('real autonomous HTTP endpoints expose status/start/stop/tick', async () => {
  const calls = [];
  const fakeScheduler = {
    status: () => ({ enabled: true, active: false, ticksRun: 0 }),
    start: () => ({ ok: true, status: { active: true } }),
    stop: () => ({ ok: true, status: { active: false } }),
    runNow: async (ctx) => {
      calls.push(ctx);
      return { ok: true, executedCount: 0, candidates: [] };
    }
  };
  const router = createApiRouter(context({ deps: { realAutonomousScheduler: fakeScheduler } }));

  assert.deepEqual((await router.dispatch({ method: 'GET', pathname: '/api/real-autonomous/status' })).body, { enabled: true, active: false, ticksRun: 0 });
  assert.equal((await router.dispatch({ method: 'POST', pathname: '/api/real-autonomous/start' })).body.status.active, true);
  assert.equal((await router.dispatch({ method: 'POST', pathname: '/api/real-autonomous/stop' })).body.status.active, false);

  const tick = await router.dispatch({ method: 'POST', pathname: '/api/real-autonomous/tick' });
  assert.equal(tick.status, 200);
  assert.equal(tick.body.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].botState.tradingRealEnabled, true);
});

test('real autonomous tick builds executable universe from router deps and audits Binance orders', async () => {
  const audit = [];
  const executed = [];
  const router = createApiRouter(context({
    deps: {
      binanceRealOrderAuditFile: 'virtual-audit.jsonl',
      appendBinanceRealOrderAudit: (_file, entry) => audit.push(entry),
      readTrainingStateSnapshot: () => ({
        state: {
          activePairs: [
            { venue: 'BINANCE', symbol: 'ACXUSDT', bias: 'LONG', confidence: 95 },
            { venue: 'BINANCE', symbol: 'BTCUSDT', bias: 'LONG', confidence: 51 }
          ]
        }
      }),
      getBinanceSymbols: async () => ['BTCUSDT', 'ACXUSDT'],
      getSymbolFilters: async (symbol) => ({
        BTCUSDT: { minQty: 0.00001, stepSize: 0.00001, minNotional: 5, status: 'TRADING', quoteAsset: 'USDT' },
        ACXUSDT: { minQty: 1, stepSize: 1, minNotional: 5, status: 'TRADING', quoteAsset: 'USDT' }
      }[symbol]),
      getTicker: async (symbol) => ({ price: symbol === 'ACXUSDT' ? 0.04 : 65000 }),
      getBinanceSpotBalance: async () => ({ asset: 'USDT', free: 30, locked: 0 }),
      testOrderBinance: async () => ({ ok: true }),
      placeOrderBinance: async (side, symbol, qty) => {
        executed.push({ side, symbol, qty });
        return { ok: true, status: 'FILLED', orderId: 11, notional: 5.2 };
      }
    }
  }));

  const tick = await router.dispatch({ method: 'POST', pathname: '/api/real-autonomous/tick' });

  assert.equal(tick.status, 200);
  assert.equal(tick.body.executedCount, 1);
  assert.equal(executed[0].symbol, 'ACXUSDT');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].status, 'executed');
});
