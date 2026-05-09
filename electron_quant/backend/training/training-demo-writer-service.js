const { applyAtomicTrainingDemoClose } = require('./training-atomic-close-service');
const { createTrainingStateSnapshot } = require('./training-state');

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isTrainingBackendWriterEnabled(env = {}) {
  return String(env.TRAINING_BACKEND_WRITER_ENABLED || 'false').toLowerCase() === 'true';
}

function disabledResponse() {
  return {
    ok: false,
    available: false,
    reason: 'training_backend_writer_disabled',
    safety: {
      readOnly: false,
      writesPerformed: false,
      realTradingTouched: false
    }
  };
}

function noWriteResponse(reason, error, status = 409) {
  return {
    status,
    body: {
      ok: false,
      available: false,
      reason,
      ...(error ? { error } : {}),
      safety: {
        readOnly: false,
        writesPerformed: false,
        realTradingTouched: false
      }
    }
  };
}

function registerTrainingDemoClosedTrade(env = {}, deps = {}, payload = {}) {
  if (!isTrainingBackendWriterEnabled(env)) {
    return { status: 409, body: disabledResponse() };
  }

  if (typeof deps.writeTrainingState !== 'function') {
    return noWriteResponse('training_state_writer_missing', null, 503);
  }

  const body = isObject(payload) ? payload : {};
  const openPosition = body.openPosition || body.open_position || body.position;
  if (!isObject(openPosition)) {
    return noWriteResponse('invalid_payload', 'openPosition object is required', 400);
  }

  const exitContext = isObject(body.exitContext || body.exit_context)
    ? (body.exitContext || body.exit_context)
    : {};
  const signal = isObject(body.signal) ? body.signal : {};
  const options = isObject(body.options) ? body.options : {};
  const snapshot = typeof deps.readTrainingStateSnapshot === 'function'
    ? deps.readTrainingStateSnapshot()
    : createTrainingStateSnapshot(
        typeof deps.readTrainingState === 'function' ? deps.readTrainingState() : null,
        { source: 'deps.readTrainingState' }
      );
  if (!snapshot || snapshot.available !== true) {
    return noWriteResponse(snapshot?.reason || 'training_state_unavailable');
  }

  const balanceBefore = Number(snapshot.state?.balance || 0);
  const atomicResult = applyAtomicTrainingDemoClose({
    state: snapshot.state || snapshot.raw || {},
    openPosition,
    exitContext,
    signal,
    options: {
      closedAt: options.closedAt,
      lessonBuilder: typeof options.lessonBuilder === 'function' ? options.lessonBuilder : undefined,
      maxClosedTrades: options.maxClosedTrades,
      maxLessons: options.maxLessons,
      persistedAt: options.persistedAt
    }
  });
  if (!atomicResult.ok) {
    const status = atomicResult.reason === 'open_position_object_required' ? 400 : 409;
    return noWriteResponse(atomicResult.reason, null, status);
  }

  const writeResult = deps.writeTrainingState(atomicResult.nextState);

  return {
    status: 200,
    body: {
      ok: true,
      available: true,
      mode: 'internal',
      closedTrade: atomicResult.closedTrade,
      balanceBefore,
      balanceAfter: atomicResult.nextState.balance,
      removedPositionId: atomicResult.removedPosition?.id || null,
      removedSignalId: atomicResult.removedPosition?.signal_id || atomicResult.removedPosition?.signalId || null,
      lessonPending: atomicResult.lessonPending === true,
      lessonPendingReason: atomicResult.lessonPendingReason || null,
      summary: {
        positions: atomicResult.nextState.positions.length,
        closedTrades: atomicResult.nextState.closedTrades.length,
        lessons: atomicResult.nextState.lessons.length
      },
      persistence: writeResult || { ok: true },
      safety: {
        readOnly: false,
        writesPerformed: true,
        realTradingTouched: false
      }
    }
  };
}

module.exports = {
  isTrainingBackendWriterEnabled,
  registerTrainingDemoClosedTrade
};
