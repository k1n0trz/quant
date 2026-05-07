const test = require('node:test');
const assert = require('node:assert/strict');

const { createDefaultBotState } = require('../backend/services/bot-state-service');
const { createDefaultRiskConfig } = require('../backend/risk/risk-policy');
const { createBackendContext } = require('../backend/server/backend-context');
const { createApiRouter } = require('../backend/routes/api-router');

test('status route exposes safe operational summary', async () => {
  const context = createBackendContext({
    botState: createDefaultBotState(),
    riskConfig: createDefaultRiskConfig()
  });
  const router = createApiRouter(context);

  const res = await router.dispatch({ method: 'GET', pathname: '/api/status' });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.bot.tradingRealEnabled, false);
  assert.equal(res.body.bot.trainingEnabled, true);
});

test('trading real on route refuses invalid risk configuration', async () => {
  const context = createBackendContext({
    botState: createDefaultBotState(),
    riskConfig: {
      enabled: true,
      maxRiskPerTradePct: 0,
      maxDailyLossPct: 0,
      maxOpenPositions: 0,
      requireStopLoss: false
    }
  });
  const router = createApiRouter(context);

  const res = await router.dispatch({ method: 'POST', pathname: '/api/bot/trading-real/on', body: {} });

  assert.equal(res.status, 409);
  assert.match(String(res.body.error || ''), /risk/i);
});

test('connections route reports MT5 as optional adapter', async () => {
  const context = createBackendContext({
    env: { MT5_CONNECTOR_ENABLED: 'false' },
    botState: createDefaultBotState(),
    riskConfig: createDefaultRiskConfig()
  });
  const router = createApiRouter(context);

  const res = await router.dispatch({ method: 'GET', pathname: '/api/connections' });

  assert.equal(res.status, 200);
  assert.equal(res.body.adapters.binance.required, true);
  assert.equal(res.body.adapters.mt5.optional, true);
});
