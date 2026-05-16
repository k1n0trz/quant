const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createBootstrapTrainingState
} = require('../backend/training/training-bootstrap-service');
const {
  runTrainingDemoTick
} = require('../backend/training/training-loop-service');

test('bootstrap training state is safe, backend-managed, and seeds autonomous pairs', () => {
  const state = createBootstrapTrainingState({
    now: '2026-05-15T10:00:00.000Z'
  });

  assert.equal(state.mode, 'training');
  assert.equal(state.simulated, true);
  assert.equal(state.blockRealExecution, true);
  assert.equal(state.backendManaged, true);
  assert.equal(state.targets.minTotal, 20);
  assert.equal(state.targets.maxTotal, 40);
  assert.equal(state.targets.total, 20);
  assert.equal(state.targets.intraday, 10);
  assert.equal(state.targets.swing, 10);
  assert.equal(state.activePairs.length, 20);
  assert.equal(state.positions.length, 0);
  assert.equal(state.closedTrades.length, 0);
  assert.equal(state.lessons.length, 0);

  for (const pair of state.activePairs) {
    assert.equal(pair.venue, 'BINANCE');
    assert.equal(typeof pair.symbol, 'string');
    assert.equal(pair.score >= 62, true);
    assert.equal(pair.indicators.bias === 'LONG' || pair.indicators.bias === 'SHORT', true);
    assert.equal(pair.indicators.confidence >= 74, true);
    assert.equal(pair.indicators.htfAlignmentScore >= 0.5, true);
    assert.equal(pair.indicators.patternScore >= 0.45, true);
    assert.equal(pair.indicators.volumeRatio >= 0.85, true);
    assert.equal(pair.indicators.primaryStrategy.backendExecutable, true);
  }
});

test('backend tick can open target demo positions from bootstrapped state without touching real trading', async () => {
  const state = createBootstrapTrainingState({
    now: '2026-05-15T10:00:00.000Z'
  });

  const result = await runTrainingDemoTick({
    state,
    positionContexts: [],
    nowMs: Date.parse('2026-05-15T10:01:00.000Z'),
    env: {
      TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true',
      TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED: 'true'
    },
    deps: {
      getTicker: async () => ({ ok: true, price: 100 }),
      readMemory: () => []
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.closedPositions, 0);
  assert.equal(result.openedPositions, 20);
  assert.equal(result.entryEnabled, true);
  assert.equal(result.nextState.positions.length, 20);
  assert.equal(result.nextState.positions.every((position) => position.simulated === true), true);
  assert.equal(result.nextState.positions.every((position) => position.exit_price === null), true);
});
