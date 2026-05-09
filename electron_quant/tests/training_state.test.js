const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createDefaultTrainingState,
  normalizeTrainingState,
  createTrainingStateStore,
  createTrainingStateSnapshot,
  createReadOnlyTrainingStateReader,
  isBackendTrainingEnabled
} = require('../backend/training/training-state');
const {
  normalizeClosedTradeTrace,
  normalizeTrainingStateTraceability
} = require('../backend/training/training-traceability');

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

test('read-only training state reader exposes compatible persisted state', () => {
  const filePath = path.join(__dirname, '.tmp-training-state-compatible.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify({
      mode: 'training',
      balanceStart: 1000,
      closedTrades: [{ pnl_demo: 5 }, { profit: -2 }],
      persistedAt: '2026-05-08T10:00:00.000Z'
    }), 'utf8');

    const snapshot = createReadOnlyTrainingStateReader(filePath).readSnapshot();

    assert.equal(snapshot.available, true);
    assert.equal(snapshot.reason, null);
    assert.equal(snapshot.state.closedTrades.length, 2);
    assert.equal(snapshot.state.persistedAt, '2026-05-08T10:00:00.000Z');
    assert.equal(snapshot.source.filePath, filePath);
  } finally {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
});

test('read-only training state reader reports missing, invalid and incompatible files', () => {
  const missingPath = path.join(__dirname, '.tmp-training-state-missing.json');
  const invalidPath = path.join(__dirname, '.tmp-training-state-invalid.json');
  const incompatiblePath = path.join(__dirname, '.tmp-training-state-incompatible.json');
  try {
    if (fs.existsSync(missingPath)) fs.unlinkSync(missingPath);
    fs.writeFileSync(invalidPath, '{bad json', 'utf8');
    fs.writeFileSync(incompatiblePath, JSON.stringify({ unrelated: true }), 'utf8');

    assert.equal(createReadOnlyTrainingStateReader(missingPath).readSnapshot().reason, 'training_state_file_missing');
    assert.equal(createReadOnlyTrainingStateReader(invalidPath).readSnapshot().reason, 'training_state_json_invalid');
    assert.equal(createReadOnlyTrainingStateReader(incompatiblePath).readSnapshot().reason, 'training_state_shape_incompatible');
  } finally {
    for (const filePath of [invalidPath, incompatiblePath]) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }
});

test('training state snapshot accepts partial legacy closed trades without throwing', () => {
  const snapshot = createTrainingStateSnapshot({
    closedTrades: [{ profit: 2 }, { pnl: -1 }],
    strategyStats: {
      legacy: { id: 'legacy', closed: 2, wins: 1, pnl: 1, avgScore: 55 }
    }
  }, { source: 'unit-test' });

  assert.equal(snapshot.available, true);
  assert.equal(snapshot.reason, null);
  assert.equal(snapshot.state.closedTrades.length, 2);
  assert.equal(snapshot.state.strategyStats.legacy.closed, 2);
});

test('traceability normalizes a new closed trade with complete metadata', () => {
  const trade = normalizeClosedTradeTrace({
    strategy_id: 'trendMomentum',
    strategy_name: 'Trend Momentum / EMA-MACD',
    signal_id: 'sig-1',
    timeframe: 'M15',
    horizon: 'intraday',
    session: 'new_york',
    entry_reason_code: 'professional_gate',
    exit_reason_code: 'signal_flip',
    risk_profile_id: 'demo-training-v1',
    source: 'renderer.training',
    timestamp: '2026-05-09T10:00:00.000Z',
    closed_timestamp: '2026-05-09T11:00:00.000Z',
    symbol: 'BTCUSD',
    direction: 'LONG',
    entry_price: 100,
    exit_price: 110,
    pnl_demo: 10,
    confidence: 77,
    regime_at_entry: 'trend',
    volatility_at_entry: 0.012
  });

  assert.equal(trade.traceability_version, 1);
  assert.equal(trade.strategy_id, 'trendMomentum');
  assert.equal(trade.side, 'LONG');
  assert.equal(trade.pnl, 10);
  assert.equal(trade.pnl_pct, 0.1);
  assert.equal(trade.opened_at, '2026-05-09T10:00:00.000Z');
  assert.equal(trade.closed_at, '2026-05-09T11:00:00.000Z');
  assert.equal(trade.confidence_at_entry, 77);
});

test('traceability keeps partial metadata without inventing absent fields', () => {
  const trade = normalizeClosedTradeTrace({
    strategyId: 'ictCrt',
    symbol: 'XAUUSD',
    side: 'SHORT',
    pnl_demo: -3
  });

  assert.equal(trade.traceability_version, 1);
  assert.equal(trade.strategy_id, 'ictCrt');
  assert.equal(trade.side, 'SHORT');
  assert.equal(trade.pnl, -3);
  assert.equal(Object.prototype.hasOwnProperty.call(trade, 'signal_id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(trade, 'pnl_pct'), false);
});

test('traceability leaves legacy closed trades untouched when no causal metadata exists', () => {
  const legacy = {
    symbol: 'ETHUSD',
    direction: 'LONG',
    timestamp: '2026-05-08T00:00:00.000Z',
    closed_timestamp: '2026-05-08T01:00:00.000Z',
    pnl_demo: 2
  };
  const normalized = normalizeClosedTradeTrace(legacy);

  assert.notEqual(normalized, legacy);
  assert.deepEqual(normalized, legacy);
});

test('traceability normalizes training state without mutating legacy trades', () => {
  const legacy = { symbol: 'ETHUSD', pnl_demo: 2 };
  const traceable = { strategy_id: 'trendMomentum', symbol: 'BTCUSD', direction: 'LONG', pnl_demo: 5 };
  const state = { closedTrades: [traceable, legacy] };

  const normalized = normalizeTrainingStateTraceability(state);

  assert.deepEqual(state.closedTrades[1], legacy);
  assert.equal(normalized.closedTrades[0].strategy_id, 'trendMomentum');
  assert.equal(normalized.closedTrades[0].traceability_version, 1);
  assert.deepEqual(normalized.closedTrades[1], legacy);
});

test('backend training feature flag is explicit opt-in', () => {
  assert.equal(isBackendTrainingEnabled({}), false);
  assert.equal(isBackendTrainingEnabled({ TRAINING_BACKEND_ENABLED: 'false' }), false);
  assert.equal(isBackendTrainingEnabled({ TRAINING_BACKEND_ENABLED: 'true' }), true);
});
