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

test('signal candidate degrades gracefully from persisted activePair projection', async () => {
  const result = await generateTrainingSignalCandidate('XAUUSD', {
    state: createState({
      activePairs: [{
        symbol: 'XAUUSD',
        venue: 'MT5',
        score: 74,
        signalQuality: 0.78,
        indicators: {
          bias: 'SHORT',
          confidence: 77,
          horizon: 'swing',
          signalQuality: 0.78,
          primaryStrategy: { id: 'trendMomentum', name: 'Trend Momentum', score: 83 }
        }
      }]
    }),
    marketContext: { available: true, symbol: 'XAUUSD', venue: 'MT5', price: 2430, source: 'mt5_bridge_rates', stale: false, ageMs: 0 },
    env: { TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED: 'true' },
    nowMs: Date.parse('2026-05-10T12:00:00.000Z')
  });

  assert.equal(result.available, true);
  assert.equal(result.symbol, 'XAUUSD');
  assert.equal(result.venue, 'MT5');
  assert.equal(result.bias, 'SHORT');
  assert.equal(result.confidence, 77);
  assert.equal(result.horizon, 'swing');
  assert.equal(result.htfAlignmentScore > 0, true);
  assert.equal(result.patternScore > 0, true);
  assert.equal(result.volumeRatio >= 1, true);
});

test('signal candidate accepts flat persisted activePair fields without indicators object', async () => {
  const result = await generateTrainingSignalCandidate('ETHUSDT', {
    state: createState({
      activePairs: [{
        symbol: 'ETHUSDT',
        venue: 'BINANCE',
        score: 76,
        price: 1900,
        bias: 'LONG',
        confidence: 81,
        horizon: 'intraday',
        signalQuality: 0.82,
        primaryStrategy: { id: 'breakoutRetest', name: 'Breakout Retest', score: 86 }
      }]
    }),
    marketContext: { available: true, symbol: 'ETHUSDT', venue: 'BINANCE', price: 1900, source: 'ticker', stale: false, ageMs: 0 },
    env: { TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED: 'true' },
    nowMs: Date.parse('2026-05-10T12:00:00.000Z')
  });

  assert.equal(result.available, true);
  assert.equal(result.symbol, 'ETHUSDT');
  assert.equal(result.bias, 'LONG');
  assert.equal(result.strategy_id, 'breakoutRetest');
});

test('signal candidate falls back to persisted active pair price when live context is stale', async () => {
  const result = await generateTrainingSignalCandidate('AUDCAD', {
    state: createState({
      activePairs: [{
        symbol: 'AUDCAD',
        venue: 'MT5',
        score: 79,
        price: 0.9012,
        bias: 'SHORT',
        confidence: 84,
        horizon: 'intraday',
        signalQuality: 0.81,
        primaryStrategy: { id: 'trendMomentum', name: 'Trend Momentum', score: 88 }
      }]
    }),
    marketContext: { available: false, symbol: 'AUDCAD', venue: 'MT5', reason: 'mt5_rates_timeout' },
    env: { TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED: 'true' },
    nowMs: Date.parse('2026-05-10T12:00:00.000Z')
  });

  assert.equal(result.available, true);
  assert.equal(result.symbol, 'AUDCAD');
  assert.equal(result.venue, 'MT5');
  assert.equal(result.reason_codes.includes('market_source:active_pair_projection'), true);
});

test('signal candidate can use open MT5 position metadata when active pair has no indicators', async () => {
  const result = await generateTrainingSignalCandidate('EURUSD', {
    state: createState({
      activePairs: [{
        symbol: 'EURUSD',
        venue: 'MT5',
        price: 1.16073
      }],
      positions: [{
        id: 'pos-eurusd-mt5',
        symbol: 'EURUSD',
        venue: 'MT5',
        direction: 'SHORT',
        horizon: 'intraday',
        confidence: 76,
        strategy_id: 'trendMomentum',
        strategy_name: 'Trend Momentum / MT5',
        strategy_score: 84
      }]
    }),
    marketContext: { available: false, symbol: 'EURUSD', venue: 'MT5', reason: 'mt5_rates_timeout' },
    env: { TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED: 'true' },
    nowMs: Date.parse('2026-05-10T12:00:00.000Z')
  });

  assert.equal(result.available, true);
  assert.equal(result.symbol, 'EURUSD');
  assert.equal(result.venue, 'MT5');
  assert.equal(result.bias, 'SHORT');
  assert.equal(result.confidence, 76);
  assert.equal(result.strategy_id, 'trendMomentum');
  assert.equal(result.reason_codes.includes('open_position_context'), true);
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
