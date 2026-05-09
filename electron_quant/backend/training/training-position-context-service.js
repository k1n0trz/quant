const { createTrainingStateSnapshot } = require('./training-state');
const { resolveTrainingMarketContext } = require('./training-market-context-service');
const { resolveTrainingSignalContext } = require('./training-signal-context-service');

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function textValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

async function buildTrainingPositionContexts(state, deps = {}, options = {}) {
  const snapshot = createTrainingStateSnapshot(state, { source: 'training-position-context-service' });
  if (!snapshot.available) {
    return {
      ok: false,
      reason: snapshot.reason || 'training_state_shape_incompatible',
      contexts: [],
      skipped: []
    };
  }

  const openPositions = (Array.isArray(snapshot.state.positions) ? snapshot.state.positions : []).filter((position) => !position.exit_price);
  const contexts = [];
  const skipped = [];
  const nowMs = Number.isFinite(Number(options.nowMs ?? deps.nowMs)) ? Number(options.nowMs ?? deps.nowMs) : Date.now();

  for (const position of openPositions) {
    const marketContext = await resolveTrainingMarketContext(position.symbol, {
      venue: position.venue,
      position,
      state: snapshot.raw || state,
      nowMs,
      deps
    });
    if (!marketContext.available || !Number.isFinite(Number(marketContext.price))) {
      skipped.push({
        id: position.id || null,
        signal_id: position.signal_id || null,
        symbol: position.symbol || null,
        reason: marketContext.reason || 'missing_price'
      });
      continue;
    }

    const signal = await resolveTrainingSignalContext(position, {
      ...deps,
      state: snapshot.raw || state,
      env: options.env || deps.env || {},
      nowMs,
      marketContext
    });
    contexts.push({
      positionId: position.id || null,
      signalId: textValue(position.signal_id, position.signalId),
      strategy_id: textValue(position.strategy_id, position.strategyId),
      horizon: textValue(position.horizon),
      pair: {
        symbol: textValue(position.symbol),
        venue: textValue(position.venue, marketContext.venue),
        price: Number(marketContext.price),
        source: marketContext.source,
        stale: marketContext.stale,
        ageMs: marketContext.ageMs
      },
      signal
    });
  }

  return {
    ok: true,
    reason: null,
    contexts,
    skipped
  };
}

module.exports = {
  buildTrainingPositionContexts
};
