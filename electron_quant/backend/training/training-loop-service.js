const { applyAtomicTrainingDemoClose } = require('./training-atomic-close-service');
const { createTrainingStateSnapshot } = require('./training-state');
const { buildMt5ProtectionLevels } = require('../adapters/mt5/mt5-protection-policy');
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

function isTrainingMt5DemoCloseEnabled(env = {}) {
  const explicit = env.TRAINING_MT5_DEMO_CLOSE_ENABLED;
  if (explicit != null) return String(explicit || 'false').toLowerCase() === 'true';
  return String(env.TRAINING_MT5_DEMO_ORDER_SEND_ENABLED || 'false').toLowerCase() === 'true';
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

function activeUniverseSignature(state = {}) {
  const pairs = Array.isArray(state.activePairs) ? state.activePairs : [];
  return pairs
    .map((pair) => `${String(pair.venue || 'BINANCE').toUpperCase()}:${String(pair.symbol || '').toUpperCase()}`)
    .join('|');
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

function mt5DemoExecutionTicket(position = {}) {
  return finiteNumber(
    position.mt5_demo_execution?.ticket,
    position.mt5DemoExecution?.ticket,
    position.mt5_ticket,
    position.mt5Ticket
  );
}

function mt5DemoExecutionVolume(position = {}) {
  return finiteNumber(
    position.mt5_demo_execution?.volume,
    position.mt5DemoExecution?.volume,
    position.mt5_lots,
    position.mt5Lots
  );
}

function requiresMt5DemoBridgeClose(position = {}) {
  if (!sameText(position.venue, 'MT5')) return false;
  const execution = isObject(position.mt5_demo_execution) ? position.mt5_demo_execution : position.mt5DemoExecution;
  if (!isObject(execution)) return false;
  const ticket = mt5DemoExecutionTicket(position);
  return Boolean(
    ticket && ticket > 0
    && execution.ok !== false
    && execution.demoOnly !== false
    && execution.realTradingTouched !== true
  );
}

function compactMt5DemoCloseResult(result = {}) {
  return {
    attempted: true,
    ok: Boolean(result.ok),
    reason: result.reason || null,
    ticket: finiteNumber(result.ticket, result.close?.ticket),
    deal: finiteNumber(result.deal),
    retcode: finiteNumber(result.retcode),
    bridge: Boolean(result.bridge),
    demoOnly: result.demoOnly !== false,
    realTradingTouched: false
  };
}

function requiresMt5DemoBridgeOpen(position = {}, nowMs = Date.now()) {
  if (!sameText(position.venue, 'MT5')) return false;
  const execution = isObject(position.mt5_demo_execution) ? position.mt5_demo_execution : position.mt5DemoExecution;
  const ticket = mt5DemoExecutionTicket(position);
  if (ticket && ticket > 0 && execution?.ok !== false && execution?.realTradingTouched !== true) return false;
  const attemptedAt = Date.parse(execution?.attemptedAt || execution?.lastAttemptAt || 0) || 0;
  if (attemptedAt && nowMs - attemptedAt < 10 * 60 * 1000 && execution?.ok === false && execution?.reason !== 'TRAINING_MT5_DEMO_ORDER_SEND_ENABLED=false') {
    return false;
  }
  return true;
}

function compactMt5DemoOpenResult(result = {}, volume = null) {
  return {
    attempted: true,
    ok: Boolean(result.ok),
    reason: result?.ok ? null : (result.reason || result.error || 'mt5_demo_order_failed'),
    ticket: finiteNumber(result.ticket, result.order?.ticket),
    deal: finiteNumber(result.deal),
    retcode: finiteNumber(result.retcode),
    volume,
    bridge: Boolean(result.bridge),
    demoOnly: result.demoOnly !== false,
    realTradingTouched: false,
    attemptedAt: new Date().toISOString()
  };
}

async function openMt5DemoBridgePosition(openPosition, source = {}, nowMs = Date.now()) {
  if (!requiresMt5DemoBridgeOpen(openPosition, nowMs)) return { required: false, result: null };
  const env = source.env || {};
  const deps = source.deps || {};
  if (String(env.TRAINING_MT5_DEMO_ORDER_SEND_ENABLED || 'false').toLowerCase() !== 'true') {
    return {
      required: true,
      ok: false,
      reason: 'TRAINING_MT5_DEMO_ORDER_SEND_ENABLED=false',
      result: compactMt5DemoOpenResult({ ok: false, reason: 'TRAINING_MT5_DEMO_ORDER_SEND_ENABLED=false', demoOnly: true }, null)
    };
  }
  if (typeof deps.placeMt5DemoOrder !== 'function') {
    return {
      required: true,
      ok: false,
      reason: 'mt5_demo_order_executor_missing',
      result: compactMt5DemoOpenResult({ ok: false, reason: 'mt5_demo_order_executor_missing', demoOnly: true }, null)
    };
  }
  const demoSide = openPosition.direction === 'LONG' ? 'BUY' : openPosition.direction === 'SHORT' ? 'SELL' : null;
  if (!demoSide) {
    return {
      required: true,
      ok: false,
      reason: 'unsupported_training_direction',
      result: compactMt5DemoOpenResult({ ok: false, reason: 'unsupported_training_direction', demoOnly: true }, null)
    };
  }
  const demoLots = finiteNumber(env.TRAINING_MT5_DEMO_LOT_SIZE, 0.01) || 0.01;
  try {
    const protection = buildMt5ProtectionLevels({
      symbol: openPosition.symbol,
      side: demoSide,
      entryPrice: openPosition.entry_price
    }, env);
    if (!protection.ok) {
      return {
        required: true,
        ok: false,
        reason: protection.reason,
        result: compactMt5DemoOpenResult({ ok: false, reason: protection.reason, demoOnly: true }, demoLots)
      };
    }
    const result = await deps.placeMt5DemoOrder({
      symbol: openPosition.symbol,
      side: demoSide,
      volume: demoLots,
      type: 'MARKET',
      entryPrice: openPosition.entry_price,
      stopLoss: protection.stopLoss,
      takeProfit: protection.takeProfit,
      reason: 'training-demo-existing-position',
      trainingPositionId: openPosition.id || null
    });
    return {
      required: true,
      ok: Boolean(result?.ok),
      reason: result?.ok ? null : (result?.reason || 'mt5_demo_order_failed'),
      result: compactMt5DemoOpenResult(result || {}, demoLots)
    };
  } catch (error) {
    return {
      required: true,
      ok: false,
      reason: String(error?.message || error),
      result: compactMt5DemoOpenResult({ ok: false, reason: String(error?.message || error), demoOnly: true }, demoLots)
    };
  }
}

async function closeMt5DemoBridgePosition(openPosition, source = {}) {
  if (!requiresMt5DemoBridgeClose(openPosition)) return { required: false, result: null };
  const env = source.env || {};
  const deps = source.deps || {};
  if (!isTrainingMt5DemoCloseEnabled(env)) {
    return { required: true, ok: false, reason: 'mt5_demo_close_disabled' };
  }
  if (typeof deps.closeMt5DemoPosition !== 'function') {
    return { required: true, ok: false, reason: 'mt5_demo_close_executor_missing' };
  }
  try {
    const result = await deps.closeMt5DemoPosition({
      ticket: mt5DemoExecutionTicket(openPosition),
      symbol: openPosition.symbol,
      volume: mt5DemoExecutionVolume(openPosition),
      reason: 'training-demo-close',
      trainingPositionId: openPosition.id || null
    });
    return {
      required: true,
      ok: Boolean(result?.ok),
      reason: result?.ok ? null : (result?.reason || 'mt5_demo_close_failed'),
      result: compactMt5DemoCloseResult(result || {})
    };
  } catch (error) {
    return {
      required: true,
      ok: false,
      reason: String(error?.message || error),
      result: {
        attempted: true,
        ok: false,
        reason: String(error?.message || error),
        ticket: mt5DemoExecutionTicket(openPosition),
        deal: null,
        retcode: null,
        bridge: false,
        demoOnly: true,
        realTradingTouched: false
      }
    };
  }
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
  const shouldClose = hardStop || profitTarget || signalExit || timeExit;

  if (!shouldClose) return { ok: true, shouldClose: false, reason: 'not_closable' };

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
  const activeUniverseBefore = activeUniverseSignature(snapshot.state);
  let nextState = snapshot.state;
  let evaluatedPositions = 0;
  let closedPositions = 0;
  let openedPositions = 0;
  let mt5DemoOrdersAttempted = 0;
  let mt5DemoOrdersSent = 0;
  let mt5DemoOrdersFailed = 0;
  let lessonPendingCount = 0;
  const skippedPositions = [];
  const skippedEntries = [];
  const entryEnabled = isTrainingBackendDemoEntryEnabled(source.env || {});

  const openPositions = (Array.isArray(snapshot.state.positions) ? snapshot.state.positions : []).filter((position) => !position.exit_price);
  for (const openPosition of openPositions) {
    let workingPosition = openPosition;
    const mt5Open = await openMt5DemoBridgePosition(workingPosition, source, nowMs);
    if (mt5Open.required) {
      mt5DemoOrdersAttempted += 1;
      if (mt5Open.ok) mt5DemoOrdersSent += 1;
      else mt5DemoOrdersFailed += 1;
      const positions = Array.isArray(nextState.positions) ? nextState.positions.slice() : [];
      const index = positions.findIndex((position) => (
        (workingPosition.id && sameText(position.id, workingPosition.id))
        || (workingPosition.signal_id && sameText(position.signal_id, workingPosition.signal_id))
        || (sameText(position.venue, workingPosition.venue) && sameText(position.symbol, workingPosition.symbol) && sameText(position.horizon || 'intraday', workingPosition.horizon || 'intraday'))
      ));
      if (index >= 0) {
        positions[index] = {
          ...positions[index],
          mt5_demo_execution: mt5Open.result
        };
        nextState = { ...nextState, positions };
        workingPosition = positions[index];
      }
    }

    const context = findPositionContext(workingPosition, contexts);
    if (!context) {
      skippedPositions.push({ id: workingPosition.id || null, signal_id: workingPosition.signal_id || null, reason: 'missing_context' });
      continue;
    }

    evaluatedPositions += 1;
    const decision = evaluateCloseDecision(workingPosition, context, nextState, nowMs);
    if (!decision.ok) {
      skippedPositions.push({ id: workingPosition.id || null, signal_id: workingPosition.signal_id || null, reason: decision.reason });
      continue;
    }
    if (!decision.shouldClose) {
      skippedPositions.push({ id: workingPosition.id || null, signal_id: workingPosition.signal_id || null, reason: decision.reason });
      continue;
    }

    const mt5Close = await closeMt5DemoBridgePosition(workingPosition, source);
    if (mt5Close.required && !mt5Close.ok) {
      skippedPositions.push({
        id: workingPosition.id || null,
        signal_id: workingPosition.signal_id || null,
        reason: mt5Close.reason || 'mt5_demo_close_failed',
        mt5_demo_close: mt5Close.result || null
      });
      continue;
    }

    const atomicResult = applyAtomicTrainingDemoClose({
      state: nextState,
      openPosition: workingPosition,
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
    if (mt5Close.result) {
      const closedTrades = Array.isArray(nextState.closedTrades) ? nextState.closedTrades.slice() : [];
      if (closedTrades[0]) {
        closedTrades[0] = {
          ...closedTrades[0],
          mt5_demo_close: mt5Close.result
        };
        nextState = {
          ...nextState,
          closedTrades
        };
      }
    }
    closedPositions += 1;
    if (atomicResult.lessonPending) lessonPendingCount += 1;
  }

  if (entryEnabled && closedPositions > 0) {
    skippedEntries.push({
      reason: 'entry_paused_after_close',
      closedPositions
    });
  } else if (entryEnabled) {
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

  // Protect: set SL/TP on any already-open demo position left naked by the
  // broker (rejected stops, price moved). A demo position must never be unguarded.
  let protectionSweep = null;
  if (typeof source.deps?.runProtectionSweep === 'function') {
    try {
      protectionSweep = await source.deps.runProtectionSweep();
    } catch (error) {
      protectionSweep = { ok: false, ran: false, reason: 'protection_sweep_exception', error: String(error?.message || error) };
    }
  }

  return {
    ok: true,
    tickId,
    evaluatedPositions,
    closedPositions,
    openedPositions,
    mt5DemoOrdersAttempted,
    mt5DemoOrdersSent,
    mt5DemoOrdersFailed,
    protectionSweep,
    skippedPositions,
    skippedEntries,
    balanceBefore,
    balanceAfter: Number(nextState.balance || balanceBefore),
    lessonPendingCount,
    entryEnabled,
    activeUniverseChanged: activeUniverseSignature(nextState) !== activeUniverseBefore,
    nextState
  };
}

module.exports = {
  isTrainingBackendLoopEnabled,
  isTrainingMt5DemoCloseEnabled,
  runTrainingDemoTick
};
