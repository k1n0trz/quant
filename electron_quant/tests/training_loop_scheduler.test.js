const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createTrainingDemoLoopSchedulerController,
  isTrainingBackendLoopSchedulerEnabled,
  resolveTrainingBackendLoopIntervalMs
} = require('../backend/training/training-loop-scheduler');
const { createTrainingStateSnapshot } = require('../backend/training/training-state');

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

function createTimerStub() {
  let nextId = 1;
  const handles = new Map();
  return {
    setInterval(callback, intervalMs) {
      const handle = { id: nextId++, callback, intervalMs };
      handles.set(handle.id, handle);
      return handle;
    },
    clearInterval(handle) {
      handles.delete(handle?.id);
    },
    handles
  };
}

function createClosableState() {
  return createState({
    positions: [{
      id: 'pos-scheduler-1',
      signal_id: 'sig-scheduler-1',
      strategy_id: 'trendMomentum',
      symbol: 'BTCUSDT',
      venue: 'BINANCE',
      direction: 'LONG',
      entry_price: 100,
      size_demo: 1,
      opened_tick: Date.parse('2026-05-10T08:00:00.000Z'),
      min_hold_ms: 30 * 60 * 1000,
      max_hold_ms: 12 * 60 * 60 * 1000,
      horizon: 'intraday'
    }]
  });
}

test('scheduler flag is explicit opt-in and interval is configurable', () => {
  assert.equal(isTrainingBackendLoopSchedulerEnabled({}), false);
  assert.equal(isTrainingBackendLoopSchedulerEnabled({ TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'true' }), true);
  assert.equal(resolveTrainingBackendLoopIntervalMs({}), 60000);
  assert.equal(resolveTrainingBackendLoopIntervalMs({ TRAINING_BACKEND_LOOP_INTERVAL_MS: '15000' }), 15000);
});

test('scheduler disabled does not start', () => {
  const timers = createTimerStub();
  const controller = createTrainingDemoLoopSchedulerController({ timers });

  const result = controller.startTrainingDemoLoopScheduler({
    env: { TRAINING_BACKEND_LOOP_ENABLED: 'true', TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'false' },
    deps: {}
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'training_backend_loop_scheduler_disabled');
  assert.equal(result.status.active, false);
  assert.equal(timers.handles.size, 0);
});

test('scheduler start stop and status are tracked', () => {
  const timers = createTimerStub();
  const controller = createTrainingDemoLoopSchedulerController({ timers });
  const context = {
    env: {
      TRAINING_BACKEND_LOOP_ENABLED: 'true',
      TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'true',
      TRAINING_BACKEND_LOOP_INTERVAL_MS: '15000'
    },
    deps: {}
  };

  const start = controller.startTrainingDemoLoopScheduler(context);
  assert.equal(start.ok, true);
  assert.equal(start.alreadyRunning, false);
  assert.equal(start.status.active, true);
  assert.equal(start.status.intervalMs, 15000);
  assert.equal(timers.handles.size, 1);

  const status = controller.getTrainingDemoLoopSchedulerStatus(context);
  assert.equal(status.active, true);
  assert.equal(status.enabled, true);
  assert.equal(status.loopEnabled, true);

  const stop = controller.stopTrainingDemoLoopScheduler(context);
  assert.equal(stop.ok, true);
  assert.equal(stop.status.active, false);
  assert.equal(timers.handles.size, 0);
});

test('scheduler skips concurrent ticks with tick_in_progress', async () => {
  const controller = createTrainingDemoLoopSchedulerController();
  let releaseTicker;
  const firstRun = controller.runNow({
    env: {
      TRAINING_BACKEND_LOOP_ENABLED: 'true',
      TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'true'
    },
    deps: {
      readTrainingStateSnapshot: () => createTrainingStateSnapshot(createClosableState()),
      getTicker: () => new Promise((resolve) => { releaseTicker = resolve; }),
      readMemory: () => []
    }
  });

  const secondRun = await controller.runNow({
    env: {
      TRAINING_BACKEND_LOOP_ENABLED: 'true',
      TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'true'
    },
    deps: {
      readTrainingStateSnapshot: () => createTrainingStateSnapshot(createClosableState()),
      getTicker: async () => ({ ok: true, price: 98 }),
      readMemory: () => []
    }
  });

  assert.equal(secondRun.ok, false);
  assert.equal(secondRun.reason, 'tick_in_progress');
  assert.equal(controller.getTrainingDemoLoopSchedulerStatus().ticksSkipped, 1);

  releaseTicker({ ok: true, price: 98 });
  await firstRun;
});

test('tick error does not stop scheduler and records last error', async () => {
  const timers = createTimerStub();
  const controller = createTrainingDemoLoopSchedulerController({ timers });
  const context = {
    env: {
      TRAINING_BACKEND_LOOP_ENABLED: 'true',
      TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'true'
    },
    deps: {
      readTrainingStateSnapshot: () => null
    }
  };

  controller.startTrainingDemoLoopScheduler(context);
  const result = await controller.runNow(context);
  const status = controller.getTrainingDemoLoopSchedulerStatus(context);

  assert.equal(result.ok, false);
  assert.equal(status.active, true);
  assert.equal(status.ticksRun, 1);
  assert.match(String(status.lastError?.message || ''), /training_state_shape_incompatible/i);
  controller.stopTrainingDemoLoopScheduler(context);
});

test('scheduler tick closes positions, does not open new ones, and never touches real trading', async () => {
  const writes = [];
  const controller = createTrainingDemoLoopSchedulerController();
  const result = await controller.runNow({
    env: {
      TRAINING_BACKEND_LOOP_ENABLED: 'true',
      TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'true'
    },
    deps: {
      readTrainingStateSnapshot: () => createTrainingStateSnapshot(createClosableState()),
      getTicker: async () => ({ ok: true, price: 98 }),
      readMemory: () => [],
      writeTrainingState: (nextState) => {
        writes.push(JSON.parse(JSON.stringify(nextState)));
        return { ok: true, persistedAt: '2026-05-10T16:00:00.000Z' };
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.closedPositions, 1);
  assert.equal(result.contextSource, 'backend');
  assert.equal(result.safety.realTradingTouched, false);
  assert.equal(writes.length, 1);
  assert.equal(Array.isArray(writes[0].positions), true);
  assert.equal(writes[0].positions.length, 0);
});
