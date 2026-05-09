const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isTrainingBackendSignalCandidatesEnabled,
  generateTrainingSignalCandidate,
  generateTrainingSignalCandidates
} = require('../backend/training/training-signal-candidate-engine');

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

test('signal candidate flag is explicit opt-in', () => {
  assert.equal(isTrainingBackendSignalCandidatesEnabled({}), false);
  assert.equal(isTrainingBackendSignalCandidatesEnabled({ TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED: 'true' }), true);
});

test('signal candidate returns unavailable when flag is disabled', async () => {
  const result = await generateTrainingSignalCandidate('BTCUSDT', {
    state: createState({
      activePairs: [{
        symbol: 'BTCUSDT',
        venue: 'BINANCE',
        score: 70,
        indicators: { bias: 'LONG', confidence: 80, horizon: 'intraday' }
      }]
    }),
    marketContext: { available: true, symbol: 'BTCUSDT', venue: 'BINANCE', price: 105, source: 'ticker', stale: false, ageMs: 0 },
    env: {}
  });

  assert.equal(result.available, false);
  assert.equal(result.reason, 'signal_candidates_disabled');
});

test('signal candidate returns unavailable for insufficient context', async () => {
  const result = await generateTrainingSignalCandidate('BTCUSDT', {
    state: createState(),
    marketContext: { available: true, symbol: 'BTCUSDT', venue: 'BINANCE', price: 105, source: 'ticker', stale: false, ageMs: 0 },
    env: { TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED: 'true' }
  });

  assert.equal(result.available, false);
  assert.equal(result.reason, 'insufficient_context');
});

test('signal candidate can be generated from active pair indicators and preserves current thresholds inputs', async () => {
  const result = await generateTrainingSignalCandidate('BTCUSDT', {
    state: createState({
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
      }],
      strategyStats: {
        trendMomentum: { id: 'trendMomentum', pnl: 12, wins: 3, closed: 4 }
      },
      lessons: [{ symbol: 'BTCUSDT', outcome: 'win' }]
    }),
    marketContext: { available: true, symbol: 'BTCUSDT', venue: 'BINANCE', price: 105, source: 'ticker', stale: false, ageMs: 0 },
    env: { TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED: 'true' },
    nowMs: Date.parse('2026-05-10T12:00:00.000Z')
  });

  assert.equal(result.available, true);
  assert.equal(result.symbol, 'BTCUSDT');
  assert.equal(result.bias, 'LONG');
  assert.equal(result.confidence, 80);
  assert.equal(result.horizon, 'intraday');
  assert.equal(result.strategy_id, 'trendMomentum');
  assert.equal(result.source, 'backend_signal_candidate');
  assert.equal(Array.isArray(result.reason_codes), true);
  assert.match(result.signal_id, /^sig_/);
});

test('signal candidate batch generation stays read-only and returns per-symbol results', async () => {
  const results = await generateTrainingSignalCandidates(['BTCUSDT', 'ETHUSDT'], {
    state: createState({
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
    env: { TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED: 'true' },
    deps: {
      getTicker: async (symbol) => (symbol === 'BTCUSDT' ? { ok: true, price: 105 } : { ok: false })
    }
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].available, true);
  assert.equal(results[1].available, false);
});
