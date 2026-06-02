function isSystemSelfAuditSchedulerEnabled(env = {}) {
  if (Object.prototype.hasOwnProperty.call(env, 'SYSTEM_SELF_AUDIT_ENABLED')) {
    return String(env.SYSTEM_SELF_AUDIT_ENABLED || 'false').trim().toLowerCase() === 'true';
  }
  return true;
}

function resolveSystemSelfAuditIntervalMs(env = {}) {
  const configured = Number(env.SYSTEM_SELF_AUDIT_INTERVAL_MS);
  if (Number.isFinite(configured) && configured >= 10000) return configured;
  return 300000;
}

function createStatusSnapshot(state, env = {}) {
  return {
    enabled: isSystemSelfAuditSchedulerEnabled(env),
    active: state.active,
    inProgress: state.inProgress,
    intervalMs: state.intervalMs,
    startedAt: state.startedAt,
    lastRunAt: state.lastRunAt,
    lastFinishedAt: state.lastFinishedAt,
    lastResult: state.lastResult,
    lastError: state.lastError,
    runs: state.runs,
    skipped: state.skipped
  };
}

function createSystemSelfAuditSchedulerController(options = {}) {
  const timers = options.timers || {
    setInterval: (...args) => setInterval(...args),
    clearInterval: (handle) => clearInterval(handle)
  };
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const runAudit = typeof options.runAudit === 'function'
    ? options.runAudit
    : async () => ({ ok: false, reason: 'system_self_audit_runner_missing' });

  const state = {
    active: false,
    inProgress: false,
    intervalMs: 300000,
    timerHandle: null,
    startedAt: null,
    lastRunAt: null,
    lastFinishedAt: null,
    lastResult: null,
    lastError: null,
    runs: 0,
    skipped: 0,
    context: null
  };

  async function runNow(overrideContext = null) {
    if (state.inProgress) {
      state.skipped += 1;
      state.lastResult = { ok: false, reason: 'system_self_audit_in_progress', skipped: true };
      return state.lastResult;
    }

    const context = overrideContext || state.context || {};
    state.inProgress = true;
    state.lastRunAt = new Date(now()).toISOString();
    try {
      const result = await runAudit(context);
      state.runs += 1;
      state.lastResult = result;
      state.lastError = result?.ok === true ? null : {
        at: state.lastRunAt,
        message: String(result?.reason || 'system_self_audit_failed')
      };
      return result;
    } catch (error) {
      state.runs += 1;
      state.lastError = {
        at: state.lastRunAt,
        message: String(error?.message || error)
      };
      state.lastResult = { ok: false, reason: 'system_self_audit_exception', error: state.lastError.message };
      return state.lastResult;
    } finally {
      state.lastFinishedAt = new Date(now()).toISOString();
      state.inProgress = false;
    }
  }

  function start(context = {}) {
    const env = context.env || {};
    if (!isSystemSelfAuditSchedulerEnabled(env)) {
      return {
        ok: false,
        reason: 'system_self_audit_scheduler_disabled',
        status: createStatusSnapshot(state, env)
      };
    }
    state.context = context;
    state.intervalMs = resolveSystemSelfAuditIntervalMs(env);
    if (state.active) {
      return {
        ok: true,
        alreadyRunning: true,
        status: createStatusSnapshot(state, env)
      };
    }
    state.startedAt = new Date(now()).toISOString();
    state.timerHandle = timers.setInterval(() => runNow(), state.intervalMs);
    state.active = true;
    return {
      ok: true,
      alreadyRunning: false,
      status: createStatusSnapshot(state, env)
    };
  }

  function stop(context = {}) {
    if (state.timerHandle) timers.clearInterval(state.timerHandle);
    state.timerHandle = null;
    state.active = false;
    return {
      ok: true,
      status: createStatusSnapshot(state, context.env || state.context?.env || {})
    };
  }

  function status(context = {}) {
    return createStatusSnapshot(state, context.env || state.context?.env || {});
  }

  return {
    start,
    stop,
    runNow,
    status
  };
}

module.exports = {
  isSystemSelfAuditSchedulerEnabled,
  resolveSystemSelfAuditIntervalMs,
  createSystemSelfAuditSchedulerController
};
