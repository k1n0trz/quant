const test = require('node:test');
const assert = require('node:assert/strict');

const { computeTrainingMetrics } = require('../backend/training/metrics-engine');
const { computeTrainingDiagnostics } = require('../backend/training/training-diagnostics');
const { createStrategyRegistry } = require('../backend/training/strategy-registry');
const { runStrategyPortfolio } = require('../backend/training/strategy-runner');

test('computes core trading metrics from closed demo trades', () => {
  const metrics = computeTrainingMetrics({
    balanceStart: 100000,
    closedTrades: [
      { symbol: 'BTCUSDT', strategy_id: 'trendMomentum', pnl_demo: 10, closed_timestamp: '2026-05-01T00:00:00.000Z' },
      { symbol: 'BTCUSDT', strategy_id: 'trendMomentum', pnl_demo: -5, closed_timestamp: '2026-05-01T01:00:00.000Z' },
      { symbol: 'ETHUSDT', strategy_id: 'breakoutRetest', pnl_demo: 15, closed_timestamp: '2026-05-01T02:00:00.000Z' },
      { symbol: 'ETHUSDT', strategy_id: 'breakoutRetest', pnl_demo: -10, closed_timestamp: '2026-05-01T03:00:00.000Z' }
    ]
  });

  assert.equal(metrics.sampleSize, 4);
  assert.equal(metrics.wins, 2);
  assert.equal(metrics.losses, 2);
  assert.equal(metrics.winRate, 0.5);
  assert.equal(metrics.grossProfit, 25);
  assert.equal(metrics.grossLoss, 15);
  assert.equal(metrics.netProfit, 10);
  assert.equal(metrics.profitFactor, 1.667);
  assert.equal(metrics.expectancy, 2.5);
  assert.deepEqual(metrics.equityCurve, [100010, 100005, 100020, 100010]);
  assert.equal(metrics.maxDrawdown, 10);
  assert.equal(metrics.maxDrawdownPct, 0.01);
  assert.equal(metrics.byStrategy.trendMomentum.sampleSize, 2);
  assert.equal(metrics.byStrategy.breakoutRetest.netProfit, 5);
});

test('reports insufficient sample size and bounded confidence', () => {
  const metrics = computeTrainingMetrics({
    minimumSampleSize: 30,
    closedTrades: [{ pnl_demo: 1 }, { pnl_demo: -1 }]
  });

  assert.equal(metrics.sampleSize, 2);
  assert.equal(metrics.sampleStatus, 'insufficient');
  assert.equal(metrics.confidenceScore >= 0, true);
  assert.equal(metrics.confidenceScore <= 100, true);
  assert.equal(metrics.stabilityScore >= 0, true);
  assert.equal(metrics.edgeDegradation.status, 'insufficient_sample');
});

test('strategy registry exposes default Quant-Core strategies', () => {
  const registry = createStrategyRegistry();

  assert.deepEqual(registry.ids(), [
    'ictCrt',
    'trendMomentum',
    'breakoutRetest',
    'meanReversion',
    'volumePullback'
  ]);
  assert.equal(registry.get('ictCrt').backendExecutable, false);
  assert.equal(registry.get('trendMomentum').minScore, 72);
});

test('strategy runner ranks provided shadow scores without mutating input', () => {
  const registry = createStrategyRegistry();
  const input = {
    strategyScores: [
      { id: 'meanReversion', bias: 'LONG', score: 64, reason: 'range stretch' },
      { id: 'trendMomentum', bias: 'SHORT', score: 81, reason: 'aligned trend' },
      { id: 'unknownExperimental', bias: 'LONG', score: 99, reason: 'not registered' }
    ]
  };

  const result = runStrategyPortfolio(input, registry);

  assert.equal(result.primary.id, 'trendMomentum');
  assert.equal(result.primary.bias, 'SHORT');
  assert.deepEqual(result.ranked.map((row) => row.id), ['trendMomentum', 'meanReversion']);
  assert.equal(input.strategyScores[0].score, 64);
});

test('training diagnostics computes breakdown by strategy and expectancy', () => {
  const diagnostics = computeTrainingDiagnostics([
    { strategy_id: 'trendMomentum', symbol: 'BTCUSDT', direction: 'LONG', timeframe: 'M15', pnl_demo: 10 },
    { strategy_id: 'trendMomentum', symbol: 'BTCUSDT', direction: 'SHORT', timeframe: 'M15', pnl_demo: -4 },
    { strategy: 'meanReversion', symbol: 'ETHUSDT', side: 'LONG', timeframe: 'H1', profit: 2 }
  ], { balanceStart: 1000 });

  assert.equal(diagnostics.summary.totalTrades, 3);
  assert.equal(diagnostics.summary.unknownStrategyTrades, 0);
  assert.equal(diagnostics.byStrategy.trendMomentum.sampleSize, 2);
  assert.equal(diagnostics.byStrategy.trendMomentum.expectancy, 3);
  assert.equal(diagnostics.byStrategy.trendMomentum.profitFactor, 2.5);
  assert.equal(diagnostics.byStrategy.trendMomentum.maxDrawdownPct, 0.4);
  assert.equal(diagnostics.summary.bestStrategyByExpectancy.id, 'trendMomentum');
  assert.equal(diagnostics.byResult.win.sampleSize, 2);
  assert.equal(diagnostics.byResult.loss.sampleSize, 1);
  assert.equal(diagnostics.byTimeframe.M15.sampleSize, 2);
});

test('training diagnostics tracks missing strategy attribution', () => {
  const diagnostics = computeTrainingDiagnostics([
    { symbol: 'XAUUSD', direction: 'SHORT', pnl_demo: -5 },
    { strategy_id: 'ictCrt', symbol: 'XAUUSD', direction: 'LONG', pnl_demo: 1 }
  ]);

  assert.equal(diagnostics.summary.totalTrades, 2);
  assert.equal(diagnostics.summary.unknownStrategyTrades, 1);
  assert.equal(diagnostics.summary.unknownStrategyRate, 0.5);
  assert.equal(diagnostics.byStrategy.unknown.sampleSize, 1);
  assert.deepEqual(diagnostics.missingFields.strategy[0].index, 0);
});

test('training diagnostics tracks missing symbol and side defensively', () => {
  const diagnostics = computeTrainingDiagnostics([
    { strategy_id: 'ictCrt', pnl_demo: 0 },
    { strategy_id: 'ictCrt', symbol: 'EURUSD', side: 'LONG', pnl_demo: 3 }
  ]);

  assert.equal(diagnostics.bySymbol.unknown.sampleSize, 1);
  assert.equal(diagnostics.bySide.unknown.sampleSize, 1);
  assert.equal(diagnostics.byResult.breakeven.sampleSize, 1);
  assert.equal(diagnostics.missingFields.symbol.length, 1);
  assert.equal(diagnostics.missingFields.side.length, 1);
});
