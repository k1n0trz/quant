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

test('healthz route exposes public backend heartbeat', async () => {
  const context = createBackendContext({
    botState: createDefaultBotState(),
    riskConfig: createDefaultRiskConfig()
  });
  const router = createApiRouter(context);

  const res = await router.dispatch({ method: 'GET', pathname: '/healthz' });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.service, 'quant-backend');
  assert.ok(typeof res.body.ts === 'string' && res.body.ts.length > 0);
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

test('kill switch routes toggle authoritative backend state', async () => {
  const context = createBackendContext({
    botState: {
      ...createDefaultBotState(),
      tradingRealEnabled: true,
      trainingEnabled: true,
      paperMode: false
    },
    riskConfig: createDefaultRiskConfig()
  });
  const router = createApiRouter(context);

  const onRes = await router.dispatch({ method: 'POST', pathname: '/api/bot/kill-switch/on', body: {} });
  assert.equal(onRes.status, 200);
  assert.equal(onRes.body.killSwitch, true);
  assert.equal(onRes.body.tradingRealEnabled, false);
  assert.equal(onRes.body.paperMode, true);
  assert.equal(onRes.body.trainingEnabled, true);

  const offRes = await router.dispatch({ method: 'POST', pathname: '/api/bot/kill-switch/off', body: {} });
  assert.equal(offRes.status, 200);
  assert.equal(offRes.body.killSwitch, false);
  assert.equal(offRes.body.tradingRealEnabled, false);
  assert.equal(offRes.body.paperMode, true);
  assert.equal(offRes.body.trainingEnabled, true);
});
