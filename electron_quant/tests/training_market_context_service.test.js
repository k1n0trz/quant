const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveTrainingMarketContext
} = require('../backend/training/training-market-context-service');

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
    persistedAt: '2026-05-10T12:00:00.000Z',
    ...overrides
  };
}

test('market context resolves price from ticker first', async () => {
  const result = await resolveTrainingMarketContext('BTCUSDT', {
    venue: 'BINANCE',
    nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
    deps: {
      getTicker: async () => ({ ok: true, price: 105 })
    }
  });

  assert.equal(result.available, true);
  assert.equal(result.price, 105);
  assert.equal(result.source, 'ticker');
  assert.equal(result.stale, false);
});

test('market context falls back to mt5 snapshot when ticker is unavailable', async () => {
  const result = await resolveTrainingMarketContext('XAUUSD', {
    venue: 'MT5',
    nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
    deps: {
      getTicker: async () => ({ ok: false }),
      readMt5Snapshot: () => ({
        syncedAt: '2026-05-10T11:59:30.000Z',
        positions: [{ symbol: 'XAUUSD', price_current: 2315.5 }]
      })
    }
  });

  assert.equal(result.available, true);
  assert.equal(result.price, 2315.5);
  assert.equal(result.source, 'mt5_snapshot');
  assert.equal(result.stale, false);
});

test('market context marks stale last known price when only stale training state data exists', async () => {
  const result = await resolveTrainingMarketContext('ETHUSDT', {
    venue: 'BINANCE',
    nowMs: Date.parse('2026-05-10T12:10:00.000Z'),
    staleAfterMs: 60 * 1000,
    allowStale: false,
    state: createState({
      activePairs: [{
        symbol: 'ETHUSDT',
        venue: 'BINANCE',
        price: 2500,
        updatedAt: '2026-05-10T12:00:00.000Z'
      }]
    }),
    deps: {
      getTicker: async () => ({ ok: false })
    }
  });

  assert.equal(result.available, false);
  assert.equal(result.source, 'training_state_last_known');
  assert.equal(result.stale, true);
  assert.equal(result.reason, 'stale_price');
});

test('market context reports missing price when no source is available', async () => {
  const result = await resolveTrainingMarketContext('SOLUSDT', {
    venue: 'BINANCE',
    nowMs: Date.parse('2026-05-10T12:00:00.000Z'),
    deps: {
      getTicker: async () => ({ ok: false }),
      readMt5Snapshot: () => null
    }
  });

  assert.equal(result.available, false);
  assert.equal(result.reason, 'missing_price');
});
