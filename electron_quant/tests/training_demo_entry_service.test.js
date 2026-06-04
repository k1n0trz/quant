const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isTrainingBackendDemoEntryEnabled,
  buildBackendBootstrapPairs,
  evaluateTrainingDemoEntry,
  openTrainingDemoPosition,
  evaluateTrainingDemoEntries
} = require('../backend/training/training-demo-entry-service');

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
    targets: { total: 20, intraday: 1, swing: 0 },
    targetIntradayPositions: 1,
    targetSwingPositions: 0,
    minMt5OpenPositions: 0,
    persistedAt: '2026-05-10T00:00:00.000Z',
    ...overrides
  };
}

function createPair(overrides = {}) {
  return {
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
      horizon: 'intraday',
      signal_id: 'sig-live-1'
    },
    ...overrides
  };
}

function createSignalContext(overrides = {}) {
  return {
    signal_id: 'sig-live-1',
    bias: 'LONG',
    confidence: 80,
    htfAlignmentScore: 0.7,
    patternScore: 0.5,
    volumeRatio: 1.2,
    symbol: 'BTCUSDT',
    venue: 'BINANCE',
    source: 'memory_signal_id',
    defensive: false,
    missing_signal: false,
    strategy_id: 'trendMomentum',
    strategy_name: 'Trend Momentum',
    primaryStrategy: { id: 'trendMomentum', name: 'Trend Momentum', score: 82, reason: 'Aligned trend' },
    strategyScores: [{ id: 'trendMomentum', score: 82 }],
    setup: 'Trend Momentum: breakout',
    horizon: 'intraday',
    ...overrides
  };
}

function createMarketContext(overrides = {}) {
  return {
    symbol: 'BTCUSDT',
    venue: 'BINANCE',
    price: 105,
    source: 'ticker',
    stale: false,
    ageMs: 0,
    available: true,
    reason: null,
    ...overrides
  };
}

test('demo entry flag is explicit and independent from real trading state', () => {
  assert.equal(isTrainingBackendDemoEntryEnabled({}), false);
  assert.equal(isTrainingBackendDemoEntryEnabled({ TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true' }), true);
  assert.equal(isTrainingBackendDemoEntryEnabled({ TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true', REAL_TRADING: 'true' }), true);
});

test('missing price does not open demo position', () => {
  const result = evaluateTrainingDemoEntry({
    state: createState(),
    pair: createPair(),
    marketContext: createMarketContext({ available: false, price: null, reason: 'missing_price' }),
    signalContext: createSignalContext(),
    env: { TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true' }
  });

  assert.equal(result.shouldOpen, false);
  assert.equal(result.reason, 'missing_price');
});

test('defensive fallback opens only inside guarded paper training', () => {
  const result = evaluateTrainingDemoEntry({
    state: createState(),
    pair: createPair(),
    marketContext: createMarketContext(),
    signalContext: createSignalContext({ defensive: true, missing_signal: true, source: 'defensive_fallback' }),
    env: { TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true' }
  });

  assert.equal(result.shouldOpen, true);
  assert.equal(result.reason, null);
  assert.equal(result.signal.learning_mode, 'exploration_paper');

  const unguarded = evaluateTrainingDemoEntry({
    state: createState({ blockRealExecution: false }),
    pair: createPair(),
    marketContext: createMarketContext(),
    signalContext: createSignalContext({ defensive: true, missing_signal: true, source: 'defensive_fallback' }),
    env: { TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true' }
  });

  assert.equal(unguarded.shouldOpen, false);
  assert.equal(unguarded.reason, 'defensive_signal_not_allowed');
});

test('defensive fallback does not require professional scoring inside guarded paper training', () => {
  const result = evaluateTrainingDemoEntry({
    state: createState(),
    pair: createPair({
      score: 20,
      indicators: {
        bias: 'LONG',
        confidence: 55,
        primaryStrategy: { id: 'exploration', name: 'Exploration', score: 55 }
      }
    }),
    marketContext: createMarketContext(),
    signalContext: createSignalContext({
      defensive: true,
      missing_signal: true,
      source: 'defensive_fallback',
      htfAlignmentScore: null,
      patternScore: null,
      volumeRatio: null
    }),
    env: { TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true' }
  });

  assert.equal(result.shouldOpen, true);
  assert.equal(result.reason, null);
  assert.equal(result.signal.learning_mode, 'exploration_paper');
});

test('low confidence does not open', () => {
  const result = evaluateTrainingDemoEntry({
    state: createState(),
    pair: createPair(),
    marketContext: createMarketContext(),
    signalContext: createSignalContext({ confidence: 60 }),
    env: { TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true' }
  });

  assert.equal(result.shouldOpen, false);
  assert.equal(result.reason, 'confidence_below_threshold');
});

test('duplicate position does not open', () => {
  const state = createState({
    positions: [{
      symbol: 'BTCUSDT',
      venue: 'BINANCE',
      horizon: 'intraday',
      strategy_id: 'trendMomentum'
    }]
  });
  const result = evaluateTrainingDemoEntry({
    state,
    pair: createPair(),
    marketContext: createMarketContext(),
    signalContext: createSignalContext(),
    env: { TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true' }
  });

  assert.equal(result.shouldOpen, false);
  assert.equal(result.reason, 'duplicate_open_position');
});

test('valid demo entry opens traceable simulated position', () => {
  const evaluation = evaluateTrainingDemoEntry({
    state: createState(),
    pair: createPair(),
    marketContext: createMarketContext(),
    signalContext: createSignalContext(),
    env: { TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true' },
    nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
    horizon: 'intraday'
  });

  assert.equal(evaluation.shouldOpen, true);
  const position = openTrainingDemoPosition({
    pair: createPair(),
    signal: evaluation.signal,
    marketContext: createMarketContext(),
    openedAt: '2026-05-10T12:00:00.000Z'
  });

  assert.equal(position.simulated, true);
  assert.equal(position.symbol, 'BTCUSDT');
  assert.equal(position.signal_id, 'sig-live-1');
  assert.equal(position.strategy_id, 'trendMomentum');
  assert.equal(position.strategy_name, 'Trend Momentum');
  assert.equal(position.traceability_version, 1);
  assert.equal(position.confidence_at_entry, 80);
  assert.equal(position.entry_price, 105);
  assert.equal(position.opened_at, '2026-05-10T12:00:00.000Z');
});

test('entry evaluator opens valid position without touching real trading and preserves metadata', async () => {
  const state = createState({
    activePairs: [createPair()],
    targets: { total: 1, intraday: 1, swing: 0 },
    targetOpenPositions: 1
  });

  const result = await evaluateTrainingDemoEntries({
    state,
    env: { TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true' },
    nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
    deps: {
      getTicker: async () => ({ ok: true, price: 105 }),
      readMemory: () => [
        { kind: 'training_signal', payload: createSignalContext({ signal_id: 'sig-live-1' }) }
      ]
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.openedEntries.length, 1);
  assert.equal(result.nextState.positions.length, 1);
  assert.equal(result.nextState.positions[0].signal_id, 'sig-live-1');
  assert.equal(result.nextState.positions[0].simulated, true);
  assert.equal(result.nextState.positions[0].blockRealExecution, undefined);
});

test('entry evaluator can send MT5 demo order only when demo flags are armed', async () => {
  let calls = 0;
  const state = createState({
    activePairs: [createPair({ symbol: 'XAUUSD', venue: 'MT5' })],
    targets: { total: 1, intraday: 1, swing: 0 },
    targetOpenPositions: 1
  });

  const result = await evaluateTrainingDemoEntries({
    state,
    env: {
      TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true',
      TRAINING_MT5_DEMO_ORDER_SEND_ENABLED: 'true',
      TRAINING_MT5_DEMO_LOT_SIZE: '0.02'
    },
    nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
    deps: {
      getTicker: async () => ({ ok: true, price: 2300 }),
      placeMt5DemoOrder: async (payload) => {
        calls += 1;
        assert.equal(payload.symbol, 'XAUUSD');
        assert.equal(payload.side, 'BUY');
        assert.equal(payload.volume, 0.02);
        return { ok: true, ticket: 777, retcode: 10009, demoOnly: true };
      },
      readMemory: () => [
        { kind: 'training_signal', payload: createSignalContext({ signal_id: 'sig-live-1', symbol: 'XAUUSD', venue: 'MT5' }) }
      ]
    }
  });

  assert.equal(result.ok, true);
  assert.equal(calls, 1);
  assert.equal(result.nextState.positions[0].mt5_demo_execution.ok, true);
  assert.equal(result.nextState.positions[0].mt5_demo_execution.ticket, 777);
  assert.equal(result.nextState.positions[0].mt5_demo_execution.realTradingTouched, false);
});

test('backend bootstrap includes MT5 candidates when MT5 symbols and ticks are available', async () => {
  const pairs = await buildBackendBootstrapPairs({
    nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
    deps: {
      getBinanceSymbols: async () => ['BTCUSDT', 'ETHUSDT'],
      getTicker: async (symbol) => ({ price: symbol === 'BTCUSDT' ? 100000 : 3000, changePct: 1.2, quoteVolume: 80000000 }),
      getMt5Symbols: async () => ({ ok: true, symbols: ['XAUUSD', 'EURUSD'] }),
      getMt5Ticker: async (symbol) => ({ price: symbol === 'XAUUSD' ? 2300 : 1.1, bid: 1, ask: 1.01, spread: 0.01 })
    }
  });

  assert.equal(pairs.some((pair) => pair.venue === 'MT5' && pair.symbol === 'XAUUSD'), true);
  assert.equal(pairs.some((pair) => pair.venue === 'BINANCE' && pair.symbol === 'BTCUSDT'), true);
});

test('backend bootstrap caps to 40 and balances Binance with MT5 when both venues are available', async () => {
  const binanceSymbols = Array.from({ length: 45 }, (_, index) => `B${index + 1}USDT`);
  const mt5Symbols = Array.from({ length: 30 }, (_, index) => `MT5${index + 1}`);

  const pairs = await buildBackendBootstrapPairs({
    nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
    deps: {
      getBinanceSymbols: async () => binanceSymbols,
      getTicker: async (symbol) => ({
        price: 100 + Number(symbol.match(/\d+/)?.[0] || 0),
        changePct: 1.4,
        quoteVolume: 90000000
      }),
      getMt5Symbols: async () => ({ ok: true, symbols: mt5Symbols }),
      getMt5Ticker: async (symbol) => ({
        price: 1.1 + Number(symbol.match(/\d+/)?.[0] || 0) / 100,
        bid: 1.1,
        ask: 1.1002,
        spread: 0.0002,
        changePct: -0.8
      })
    }
  });

  assert.equal(pairs.length, 40);
  assert.equal(pairs.filter((pair) => pair.venue === 'BINANCE').length, 20);
  assert.equal(pairs.filter((pair) => pair.venue === 'MT5').length, 20);
});

test('entry evaluator refreshes stale active pairs that no longer carry actionable indicators', async () => {
  const state = createState({
    activePairs: [
      { venue: 'BINANCE', symbol: 'BTCUSDT', price: 100 },
      { venue: 'BINANCE', symbol: 'ETHUSDT', price: 10 }
    ],
    positions: [
      { id: 'pos-i', venue: 'BINANCE', symbol: 'BTCUSDT', horizon: 'intraday', direction: 'LONG', entry_price: 100 },
      { id: 'pos-s', venue: 'BINANCE', symbol: 'ETHUSDT', horizon: 'swing', direction: 'LONG', entry_price: 10 }
    ],
    targets: { total: 2, intraday: 1, swing: 1 },
    targetOpenPositions: 2,
    targetIntradayPositions: 1,
    targetSwingPositions: 1
  });

  const result = await evaluateTrainingDemoEntries({
    state,
    env: { TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true' },
    nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
    deps: {
      getBinanceSymbols: async () => ['BTCUSDT', 'ETHUSDT'],
      getTicker: async (symbol) => ({ price: symbol === 'BTCUSDT' ? 100 : 10, changePct: symbol === 'BTCUSDT' ? 1.5 : -1.2, quoteVolume: 80000000 })
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.openedEntries.length, 0);
  assert.equal(result.nextState.activePairs.length, 2);
  assert.equal(result.nextState.activePairs[0].symbol, 'BTCUSDT');
  assert.equal(result.nextState.activePairs[0].score > 0, true);
  assert.equal(result.nextState.activePairs[0].indicators.bias, 'LONG');
  assert.equal(Number.isFinite(result.nextState.activePairs[0].indicators.confidence), true);
  assert.equal(Number.isFinite(result.nextState.activePairs[0].indicators.htfAlignmentScore), true);
  assert.equal(Number.isFinite(result.nextState.activePairs[0].indicators.patternScore), true);
  assert.equal(Number.isFinite(result.nextState.activePairs[0].indicators.volumeRatio), true);
});

test('entry evaluator rebalances a full Binance-only universe when MT5 source is available', async () => {
  const binanceSymbols = Array.from({ length: 40 }, (_, index) => `B${index + 1}USDT`);
  const mt5Symbols = Array.from({ length: 25 }, (_, index) => `FX${index + 1}`);
  const activePairs = binanceSymbols.map((symbol) => createPair({ symbol, venue: 'BINANCE' }));
  const positions = binanceSymbols.map((symbol, index) => ({
    id: `pos-${symbol}`,
    venue: 'BINANCE',
    symbol,
    horizon: index < 20 ? 'intraday' : 'swing',
    direction: 'LONG',
    entry_price: 100
  }));
  const state = createState({
    activePairs,
    positions,
    targets: { total: 40, intraday: 20, swing: 20 },
    targetOpenPositions: 40,
    targetIntradayPositions: 20,
    targetSwingPositions: 20
  });

  const result = await evaluateTrainingDemoEntries({
    state,
    env: { TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true' },
    nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
    deps: {
      getBinanceSymbols: async () => binanceSymbols,
      getTicker: async () => ({ price: 100, changePct: 1.2, quoteVolume: 80000000 }),
      getMt5Symbols: async () => ({ ok: true, symbols: mt5Symbols }),
      getMt5Ticker: async (symbol) => ({
        price: 1.1 + Number(symbol.match(/\d+/)?.[0] || 0) / 100,
        bid: 1.1,
        ask: 1.1002,
        spread: 0.0002,
        changePct: -0.7
      })
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.openedEntries.length, 0);
  assert.equal(result.nextState.activePairs.length, 40);
  assert.equal(result.nextState.activePairs.filter((pair) => pair.venue === 'MT5').length, 20);
  assert.equal(result.nextState.activePairs.filter((pair) => pair.venue === 'BINANCE').length, 20);
});

test('entry evaluator keeps open MT5 positions visible in active pairs even when bootstrap has no MT5 tickers', async () => {
  const binanceSymbols = Array.from({ length: 40 }, (_, index) => `B${index + 1}USDT`);
  const activePairs = binanceSymbols.map((symbol) => createPair({ symbol, venue: 'BINANCE' }));
  const positions = [
    ...binanceSymbols.slice(0, 38).map((symbol, index) => ({
      id: `pos-${symbol}`,
      venue: 'BINANCE',
      symbol,
      horizon: index < 19 ? 'intraday' : 'swing',
      direction: 'LONG',
      entry_price: 100
    })),
    { id: 'pos-eurusd', venue: 'MT5', symbol: 'EURUSD', horizon: 'intraday', direction: 'LONG', entry_price: 1.16 },
    { id: 'pos-xauusd', venue: 'MT5', symbol: 'XAUUSD', horizon: 'swing', direction: 'SHORT', entry_price: 4430 }
  ];

  const result = await evaluateTrainingDemoEntries({
    state: createState({
      activePairs,
      positions,
      targets: { total: 40, intraday: 20, swing: 20 },
      targetOpenPositions: 40,
      targetIntradayPositions: 20,
      targetSwingPositions: 20
    }),
    env: { TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true' },
    nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
    deps: {
      getBinanceSymbols: async () => binanceSymbols,
      getTicker: async () => ({ price: 100, changePct: 1.2, quoteVolume: 80000000 }),
      getMt5Symbols: async () => ({ ok: true, symbols: ['EURUSD', 'XAUUSD'] }),
      getMt5Ticker: async () => null
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.openedEntries.length, 0);
  assert.equal(result.nextState.activePairs.length, 40);
  assert.equal(result.nextState.activePairs.some((pair) => pair.venue === 'MT5' && pair.symbol === 'EURUSD'), true);
  assert.equal(result.nextState.activePairs.some((pair) => pair.venue === 'MT5' && pair.symbol === 'XAUUSD'), true);
});

test('entry evaluator expands MT5 active universe when current MT5 coverage is below minimum', async () => {
  const binanceSymbols = Array.from({ length: 40 }, (_, index) => `B${index + 1}USDT`);
  const mt5Symbols = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDCAD', 'USDCAD', 'BTCUSD', 'ETHUSD'];
  const activePairs = [
    createPair({ symbol: 'EURUSD', venue: 'MT5' }),
    createPair({ symbol: 'XAUUSD', venue: 'MT5' }),
    ...binanceSymbols.slice(0, 38).map((symbol) => createPair({ symbol, venue: 'BINANCE' }))
  ];
  const positions = activePairs.map((pair, index) => ({
    id: `pos-${pair.venue}-${pair.symbol}`,
    venue: pair.venue,
    symbol: pair.symbol,
    horizon: index < 20 ? 'intraday' : 'swing',
    direction: index % 2 ? 'SHORT' : 'LONG',
    entry_price: pair.venue === 'MT5' ? 1.1 : 100
  }));

  const result = await evaluateTrainingDemoEntries({
    state: createState({
      activePairs,
      positions,
      targets: { total: 40, intraday: 20, swing: 20 },
      targetOpenPositions: 40,
      targetIntradayPositions: 20,
      targetSwingPositions: 20,
      minMt5OpenPositions: 6
    }),
    env: { TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true' },
    nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
    deps: {
      getBinanceSymbols: async () => binanceSymbols,
      getTicker: async () => ({ price: 100, changePct: 1.2, quoteVolume: 80000000 }),
      getMt5Symbols: async () => ({ ok: true, symbols: mt5Symbols }),
      getMt5Ticker: async (symbol) => ({
        price: symbol === 'XAUUSD' ? 2430 : 1.1,
        bid: symbol === 'XAUUSD' ? 2429.9 : 1.0999,
        ask: symbol === 'XAUUSD' ? 2430.1 : 1.1001,
        spread: symbol === 'XAUUSD' ? 0.2 : 0.0002,
        changePct: symbol === 'GBPUSD' ? 1.4 : -0.7
      })
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.openedEntries.length, 0);
  assert.equal(result.nextState.activePairs.length, 40);
  assert.equal(result.nextState.activePairs.filter((pair) => pair.venue === 'MT5').length >= 6, true);
  assert.equal(result.nextState.activePairs.some((pair) => pair.venue === 'MT5' && pair.symbol === 'GBPUSD'), true);
});
