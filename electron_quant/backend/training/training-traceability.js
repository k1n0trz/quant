function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function firstFinite(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function hasCausalMetadata(trade = {}) {
  const trace = isObject(trade.trace) ? trade.trace : {};
  return Boolean(
    firstText(trade.strategy_id, trade.strategyId, trade.strategy, trace.strategy_id, trace.strategyId, trace.strategy) ||
    firstText(trade.signal_id, trade.signalId, trace.signal_id, trace.signalId) ||
    firstText(trade.entry_reason_code, trace.entry_reason_code) ||
    firstText(trade.exit_reason_code, trace.exit_reason_code) ||
    firstText(trade.risk_profile_id, trace.risk_profile_id) ||
    firstText(trade.source, trace.source) ||
    Number.isFinite(Number(trade.traceability_version))
  );
}

function maybeSetText(target, key, ...values) {
  const value = firstText(...values);
  if (value) target[key] = value;
}

function maybeSetNumber(target, key, ...values) {
  const value = firstFinite(...values);
  if (value !== null) target[key] = value;
}

function calculatePnlPct(trade, side, pnl) {
  const explicit = firstFinite(trade.pnl_pct, trade.pnlPct);
  if (explicit !== null) return explicit;

  const notional = firstFinite(trade.notional_demo, trade.notional, trade.size_usd);
  if (notional && pnl !== null) return pnl / Math.abs(notional);

  const entry = firstFinite(trade.entry_price, trade.entryPrice);
  const exit = firstFinite(trade.exit_price, trade.exitPrice);
  if (!entry || exit === null || !side) return null;
  const directionFactor = side === 'SHORT' ? -1 : 1;
  return ((exit - entry) / entry) * directionFactor;
}

function normalizeClosedTradeTrace(trade = {}) {
  const source = isObject(trade) ? trade : {};
  const normalized = { ...source };
  if (!hasCausalMetadata(source)) return normalized;

  const trace = isObject(source.trace) ? source.trace : {};
  const side = firstText(source.side, source.direction, trace.side, trace.direction);
  const pnl = firstFinite(source.pnl, source.pnl_demo, source.profit, trace.pnl);

  normalized.traceability_version = Number(source.traceability_version || 1);
  maybeSetText(normalized, 'strategy_id', source.strategy_id, source.strategyId, source.strategy, trace.strategy_id, trace.strategyId, trace.strategy);
  maybeSetText(normalized, 'strategy_name', source.strategy_name, source.strategyName, trace.strategy_name, trace.strategyName);
  maybeSetText(normalized, 'signal_id', source.signal_id, source.signalId, trace.signal_id, trace.signalId);
  maybeSetText(normalized, 'timeframe', source.timeframe, source.tf, source.period, trace.timeframe, trace.tf, trace.period);
  maybeSetText(normalized, 'horizon', source.horizon, trace.horizon);
  maybeSetText(normalized, 'session', source.session, source.market_session, trace.session, trace.market_session);
  maybeSetText(normalized, 'entry_reason_code', source.entry_reason_code, trace.entry_reason_code);
  maybeSetText(normalized, 'exit_reason_code', source.exit_reason_code, trace.exit_reason_code);
  maybeSetText(normalized, 'risk_profile_id', source.risk_profile_id, trace.risk_profile_id);
  maybeSetText(normalized, 'source', source.source, trace.source);
  maybeSetText(normalized, 'opened_at', source.opened_at, source.openedAt, source.timestamp, trace.opened_at, trace.openedAt);
  maybeSetText(normalized, 'closed_at', source.closed_at, source.closedAt, source.closed_timestamp, trace.closed_at, trace.closedAt);
  maybeSetText(normalized, 'symbol', source.symbol, source.pair, source.instrument, trace.symbol);
  maybeSetText(normalized, 'side', side);
  maybeSetNumber(normalized, 'pnl', pnl);

  const pnlPct = calculatePnlPct(source, side ? side.toUpperCase() : null, pnl);
  if (pnlPct !== null) normalized.pnl_pct = pnlPct;

  maybeSetNumber(normalized, 'confidence_at_entry', source.confidence_at_entry, source.confidenceAtEntry, source.confidence, trace.confidence_at_entry);
  maybeSetText(normalized, 'regime_at_entry', source.regime_at_entry, source.regimeAtEntry, source.regime, trace.regime_at_entry);
  maybeSetNumber(normalized, 'volatility_at_entry', source.volatility_at_entry, source.volatilityAtEntry, source.volatilityPct, source.volatility_pct, trace.volatility_at_entry);

  if (normalized.side) normalized.side = normalized.side.toUpperCase();
  return normalized;
}

function normalizeTrainingStateTraceability(state = {}) {
  const source = isObject(state) ? state : {};
  const closedTrades = Array.isArray(source.closedTrades)
    ? source.closedTrades.map((trade) => normalizeClosedTradeTrace(trade))
    : source.closedTrades;

  return {
    ...source,
    closedTrades
  };
}

module.exports = {
  normalizeClosedTradeTrace,
  normalizeTrainingStateTraceability
};
