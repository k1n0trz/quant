const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveTrainingSignalContext
} = require('../backend/training/training-signal-context-service');

function createPosition(overrides = {}) {
  return {
    id: 'pos-signal-1',
    signal_id: 'sig-signal-1',
    symbol: 'BTCUSDT',
    venue: 'BINANCE',
    direction: 'LONG',
    horizon: 'intraday',
    ...overrides
  };
}

test('signal context resolves by signal_id from memory first', async () => {
  const result = await resolveTrainingSignalContext(createPosition(), {
    readMemory: () => [
      { kind: 'training_signal', payload: { signal_id: 'sig-signal-1', bias: 'SHORT', confidence: 54, symbol: 'BTCUSDT', venue: 'BINANCE' } }
    ]
  });

  assert.equal(result.bias, 'SHORT');
  assert.equal(result.confidence, 54);
  assert.equal(result.source, 'memory_signal_id');
  assert.equal(result.defensive, false);
});

test('signal context resolves by symbol venue horizon when signal_id is absent', async () => {
  const result = await resolveTrainingSignalContext(createPosition({ signal_id: null }), {
    readMemory: () => [
      { kind: 'signal', payload: { bias: 'SHORT', confidence: 58, symbol: 'BTCUSDT', venue: 'BINANCE', horizon: 'intraday' } }
    ]
  });

  assert.equal(result.bias, 'SHORT');
  assert.equal(result.source, 'memory_symbol_horizon');
  assert.equal(result.defensive, false);
});

test('signal context falls back to defensive signal as last resort', async () => {
  const result = await resolveTrainingSignalContext(createPosition({ direction: 'SHORT' }), {
    readMemory: () => []
  });

  assert.equal(result.bias, 'SHORT');
  assert.equal(result.confidence, 100);
  assert.equal(result.source, 'defensive_fallback');
  assert.equal(result.defensive, true);
  assert.equal(result.missing_signal, true);
});

test('signal context can use backend candidate when memory is missing and flag is enabled', async () => {
  const result = await resolveTrainingSignalContext(createPosition({ signal_id: null }), {
    state: {
      activePairs: [{
        symbol: 'BTCUSDT',
        venue: 'BINANCE',
        score: 70,
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
    },
    env: { TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED: 'true' },
    readMemory: () => [],
    getTicker: async () => ({ ok: true, price: 105 })
  });

  assert.equal(result.source, 'backend_signal_candidate');
  assert.equal(result.defensive, false);
  assert.equal(result.missing_signal, false);
  assert.equal(result.bias, 'LONG');
});
