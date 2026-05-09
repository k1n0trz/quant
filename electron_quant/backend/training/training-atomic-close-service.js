const { buildClosedTradeFromPosition, normalizeOpenPosition } = require('./training-closure-service');
const { createTrainingStateSnapshot } = require('./training-state');

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function finiteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function sameText(left, right) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return String(left).trim().toUpperCase() === String(right).trim().toUpperCase();
}

function removeAtIndex(items, index) {
  return items.filter((_, currentIndex) => currentIndex !== index);
}

function matchingIndices(positions, predicate) {
  const matches = [];
  for (let index = 0; index < positions.length; index += 1) {
    if (predicate(positions[index], index)) matches.push(index);
  }
  return matches;
}

function findUniqueMatchIndex(positions, openPosition) {
  const normalizedOpen = normalizeOpenPosition(openPosition);

  const byExactReference = positions.indexOf(openPosition);
  if (byExactReference >= 0) return { ok: true, index: byExactReference };

  const openId = firstText(openPosition?.id, normalizedOpen.id);
  if (openId) {
    const byId = matchingIndices(positions, (position) => sameText(position?.id, openId));
    if (byId.length === 1) return { ok: true, index: byId[0] };
    if (byId.length > 1) return { ok: false, reason: 'open_position_not_unique' };
  }

  const signalId = firstText(openPosition?.signal_id, openPosition?.signalId, normalizedOpen.signal_id, normalizedOpen.signalId);
  if (signalId) {
    const bySignalId = matchingIndices(positions, (position) => sameText(position?.signal_id || position?.signalId, signalId));
    if (bySignalId.length === 1) return { ok: true, index: bySignalId[0] };
    if (bySignalId.length > 1) return { ok: false, reason: 'open_position_not_unique' };
  }

  const openedTick = finiteNumber(openPosition?.opened_tick, openPosition?.openedTick, normalizedOpen.opened_tick, normalizedOpen.openedTick);
  if (openedTick !== null) {
    const byOpenedTick = matchingIndices(positions, (position) => finiteNumber(position?.opened_tick, position?.openedTick) === openedTick);
    if (byOpenedTick.length === 1) return { ok: true, index: byOpenedTick[0] };
    if (byOpenedTick.length > 1) return { ok: false, reason: 'open_position_not_unique' };
  }

  const compositeMatches = matchingIndices(positions, (position) => {
    const normalizedPosition = normalizeOpenPosition(position);
    if (!sameText(normalizedPosition.symbol, normalizedOpen.symbol)) return false;
    if (!sameText(normalizedPosition.direction, normalizedOpen.direction)) return false;
    if (!sameText(normalizedPosition.venue, normalizedOpen.venue)) return false;
    if (finiteNumber(normalizedPosition.entry_price) !== finiteNumber(normalizedOpen.entry_price)) return false;
    if (finiteNumber(normalizedPosition.size_demo) !== finiteNumber(normalizedOpen.size_demo)) return false;

    const leftTimestamp = firstText(normalizedPosition.timestamp, normalizedPosition.opened_at);
    const rightTimestamp = firstText(normalizedOpen.timestamp, normalizedOpen.opened_at);
    if ((leftTimestamp || rightTimestamp) && !sameText(leftTimestamp, rightTimestamp)) return false;

    const leftHorizon = firstText(normalizedPosition.horizon);
    const rightHorizon = firstText(normalizedOpen.horizon);
    if ((leftHorizon || rightHorizon) && !sameText(leftHorizon, rightHorizon)) return false;

    return true;
  });

  if (compositeMatches.length === 1) return { ok: true, index: compositeMatches[0] };
  if (compositeMatches.length > 1) return { ok: false, reason: 'open_position_not_unique' };
  return { ok: false, reason: 'open_position_not_found' };
}

function applyAtomicTrainingDemoClose(input = {}) {
  const source = isObject(input) ? input : {};
  const snapshot = createTrainingStateSnapshot(source.state, { source: 'training-atomic-close-service' });
  if (!snapshot.available) {
    return {
      ok: false,
      reason: snapshot.reason || 'training_state_shape_incompatible',
      writesPerformed: false
    };
  }

  const state = snapshot.state;
  const openPosition = isObject(source.openPosition) ? source.openPosition : null;
  if (!openPosition) {
    return {
      ok: false,
      reason: 'open_position_object_required',
      writesPerformed: false
    };
  }

  const positions = Array.isArray(state.positions) ? state.positions : [];
  const positionMatch = findUniqueMatchIndex(positions, openPosition);
  if (!positionMatch.ok) {
    return {
      ok: false,
      reason: positionMatch.reason,
      writesPerformed: false
    };
  }

  const exitContext = isObject(source.exitContext) ? source.exitContext : {};
  const signal = isObject(source.signal) ? source.signal : {};
  const options = isObject(source.options) ? source.options : {};
  const removedPosition = positions[positionMatch.index];
  const closedTrade = buildClosedTradeFromPosition(openPosition, exitContext, signal, {
    closedAt: options.closedAt,
    lessonBuilder: typeof options.lessonBuilder === 'function' ? options.lessonBuilder : undefined
  });

  const existingLessons = Array.isArray(state.lessons) ? state.lessons.slice() : [];
  const lesson = closedTrade.lesson_learned;
  const lessonPending = !isObject(lesson);
  const nextLessons = lessonPending
    ? existingLessons
    : [lesson, ...existingLessons].slice(0, Number(options.maxLessons || 160));

  const nextState = {
    ...state,
    positions: removeAtIndex(positions, positionMatch.index),
    closedTrades: [closedTrade, ...(Array.isArray(state.closedTrades) ? state.closedTrades : [])]
      .slice(0, Number(options.maxClosedTrades || 80)),
    lessons: nextLessons,
    balance: Number(state.balance || 0) + Number(closedTrade.pnl_demo || closedTrade.pnl || 0),
    persistedAt: options.persistedAt || new Date().toISOString()
  };

  return {
    ok: true,
    closedTrade,
    removedPosition,
    nextState,
    lessonPending,
    lessonPendingReason: lessonPending ? 'Equivalent backend lesson is unavailable without renderer lesson builder.' : null,
    summary: {
      positions: nextState.positions.length,
      closedTrades: nextState.closedTrades.length,
      lessons: nextState.lessons.length,
      balance: nextState.balance
    }
  };
}

module.exports = {
  applyAtomicTrainingDemoClose
};
