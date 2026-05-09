const { computeTrainingMetrics } = require('./metrics-engine');

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function tradePnl(trade = {}) {
  return Number(trade.pnl_demo ?? trade.pnl ?? trade.profit ?? 0) || 0;
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function strategyId(trade = {}) {
  return firstText(trade.strategy_id, trade.strategyId, trade.strategy) || 'unknown';
}

function symbolId(trade = {}) {
  return firstText(trade.symbol, trade.pair, trade.instrument) || 'unknown';
}

function sideId(trade = {}) {
  const side = firstText(trade.direction, trade.side, trade.order_side);
  return side ? side.toUpperCase() : 'unknown';
}

function timeframeId(trade = {}) {
  return firstText(trade.timeframe, trade.tf, trade.period, trade.horizon) || 'unknown';
}

function tradeTimestamp(trade = {}) {
  return firstText(trade.closed_timestamp, trade.closedAt, trade.timestamp, trade.openedAt);
}

function dateId(trade = {}) {
  const ts = tradeTimestamp(trade);
  if (!ts) return 'unknown';
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return 'unknown';
  return parsed.toISOString().slice(0, 10);
}

function sessionId(trade = {}) {
  const explicit = firstText(trade.session, trade.market_session);
  if (explicit) return explicit;

  const ts = tradeTimestamp(trade);
  if (!ts) return 'unknown';
  const parsed = new Date(ts);
  if (Number.isNaN(parsed.getTime())) return 'unknown';

  const hour = parsed.getUTCHours();
  if (hour >= 7 && hour < 12) return 'london';
  if (hour >= 12 && hour < 17) return 'new_york';
  if (hour >= 0 && hour < 7) return 'asia';
  return 'after_hours';
}

function resultId(trade = {}) {
  const pnl = tradePnl(trade);
  if (pnl > 0) return 'win';
  if (pnl < 0) return 'loss';
  return 'breakeven';
}

function pushMissing(missingFields, field, index, trade = {}) {
  missingFields[field].push({
    index,
    symbol: symbolId(trade),
    timestamp: tradeTimestamp(trade) || null
  });
}

function summarizeGroup(id, rows, options = {}) {
  const metrics = computeTrainingMetrics({
    balanceStart: options.balanceStart,
    closedTrades: rows,
    includeStrategyBreakdown: false
  });
  return {
    id,
    sampleSize: metrics.sampleSize,
    wins: metrics.wins,
    losses: metrics.losses,
    breakevens: rows.filter((trade) => resultId(trade) === 'breakeven').length,
    winRate: metrics.winRate,
    expectancy: metrics.expectancy,
    profitFactor: metrics.profitFactor,
    netProfit: metrics.netProfit,
    grossProfit: metrics.grossProfit,
    grossLoss: metrics.grossLoss,
    maxDrawdown: metrics.maxDrawdown,
    maxDrawdownPct: metrics.maxDrawdownPct,
    sharpeApprox: metrics.sharpeApprox
  };
}

function addToGroup(groups, id, trade) {
  if (!groups[id]) groups[id] = [];
  groups[id].push(trade);
}

function summarizeGroups(groups, options = {}) {
  return Object.fromEntries(
    Object.entries(groups).map(([id, rows]) => [id, summarizeGroup(id, rows, options)])
  );
}

function bestBy(groups, field, direction = 'desc') {
  const rows = Object.values(groups).filter((row) => row.sampleSize > 0);
  if (!rows.length) return null;
  return rows.sort((a, b) => {
    const diff = (Number(a[field]) || 0) - (Number(b[field]) || 0);
    return direction === 'asc' ? diff : -diff;
  })[0];
}

function computeTrainingDiagnostics(closedTrades = [], options = {}) {
  const trades = Array.isArray(closedTrades) ? closedTrades : [];
  const groupOptions = {
    balanceStart: options.balanceStart
  };
  const groups = {
    strategy: {},
    symbol: {},
    side: {},
    timeframe: {},
    result: {},
    date: {},
    session: {}
  };
  const missingFields = {
    strategy: [],
    symbol: [],
    side: [],
    timeframe: []
  };

  trades.forEach((trade, index) => {
    const strategy = strategyId(trade);
    const symbol = symbolId(trade);
    const side = sideId(trade);
    const timeframe = timeframeId(trade);
    const result = resultId(trade);
    const date = dateId(trade);
    const session = sessionId(trade);

    if (strategy === 'unknown') pushMissing(missingFields, 'strategy', index, trade);
    if (symbol === 'unknown') pushMissing(missingFields, 'symbol', index, trade);
    if (side === 'unknown') pushMissing(missingFields, 'side', index, trade);
    if (timeframe === 'unknown') pushMissing(missingFields, 'timeframe', index, trade);

    addToGroup(groups.strategy, strategy, trade);
    addToGroup(groups.symbol, symbol, trade);
    addToGroup(groups.side, side, trade);
    addToGroup(groups.timeframe, timeframe, trade);
    addToGroup(groups.result, result, trade);
    addToGroup(groups.date, date, trade);
    addToGroup(groups.session, session, trade);
  });

  const byStrategy = summarizeGroups(groups.strategy, groupOptions);
  const bySymbol = summarizeGroups(groups.symbol, groupOptions);
  const bySide = summarizeGroups(groups.side, groupOptions);
  const byTimeframe = summarizeGroups(groups.timeframe, groupOptions);
  const byResult = summarizeGroups(groups.result, groupOptions);
  const byDate = summarizeGroups(groups.date, groupOptions);
  const bySession = summarizeGroups(groups.session, groupOptions);
  const unknownStrategyTrades = byStrategy.unknown?.sampleSize || 0;

  return {
    summary: {
      totalTrades: trades.length,
      unknownStrategyTrades,
      unknownStrategyRate: trades.length ? round(unknownStrategyTrades / trades.length) : 0,
      bestStrategyByExpectancy: bestBy(byStrategy, 'expectancy'),
      worstStrategyByExpectancy: bestBy(byStrategy, 'expectancy', 'asc'),
      bestSymbol: bestBy(bySymbol, 'expectancy'),
      worstSymbol: bestBy(bySymbol, 'expectancy', 'asc'),
      longVsShortPerformance: bySide,
      profitFactorByStrategy: Object.fromEntries(
        Object.entries(byStrategy).map(([id, row]) => [id, row.profitFactor])
      ),
      drawdownByStrategy: Object.fromEntries(
        Object.entries(byStrategy).map(([id, row]) => [id, {
          maxDrawdown: row.maxDrawdown,
          maxDrawdownPct: row.maxDrawdownPct
        }])
      )
    },
    byStrategy,
    bySymbol,
    bySide,
    byTimeframe,
    byResult,
    byDate,
    bySession,
    missingFields
  };
}

module.exports = {
  computeTrainingDiagnostics
};
