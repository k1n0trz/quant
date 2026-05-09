const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyAtomicTrainingDemoClose
} = require('../backend/training/training-atomic-close-service');

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
    persistedAt: '2026-05-09T00:00:00.000Z',
    ...overrides
  };
}

test('atomic close inserts LONG winning closed trade first and updates balance', () => {
  const open = {
    id: 'pos-1',
    symbol: 'BTCUSDT',
    venue: 'BINANCE',
    direction: 'LONG',
    entry_price: 100,
    size_demo: 2,
    fees_simuladas: 1,
    spread_estimado: 0.5,
    slippage_estimado: 0.25,
    strategy_id: 'trendMomentum',
    signal_id: 'sig-long-1'
  };
  const state = createState({
    balance: 100000,
    positions: [open, { id: 'pos-2', symbol: 'ETHUSDT', direction: 'LONG', entry_price: 10, size_demo: 1 }],
    closedTrades: [{ symbol: 'OLD', pnl_demo: -2 }]
  });

  const result = applyAtomicTrainingDemoClose({
    state,
    openPosition: { ...open },
    exitContext: { price: 105 },
    signal: { bias: 'SHORT', confidence: 58 },
    options: { closedAt: '2026-05-09T12:00:00.000Z' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.closedTrade.pnl_demo, 8.25);
  assert.equal(result.nextState.balance, 100008.25);
  assert.equal(result.nextState.positions.length, 1);
  assert.equal(result.nextState.closedTrades.length, 2);
  assert.equal(result.nextState.closedTrades[0].signal_id, 'sig-long-1');
  assert.equal(result.nextState.closedTrades[0].strategy_id, 'trendMomentum');
  assert.equal(result.nextState.closedTrades[0].closed_at, '2026-05-09T12:00:00.000Z');
});

test('atomic close handles SHORT losing close and preserves traceable metadata', () => {
  const open = {
    signal_id: 'sig-short-1',
    strategy_id: 'breakoutRetest',
    symbol: 'XAUUSD',
    venue: 'MT5',
    direction: 'SHORT',
    entry_price: 100,
    size_demo: 2,
    fees_simuladas: 1,
    spread_estimado: 0.5,
    slippage_estimado: 0.25
  };
  const state = createState({ balance: 5000, positions: [open] });

  const result = applyAtomicTrainingDemoClose({
    state,
    openPosition: { ...open },
    exitContext: { price: 105 },
    signal: { bias: 'SHORT', confidence: 61 },
    options: { closedAt: '2026-05-09T13:00:00.000Z' }
  });

  assert.equal(result.ok, true);
  assert.equal(result.closedTrade.pnl_demo, -11.75);
  assert.equal(result.nextState.balance, 4988.25);
  assert.equal(result.nextState.closedTrades[0].signal_id, 'sig-short-1');
  assert.equal(result.nextState.closedTrades[0].strategy_id, 'breakoutRetest');
  assert.equal(result.nextState.positions.length, 0);
});

test('atomic close removes exactly one matching position', () => {
  const open = {
    id: 'only-match',
    symbol: 'BTCUSDT',
    venue: 'BINANCE',
    direction: 'LONG',
    entry_price: 100,
    size_demo: 1
  };
  const sameSymbolOther = {
    id: 'other-position',
    symbol: 'BTCUSDT',
    venue: 'BINANCE',
    direction: 'LONG',
    entry_price: 101,
    size_demo: 1
  };
  const state = createState({ positions: [open, sameSymbolOther] });

  const result = applyAtomicTrainingDemoClose({
    state,
    openPosition: { ...open },
    exitContext: { price: 102 },
    signal: { bias: 'LONG', confidence: 70 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.nextState.positions.length, 1);
  assert.equal(result.nextState.positions[0].id, 'other-position');
});

test('atomic close marks lesson pending when no equivalent backend lesson exists', () => {
  const open = {
    id: 'pos-lesson-pending',
    symbol: 'ETHUSDT',
    venue: 'BINANCE',
    direction: 'LONG',
    entry_price: 100,
    size_demo: 1
  };
  const state = createState({ positions: [open], lessons: [{ symbol: 'OLD', outcome: 'win' }] });

  const result = applyAtomicTrainingDemoClose({
    state,
    openPosition: { ...open },
    exitContext: { price: 101 },
    signal: { bias: 'LONG', confidence: 73 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.lessonPending, true);
  assert.match(String(result.lessonPendingReason || ''), /lesson/i);
  assert.equal(result.nextState.lessons.length, 1);
});

test('atomic close appends lesson when closed trade already carries one', () => {
  const lesson = { type: 'training_lesson', symbol: 'BTCUSDT', outcome: 'win' };
  const open = {
    id: 'pos-with-lesson',
    symbol: 'BTCUSDT',
    venue: 'BINANCE',
    direction: 'LONG',
    entry_price: 100,
    size_demo: 1,
    lesson_learned: lesson
  };
  const state = createState({ positions: [open], lessons: [] });

  const result = applyAtomicTrainingDemoClose({
    state,
    openPosition: { ...open },
    exitContext: { price: 102 },
    signal: { bias: 'SHORT', confidence: 57 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.lessonPending, false);
  assert.equal(result.nextState.lessons.length, 1);
  assert.deepEqual(result.nextState.lessons[0], lesson);
});

test('atomic close supports legacy position without metadata', () => {
  const open = {
    symbol: 'EURUSD',
    direction: 'SHORT',
    entry_price: 10,
    size_demo: 3
  };
  const state = createState({ positions: [open], balance: 1000 });

  const result = applyAtomicTrainingDemoClose({
    state,
    openPosition: { ...open },
    exitContext: { price: 9 },
    signal: { bias: 'SHORT', confidence: 62 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.closedTrade.pnl_demo, 3);
  assert.equal(result.nextState.balance, 1003);
  assert.equal(result.nextState.positions.length, 0);
});

test('atomic close does not mutate input state or payload', () => {
  const open = {
    id: 'pos-immutable',
    symbol: 'BTCUSDT',
    direction: 'LONG',
    entry_price: 100,
    size_demo: 1
  };
  const state = createState({
    positions: [open],
    closedTrades: [{ symbol: 'OLD', pnl_demo: 1 }],
    lessons: [{ symbol: 'OLD', outcome: 'win' }]
  });
  const stateBefore = JSON.stringify(state);
  const openBefore = JSON.stringify(open);

  const result = applyAtomicTrainingDemoClose({
    state,
    openPosition: open,
    exitContext: { price: 102 },
    signal: { bias: 'LONG', confidence: 75 }
  });

  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(state), stateBefore);
  assert.equal(JSON.stringify(open), openBefore);
});

test('atomic close rejects incompatible state without producing next state', () => {
  const result = applyAtomicTrainingDemoClose({
    state: null,
    openPosition: { symbol: 'BTCUSDT', direction: 'LONG', entry_price: 100, size_demo: 1 },
    exitContext: { price: 101 },
    signal: { bias: 'LONG', confidence: 70 }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'training_state_shape_incompatible');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'nextState'), false);
});

test('atomic close rejects when matching open position is not uniquely identifiable', () => {
  const duplicateA = { symbol: 'BTCUSDT', direction: 'LONG', entry_price: 100, size_demo: 1 };
  const duplicateB = { symbol: 'BTCUSDT', direction: 'LONG', entry_price: 100, size_demo: 1 };
  const state = createState({ positions: [duplicateA, duplicateB] });

  const result = applyAtomicTrainingDemoClose({
    state,
    openPosition: { symbol: 'BTCUSDT', direction: 'LONG', entry_price: 100, size_demo: 1 },
    exitContext: { price: 101 },
    signal: { bias: 'LONG', confidence: 70 }
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'open_position_not_unique');
});
