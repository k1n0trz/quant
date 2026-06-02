const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDefaultRiskConfig } = require('../backend/risk/risk-policy');
const { createBackendContext } = require('../backend/server/backend-context');
const { createApiRouter } = require('../backend/routes/api-router');

function auditFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'quant-binance-real-route-')), 'audit.jsonl');
}

function armedContext(overrides = {}) {
  return createBackendContext({
    env: {
      REAL_TRADING: 'true',
      BINANCE_API_KEY: 'key',
      BINANCE_SECRET: 'secret',
      ...overrides.env
    },
    botState: {
      tradingRealEnabled: true,
      trainingEnabled: true,
      killSwitch: false,
      paperMode: false,
      updatedAt: '2026-06-02T12:00:00.000Z',
      ...overrides.botState
    },
    riskConfig: {
      ...createDefaultRiskConfig(),
      ...overrides.riskConfig
    },
    deps: overrides.deps || {}
  });
}

test('POST /api/place-order executes Binance Spot through the injected executor and writes audit', async () => {
  const file = auditFile();
  const calls = [];
  const router = createApiRouter(armedContext({
    deps: {
      binanceRealOrderAuditFile: file,
      placeOrderBinance: async (...args) => {
        calls.push(args);
        return {
          ok: true,
          orderId: 987,
          status: 'FILLED',
          symbol: 'BTCUSDT',
          side: 'BUY',
          type: 'MARKET',
          qty: 0.001,
          price: 65000,
          notional: 65
        };
      }
    }
  }));

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/place-order',
    body: { side: 'buy', symbol: 'btcusdt', qty: '0.001', type: 'market' }
  });
  const audit = await router.dispatch({ method: 'GET', pathname: '/api/binance-real-order-audit', body: { limit: 5 } });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.executionStatus, 'executed');
  assert.equal(res.body.orderId, 987);
  assert.deepEqual(calls, [['BUY', 'BTCUSDT', 0.001, 'MARKET', null]]);
  assert.equal(audit.status, 200);
  assert.equal(audit.body.entries.length, 1);
  assert.equal(audit.body.entries[0].status, 'executed');
  assert.equal(audit.body.entries[0].realTradingTouched, true);
});

test('POST /api/place-order blocks when real trading is not armed and still audits safely', async () => {
  const file = auditFile();
  let called = false;
  const router = createApiRouter(armedContext({
    env: { REAL_TRADING: 'false' },
    deps: {
      binanceRealOrderAuditFile: file,
      placeOrderBinance: async () => {
        called = true;
        return { ok: true };
      }
    }
  }));

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/place-order',
    body: { side: 'BUY', symbol: 'BTCUSDT', qty: 0.001, type: 'MARKET' }
  });
  const audit = await router.dispatch({ method: 'GET', pathname: '/api/binance-real-order-audit', body: { limit: 1 } });

  assert.equal(res.status, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'blocked');
  assert.equal(res.body.safety.realTradingTouched, false);
  assert.equal(called, false);
  assert.equal(audit.status, 200);
  assert.equal(audit.body.entries.length, 1);
  assert.equal(audit.body.entries[0].status, 'blocked');
  assert.equal(audit.body.entries[0].realTradingTouched, false);
});

test('POST /api/binance-real-order-preflight returns affordability without touching executor', async () => {
  let called = false;
  const router = createApiRouter(armedContext({
    deps: {
      getSymbolFilters: async () => ({ minQty: 0.00001, stepSize: 0.00001, minNotional: 5, status: 'TRADING', quoteAsset: 'USDT' }),
      getTicker: async () => ({ price: 65000 }),
      getBinanceSpotBalance: async () => ({ asset: 'USDT', free: 0.005, locked: 0 }),
      getBinanceEarnBalance: async () => ({ asset: 'USDT', total: 75, redeemable: 75, positions: [] }),
      placeOrderBinance: async () => { called = true; return { ok: true }; }
    }
  }));

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/binance-real-order-preflight',
    body: { side: 'BUY', symbol: 'BTCUSDT', qty: 0.001, type: 'MARKET' }
  });

  assert.equal(res.status, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'blocked');
  assert.equal(res.body.quoteFree, 0.005);
  assert.equal(res.body.requestedNotional, 65);
  assert.equal(res.body.earn.redeemable, 75);
  assert.equal(res.body.canCoverWithEarn, true);
  assert.equal(called, false);
});

test('POST /api/place-order uses preflight to block insufficient balance before executor', async () => {
  const file = auditFile();
  let called = false;
  const router = createApiRouter(armedContext({
    deps: {
      binanceRealOrderAuditFile: file,
      getSymbolFilters: async () => ({ minQty: 0.00001, stepSize: 0.00001, minNotional: 5, status: 'TRADING', quoteAsset: 'USDT' }),
      getTicker: async () => ({ price: 65000 }),
      getBinanceSpotBalance: async () => ({ asset: 'USDT', free: 0.005, locked: 0 }),
      placeOrderBinance: async () => { called = true; return { ok: true }; }
    }
  }));

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/place-order',
    body: { side: 'BUY', symbol: 'BTCUSDT', qty: 0.001, type: 'MARKET' }
  });
  const audit = await router.dispatch({ method: 'GET', pathname: '/api/binance-real-order-audit', body: { limit: 1 } });

  assert.equal(res.status, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.status, 'blocked');
  assert.equal(res.body.safety.realTradingTouched, false);
  assert.equal(called, false);
  assert.equal(audit.body.entries[0].status, 'blocked');
  assert.equal(audit.body.entries[0].realTradingTouched, false);
});
