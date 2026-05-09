const { runTrainingDemoTick, isTrainingBackendLoopEnabled } = require('./training-loop-service');
const { buildTrainingPositionContexts } = require('./training-position-context-service');

function isTrainingBackendLoopSchedulerEnabled(env = {}) {
  return String(env.TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED || 'false').toLowerCase() === 'true';
}

function resolveTrainingBackendLoopIntervalMs(env = {}) {
  const configured = Number(env.TRAINING_BACKEND_LOOP_INTERVAL_MS);
  if (Number.isFinite(configured) && configured >= 1000) return configured;
  return 60000;
}

function createStatusSnapshot(state, env = {}) {
  return {
    enabled: isTrainingBackendLoopSchedulerEnabled(env),
    loopEnabled: isTrainingBackendLoopEnabled(env),
    active: state.active,
    inProgress: state.inProgress,
    intervalMs: state.intervalMs,
    startedAt: state.startedAt,
    lastTickAt: state.lastTickAt,
    lastTickResult: state.lastTickResult,
    lastError: state.lastError,
    ticksRun: state.ticksRun,
    ticksSkipped: state.ticksSkipped,
    realTradingTouched: false
  };
}

async function executeTrainingDemoLoopTick(context = {}) {
  const deps = context.deps || {};
  const snapshot = typeof deps.readTrainingStateSnapshot === 'function'
    ? deps.readTrainingStateSnapshot()
    : null;
  const builtContexts = await buildTrainingPositionContexts(snapshot?.state || null, deps, { nowMs: context.nowMs, env: context.env || {} });
  if (!builtContexts?.ok) {
    return {
      ok: false,
      reason: builtContexts?.reason || 'training_position_contexts_unavailable',
      evaluatedPositions: 0,
      closedPositions: 0,
      openedPositions: 0,
      skippedPositions: [],
      skippedEntries: [],
      balanceBefore: Number(snapshot?.state?.balance || 0),
      balanceAfter: Number(snapshot?.state?.balance || 0),
      lessonPendingCount: 0,
      contextSource: 'backend',
      entryEnabled: false,
      persistence: null,
      safety: {
        readOnly: false,
        writesPerformed: false,
        realTradingTouched: false
      }
    };
  }

  const tickResult = await runTrainingDemoTick({
    state: snapshot?.state || null,
    positionContexts: builtContexts.contexts,
    nowMs: context.nowMs,
    env: context.env || {},
    deps
  });
  if (!tickResult.ok) {
    return {
      ok: false,
      reason: tickResult.reason,
      evaluatedPositions: 0,
      closedPositions: 0,
      openedPositions: 0,
      skippedPositions: builtContexts.skipped.slice(),
      skippedEntries: [],
      balanceBefore: Number(snapshot?.state?.balance || 0),
      balanceAfter: Number(snapshot?.state?.balance || 0),
      lessonPendingCount: 0,
      contextSource: 'backend',
      entryEnabled: false,
      persistence: null,
      safety: {
        readOnly: false,
        writesPerformed: false,
        realTradingTouched: false
      }
    };
  }

  let persistence = null;
  if (tickResult.closedPositions > 0 || tickResult.openedPositions > 0) {
    if (typeof deps.writeTrainingState !== 'function') {
      return {
        ok: false,
        reason: 'training_state_writer_missing',
        evaluatedPositions: tickResult.evaluatedPositions,
        closedPositions: tickResult.closedPositions,
        openedPositions: tickResult.openedPositions,
        skippedPositions: builtContexts.skipped.concat(tickResult.skippedPositions),
        skippedEntries: tickResult.skippedEntries,
        balanceBefore: tickResult.balanceBefore,
        balanceAfter: tickResult.balanceAfter,
        lessonPendingCount: tickResult.lessonPendingCount,
        contextSource: 'backend',
        entryEnabled: tickResult.entryEnabled,
        persistence: null,
        safety: {
          readOnly: false,
          writesPerformed: false,
          realTradingTouched: false
        }
      };
    }
    persistence = await Promise.resolve(deps.writeTrainingState(tickResult.nextState));
  }

  return {
    ok: true,
    tickId: tickResult.tickId,
    evaluatedPositions: tickResult.evaluatedPositions,
    closedPositions: tickResult.closedPositions,
    openedPositions: tickResult.openedPositions,
    skippedPositions: builtContexts.skipped.concat(tickResult.skippedPositions),
    skippedEntries: tickResult.skippedEntries,
    balanceBefore: tickResult.balanceBefore,
    balanceAfter: tickResult.balanceAfter,
    lessonPendingCount: tickResult.lessonPendingCount,
    contextSource: 'backend',
    entryEnabled: tickResult.entryEnabled,
    persistence,
    safety: {
      readOnly: false,
      writesPerformed: tickResult.closedPositions > 0 || tickResult.openedPositions > 0,
      realTradingTouched: false
    }
  };
}

function createTrainingDemoLoopSchedulerController(options = {}) {
  const timers = options.timers || {
    setInterval: (...args) => setInterval(...args),
    clearInterval: (handle) => clearInterval(handle)
  };
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const state = {
    active: false,
    inProgress: false,
    intervalMs: 60000,
    timerHandle: null,
    startedAt: null,
    lastTickAt: null,
    lastTickResult: null,
    lastError: null,
    ticksRun: 0,
    ticksSkipped: 0,
    context: null
  };

  async function runNow(overrideContext = null) {
    if (state.inProgress) {
      state.ticksSkipped += 1;
      state.lastTickResult = {
        ok: false,
        reason: 'tick_in_progress',
        skipped: true,
        realTradingTouched: false
      };
      return state.lastTickResult;
    }

    const context = overrideContext || state.context || {};
    state.inProgress = true;
    state.lastTickAt = new Date(now()).toISOString();

    try {
      const result = await executeTrainingDemoLoopTick(context);
      state.ticksRun += 1;
      state.lastTickResult = result;
      state.lastError = result.ok ? null : {
        at: state.lastTickAt,
        message: result.reason || 'training_demo_tick_failed'
      };
      return result;
    } catch (error) {
      state.ticksRun += 1;
      state.lastError = {
        at: state.lastTickAt,
        message: String(error?.message || error)
      };
      state.lastTickResult = {
        ok: false,
        reason: 'training_demo_tick_exception',
        error: state.lastError.message,
        realTradingTouched: false
      };
      return state.lastTickResult;
    } finally {
      state.inProgress = false;
    }
  }

  function startTrainingDemoLoopScheduler(context = {}) {
    const env = context.env || {};
    if (!isTrainingBackendLoopSchedulerEnabled(env)) {
      return {
        ok: false,
        reason: 'training_backend_loop_scheduler_disabled',
        status: createStatusSnapshot(state, env)
      };
    }
    if (!isTrainingBackendLoopEnabled(env)) {
      return {
        ok: false,
        reason: 'training_backend_loop_disabled',
        status: createStatusSnapshot(state, env)
      };
    }
    if (state.active) {
      state.context = context;
      return {
        ok: true,
        alreadyRunning: true,
        status: createStatusSnapshot(state, env)
      };
    }

    state.context = context;
    state.intervalMs = resolveTrainingBackendLoopIntervalMs(env);
    state.active = true;
    state.startedAt = new Date(now()).toISOString();
    state.timerHandle = timers.setInterval(() => {
      void runNow();
    }, state.intervalMs);

    return {
      ok: true,
      alreadyRunning: false,
      status: createStatusSnapshot(state, env)
    };
  }

  function stopTrainingDemoLoopScheduler(context = null) {
    const env = context?.env || state.context?.env || {};
    if (state.timerHandle) timers.clearInterval(state.timerHandle);
    state.timerHandle = null;
    state.active = false;
    state.inProgress = false;
    return {
      ok: true,
      status: createStatusSnapshot(state, env)
    };
  }

  function getTrainingDemoLoopSchedulerStatus(context = null) {
    const env = context?.env || state.context?.env || {};
    return createStatusSnapshot(state, env);
  }

  return {
    startTrainingDemoLoopScheduler,
    stopTrainingDemoLoopScheduler,
    getTrainingDemoLoopSchedulerStatus,
    runNow
  };
}

const defaultController = createTrainingDemoLoopSchedulerController();

module.exports = {
  isTrainingBackendLoopSchedulerEnabled,
  resolveTrainingBackendLoopIntervalMs,
  executeTrainingDemoLoopTick,
  createTrainingDemoLoopSchedulerController,
  startTrainingDemoLoopScheduler: (context) => defaultController.startTrainingDemoLoopScheduler(context),
  stopTrainingDemoLoopScheduler: (context) => defaultController.stopTrainingDemoLoopScheduler(context),
  getTrainingDemoLoopSchedulerStatus: (context) => defaultController.getTrainingDemoLoopSchedulerStatus(context)
};
