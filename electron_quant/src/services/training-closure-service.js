(function attachTrainingClosureService(globalScope) {
  function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
  }

  function finiteNumber() {
    for (let index = 0; index < arguments.length; index += 1) {
      const number = Number(arguments[index]);
      if (Number.isFinite(number)) return number;
    }
    return 0;
  }

  function textValue() {
    for (let index = 0; index < arguments.length; index += 1) {
      const value = arguments[index];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  }

  function normalizeSide(value) {
    const side = textValue(value);
    return side ? side.toUpperCase() : null;
  }

  function normalizeOpenPosition(position) {
    const source = isObject(position) ? position : {};
    const direction = normalizeSide(source.direction || source.side);
    return {
      ...source,
      direction: direction || source.direction,
      entry_price: finiteNumber(source.entry_price, source.entryPrice),
      size_demo: finiteNumber(source.size_demo, source.size, source.qty),
      fees_simuladas: finiteNumber(source.fees_simuladas, source.fees),
      spread_estimado: finiteNumber(source.spread_estimado, source.spreadCost),
      slippage_estimado: finiteNumber(source.slippage_estimado, source.slippage)
    };
  }

  function calculateTrainingPnl(position, exitContext) {
    const open = normalizeOpenPosition(position);
    const context = isObject(exitContext) ? exitContext : {};
    const price = finiteNumber(context.price, context.exit_price, context.exitPrice);
    const directionFactor = open.direction === 'LONG' ? 1 : -1;
    const gross = (price - open.entry_price) * directionFactor * open.size_demo;
    const costs = open.fees_simuladas + open.spread_estimado + open.slippage_estimado;
    const pnl = gross - costs;

    return {
      price,
      gross,
      costs,
      pnl
    };
  }

  function exitReasonCode(open, signal) {
    const exitSignal = isObject(signal) ? signal : {};
    if (exitSignal.exit_reason_code) return exitSignal.exit_reason_code;
    return exitSignal.bias !== open.direction ? 'signal_flip_or_edge_loss' : 'demo_risk_management';
  }

  function exitReasonText(open, signal) {
    const exitSignal = isObject(signal) ? signal : {};
    const prefix = exitSignal.bias !== open.direction ? 'Senal opuesta o perdida de edge' : 'Gestion demo por objetivo/riesgo';
    return `${prefix}; confianza actual ${exitSignal.confidence}`;
  }

  function buildClosedTradeFromPosition(position, exitContext, signal, options) {
    const open = normalizeOpenPosition(position);
    const context = isObject(exitContext) ? exitContext : {};
    const closeOptions = isObject(options) ? options : {};
    const pnlResult = calculateTrainingPnl(open, context);
    const closedAt = closeOptions.closedAt || new Date().toISOString();
    const closed = {
      ...open,
      exit_price: pnlResult.price,
      closed_timestamp: closedAt,
      closed_at: closedAt,
      pnl_demo: pnlResult.pnl,
      pnl: pnlResult.pnl,
      exit_reason_code: exitReasonCode(open, signal),
      motivo_salida: exitReasonText(open, signal)
    };

    if (typeof closeOptions.lessonBuilder === 'function') {
      closed.lesson_learned = closeOptions.lessonBuilder(open, context, signal, pnlResult.pnl);
    } else if (Object.prototype.hasOwnProperty.call(open, 'lesson_learned')) {
      closed.lesson_learned = open.lesson_learned;
    }

    return closed;
  }

  function closeTrainingPosition(state, position, exitContext, signal, options) {
    const sourceState = isObject(state) ? state : {};
    const closeOptions = isObject(options) ? options : {};
    const positions = Array.isArray(sourceState.positions) ? sourceState.positions : [];
    const closedTrades = Array.isArray(sourceState.closedTrades) ? sourceState.closedTrades : [];
    const closedTrade = buildClosedTradeFromPosition(position, exitContext, signal, closeOptions);

    return {
      closedTrade,
      nextState: {
        ...sourceState,
        positions: positions.filter((row) => row !== position),
        closedTrades: [closedTrade, ...closedTrades].slice(0, Number(closeOptions.maxClosedTrades || 80))
      }
    };
  }

  globalScope.QuantTrainingClosure = {
    normalizeOpenPosition,
    calculateTrainingPnl,
    buildClosedTradeFromPosition,
    closeTrainingPosition
  };
})(typeof window !== 'undefined' ? window : globalThis);
