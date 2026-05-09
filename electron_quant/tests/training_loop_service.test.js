const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runTrainingDemoTick,
  isTrainingBackendLoopEnabled
} = require('../backend/training/training-loop-service');

function createState(overrides = {}) {
  return {
    version: 2,
    mode: 'training',
    simulated: true,
    blockRealExecution: true,
    balanceStart: 100000,
    balance: 100000,
    positions: [],
    closedTrades: [],
    lessons: [],
    strategyStats: {},
    pairCooldowns: {},
    xp: 0,
    targets: { total: 20, intraday: 10, swing: 10 },
    persistedAt: '2026-05-10T00:00:00.000Z',
    ...overrides
  };
}

test('backend training loop flag is explicit opt-in', () => {
  assert.equal(isTrainingBackendLoopEnabled({}), false);
  assert.equal(isTrainingBackendLoopEnabled({ TRAINING_BACKEND_LOOP_ENABLED: 'false' }), false);
  assert.equal(isTrainingBackendLoopEnabled({ TRAINING_BACKEND_LOOP_ENABLED: 'true' }), true);
});

test('tick with no positions does not break', async () => {
  const result = await runTrainingDemoTick({
    state: createState(),
    positionContexts: [],
    nowMs: Date.parse('2026-05-10T12:00:00.000Z')
  });

  assert.equal(result.ok, true);
  assert.equal(result.evaluatedPositions, 0);
  assert.equal(result.closedPositions, 0);
  assert.equal(result.skippedPositions.length, 0);
  assert.equal(result.balanceBefore, 100000);
  assert.equal(result.balanceAfter, 100000);
  assert.equal(result.lessonPendingCount, 0);
});

test('tick closes a closable position atomically', async () => {
  const open = {
    id: 'pos-close-1',
    signal_id: 'sig-close-1',
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
  };
  const state = createState({
    balance: 100000,
    positions: [
      open,
      { id: 'pos-other', symbol: 'ETHUSDT', venue: 'BINANCE', direction: 'LONG', entry_price: 10, size_demo: 1 },
      { id: 'pos-other-2', symbol: 'SOLUSDT', venue: 'BINANCE', direction: 'LONG', entry_price: 20, size_demo: 1 }
    ],
    targetOpenPositions: 3
  });

  const result = await runTrainingDemoTick({
    state,
    positionContexts: [{
      positionId: 'pos-close-1',
      pair: { symbol: 'BTCUSDT', venue: 'BINANCE', price: 105 },
      signal: { bias: 'LONG', confidence: 70 }
    }],
    nowMs: Date.parse('2026-05-10T12:00:00.000Z')
  });

  assert.equal(result.ok, true);
  assert.equal(result.evaluatedPositions, 1);
  assert.equal(result.closedPositions, 1);
  assert.equal(result.balanceBefore, 100000);
  assert.equal(result.balanceAfter, 100008.25);
  assert.equal(result.nextState.positions.length, 2);
  assert.equal(result.nextState.closedTrades[0].signal_id, 'sig-close-1');
  assert.equal(result.lessonPendingCount, 1);
  assert.equal(state.positions.length, 3);
  assert.equal(result.openedPositions, 0);
});

test('tick leaves non-closable position open', async () => {
  const open = {
    id: 'pos-hold-1',
    signal_id: 'sig-hold-1',
    symbol: 'BTCUSDT',
    venue: 'BINANCE',
    direction: 'LONG',
    entry_price: 100,
    size_demo: 1,
    opened_tick: Date.parse('2026-05-10T11:55:00.000Z'),
    min_hold_ms: 90 * 60 * 1000,
    max_hold_ms: 12 * 60 * 60 * 1000,
    horizon: 'intraday'
  };
  const state = createState({ positions: [open] });

  const result = await runTrainingDemoTick({
    state,
    positionContexts: [{
      positionId: 'pos-hold-1',
      pair: { symbol: 'BTCUSDT', venue: 'BINANCE', price: 100.3 },
      signal: { bias: 'LONG', confidence: 77 }
    }],
    nowMs: Date.parse('2026-05-10T12:00:00.000Z')
  });

  assert.equal(result.ok, true);
  assert.equal(result.closedPositions, 0);
  assert.equal(result.balanceAfter, 100000);
  assert.equal(result.nextState.positions.length, 1);
});

test('tick updates balance once for one closure', async () => {
  const open = {
    id: 'pos-balance-1',
    signal_id: 'sig-balance-1',
    symbol: 'XAUUSD',
    venue: 'MT5',
    direction: 'SHORT',
    entry_price: 100,
    size_demo: 2,
    fees_simuladas: 1,
    spread_estimado: 0.5,
    slippage_estimado: 0.25,
    opened_tick: Date.parse('2026-05-09T00:00:00.000Z'),
    min_hold_ms: 30 * 60 * 1000,
    max_hold_ms: 12 * 60 * 60 * 1000,
    horizon: 'intraday'
  };

  const result = await runTrainingDemoTick({
    state: createState({ balance: 5000, positions: [open] }),
    positionContexts: [{
      signalId: 'sig-balance-1',
      pair: { symbol: 'XAUUSD', venue: 'MT5', price: 105 },
      signal: { bias: 'SHORT', confidence: 61 }
    }],
    nowMs: Date.parse('2026-05-10T12:00:00.000Z')
  });

  assert.equal(result.closedPositions, 1);
  assert.equal(result.balanceAfter, 4988.25);
});

test('tick does not mutate input state', async () => {
  const open = {
    id: 'pos-immutable-loop',
    signal_id: 'sig-immutable-loop',
    symbol: 'BTCUSDT',
    venue: 'BINANCE',
    direction: 'LONG',
    entry_price: 100,
    size_demo: 1,
    opened_tick: Date.parse('2026-05-09T00:00:00.000Z'),
    min_hold_ms: 30 * 60 * 1000,
    max_hold_ms: 12 * 60 * 60 * 1000,
    horizon: 'intraday'
  };
  const state = createState({ positions: [open] });
  const before = JSON.stringify(state);

  const result = await runTrainingDemoTick({
    state,
    positionContexts: [{
      positionId: 'pos-immutable-loop',
      pair: { symbol: 'BTCUSDT', venue: 'BINANCE', price: 105 },
      signal: { bias: 'LONG', confidence: 70 }
    }],
    nowMs: Date.parse('2026-05-10T12:00:00.000Z')
  });

  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(state), before);
});

test('tick does not open new positions', async () => {
  const state = createState({ positions: [] });

  const result = await runTrainingDemoTick({
    state,
    positionContexts: [{
      positionId: 'non-existent',
      pair: { symbol: 'BTCUSDT', venue: 'BINANCE', price: 105 },
      signal: { bias: 'LONG', confidence: 70 }
    }],
    nowMs: Date.parse('2026-05-10T12:00:00.000Z')
  });

  assert.equal(result.ok, true);
  assert.equal(result.nextState.positions.length, 0);
  assert.equal(result.closedPositions, 0);
});

test('tick reports entry disabled by default and does not open demo entries', async () => {
  const state = createState({
    targets: { total: 1, intraday: 1, swing: 0 },
    targetIntradayPositions: 1,
    targetSwingPositions: 0,
    activePairs: [{
      symbol: 'BTCUSDT',
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
    positions: []
  });

  const result = await runTrainingDemoTick({
    state,
    positionContexts: [],
    nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
    deps: {
      getTicker: async () => ({ ok: true, price: 105 }),
      readMemory: () => [
        { kind: 'training_signal', payload: { signal_id: 'sig-entry-disabled', symbol: 'BTCUSDT', venue: 'BINANCE', bias: 'LONG', confidence: 80, htfAlignmentScore: 0.7, patternScore: 0.5, volumeRatio: 1.2, strategy_id: 'trendMomentum', strategy_name: 'Trend Momentum' } }
      ]
    },
    env: {}
  });

  assert.equal(result.entryEnabled, false);
  assert.equal(result.openedPositions, 0);
  assert.equal(result.nextState.positions.length, 0);
});

test('tick can open a valid backend demo position when entry flag is enabled', async () => {
  const state = createState({
    targets: { total: 1, intraday: 1, swing: 0 },
    targetIntradayPositions: 1,
    targetSwingPositions: 0,
    activePairs: [{
      symbol: 'BTCUSDT',
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
    positions: []
  });

  const result = await runTrainingDemoTick({
    state,
    positionContexts: [],
    nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
    deps: {
      getTicker: async () => ({ ok: true, price: 105 }),
      readMemory: () => [
        { kind: 'training_signal', payload: { signal_id: 'sig-entry-open', symbol: 'BTCUSDT', venue: 'BINANCE', bias: 'LONG', confidence: 80, htfAlignmentScore: 0.7, patternScore: 0.5, volumeRatio: 1.2, strategy_id: 'trendMomentum', strategy_name: 'Trend Momentum' } }
      ]
    },
    env: { TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true' }
  });

  assert.equal(result.entryEnabled, true);
  assert.equal(result.openedPositions, 1);
  assert.equal(result.closedPositions, 0);
  assert.equal(result.nextState.positions.length, 1);
  assert.equal(result.nextState.positions[0].signal_id, 'sig-entry-open');
  assert.equal(result.nextState.positions[0].strategy_id, 'trendMomentum');
});
