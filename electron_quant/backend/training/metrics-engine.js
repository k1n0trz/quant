function round(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function tradePnl(trade) {
  return Number(trade?.pnl_demo ?? trade?.pnl ?? trade?.profit ?? 0) || 0;
}

function computeEquityCurve(trades, balanceStart = 0) {
  let equity = Number(balanceStart) || 0;
  return trades.map((trade) => {
    equity += tradePnl(trade);
    return round(equity, 2);
  });
}

function computeMaxDrawdown(equityCurve, balanceStart = 0) {
  let peak = Number(balanceStart) || 0;
  let maxDrawdown = 0;
  for (const equity of equityCurve) {
    if (equity > peak) peak = equity;
    const drawdown = Math.max(0, peak - equity);
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  const denominator = Math.max(Math.abs(Number(balanceStart) || 0), 1);
  return {
    maxDrawdown: round(maxDrawdown, 2),
    maxDrawdownPct: round((maxDrawdown / denominator) * 100, 4)
  };
}

function computeSharpeApprox(pnls) {
  if (pnls.length < 2) return 0;
  const mean = pnls.reduce((sum, value) => sum + value, 0) / pnls.length;
  const variance = pnls.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (pnls.length - 1);
  const stdev = Math.sqrt(variance);
  if (!stdev) return 0;
  return round((mean / stdev) * Math.sqrt(pnls.length), 3);
}

function computeEdgeDegradation(trades) {
  if (trades.length < 10) {
    return {
      status: 'insufficient_sample',
      isWinRate: null,
      oosWinRate: null,
      degradationPct: null
    };
  }
  const split = Math.floor(trades.length * 0.7);
  const ins = trades.slice(0, split);
  const oos = trades.slice(split);
  const wr = (rows) => rows.filter((trade) => tradePnl(trade) >= 0).length / Math.max(rows.length, 1);
  const isWinRate = wr(ins);
  const oosWinRate = wr(oos);
  const degradationPct = isWinRate > 0 ? ((isWinRate - oosWinRate) / isWinRate) * 100 : 0;
  return {
    status: degradationPct > 25 ? 'degrading' : 'stable',
    isWinRate: round(isWinRate, 4),
    oosWinRate: round(oosWinRate, 4),
    degradationPct: round(Math.max(0, degradationPct), 2)
  };
}

function groupByStrategy(trades, options = {}) {
  const groups = {};
  for (const trade of trades) {
    const id = trade?.strategy_id || trade?.strategyId || trade?.trace?.strategy_id || trade?.trace?.strategyId || 'unknown';
    if (!groups[id]) groups[id] = [];
    groups[id].push(trade);
  }
  const out = {};
  for (const [id, rows] of Object.entries(groups)) {
    out[id] = computeTrainingMetrics({ ...options, closedTrades: rows, includeStrategyBreakdown: false });
  }
  return out;
}

function computeTrainingMetrics(input = {}) {
  const closedTrades = Array.isArray(input.closedTrades) ? input.closedTrades : [];
  const balanceStart = Number(input.balanceStart || 0);
  const minimumSampleSize = Number(input.minimumSampleSize || 30);
  const pnls = closedTrades.map(tradePnl);
  const wins = pnls.filter((value) => value >= 0);
  const losses = pnls.filter((value) => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  const netProfit = pnls.reduce((sum, value) => sum + value, 0);
  const sampleSize = closedTrades.length;
  const winRate = sampleSize ? wins.length / sampleSize : 0;
  const avgWin = wins.length ? grossProfit / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const equityCurve = computeEquityCurve(closedTrades, balanceStart);
  const drawdown = computeMaxDrawdown(equityCurve, balanceStart);
  const edgeDegradation = computeEdgeDegradation(closedTrades);
  const sampleRatio = Math.min(1, sampleSize / Math.max(minimumSampleSize, 1));
  const pfScore = Math.min(1, (Number.isFinite(profitFactor) ? profitFactor : 3) / 2);
  const ddPenalty = Math.min(1, drawdown.maxDrawdownPct / 25);
  const stabilityScore = round(Math.max(0, Math.min(100, (sampleRatio * 55) + (pfScore * 35) + ((1 - ddPenalty) * 10))), 2);

  return {
    sampleSize,
    sampleStatus: sampleSize >= minimumSampleSize ? 'sufficient' : 'insufficient',
    wins: wins.length,
    losses: losses.length,
    winRate: round(winRate, 4),
    grossProfit: round(grossProfit, 2),
    grossLoss: round(grossLoss, 2),
    netProfit: round(netProfit, 2),
    profitFactor: Number.isFinite(profitFactor) ? round(profitFactor, 3) : 999,
    expectancy: round(expectancy, 4),
    avgWin: round(avgWin, 2),
    avgLoss: round(avgLoss, 2),
    equityCurve,
    sharpeApprox: computeSharpeApprox(pnls),
    edgeDegradation,
    stabilityScore,
    confidenceScore: round(Math.max(0, Math.min(100, (stabilityScore * 0.7) + (sampleRatio * 30))), 2),
    ...drawdown,
    byStrategy: input.includeStrategyBreakdown === false ? {} : groupByStrategy(closedTrades, input)
  };
}

module.exports = {
  computeTrainingMetrics,
  computeEquityCurve,
  computeMaxDrawdown
};
