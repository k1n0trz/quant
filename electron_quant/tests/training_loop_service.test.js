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

test('tick closes profit target even when open count is below the old target profile', async () => {
  const open = {
    id: 'pos-profit-target-low-count',
    signal_id: 'sig-profit-target-low-count',
    symbol: 'BTCUSDT',
    venue: 'BINANCE',
    direction: 'LONG',
    entry_price: 100,
    size_demo: 1,
    fees_simuladas: 0,
    spread_estimado: 0,
    slippage_estimado: 0,
    opened_tick: Date.parse('2026-05-10T08:00:00.000Z'),
    min_hold_ms: 30 * 60 * 1000,
    max_hold_ms: 12 * 60 * 60 * 1000,
    horizon: 'intraday'
  };

  const result = await runTrainingDemoTick({
    state: createState({ positions: [open], targetOpenPositions: 40 }),
    positionContexts: [{
      positionId: 'pos-profit-target-low-count',
      pair: { symbol: 'BTCUSDT', venue: 'BINANCE', price: 102 },
      signal: { bias: 'LONG', confidence: 72 }
    }],
    nowMs: Date.parse('2026-05-10T12:00:00.000Z')
  });

  assert.equal(result.ok, true);
  assert.equal(result.closedPositions, 1);
  assert.equal(result.nextState.positions.length, 0);
  assert.equal(result.nextState.closedTrades[0].signal_id, 'sig-profit-target-low-count');
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

test('tick closes MT5 demo bridge position before removing it from training state', async () => {
  const open = {
    id: 'pos-mt5-bridge-close',
    signal_id: 'sig-mt5-bridge-close',
    symbol: 'EURUSD',
    venue: 'MT5',
    direction: 'LONG',
    entry_price: 1.1,
    size_demo: 1000,
    fees_simuladas: 0,
    spread_estimado: 0,
    slippage_estimado: 0,
    opened_tick: Date.parse('2026-05-09T00:00:00.000Z'),
    min_hold_ms: 30 * 60 * 1000,
    max_hold_ms: 12 * 60 * 60 * 1000,
    horizon: 'intraday',
    mt5_demo_execution: {
      attempted: true,
      ok: true,
      ticket: 1811606880,
      volume: 0.01,
      demoOnly: true,
      realTradingTouched: false
    }
  };
  const closeCalls = [];

  const result = await runTrainingDemoTick({
    state: createState({
      balance: 100000,
      positions: [
        open,
        { id: 'pos-keep-a', symbol: 'BTCUSDT', venue: 'BINANCE', direction: 'LONG', entry_price: 10, size_demo: 1 },
        { id: 'pos-keep-b', symbol: 'ETHUSDT', venue: 'BINANCE', direction: 'LONG', entry_price: 10, size_demo: 1 }
      ],
      targetOpenPositions: 3
    }),
    positionContexts: [{
      signalId: 'sig-mt5-bridge-close',
      pair: { symbol: 'EURUSD', venue: 'MT5', price: 1.12 },
      signal: { bias: 'LONG', confidence: 70 }
    }],
    env: {
      TRAINING_MT5_DEMO_ORDER_SEND_ENABLED: 'true',
      TRAINING_MT5_DEMO_CLOSE_ENABLED: 'true'
    },
    deps: {
      closeMt5DemoPosition: async (payload) => {
        closeCalls.push(payload);
        return { ok: true, ticket: payload.ticket, retcode: 10009, deal: 998, bridge: true, demoOnly: true, realTradingTouched: false };
      }
    },
    nowMs: Date.parse('2026-05-10T12:00:00.000Z')
  });

  assert.equal(result.ok, true);
  assert.equal(closeCalls.length, 1);
  assert.deepEqual(closeCalls[0], {
    ticket: 1811606880,
    symbol: 'EURUSD',
    volume: 0.01,
    reason: 'training-demo-close',
    trainingPositionId: 'pos-mt5-bridge-close'
  });
  assert.equal(result.closedPositions, 1);
  assert.equal(result.nextState.closedTrades[0].mt5_demo_close.ok, true);
  assert.equal(result.nextState.closedTrades[0].mt5_demo_close.ticket, 1811606880);
  assert.equal(result.nextState.closedTrades[0].mt5_demo_close.realTradingTouched, false);
});

test('tick sends existing MT5 paper positions to demo bridge when order_send becomes enabled', async () => {
  const open = {
    id: 'pos-mt5-pending-demo-send',
    signal_id: 'sig-mt5-pending-demo-send',
    symbol: 'AUDCAD',
    venue: 'MT5',
    direction: 'SHORT',
    entry_price: 0.902,
    size_demo: 1000,
    opened_tick: Date.parse('2026-05-10T11:00:00.000Z'),
    min_hold_ms: 90 * 60 * 1000,
    max_hold_ms: 12 * 60 * 60 * 1000,
    horizon: 'intraday',
    mt5_demo_execution: {
      attempted: true,
      ok: false,
      reason: 'TRAINING_MT5_DEMO_ORDER_SEND_ENABLED=false',
      demoOnly: true,
      realTradingTouched: false
    }
  };
  const calls = [];

  const result = await runTrainingDemoTick({
    state: createState({ positions: [open], targetOpenPositions: 1 }),
    positionContexts: [{
      positionId: 'pos-mt5-pending-demo-send',
      pair: { symbol: 'AUDCAD', venue: 'MT5', price: 0.901 },
      signal: { bias: 'SHORT', confidence: 80 }
    }],
    env: {
      TRAINING_MT5_DEMO_ORDER_SEND_ENABLED: 'true',
      TRAINING_MT5_DEMO_LOT_SIZE: '0.01'
    },
    deps: {
      placeMt5DemoOrder: async (payload) => {
        calls.push(payload);
        return { ok: true, ticket: 991001, retcode: 10009, bridge: true, demoOnly: true, realTradingTouched: false };
      }
    },
    nowMs: Date.parse('2026-05-10T12:00:00.000Z')
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    symbol: 'AUDCAD',
    side: 'SELL',
    volume: 0.01,
    type: 'MARKET',
    entryPrice: 0.902,
    stopLoss: 0.904255,
    takeProfit: 0.89749,
    reason: 'training-demo-existing-position',
    trainingPositionId: 'pos-mt5-pending-demo-send'
  });
  assert.equal(result.mt5DemoOrdersSent, 1);
  assert.equal(result.nextState.positions[0].mt5_demo_execution.ok, true);
  assert.equal(result.nextState.positions[0].mt5_demo_execution.ticket, 991001);
  assert.equal(result.nextState.positions[0].mt5_demo_execution.realTradingTouched, false);
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

test('tick bootstraps a Binance universe when perpetual training starts empty', async () => {
  const state = createState({
    targets: { total: 2, intraday: 2, swing: 0 },
    targetIntradayPositions: 2,
    targetSwingPositions: 0,
    activePairs: [],
    positions: []
  });

  const result = await runTrainingDemoTick({
    state,
    positionContexts: [],
    nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
    deps: {
      getBinanceSymbols: async () => ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
      getTicker: async (symbol) => ({
        ok: true,
        symbol,
        price: symbol === 'BTCUSDT' ? 100000 : symbol === 'ETHUSDT' ? 4000 : 180,
        spread: 1,
        changePct: symbol === 'ETHUSDT' ? -1.7 : 2.3,
        quoteVolume: 90000000
      }),
      readMemory: () => []
    },
    env: {
      TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true',
      TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED: 'true'
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.entryEnabled, true);
  assert.equal(result.openedPositions, 0);
  assert.equal(result.nextState.activePairs.length >= 2, true);
  assert.equal(result.nextState.positions.length, 0);
  assert.equal(result.skippedEntries.length >= 2, true);
  assert.equal(result.skippedEntries.every((entry) => entry.reason === 'bootstrap_context_only'), true);
  assert.equal(state.activePairs.length, 0);
  assert.equal(state.positions.length, 0);
});

test('tick expands a stale small universe as context without filling a position quota', async () => {
  const symbols = Array.from({ length: 40 }, (_, index) => `Q${index + 1}USDT`);
  const state = createState({
    targets: { total: 40, intraday: 20, swing: 20 },
    activePairs: symbols.slice(0, 10).map((symbol) => ({
      symbol,
      venue: 'BINANCE',
      score: 72,
      price: 100,
      spreadPct: 0.001,
      indicators: {
        bias: 'LONG',
        confidence: 84,
        htfAlignmentScore: 0.75,
        patternScore: 0.55,
        volumeRatio: 1.4,
        horizon: 'intraday',
        primaryStrategy: { id: 'trendMomentum', name: 'Trend Momentum', score: 86 }
      }
    })),
    positions: []
  });

  const result = await runTrainingDemoTick({
    state,
    positionContexts: [],
    nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
    deps: {
      getBinanceSymbols: async () => symbols,
      getTicker: async (symbol) => ({
        ok: true,
        symbol,
        price: 100 + Number(symbol.match(/\d+/)?.[0] || 0),
        spread: 0.05,
        changePct: 1.8,
        quoteVolume: 120000000
      }),
      readMemory: () => []
    },
    env: {
      TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true',
      TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED: 'true'
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.nextState.activePairs.length >= 40, true);
  assert.equal(result.nextState.positions.length, 10);
  assert.equal(result.openedPositions, 10);
  assert.equal(result.nextState.positions.every((position) => symbols.slice(0, 10).includes(position.symbol)), true);
  assert.equal(result.skippedEntries.some((entry) => entry.reason === 'bootstrap_context_only'), true);
});
