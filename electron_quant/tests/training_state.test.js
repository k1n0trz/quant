const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createDefaultTrainingState,
  normalizeTrainingState,
  createTrainingStateStore,
  isBackendTrainingEnabled
} = require('../backend/training/training-state');

test('default training state is safe and renderer-compatible', () => {
  const state = createDefaultTrainingState();

  assert.equal(state.mode, 'training');
  assert.equal(state.simulated, true);
  assert.equal(state.blockRealExecution, true);
  assert.equal(state.backendManaged, false);
  assert.equal(state.shadowModeReady, true);
  assert.equal(state.balanceStart, 100000);
  assert.deepEqual(state.positions, []);
  assert.deepEqual(state.closedTrades, []);
  assert.deepEqual(state.lessons, []);
  assert.deepEqual(state.targets, { total: 20, intraday: 10, swing: 10 });
});

test('normalizes current renderer training payload without losing fields', () => {
  const raw = {
    version: 2,
    mode: 'training',
    simulated: true,
    blockRealExecution: true,
    balanceStart: 50000,
    balance: 50125,
    positions: [{ symbol: 'BTCUSDT', pnl_demo: 0 }],
    closedTrades: [{ symbol: 'ETHUSDT', pnl_demo: 12 }],
    lessons: [{ symbol: 'ETHUSDT', outcome: 'win' }],
    strategyStats: { unknown: { closed: 1 } },
    pairCooldowns: { 'BINANCE:BTCUSDT:intraday': 123 },
    xp: 42,
    customFieldFromRenderer: 'preserve-me'
  };

  const state = normalizeTrainingState(raw, '2026-05-08T00:00:00.000Z');

  assert.equal(state.version, 2);
  assert.equal(state.balanceStart, 50000);
  assert.equal(state.balance, 50125);
  assert.equal(state.positions.length, 1);
  assert.equal(state.closedTrades.length, 1);
  assert.equal(state.lessons.length, 1);
  assert.equal(state.strategyStats.unknown.closed, 1);
  assert.equal(state.pairCooldowns['BINANCE:BTCUSDT:intraday'], 123);
  assert.equal(state.xp, 42);
  assert.equal(state.customFieldFromRenderer, 'preserve-me');
  assert.equal(state.backendManaged, false);
  assert.equal(state.shadowModeReady, true);
  assert.equal(state.persistedAt, '2026-05-08T00:00:00.000Z');
});

test('training state store reads missing/corrupt files as safe defaults', () => {
  const filePath = path.join(__dirname, '.tmp-training-state.json');
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    const store = createTrainingStateStore(filePath);

    assert.equal(store.read().blockRealExecution, true);

    fs.writeFileSync(filePath, '{bad json', 'utf8');
    assert.equal(store.read().simulated, true);
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

test('backend training feature flag is explicit opt-in', () => {
  assert.equal(isBackendTrainingEnabled({}), false);
  assert.equal(isBackendTrainingEnabled({ TRAINING_BACKEND_ENABLED: 'false' }), false);
  assert.equal(isBackendTrainingEnabled({ TRAINING_BACKEND_ENABLED: 'true' }), true);
});
