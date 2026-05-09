const test = require('node:test');
const assert = require('node:assert/strict');

const {
  autoStartTrainingDemoLoopScheduler
} = require('../backend/training/training-loop-autostart');

test('auto-start does nothing when loop flag is disabled', () => {
  const calls = [];
  const logs = [];
  const result = autoStartTrainingDemoLoopScheduler({
    env: {
      TRAINING_BACKEND_LOOP_ENABLED: 'false',
      TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'true'
    },
    scheduler: {
      startTrainingDemoLoopScheduler: (context) => {
        calls.push(context);
        return { ok: true, status: { active: true } };
      }
    },
    logger: {
      info: (event, payload) => logs.push({ level: 'info', event, payload }),
      error: (event, payload) => logs.push({ level: 'error', event, payload })
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.started, false);
  assert.equal(result.reason, 'training_backend_loop_disabled');
  assert.equal(calls.length, 0);
  assert.equal(logs.some((entry) => entry.event === 'training.loop.autostart.skipped'), true);
});

test('auto-start does nothing when scheduler flag is disabled', () => {
  const calls = [];
  const result = autoStartTrainingDemoLoopScheduler({
    env: {
      TRAINING_BACKEND_LOOP_ENABLED: 'true',
      TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'false'
    },
    scheduler: {
      startTrainingDemoLoopScheduler: (context) => {
        calls.push(context);
        return { ok: true, status: { active: true } };
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.started, false);
  assert.equal(result.reason, 'training_backend_loop_scheduler_disabled');
  assert.equal(calls.length, 0);
});

test('auto-start starts scheduler once when both flags are enabled', () => {
  const calls = [];
  const logs = [];
  const scheduler = {
    startTrainingDemoLoopScheduler: (context) => {
      calls.push(context);
      return {
        ok: true,
        alreadyRunning: false,
        status: { active: true, intervalMs: 15000, ticksRun: 0, ticksSkipped: 0 }
      };
    }
  };

  const result = autoStartTrainingDemoLoopScheduler({
    env: {
      TRAINING_BACKEND_LOOP_ENABLED: 'true',
      TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'true',
      TRAINING_BACKEND_LOOP_INTERVAL_MS: '15000'
    },
    deps: { readTrainingStateSnapshot: () => ({ available: true, state: { positions: [] } }) },
    scheduler,
    logger: {
      info: (event, payload) => logs.push({ level: 'info', event, payload }),
      error: (event, payload) => logs.push({ level: 'error', event, payload })
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.started, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].env.TRAINING_BACKEND_LOOP_ENABLED, 'true');
  assert.equal(logs.some((entry) => entry.event === 'training.loop.autostart.started'), true);
});

test('auto-start treats already-running scheduler as success without duplication', () => {
  const result = autoStartTrainingDemoLoopScheduler({
    env: {
      TRAINING_BACKEND_LOOP_ENABLED: 'true',
      TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'true'
    },
    scheduler: {
      startTrainingDemoLoopScheduler: () => ({
        ok: true,
        alreadyRunning: true,
        status: { active: true, ticksRun: 3, ticksSkipped: 1 }
      })
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.started, true);
  assert.equal(result.alreadyRunning, true);
});

test('auto-start logs error and does not throw when scheduler start fails', () => {
  const logs = [];
  const result = autoStartTrainingDemoLoopScheduler({
    env: {
      TRAINING_BACKEND_LOOP_ENABLED: 'true',
      TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'true'
    },
    scheduler: {
      startTrainingDemoLoopScheduler: () => ({
        ok: false,
        reason: 'training_state_reader_missing',
        status: { active: false }
      })
    },
    logger: {
      info: (event, payload) => logs.push({ level: 'info', event, payload }),
      error: (event, payload) => logs.push({ level: 'error', event, payload })
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.started, false);
  assert.equal(result.reason, 'training_state_reader_missing');
  assert.equal(logs.some((entry) => entry.event === 'training.loop.autostart.failed'), true);
});
