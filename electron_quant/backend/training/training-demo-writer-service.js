const { buildClosedTradeFromPosition } = require('./training-closure-service');
const { createTrainingStateSnapshot, normalizeTrainingState } = require('./training-state');

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

function registerTrainingDemoClosedTrade(env = {}, deps = {}, payload = {}) {
  if (!isTrainingBackendWriterEnabled(env)) {
    return { status: 409, body: disabledResponse() };
  }

  if (typeof deps.writeTrainingState !== 'function') {
    return {
      status: 503,
      body: {
        ok: false,
        available: false,
        reason: 'training_state_writer_missing',
        safety: {
          readOnly: false,
          writesPerformed: false,
          realTradingTouched: false
        }
      }
    };
  }

  const body = isObject(payload) ? payload : {};
  const openPosition = body.openPosition || body.open_position || body.position;
  if (!isObject(openPosition)) {
    return {
      status: 400,
      body: {
        ok: false,
        error: 'openPosition object is required',
        writesPerformed: false
      }
    };
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
    return {
      status: 409,
      body: {
        ok: false,
        available: false,
        reason: snapshot?.reason || 'training_state_unavailable',
        safety: {
          readOnly: false,
          writesPerformed: false,
          realTradingTouched: false
        }
      }
    };
  }
  const state = normalizeTrainingState(snapshot.state || snapshot.raw || {});
  const closedTrade = buildClosedTradeFromPosition(openPosition, exitContext, signal, {
    closedAt: options.closedAt,
    lessonBuilder: typeof options.lessonBuilder === 'function' ? options.lessonBuilder : undefined
  });
  const nextState = {
    ...state,
    closedTrades: [closedTrade, ...state.closedTrades].slice(0, Number(options.maxClosedTrades || 80))
  };
  const writeResult = deps.writeTrainingState(nextState);

  return {
    status: 200,
    body: {
      ok: true,
      available: true,
      mode: 'internal',
      closedTrade,
      summary: {
        positions: nextState.positions.length,
        closedTrades: nextState.closedTrades.length,
        lessons: nextState.lessons.length
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
