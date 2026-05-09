function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function textValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function normalizeSide(value) {
  const side = textValue(value);
  return side ? side.toUpperCase() : null;
}

function normalizeOpenPosition(position = {}) {
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

function calculateTrainingPnl(position = {}, exitContext = {}) {
  const open = normalizeOpenPosition(position);
  const price = finiteNumber(exitContext.price, exitContext.exit_price, exitContext.exitPrice);
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

function exitReasonCode(open = {}, signal = {}) {
  if (signal.exit_reason_code) return signal.exit_reason_code;
  return signal.bias !== open.direction ? 'signal_flip_or_edge_loss' : 'demo_risk_management';
}

function exitReasonText(open = {}, signal = {}) {
  const prefix = signal.bias !== open.direction ? 'Senal opuesta o perdida de edge' : 'Gestion demo por objetivo/riesgo';
  return `${prefix}; confianza actual ${signal.confidence}`;
}

function buildClosedTradeFromPosition(position = {}, exitContext = {}, signal = {}, options = {}) {
  const open = normalizeOpenPosition(position);
  const pnlResult = calculateTrainingPnl(open, exitContext);
  const closedAt = options.closedAt || new Date().toISOString();
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

  if (typeof options.lessonBuilder === 'function') {
    closed.lesson_learned = options.lessonBuilder(open, exitContext, signal, pnlResult.pnl);
  } else if (Object.prototype.hasOwnProperty.call(open, 'lesson_learned')) {
    closed.lesson_learned = open.lesson_learned;
  }

  return closed;
}

function closeTrainingPosition(state = {}, position = {}, exitContext = {}, signal = {}, options = {}) {
  const positions = Array.isArray(state.positions) ? state.positions : [];
  const closedTrades = Array.isArray(state.closedTrades) ? state.closedTrades : [];
  const closedTrade = buildClosedTradeFromPosition(position, exitContext, signal, options);

  return {
    closedTrade,
    nextState: {
      ...state,
      positions: positions.filter((row) => row !== position),
      closedTrades: [closedTrade, ...closedTrades].slice(0, Number(options.maxClosedTrades || 80))
    }
  };
}

module.exports = {
  normalizeOpenPosition,
  calculateTrainingPnl,
  buildClosedTradeFromPosition,
  closeTrainingPosition
};
