const test = require('node:test');
const assert = require('node:assert/strict');

const { createDefaultRiskConfig } = require('../backend/risk/risk-policy');
const { createBackendContext } = require('../backend/server/backend-context');
const { createApiRouter } = require('../backend/routes/api-router');

function armedContext(overrides = {}) {
  return createBackendContext({
    env: {
      REAL_TRADING: 'true',
      MT5_CONNECTOR_ENABLED: 'true',
      MT5_REAL_TRADING_ENABLED: 'true',
      MT5_ACCOUNT1_LOGIN: '110994506',
      MT5_ACCOUNT1_SERVER: 'FBS-REAL',
      ...overrides.env
    },
    botState: {
      tradingRealEnabled: true,
      trainingEnabled: true,
      killSwitch: false,
      paperMode: false,
      updatedAt: '2026-06-03T12:00:00.000Z',
      ...overrides.botState
    },
    riskConfig: {
      ...createDefaultRiskConfig(),
      ...overrides.riskConfig
    },
    deps: overrides.deps || {}
  });
}

test('POST /api/mt5-real/preflight delegates to MT5 real check without sending order', async () => {
  const calls = [];
  const router = createApiRouter(armedContext({
    deps: {
      checkMt5RealOrder: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          action: 'CHECK',
          retcode: 10009,
          realTradingTouched: false
        };
      }
    }
  }));

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/mt5-real/preflight',
    body: { symbol: 'EURUSD', side: 'BUY', volume: 0.01 }
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.safety.realTradingTouched, false);
  assert.deepEqual(calls, [{ symbol: 'EURUSD', side: 'BUY', volume: 0.01 }]);
});

test('POST /api/mt5-real/order delegates to MT5 real order channel', async () => {
  const calls = [];
  const router = createApiRouter(armedContext({
    deps: {
      placeMt5RealOrder: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          action: 'ORDER',
          ticket: 778899,
          retcode: 10009,
          realTradingTouched: true
        };
      }
    }
  }));

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/mt5-real/order',
    body: { symbol: 'EURUSD', side: 'BUY', volume: 0.01 }
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.ticket, 778899);
  assert.equal(res.body.safety.realTradingTouched, true);
  assert.deepEqual(calls, [{ symbol: 'EURUSD', side: 'BUY', volume: 0.01 }]);
});

test('POST /api/mt5-real/order returns blocked response safely', async () => {
  const router = createApiRouter(armedContext({
    deps: {
      placeMt5RealOrder: async () => ({
        ok: false,
        status: 'blocked',
        reason: 'mt5_real_trading_disabled',
        realTradingTouched: false
      })
    }
  }));

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/mt5-real/order',
    body: { symbol: 'EURUSD', side: 'BUY', volume: 0.01 }
  });

  assert.equal(res.status, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.safety.realTradingTouched, false);
});

test('POST /api/mt5-real/close delegates to MT5 real close channel', async () => {
  const calls = [];
  const router = createApiRouter(armedContext({
    deps: {
      closeMt5RealPosition: async (payload) => {
        calls.push(payload);
        return {
          ok: true,
          action: 'CLOSE',
          ticket: 991122,
          retcode: 10009,
          realTradingTouched: true
        };
      }
    }
  }));

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/mt5-real/close',
    body: { ticket: 991122, reason: 'manual-close' }
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.ticket, 991122);
  assert.equal(res.body.safety.realTradingTouched, true);
  assert.deepEqual(calls, [{ ticket: 991122, reason: 'manual-close' }]);
});
