const { applyAtomicTrainingDemoClose } = require('./training-atomic-close-service');
const { createTrainingStateSnapshot } = require('./training-state');
const {
  isTrainingBackendDemoEntryEnabled,
  evaluateTrainingDemoEntries
} = require('./training-demo-entry-service');

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function textValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function sameText(left, right) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return String(left).trim().toUpperCase() === String(right).trim().toUpperCase();
}

function isTrainingBackendLoopEnabled(env = {}) {
  return String(env.TRAINING_BACKEND_LOOP_ENABLED || 'false').toLowerCase() === 'true';
}

function buildTickId(now = new Date()) {
  return `tick_${now.toISOString().replace(/[-:.TZ]/g, '')}`;
}

function resolveTargetOpenPositions(state = {}) {
  return Number(
    state.targetOpenPositions
    || state.targets?.total
    || 20
  );
}

function findPositionContext(position, contexts = []) {
  const positionId = textValue(position.id);
  const signalId = textValue(position.signal_id, position.signalId);

  for (const context of contexts) {
    if (!isObject(context)) continue;
    if (positionId && sameText(context.positionId, positionId)) return context;
    if (signalId && sameText(context.signalId, signalId)) return context;
    const pair = isObject(context.pair) ? context.pair : {};
    if (
      sameText(pair.symbol, position.symbol)
      && sameText(pair.venue, position.venue)
      && (textValue(context.horizon) ? sameText(context.horizon, position.horizon) : true)
    ) return context;
  }
  return null;
}

function evaluateCloseDecision(position, context, state, nowMs) {
  const pair = isObject(context?.pair) ? context.pair : {};
  const liveSignal = isObject(context?.signal) ? context.signal : {};
  const price = finiteNumber(pair.price, pair.exit_price, pair.exitPrice);
  if (price === null) {
    return { ok: false, reason: 'missing_price' };
  }

  const directionFactor = position.direction === 'LONG' ? 1 : -1;
  const pnlPct = ((price - Number(position.entry_price || 0)) / Math.max(Number(position.entry_price || 0), 1e-12)) * directionFactor;
  const age = nowMs - Number(position.opened_tick || nowMs);
  const minHold = Number(position.min_hold_ms || 4 * 60 * 60000);
  const maxHold = Number(position.max_hold_ms || 16 * 60 * 60000);
  const hardStop = pnlPct <= (position.horizon === 'swing' ? -0.018 : -0.009);
  const profitTarget = pnlPct >= (position.horizon === 'swing' ? 0.035 : 0.012);
  const signalBias = textValue(liveSignal.bias) || position.direction;
  const signalConfidence = Number.isFinite(Number(liveSignal.confidence)) ? Number(liveSignal.confidence) : 100;
  const signalExit = age >= minHold && (signalBias !== position.direction || signalConfidence < 55);
  const timeExit = age >= maxHold;
  const protectContinuousTraining = (Array.isArray(state.positions) ? state.positions.length : 0) <= Math.max(2, resolveTargetOpenPositions(state) - 2);
  const shouldClose = hardStop || profitTarget || signalExit || timeExit;

  if (!shouldClose) {
    return { ok: true, shouldClose: false, reason: 'not_closable' };
  }
  if (shouldClose && protectContinuousTraining && !hardStop) {
    return { ok: true, shouldClose: false, reason: 'protected_continuous_training' };
  }

  return {
    ok: true,
    shouldClose: true,
    exitContext: {
      price,
      symbol: pair.symbol || position.symbol,
      venue: pair.venue || position.venue
    },
    signal: {
      ...liveSignal,
      bias: signalBias,
      confidence: signalConfidence
    }
  };
}

async function runTrainingDemoTick(input = {}) {
  const source = isObject(input) ? input : {};
  const snapshot = createTrainingStateSnapshot(source.state, { source: 'training-loop-service' });
  if (!snapshot.available) {
    return {
      ok: false,
      reason: snapshot.reason || 'training_state_shape_incompatible'
    };
  }

  const nowMs = Number.isFinite(Number(source.nowMs)) ? Number(source.nowMs) : Date.now();
  const tickId = buildTickId(new Date(nowMs));
  const contexts = Array.isArray(source.positionContexts) ? source.positionContexts.slice() : [];
  const balanceBefore = Number(snapshot.state.balance || 0);
  let nextState = snapshot.state;
  let evaluatedPositions = 0;
  let closedPositions = 0;
  let openedPositions = 0;
  let lessonPendingCount = 0;
  const skippedPositions = [];
  const skippedEntries = [];
  const entryEnabled = isTrainingBackendDemoEntryEnabled(source.env || {});

  const openPositions = (Array.isArray(snapshot.state.positions) ? snapshot.state.positions : []).filter((position) => !position.exit_price);
  for (const openPosition of openPositions) {
    const context = findPositionContext(openPosition, contexts);
    if (!context) {
      skippedPositions.push({ id: openPosition.id || null, signal_id: openPosition.signal_id || null, reason: 'missing_context' });
      continue;
    }

    evaluatedPositions += 1;
    const decision = evaluateCloseDecision(openPosition, context, nextState, nowMs);
    if (!decision.ok) {
      skippedPositions.push({ id: openPosition.id || null, signal_id: openPosition.signal_id || null, reason: decision.reason });
      continue;
    }
    if (!decision.shouldClose) {
      skippedPositions.push({ id: openPosition.id || null, signal_id: openPosition.signal_id || null, reason: decision.reason });
      continue;
    }

    const atomicResult = applyAtomicTrainingDemoClose({
      state: nextState,
      openPosition,
      exitContext: decision.exitContext,
      signal: decision.signal,
      options: {
        closedAt: new Date(nowMs).toISOString()
      }
    });
    if (!atomicResult.ok) {
      skippedPositions.push({ id: openPosition.id || null, signal_id: openPosition.signal_id || null, reason: atomicResult.reason });
      continue;
    }

    nextState = atomicResult.nextState;
    closedPositions += 1;
    if (atomicResult.lessonPending) lessonPendingCount += 1;
  }

  if (entryEnabled) {
    const entryResult = await evaluateTrainingDemoEntries({
      state: nextState,
      deps: source.deps || {},
      env: source.env || {},
      nowMs
    });
    if (entryResult.ok) {
      nextState = entryResult.nextState;
      openedPositions = entryResult.openedEntries.length;
      skippedEntries.push(...entryResult.skippedEntries);
    }
  }

  return {
    ok: true,
    tickId,
    evaluatedPositions,
    closedPositions,
    openedPositions,
    skippedPositions,
    skippedEntries,
    balanceBefore,
    balanceAfter: Number(nextState.balance || balanceBefore),
    lessonPendingCount,
    entryEnabled,
    nextState
  };
}

module.exports = {
  isTrainingBackendLoopEnabled,
  runTrainingDemoTick
};
