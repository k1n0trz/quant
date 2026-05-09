const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTrainingPositionContexts
} = require('../backend/training/training-position-context-service');

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

test('builder creates backend contexts from open positions with ticker and memory signal', async () => {
  const state = createState({
    positions: [{
      id: 'pos-ctx-1',
      signal_id: 'sig-ctx-1',
      strategy_id: 'trendMomentum',
      symbol: 'BTCUSDT',
      venue: 'BINANCE',
      direction: 'LONG',
      horizon: 'intraday'
    }]
  });

  const result = await buildTrainingPositionContexts(state, {
    getTicker: async (symbol) => ({ ok: true, price: 105, symbol }),
    readMemory: () => [
      { kind: 'training_signal', payload: { signal_id: 'sig-ctx-1', bias: 'SHORT', confidence: 54, symbol: 'BTCUSDT', venue: 'BINANCE' } }
    ]
  });

  assert.equal(result.contexts.length, 1);
  assert.equal(result.contexts[0].positionId, 'pos-ctx-1');
  assert.equal(result.contexts[0].pair.price, 105);
  assert.equal(result.contexts[0].pair.source, 'ticker');
  assert.equal(result.contexts[0].signal.bias, 'SHORT');
  assert.equal(result.contexts[0].signal.source, 'memory_signal_id');
  assert.equal(result.skipped.length, 0);
});

test('builder marks position skipped when price is unavailable', async () => {
  const state = createState({
    positions: [{
      id: 'pos-no-price',
      symbol: 'ETHUSDT',
      venue: 'BINANCE',
      direction: 'LONG'
    }]
  });

  const result = await buildTrainingPositionContexts(state, {
    getTicker: async () => ({ ok: false })
  });

  assert.equal(result.contexts.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].reason, 'missing_price');
});

test('builder uses defensive signal when no reliable signal is available', async () => {
  const state = createState({
    positions: [{
      id: 'pos-defensive-signal',
      signal_id: 'sig-defensive-signal',
      symbol: 'BTCUSDT',
      venue: 'BINANCE',
      direction: 'LONG',
      horizon: 'intraday'
    }]
  });

  const result = await buildTrainingPositionContexts(state, {
    getTicker: async () => ({ ok: true, price: 101 })
  });

  assert.equal(result.contexts.length, 1);
  assert.equal(result.contexts[0].signal.bias, 'LONG');
  assert.equal(result.contexts[0].signal.confidence, 100);
  assert.equal(result.contexts[0].signal.source, 'defensive_fallback');
  assert.equal(result.contexts[0].signal.missing_signal, true);
});

test('builder can use training state last known price and symbol-horizon signal fallback', async () => {
  const state = createState({
    activePairs: [{
      symbol: 'SOLUSDT',
      venue: 'BINANCE',
      price: 151,
      updatedAt: '2026-05-10T12:00:00.000Z'
    }],
    positions: [{
      id: 'pos-state-price-1',
      symbol: 'SOLUSDT',
      venue: 'BINANCE',
      direction: 'LONG',
      horizon: 'intraday'
    }]
  });

  const result = await buildTrainingPositionContexts(state, {
    nowMs: Date.parse('2026-05-10T12:00:30.000Z'),
    getTicker: async () => ({ ok: false }),
    readMemory: () => [
      { kind: 'signal', payload: { symbol: 'SOLUSDT', venue: 'BINANCE', horizon: 'intraday', bias: 'SHORT', confidence: 57 } }
    ]
  });

  assert.equal(result.contexts.length, 1);
  assert.equal(result.contexts[0].pair.price, 151);
  assert.equal(result.contexts[0].pair.source, 'training_state_last_known');
  assert.equal(result.contexts[0].signal.source, 'memory_symbol_horizon');
});
