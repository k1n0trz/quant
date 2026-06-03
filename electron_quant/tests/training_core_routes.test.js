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

function createRouterWithTrainingLoop(trainingState, env = {}) {
  const writes = [];
  const context = createBackendContext({
    env,
    botState: createDefaultBotState(),
    riskConfig: createDefaultRiskConfig(),
    deps: {
      readTrainingStateSnapshot: () => createTrainingStateSnapshot(JSON.parse(JSON.stringify(trainingState))),
      writeTrainingState: (nextState) => {
        writes.push(JSON.parse(JSON.stringify(nextState)));
        return { ok: true, persistedAt: '2026-05-10T16:00:00.000Z', file: 'fixture' };
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
    { id: 'pos-sample-1', signal_id: 'sig-sample-1', symbol: 'BTCUSDT', venue: 'BINANCE', direction: 'LONG', entry_price: 100, pnl_demo: 0, strategy_id: 'trendMomentum', size_demo: 1 }
  ],
  closedTrades: [
    { symbol: 'BTCUSDT', strategy_id: 'trendMomentum', pnl_demo: 10, closed_timestamp: '2026-05-01T00:00:00.000Z' },
    { symbol: 'ETHUSDT', strategy_id: 'breakoutRetest', pnl_demo: -5, closed_timestamp: '2026-05-01T01:00:00.000Z' },
    { symbol: 'SOLUSDT', strategy_id: 'trendMomentum', pnl_demo: 15, closed_timestamp: '2026-05-01T02:00:00.000Z' }
  ],
  lessons: [{ symbol: 'BTCUSDT', outcome: 'win' }],
  persistedAt: '2026-05-08T00:00:00.000Z'
};

function createSaturatedBinanceTrainingState() {
  const positions = Array.from({ length: 40 }, (_, index) => ({
    id: `pos-binance-route-${index + 1}`,
    signal_id: `sig-binance-route-${index + 1}`,
    symbol: `R${index + 1}USDT`,
    venue: 'BINANCE',
    direction: 'LONG',
    entry_price: 100 + index,
    size_demo: 1,
    opened_tick: Date.parse('2026-05-10T12:00:00.000Z'),
    min_hold_ms: 90 * 60 * 1000,
    max_hold_ms: 12 * 60 * 60 * 1000,
    horizon: index < 20 ? 'intraday' : 'swing'
  }));
  return {
    ...sampleTrainingState,
    positions,
    targets: { total: 40, intraday: 20, swing: 20 },
    targetOpenPositions: 40,
    targetIntradayPositions: 20,
    targetSwingPositions: 20,
    minMt5OpenPositions: 6,
    activePairs: positions.map((position) => ({
      venue: 'BINANCE',
      symbol: position.symbol,
      score: 70,
      price: position.entry_price,
      indicators: { bias: 'LONG', confidence: 80 }
    }))
  };
}

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
    positions: [{
      id: 'pos-enabled-1',
      signal_id: 'sig-enabled',
      strategy_id: 'trendMomentum',
      direction: 'LONG',
      symbol: 'BTCUSD',
      venue: 'BINANCE',
      entry_price: 100,
      size_demo: 2,
      fees_simuladas: 1,
      spread_estimado: 0.5,
      slippage_estimado: 0.25
    }],
    closedTrades: [legacyTrade],
    balance: 100010
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
  assert.equal(res.body.balanceBefore, 100010);
  assert.equal(res.body.balanceAfter, 100028.25);
  assert.equal(res.body.removedPositionId, 'pos-enabled-1');
  assert.equal(res.body.removedSignalId, 'sig-enabled');
  assert.equal(res.body.lessonPending, true);
  assert.match(String(res.body.lessonPendingReason || ''), /lesson/i);
  assert.equal(res.body.summary.closedTrades, 2);
  assert.equal(res.body.summary.positions, 0);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].positions.length, 0);
  assert.equal(writes[0].balance, 100028.25);
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

test('training demo closed trade endpoint refuses non-unique match without writing', async () => {
  const duplicatePosition = {
    symbol: 'BTCUSDT',
    venue: 'BINANCE',
    direction: 'LONG',
    entry_price: 100,
    size_demo: 1
  };
  const { router, writes } = createRouterWithTrainingWriter({
    ...sampleTrainingState,
    positions: [duplicatePosition, { ...duplicatePosition }]
  }, { TRAINING_BACKEND_WRITER_ENABLED: 'true' });

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/training/demo/closed-trade',
    body: {
      openPosition: { symbol: 'BTCUSDT', venue: 'BINANCE', direction: 'LONG', entry_price: 100, size_demo: 1 },
      exitContext: { price: 101 },
      signal: { bias: 'LONG', confidence: 70 }
    }
  });

  assert.equal(res.status, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.reason, 'open_position_not_unique');
  assert.equal(writes.length, 0);
});

test('training demo state endpoint returns read-only backend snapshot', async () => {
  const router = createRouterWithTrainingSnapshot(createTrainingStateSnapshot(sampleTrainingState));

  const res = await router.dispatch({
    method: 'GET',
    pathname: '/api/training/demo/state'
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.available, true);
  assert.equal(res.body.state.balance, 100010);
  assert.equal(res.body.state.positions.length, 1);
  assert.equal(res.body.safety.readOnly, true);
  assert.equal(res.body.safety.writesPerformed, false);
});

test('training demo live snapshot endpoint returns compact state with totals', async () => {
  const closedTrades = Array.from({ length: 150 }, (_, index) => ({
    symbol: `T${index}USDT`,
    strategy_id: 'trendMomentum',
    pnl_demo: index % 2 ? -1 : 2,
    closed_timestamp: new Date(Date.UTC(2026, 4, 1, 0, index)).toISOString()
  }));
  const lessons = Array.from({ length: 140 }, (_, index) => ({
    symbol: `L${index}USDT`,
    lesson: `lesson ${index}`,
    recorded_at: new Date(Date.UTC(2026, 4, 1, 0, index)).toISOString()
  }));
  const activePairs = Array.from({ length: 45 }, (_, index) => ({
    venue: index % 2 ? 'MT5' : 'BINANCE',
    symbol: `P${index}USDT`,
    price: 100 + index,
    score: 70,
    indicators: { bias: 'LONG', confidence: 80, horizon: index % 2 ? 'swing' : 'intraday' }
  }));
  const router = createRouterWithTrainingSnapshot(createTrainingStateSnapshot({
    ...sampleTrainingState,
    activePairs,
    closedTrades,
    lessons,
    positions: [
      { id: 'open-1', symbol: 'BTCUSDT', venue: 'BINANCE', direction: 'LONG', entry_price: 100 },
      { id: 'closed-1', symbol: 'ETHUSDT', venue: 'BINANCE', direction: 'SHORT', entry_price: 100, exit_price: 99 }
    ]
  }));

  const res = await router.dispatch({
    method: 'GET',
    pathname: '/api/training/demo/live-snapshot',
    body: { limit: 50 }
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.compact, true);
  assert.equal(res.body.state.closedTrades.length, 50);
  assert.equal(res.body.state.lessons.length, 50);
  assert.equal(res.body.state.positions.length, 1);
  assert.equal(res.body.state.totals.closedTrades, 150);
  assert.equal(res.body.state.totals.lessons, 140);
  assert.equal(res.body.state.totals.activePairs, 45);
  assert.equal(res.body.safety.readOnly, true);
});

test('training demo tick endpoint is disabled by default and does not execute', async () => {
  const { router, writes } = createRouterWithTrainingLoop(sampleTrainingState);

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/training/demo/tick',
    body: { positionContexts: [] }
  });

  assert.equal(res.status, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.reason, 'training_backend_loop_disabled');
  assert.equal(writes.length, 0);
});

test('training demo tick endpoint closes eligible position and persists next state', async () => {
  const { router, writes } = createRouterWithTrainingLoop({
    ...sampleTrainingState,
    balance: 100000,
    positions: [
      {
        id: 'pos-tick-1',
        signal_id: 'sig-tick-1',
        strategy_id: 'trendMomentum',
        symbol: 'BTCUSDT',
        venue: 'BINANCE',
        direction: 'LONG',
        entry_price: 100,
        size_demo: 2,
        fees_simuladas: 1,
        spread_estimado: 0.5,
        slippage_estimado: 0.25,
        opened_tick: Date.parse('2026-05-10T08:00:00.000Z'),
        min_hold_ms: 30 * 60 * 1000,
        max_hold_ms: 12 * 60 * 60 * 1000,
        horizon: 'intraday'
      },
      { id: 'pos-tick-2', symbol: 'ETHUSDT', venue: 'BINANCE', direction: 'LONG', entry_price: 10, size_demo: 1 },
      { id: 'pos-tick-3', symbol: 'SOLUSDT', venue: 'BINANCE', direction: 'LONG', entry_price: 20, size_demo: 1 }
    ],
    targetOpenPositions: 3
  }, { TRAINING_BACKEND_LOOP_ENABLED: 'true' });

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/training/demo/tick',
    body: {
      nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
      positionContexts: [{
        positionId: 'pos-tick-1',
        pair: { symbol: 'BTCUSDT', venue: 'BINANCE', price: 105 },
        signal: { bias: 'LONG', confidence: 70 }
      }]
    }
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.evaluatedPositions, 1);
  assert.equal(res.body.closedPositions, 1);
  assert.equal(res.body.balanceBefore, 100000);
  assert.equal(res.body.balanceAfter, 100008.25);
  assert.equal(res.body.lessonPendingCount, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].positions.length, 2);
  assert.equal(writes[0].closedTrades[0].signal_id, 'sig-tick-1');
});

test('training demo tick endpoint can build backend contexts when request omits them', async () => {
  const writes = [];
  const context = createBackendContext({
    env: { TRAINING_BACKEND_LOOP_ENABLED: 'true', TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true' },
    botState: createDefaultBotState(),
    riskConfig: createDefaultRiskConfig(),
    deps: {
      readTrainingStateSnapshot: () => createTrainingStateSnapshot({
        ...sampleTrainingState,
        balance: 100000,
        positions: [
          {
            id: 'pos-auto-1',
            signal_id: 'sig-auto-1',
            strategy_id: 'trendMomentum',
            symbol: 'BTCUSDT',
            venue: 'BINANCE',
            direction: 'LONG',
            entry_price: 100,
            size_demo: 2,
            fees_simuladas: 1,
            spread_estimado: 0.5,
            slippage_estimado: 0.25,
            opened_tick: Date.parse('2026-05-10T08:00:00.000Z'),
            min_hold_ms: 30 * 60 * 1000,
            max_hold_ms: 12 * 60 * 60 * 1000,
            horizon: 'intraday'
          },
          { id: 'pos-auto-2', symbol: 'ETHUSDT', venue: 'BINANCE', direction: 'LONG', entry_price: 10, size_demo: 1 },
          { id: 'pos-auto-3', symbol: 'SOLUSDT', venue: 'BINANCE', direction: 'LONG', entry_price: 20, size_demo: 1 }
        ],
        activePairs: [{
          symbol: 'XRPUSDT',
          venue: 'BINANCE',
          score: 70,
          spreadPct: 0.001,
          indicators: {
            bias: 'LONG',
            confidence: 80,
            htfAlignmentScore: 0.7,
            patternScore: 0.5,
            volumeRatio: 1.2,
            primaryStrategy: { id: 'trendMomentum', name: 'Trend Momentum', score: 82, reason: 'Aligned trend' },
            strategyScores: [{ id: 'trendMomentum', score: 82 }],
            setup: 'Trend Momentum: breakout',
            horizon: 'intraday'
          }
        }],
        targetIntradayPositions: 3,
        targetSwingPositions: 0,
        targets: { total: 3, intraday: 3, swing: 0 },
        targetOpenPositions: 3
      }),
      writeTrainingState: (nextState) => {
        writes.push(JSON.parse(JSON.stringify(nextState)));
        return { ok: true, persistedAt: '2026-05-10T16:00:00.000Z' };
      },
      getTicker: async (symbol) => {
        if (symbol === 'BTCUSDT') return { ok: true, price: 105 };
        if (symbol === 'XRPUSDT') return { ok: true, price: 2.1 };
        return { ok: false };
      },
      readMemory: () => [
        { kind: 'training_signal', payload: { signal_id: 'sig-auto-1', bias: 'LONG', confidence: 70, symbol: 'BTCUSDT', venue: 'BINANCE' } },
        { kind: 'training_signal', payload: { signal_id: 'sig-entry-1', bias: 'LONG', confidence: 80, symbol: 'XRPUSDT', venue: 'BINANCE', htfAlignmentScore: 0.7, patternScore: 0.5, volumeRatio: 1.2, strategy_id: 'trendMomentum', strategy_name: 'Trend Momentum' } }
      ]
    }
  });
  const router = createApiRouter(context);

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/training/demo/tick',
    body: {
      nowMs: Date.parse('2026-05-10T12:00:00.000Z')
    }
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.evaluatedPositions, 1);
  assert.equal(res.body.closedPositions, 1);
  assert.equal(res.body.openedPositions, 1);
  assert.equal(res.body.entryEnabled, true);
  assert.equal(res.body.contextSource, 'backend');
  assert.equal(writes.length, 1);
});

test('training demo tick endpoint persists active universe rebalance without opens or closes', async () => {
  const writes = [];
  const context = createBackendContext({
    env: {
      TRAINING_BACKEND_LOOP_ENABLED: 'true',
      TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true',
      MT5_CONNECTOR_ENABLED: 'true'
    },
    botState: createDefaultBotState(),
    riskConfig: createDefaultRiskConfig(),
    deps: {
      readTrainingStateSnapshot: () => createTrainingStateSnapshot(createSaturatedBinanceTrainingState()),
      writeTrainingState: (nextState) => {
        writes.push(JSON.parse(JSON.stringify(nextState)));
        return { ok: true, persistedAt: '2026-05-10T16:00:00.000Z', file: 'fixture' };
      },
      getTicker: async (symbol) => ({
        ok: true,
        price: 100 + Number(String(symbol).match(/\d+/)?.[0] || 0),
        changePct: 0.1,
        quoteVolume: 50000000
      }),
      getBinanceSymbols: async () => Array.from({ length: 40 }, (_, index) => `R${index + 1}USDT`),
      getMt5Symbols: async () => ({ ok: true, symbols: ['EURUSD'] }),
      getMt5Ticker: async () => ({ ok: true, price: 1.16285, bid: 1.1628, ask: 1.1629, spread: 0.0001 }),
      readMemory: () => []
    }
  });
  const router = createApiRouter(context);

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/training/demo/tick',
    body: {
      nowMs: Date.parse('2026-05-10T12:20:00.000Z')
    }
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.closedPositions, 0);
  assert.equal(res.body.openedPositions, 0);
  assert.equal(res.body.safety.writesPerformed, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].activePairs.some((pair) => pair.venue === 'MT5' && pair.symbol === 'EURUSD'), true);
});

test('training demo context status endpoint reports market and signal sources without writes', async () => {
  const context = createBackendContext({
    env: {},
    botState: createDefaultBotState(),
    riskConfig: createDefaultRiskConfig(),
    deps: {
      readTrainingStateSnapshot: () => createTrainingStateSnapshot({
        ...sampleTrainingState,
        activePairs: [{
          symbol: 'BTCUSDT',
          venue: 'BINANCE',
          price: 104,
          updatedAt: '2026-05-10T11:59:30.000Z'
        }],
        positions: [{
          id: 'pos-context-1',
          signal_id: 'sig-context-1',
          symbol: 'BTCUSDT',
          venue: 'BINANCE',
          direction: 'LONG',
          horizon: 'intraday'
        }]
      }),
      getTicker: async () => ({ ok: false }),
      readMemory: () => [
        { kind: 'training_signal', payload: { signal_id: 'sig-context-1', bias: 'SHORT', confidence: 56, symbol: 'BTCUSDT', venue: 'BINANCE' } }
      ]
    }
  });
  const router = createApiRouter(context);

  const res = await router.dispatch({
    method: 'GET',
    pathname: '/api/training/demo/context/status'
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.positions.length, 1);
  assert.equal(res.body.positions[0].market.source, 'training_state_last_known');
  assert.equal(res.body.positions[0].signal.source, 'memory_signal_id');
  assert.equal(res.body.safety.readOnly, true);
});

test('training demo signal candidates endpoint reports read-only backend candidates', async () => {
  const context = createBackendContext({
    env: { TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED: 'true' },
    botState: createDefaultBotState(),
    riskConfig: createDefaultRiskConfig(),
    deps: {
      readTrainingStateSnapshot: () => createTrainingStateSnapshot({
        ...sampleTrainingState,
        activePairs: [{
          symbol: 'BTCUSDT',
          venue: 'BINANCE',
          score: 71,
          indicators: {
            bias: 'LONG',
            confidence: 80,
            horizon: 'intraday',
            htfAlignmentScore: 0.7,
            patternScore: 0.5,
            volumeRatio: 1.2,
            primaryStrategy: { id: 'trendMomentum', name: 'Trend Momentum', score: 82 }
          }
        }]
      }),
      getTicker: async () => ({ ok: true, price: 105 }),
      readMemory: () => []
    }
  });
  const router = createApiRouter(context);

  const res = await router.dispatch({
    method: 'GET',
    pathname: '/api/training/demo/signals/candidates'
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.candidates.length, 1);
  assert.equal(res.body.candidates[0].available, true);
  assert.equal(res.body.candidates[0].source, 'backend_signal_candidate');
  assert.equal(res.body.safety.readOnly, true);
});

test('training demo open positions endpoint returns current open demo positions read-only', async () => {
  const router = createRouterWithTrainingSnapshot(createTrainingStateSnapshot({
    ...sampleTrainingState,
    positions: [
      {
        id: 'pos-open-1',
        signal_id: 'sig-open-1',
        symbol: 'BTCUSDT',
        venue: 'BINANCE',
        direction: 'LONG',
        entry_price: 100,
        horizon: 'intraday'
      },
      {
        id: 'pos-closed-1',
        signal_id: 'sig-closed-1',
        symbol: 'ETHUSDT',
        venue: 'BINANCE',
        direction: 'SHORT',
        entry_price: 50,
        exit_price: 48,
        horizon: 'intraday'
      }
    ]
  }));

  const res = await router.dispatch({
    method: 'GET',
    pathname: '/api/training/demo/positions/open'
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.positions.length, 1);
  assert.equal(res.body.positions[0].id, 'pos-open-1');
  assert.equal(res.body.total, 1);
  assert.equal(res.body.safety.readOnly, true);
  assert.equal(res.body.safety.writesPerformed, false);
});

test('training demo recent trades endpoint returns latest closed trades first read-only', async () => {
  const router = createRouterWithTrainingSnapshot(createTrainingStateSnapshot({
    ...sampleTrainingState,
    closedTrades: [
      { id: 'trade-3', symbol: 'SOLUSDT', pnl_demo: 15, closed_timestamp: '2026-05-01T02:00:00.000Z' },
      { id: 'trade-2', symbol: 'ETHUSDT', pnl_demo: -5, closed_timestamp: '2026-05-01T01:00:00.000Z' },
      { id: 'trade-1', symbol: 'BTCUSDT', pnl_demo: 10, closed_timestamp: '2026-05-01T00:00:00.000Z' }
    ]
  }));

  const res = await router.dispatch({
    method: 'GET',
    pathname: '/api/training/demo/trades/recent'
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.trades.length, 3);
  assert.equal(res.body.trades[0].id, 'trade-3');
  assert.equal(res.body.total, 3);
  assert.equal(res.body.safety.readOnly, true);
});

test('training demo recent lessons endpoint returns latest lessons read-only', async () => {
  const router = createRouterWithTrainingSnapshot(createTrainingStateSnapshot({
    ...sampleTrainingState,
    lessons: [
      { id: 'lesson-3', symbol: 'SOLUSDT', recorded_at: '2026-05-01T02:00:00.000Z', outcome: 'win' },
      { id: 'lesson-2', symbol: 'ETHUSDT', recorded_at: '2026-05-01T01:00:00.000Z', outcome: 'loss' },
      { id: 'lesson-1', symbol: 'BTCUSDT', recorded_at: '2026-05-01T00:00:00.000Z', outcome: 'win' }
    ]
  }));

  const res = await router.dispatch({
    method: 'GET',
    pathname: '/api/training/demo/lessons/recent'
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.lessons.length, 3);
  assert.equal(res.body.lessons[0].id, 'lesson-3');
  assert.equal(res.body.total, 3);
  assert.equal(res.body.safety.readOnly, true);
});

test('training demo performance summary endpoint returns balance, metrics and scheduler status read-only', async () => {
  const schedulerState = {
    active: true,
    enabled: true,
    loopEnabled: true,
    intervalMs: 60000,
    ticksRun: 4,
    ticksSkipped: 1,
    realTradingTouched: false
  };
  const context = createBackendContext({
    env: {},
    botState: createDefaultBotState(),
    riskConfig: createDefaultRiskConfig(),
    deps: {
      readTrainingStateSnapshot: () => createTrainingStateSnapshot({
        ...sampleTrainingState,
        balanceStart: 100000,
        balance: 100010,
        positions: [
          { id: 'pos-summary-1', symbol: 'BTCUSDT', venue: 'BINANCE', direction: 'LONG', entry_price: 100, pnl_demo: 0 }
        ],
        closedTrades: [
          { id: 'trade-a', symbol: 'BTCUSDT', pnl_demo: 10, closed_timestamp: '2026-05-01T00:00:00.000Z' },
          { id: 'trade-b', symbol: 'ETHUSDT', pnl_demo: -5, closed_timestamp: '2026-05-01T01:00:00.000Z' },
          { id: 'trade-c', symbol: 'SOLUSDT', pnl_demo: 15, closed_timestamp: '2026-05-01T02:00:00.000Z' }
        ]
      }),
      trainingLoopScheduler: {
        startTrainingDemoLoopScheduler: () => ({ ok: true, alreadyRunning: false, status: schedulerState }),
        stopTrainingDemoLoopScheduler: () => ({ ok: true, status: { ...schedulerState, active: false } }),
        getTrainingDemoLoopSchedulerStatus: () => schedulerState
      }
    }
  });
  const router = createApiRouter(context);

  const res = await router.dispatch({
    method: 'GET',
    pathname: '/api/training/demo/performance/summary'
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.summary.balance, 100010);
  assert.equal(res.body.summary.equity, 100010);
  assert.equal(res.body.summary.openPositions, 1);
  assert.equal(res.body.summary.closedTrades, 3);
  assert.equal(res.body.summary.winRate, 0.6667);
  assert.equal(res.body.summary.expectancy, 6.6667);
  assert.equal(res.body.summary.profitFactor, 5);
  assert.equal(res.body.summary.maxDrawdown, 5);
  assert.equal(res.body.schedulerStatus.active, true);
  assert.equal(res.body.safety.readOnly, true);
  assert.equal(res.body.safety.realTradingTouched, false);
});

test('training demo loop start endpoint respects scheduler flag and returns 409 when disabled', async () => {
  const schedulerStub = {
    startTrainingDemoLoopScheduler: () => ({
      ok: false,
      reason: 'training_backend_loop_scheduler_disabled',
      status: { active: false, enabled: false, loopEnabled: true, ticksRun: 0, ticksSkipped: 0 }
    }),
    stopTrainingDemoLoopScheduler: () => ({ ok: true, status: { active: false } }),
    getTrainingDemoLoopSchedulerStatus: () => ({ active: false, enabled: false, loopEnabled: true, ticksRun: 0, ticksSkipped: 0 })
  };
  const context = createBackendContext({
    env: {},
    botState: createDefaultBotState(),
    riskConfig: createDefaultRiskConfig(),
    deps: {
      trainingLoopScheduler: schedulerStub
    }
  });
  const router = createApiRouter(context);

  const res = await router.dispatch({
    method: 'POST',
    pathname: '/api/training/demo/loop/start',
    body: {}
  });

  assert.equal(res.status, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.reason, 'training_backend_loop_scheduler_disabled');
  assert.equal(res.body.scheduler.active, false);
});

test('training demo loop status and stop endpoints expose scheduler state safely', async () => {
  const schedulerState = { active: true, enabled: true, loopEnabled: true, ticksRun: 3, ticksSkipped: 1 };
  const schedulerStub = {
    startTrainingDemoLoopScheduler: () => ({ ok: true, alreadyRunning: false, status: schedulerState }),
    stopTrainingDemoLoopScheduler: () => ({ ok: true, status: { ...schedulerState, active: false } }),
    getTrainingDemoLoopSchedulerStatus: () => schedulerState
  };
  const context = createBackendContext({
    env: {},
    botState: createDefaultBotState(),
    riskConfig: createDefaultRiskConfig(),
    deps: {
      trainingLoopScheduler: schedulerStub
    }
  });
  const router = createApiRouter(context);

  const status = await router.dispatch({
    method: 'GET',
    pathname: '/api/training/demo/loop/status'
  });
  const stop = await router.dispatch({
    method: 'POST',
    pathname: '/api/training/demo/loop/stop',
    body: {}
  });

  assert.equal(status.status, 200);
  assert.equal(status.body.ok, true);
  assert.equal(status.body.scheduler.active, true);
  assert.equal(status.body.safety.realTradingTouched, false);
  assert.equal(stop.status, 200);
  assert.equal(stop.body.ok, true);
  assert.equal(stop.body.scheduler.active, false);
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
