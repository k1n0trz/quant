const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createDefaultBotState } = require('../backend/services/bot-state-service');
const { createDefaultRiskConfig } = require('../backend/risk/risk-policy');
const { createBackendContext } = require('../backend/server/backend-context');
const { createApiRouter } = require('../backend/routes/api-router');
const { createTrainingStateSnapshot } = require('../backend/training/training-state');

function createRouterWithTrainingState(trainingState, env = {}) {
  const context = createBackendContext({
    env,
    botState: createDefaultBotState(),
    riskConfig: createDefaultRiskConfig(),
    deps: {
      readTrainingState: () => JSON.parse(JSON.stringify(trainingState))
    }
  });
  return createApiRouter(context);
}

function createRouterWithTrainingSnapshot(snapshot, env = {}) {
  const context = createBackendContext({
    env,
    botState: createDefaultBotState(),
    riskConfig: createDefaultRiskConfig(),
    deps: {
      readTrainingStateSnapshot: () => JSON.parse(JSON.stringify(snapshot))
    }
  });
  return createApiRouter(context);
}

function createRouterWithTrainingWriter(trainingState, env = {}) {
  const writes = [];
  const context = createBackendContext({
    env,
    botState: createDefaultBotState(),
    riskConfig: createDefaultRiskConfig(),
    deps: {
      readTrainingState: () => JSON.parse(JSON.stringify(trainingState)),
      writeTrainingState: (nextState) => {
        writes.push(JSON.parse(JSON.stringify(nextState)));
        return { ok: true, persistedAt: '2026-05-09T16:00:00.000Z', file: 'fixture' };
      }
    }
  });
  return { router: createApiRouter(context), writes };
}

const sampleTrainingState = {
  version: 2,
  mode: 'training',
  simulated: true,
  blockRealExecution: true,
  balanceStart: 100000,
  balance: 100010,
  positions: [
    { symbol: 'BTCUSDT', venue: 'BINANCE', direction: 'LONG', entry_price: 100, pnl_demo: 0, strategy_id: 'trendMomentum' }
  ],
  closedTrades: [
    { symbol: 'BTCUSDT', strategy_id: 'trendMomentum', pnl_demo: 10, closed_timestamp: '2026-05-01T00:00:00.000Z' },
    { symbol: 'ETHUSDT', strategy_id: 'breakoutRetest', pnl_demo: -5, closed_timestamp: '2026-05-01T01:00:00.000Z' },
    { symbol: 'SOLUSDT', strategy_id: 'trendMomentum', pnl_demo: 15, closed_timestamp: '2026-05-01T02:00:00.000Z' }
  ],
  lessons: [{ symbol: 'BTCUSDT', outcome: 'win' }],
  persistedAt: '2026-05-08T00:00:00.000Z'
};

test('training core status is read-only and backend scheduler remains disabled by default', async () => {
  const router = createRouterWithTrainingState(sampleTrainingState);

  const res = await router.dispatch({ method: 'GET', pathname: '/api/training/core/status' });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.core.backendEnabled, false);
  assert.equal(res.body.core.schedulerActive, false);
  assert.equal(res.body.state.mode, 'training');
  assert.equal(res.body.state.positions, 1);
  assert.equal(res.body.state.closedTrades, 3);
  assert.equal(res.body.safety.realTradingTouched, false);
  assert.equal(res.body.safety.writesPerformed, false);
});

test('training core metrics exposes computed Quant-Core metrics', async () => {
  const router = createRouterWithTrainingState(sampleTrainingState);

  const res = await router.dispatch({ method: 'GET', pathname: '/api/training/core/metrics' });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.metrics.sampleSize, 3);
  assert.equal(res.body.metrics.winRate, 0.6667);
  assert.equal(res.body.metrics.netProfit, 20);
  assert.equal(res.body.metrics.byStrategy.trendMomentum.sampleSize, 2);
});

test('training core reports unavailable state without breaking endpoints', async () => {
  const router = createRouterWithTrainingSnapshot({
    available: false,
    reason: 'training_state_shape_incompatible',
    state: null,
    source: { filePath: 'quant_training_state.json' }
  });

  const status = await router.dispatch({ method: 'GET', pathname: '/api/training/core/status' });
  const metrics = await router.dispatch({ method: 'GET', pathname: '/api/training/core/metrics' });
  const equity = await router.dispatch({ method: 'GET', pathname: '/api/training/core/equity' });
  const edge = await router.dispatch({ method: 'GET', pathname: '/api/training/core/edge' });

  for (const res of [status, metrics, equity, edge]) {
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.available, false);
    assert.equal(res.body.reason, 'training_state_shape_incompatible');
  }
  assert.equal(metrics.body.metrics.sampleSize, 0);
  assert.equal(equity.body.equity.points, 0);
  assert.equal(edge.body.edge.sampleSize, 0);
});

test('training core computes metrics from legacy closed trades snapshot', async () => {
  const snapshot = createTrainingStateSnapshot({
    balanceStart: 1000,
    closedTrades: [
      { symbol: 'XAUUSD', profit: 10, setup_tecnico_detectado: 'legacy-a' },
      { symbol: 'EURUSD', pnl: -4, setup_tecnico_detectado: 'legacy-b' },
      { symbol: 'GBPUSD', pnl_demo: 6, strategy_id: 'trendMomentum' }
    ],
    strategyStats: {
      trendMomentum: { id: 'trendMomentum', closed: 1, wins: 1, pnl: 6, avgScore: 77 },
      unknown: { id: 'unknown', closed: 2, wins: 1, pnl: 6, avgScore: 0 }
    }
  });
  const router = createRouterWithTrainingSnapshot(snapshot);

  const metrics = await router.dispatch({ method: 'GET', pathname: '/api/training/core/metrics' });
  const strategies = await router.dispatch({ method: 'GET', pathname: '/api/training/core/strategies' });

  assert.equal(metrics.status, 200);
  assert.equal(metrics.body.available, true);
  assert.equal(metrics.body.metrics.sampleSize, 3);
  assert.equal(metrics.body.metrics.winRate, 0.6667);
  assert.equal(metrics.body.metrics.expectancy, 4);
  assert.equal(metrics.body.metrics.profitFactor, 4);
  assert.equal(metrics.body.metrics.byStrategy.trendMomentum.sampleSize, 1);
  assert.equal(metrics.body.diagnostics.summary.totalTrades, 3);
  assert.equal(metrics.body.diagnostics.summary.unknownStrategyTrades, 2);
  assert.equal(metrics.body.diagnostics.summary.unknownStrategyRate, 0.6667);
  assert.equal(strategies.body.available, true);
  assert.equal(strategies.body.strategyRanking[0].id, 'trendMomentum');
  assert.equal(strategies.body.strategyRanking[0].sampleSize, 1);
});

test('training core strategies exposes registry in shadow mode', async () => {
  const router = createRouterWithTrainingState(sampleTrainingState);

  const res = await router.dispatch({ method: 'GET', pathname: '/api/training/core/strategies' });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.mode, 'shadow');
  assert.equal(res.body.strategies.length, 5);
  assert.equal(res.body.strategies.every((strategy) => strategy.backendExecutable === false), true);
});

test('training core equity exposes equity curve only', async () => {
  const router = createRouterWithTrainingState(sampleTrainingState);

  const res = await router.dispatch({ method: 'GET', pathname: '/api/training/core/equity' });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.equity.balanceStart, 100000);
  assert.deepEqual(res.body.equity.curve, [100010, 100005, 100020]);
  assert.equal(res.body.equity.points, 3);
});

test('training core edge exposes degradation and stability without writes', async () => {
  const router = createRouterWithTrainingState(sampleTrainingState);

  const res = await router.dispatch({ method: 'GET', pathname: '/api/training/core/edge' });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.edge.sampleSize, 3);
  assert.equal(res.body.edge.degradation.status, 'insufficient_sample');
  assert.equal(res.body.edge.schedulerActive, false);
  assert.equal(res.body.edge.backendEnabled, false);
});

test('training core status reflects explicit backend feature flag without activating scheduler', async () => {
  const router = createRouterWithTrainingState(sampleTrainingState, { TRAINING_BACKEND_ENABLED: 'true' });

  const res = await router.dispatch({ method: 'GET', pathname: '/api/training/core/status' });

  assert.equal(res.status, 200);
  assert.equal(res.body.core.backendEnabled, true);
  assert.equal(res.body.core.schedulerActive, false);
});

test('training demo closed trade endpoint is disabled by default and does not write', async () => {
  const { router, writes } = createRouterWithTrainingWriter(sampleTrainingState);

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/training/demo/closed-trade',
    body: {
      openPosition: { signal_id: 'sig-disabled', direction: 'LONG', entry_price: 100, size_demo: 1 },
      exitContext: { price: 101 },
      signal: { bias: 'LONG', confidence: 70 }
    }
  });

  assert.equal(res.status, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.available, false);
  assert.equal(res.body.reason, 'training_backend_writer_disabled');
  assert.equal(writes.length, 0);
});

test('training demo closed trade endpoint writes traceable closed trade when enabled', async () => {
  const legacyTrade = { symbol: 'XAUUSD', pnl_demo: -4, setup_tecnico_detectado: 'legacy' };
  const { router, writes } = createRouterWithTrainingWriter({
    ...sampleTrainingState,
    closedTrades: [legacyTrade]
  }, { TRAINING_BACKEND_WRITER_ENABLED: 'true' });

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/training/demo/closed-trade',
    body: {
      openPosition: {
        signal_id: 'sig-enabled',
        strategy_id: 'trendMomentum',
        direction: 'LONG',
        symbol: 'BTCUSD',
        entry_price: 100,
        size_demo: 2,
        fees_simuladas: 1,
        spread_estimado: 0.5,
        slippage_estimado: 0.25
      },
      exitContext: { price: 110 },
      signal: { bias: 'SHORT', confidence: 54 }
    }
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.mode, 'internal');
  assert.equal(res.body.closedTrade.signal_id, 'sig-enabled');
  assert.equal(res.body.closedTrade.strategy_id, 'trendMomentum');
  assert.equal(res.body.closedTrade.pnl_demo, 18.25);
  assert.equal(res.body.closedTrade.exit_reason_code, 'signal_flip_or_edge_loss');
  assert.equal(res.body.summary.closedTrades, 2);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].closedTrades[0].signal_id, 'sig-enabled');
  assert.deepEqual(writes[0].closedTrades[1], legacyTrade);
});

test('training demo closed trade endpoint handles incomplete payload without 500', async () => {
  const { router, writes } = createRouterWithTrainingWriter(sampleTrainingState, { TRAINING_BACKEND_WRITER_ENABLED: 'true' });

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/training/demo/closed-trade',
    body: { exitContext: { price: 101 } }
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.ok, false);
  assert.match(res.body.error, /openPosition/i);
  assert.equal(writes.length, 0);
});

test('training demo closed trade endpoint refuses enabled writes without compatible state', async () => {
  const writes = [];
  const context = createBackendContext({
    env: { TRAINING_BACKEND_WRITER_ENABLED: 'true' },
    botState: createDefaultBotState(),
    riskConfig: createDefaultRiskConfig(),
    deps: {
      readTrainingState: () => null,
      writeTrainingState: (nextState) => {
        writes.push(nextState);
        return { ok: true };
      }
    }
  });
  const router = createApiRouter(context);

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/training/demo/closed-trade',
    body: {
      openPosition: { signal_id: 'sig-missing-state', direction: 'LONG', entry_price: 100, size_demo: 1 },
      exitContext: { price: 101 },
      signal: { bias: 'LONG', confidence: 70 }
    }
  });

  assert.equal(res.status, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.reason, 'training_state_shape_incompatible');
  assert.equal(writes.length, 0);
});

test('OpenAPI contract documents every read-only Quant-Core endpoint', () => {
  const root = path.join(__dirname, '..');
  const yaml = fs.readFileSync(path.join(root, 'openapi.yaml'), 'utf8');
  const json = JSON.parse(fs.readFileSync(path.join(root, 'openapi.json'), 'utf8'));
  const endpoints = [
    '/api/training/core/status',
    '/api/training/core/metrics',
    '/api/training/core/strategies',
    '/api/training/core/equity',
    '/api/training/core/edge'
  ];

  for (const endpoint of endpoints) {
    assert.equal(yaml.includes(`  ${endpoint}:`), true, `${endpoint} missing from openapi.yaml`);
    assert.ok(json.paths[endpoint], `${endpoint} missing from openapi.json`);
  }

  assert.ok(json.components.schemas.TrainingCoreStatusResponse);
  assert.ok(json.components.schemas.TrainingCoreMetricsResponse);
  assert.ok(json.components.schemas.TrainingCoreStrategiesResponse);
  assert.ok(json.components.schemas.TrainingCoreEquityResponse);
  assert.ok(json.components.schemas.TrainingCoreEdgeResponse);
});
