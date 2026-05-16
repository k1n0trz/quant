const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveTrainingAssetUniverse
} = require('../backend/training/training-asset-universe-service');
const {
  runTrainingDemoTick
} = require('../backend/training/training-loop-service');
const {
  createBootstrapTrainingState
} = require('../backend/training/training-bootstrap-service');

test('asset universe ranks live Binance candidates by liquidity, spread, and momentum', async () => {
  const tickerBySymbol = {
    BTCUSDT: { price: 100, bid: 99.99, ask: 100.01, quoteVolume: 1200000000, changePct: 2.4, volume: 100000 },
    ETHUSDT: { price: 50, bid: 49.95, ask: 50.05, quoteVolume: 500000000, changePct: -1.7, volume: 90000 },
    ILLQUSDT: { price: 10, bid: 9, ask: 11, quoteVolume: 10000, changePct: 0.2, volume: 100 },
    BADBTC: { price: 1, bid: 1, ask: 1, quoteVolume: 999999999, changePct: 8, volume: 1 }
  };

  const result = await resolveTrainingAssetUniverse({
    env: {
      TRAINING_TARGET_OPEN_POSITIONS: '2',
      TRAINING_MIN_OPEN_POSITIONS: '2',
      TRAINING_MAX_OPEN_POSITIONS: '4',
      TRAINING_ASSET_UNIVERSE_SCAN_LIMIT: '4'
    },
    deps: {
      getBinanceSymbols: async () => ['ILLQUSDT', 'ETHUSDT', 'BADBTC', 'BTCUSDT'],
      getTicker: async (symbol) => tickerBySymbol[symbol]
    },
    nowMs: Date.parse('2026-05-15T12:00:00.000Z')
  });

  assert.equal(result.ok, true);
  assert.equal(result.pairs.length, 2);
  assert.deepEqual(result.pairs.map((pair) => pair.symbol), ['BTCUSDT', 'ETHUSDT']);
  assert.equal(result.pairs[0].source, 'backend.training.asset_universe');
  assert.equal(result.pairs[0].indicators.bias, 'LONG');
  assert.equal(result.pairs[1].indicators.bias, 'SHORT');
  assert.equal(result.pairs.every((pair) => pair.indicators.confidence >= 74), true);
  assert.equal(result.skipped.some((row) => row.symbol === 'ILLQUSDT' && row.reason === 'spread_too_wide'), true);
  assert.equal(result.skipped.some((row) => row.symbol === 'BADBTC' && row.reason === 'unsupported_quote'), true);
});

test('training tick refreshes active pairs from backend universe before opening entries', async () => {
  const state = {
    ...createBootstrapTrainingState({ now: '2026-05-15T12:00:00.000Z' }),
    activePairs: [],
    positions: []
  };
  const tickerBySymbol = {
    BTCUSDT: { price: 100, bid: 99.99, ask: 100.01, quoteVolume: 900000000, changePct: 2.1, volume: 100000 },
    ETHUSDT: { price: 50, bid: 49.98, ask: 50.02, quoteVolume: 700000000, changePct: -1.5, volume: 90000 }
  };

  const result = await runTrainingDemoTick({
    state,
    positionContexts: [],
    nowMs: Date.parse('2026-05-15T12:01:00.000Z'),
    env: {
      TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true',
      TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED: 'true',
      TRAINING_TARGET_OPEN_POSITIONS: '2',
      TRAINING_MIN_OPEN_POSITIONS: '2',
      TRAINING_MAX_OPEN_POSITIONS: '4',
      TRAINING_TARGET_INTRADAY_POSITIONS: '1',
      TRAINING_TARGET_SWING_POSITIONS: '1'
    },
    deps: {
      getBinanceSymbols: async () => ['BTCUSDT', 'ETHUSDT'],
      getTicker: async (symbol) => tickerBySymbol[symbol],
      readMemory: () => []
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.openedPositions, 2);
  assert.deepEqual(result.nextState.activePairs.map((pair) => pair.symbol), ['BTCUSDT', 'ETHUSDT']);
  assert.equal(result.nextState.positions.length, 2);
  assert.equal(result.nextState.assetUniverse.source, 'backend.training.asset_universe');
});
