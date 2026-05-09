const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { computeTrainingMetrics } = require('../backend/training/metrics-engine');
const { computeTrainingDiagnostics } = require('../backend/training/training-diagnostics');
const {
  normalizeOpenPosition,
  calculateTrainingPnl,
  buildClosedTradeFromPosition,
  closeTrainingPosition
} = require('../backend/training/training-closure-service');
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

test('training diagnostics supports traceable and legacy closed trades together', () => {
  const diagnostics = computeTrainingDiagnostics([
    { symbol: 'ETHUSD', direction: 'LONG', pnl_demo: -2 },
    { trace: { strategy_id: 'trendMomentum' }, symbol: 'BTCUSD', side: 'LONG', pnl: 8 },
    { strategy_id: 'ictCrt', symbol: 'XAUUSD', side: 'SHORT', pnl: 4 }
  ]);

  assert.equal(diagnostics.summary.totalTrades, 3);
  assert.equal(diagnostics.summary.unknownStrategyTrades, 1);
  assert.equal(diagnostics.summary.unknownStrategyRate, 0.3333);
  assert.equal(diagnostics.byStrategy.trendMomentum.sampleSize, 1);
  assert.equal(diagnostics.byStrategy.ictCrt.sampleSize, 1);
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

test('training closure service calculates LONG winner and loser like frontend close', () => {
  const open = {
    direction: 'LONG',
    entry_price: 100,
    size_demo: 2,
    fees_simuladas: 1,
    spread_estimado: 0.5,
    slippage_estimado: 0.25
  };

  assert.equal(calculateTrainingPnl(open, { price: 110 }).pnl, 18.25);
  assert.equal(calculateTrainingPnl(open, { price: 95 }).pnl, -11.75);
});

test('training closure service calculates SHORT winner and loser like frontend close', () => {
  const open = {
    direction: 'SHORT',
    entry_price: 100,
    size_demo: 2,
    fees_simuladas: 1,
    spread_estimado: 0.5,
    slippage_estimado: 0.25
  };

  assert.equal(calculateTrainingPnl(open, { price: 90 }).pnl, 18.25);
  assert.equal(calculateTrainingPnl(open, { price: 105 }).pnl, -11.75);
});

test('training closure service preserves traceable metadata on close', () => {
  const open = {
    signal_id: 'sig-1',
    traceability_version: 1,
    strategy_id: 'trendMomentum',
    strategy_name: 'Trend Momentum / EMA-MACD',
    source: 'renderer.training.position',
    direction: 'LONG',
    symbol: 'BTCUSD',
    entry_price: 100,
    size_demo: 1,
    fees_simuladas: 0,
    spread_estimado: 0,
    slippage_estimado: 0,
    confidence_at_entry: 72
  };

  const closed = buildClosedTradeFromPosition(open, { price: 112 }, { bias: 'SHORT', confidence: 55 }, {
    closedAt: '2026-05-09T12:00:00.000Z',
    lessonBuilder: () => ({ type: 'training_lesson', outcome: 'win' })
  });

  assert.equal(closed.signal_id, 'sig-1');
  assert.equal(closed.strategy_id, 'trendMomentum');
  assert.equal(closed.closed_at, '2026-05-09T12:00:00.000Z');
  assert.equal(closed.closed_timestamp, '2026-05-09T12:00:00.000Z');
  assert.equal(closed.exit_reason_code, 'signal_flip_or_edge_loss');
  assert.equal(closed.pnl_demo, 12);
  assert.equal(closed.pnl, 12);
  assert.deepEqual(closed.lesson_learned, { type: 'training_lesson', outcome: 'win' });
});

test('training closure service supports legacy and partial positions without mutating input', () => {
  const legacy = {
    direction: 'SHORT',
    entry_price: 100,
    size_demo: 3,
    pnl_demo: 0
  };
  const before = JSON.stringify(legacy);
  const closed = buildClosedTradeFromPosition(legacy, { price: 99 }, { bias: 'SHORT', confidence: 61 }, {
    closedAt: '2026-05-09T12:30:00.000Z'
  });

  assert.equal(JSON.stringify(legacy), before);
  assert.equal(closed.direction, 'SHORT');
  assert.equal(closed.pnl_demo, 3);
  assert.equal(closed.exit_reason_code, 'demo_risk_management');
  assert.equal(closed.motivo_salida, 'Gestion demo por objetivo/riesgo; confianza actual 61');
});

test('training closure service closes one position and returns immutable next state', () => {
  const open = { id: 'a', symbol: 'BTCUSD', direction: 'LONG', entry_price: 100, size_demo: 1 };
  const other = { id: 'b', symbol: 'ETHUSD', direction: 'LONG', entry_price: 10, size_demo: 1 };
  const state = { positions: [open, other], closedTrades: [] };

  const result = closeTrainingPosition(state, open, { price: 101 }, { bias: 'LONG', confidence: 70 }, {
    closedAt: '2026-05-09T13:00:00.000Z'
  });

  assert.equal(result.closedTrade.pnl_demo, 1);
  assert.equal(result.nextState.positions.length, 1);
  assert.equal(result.nextState.positions[0], other);
  assert.equal(result.nextState.closedTrades.length, 1);
  assert.equal(state.positions.length, 2);
  assert.equal(state.closedTrades.length, 0);
});

test('training closure service normalizes open position defensively', () => {
  const open = normalizeOpenPosition({ side: 'short', entryPrice: '10', size: '2' });

  assert.equal(open.direction, 'SHORT');
  assert.equal(open.entry_price, 10);
  assert.equal(open.size_demo, 2);
});

test('renderer training closure wrapper matches backend close output', () => {
  const wrapperPath = path.join(__dirname, '..', 'src', 'services', 'training-closure-service.js');
  const wrapperSource = fs.readFileSync(wrapperPath, 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(wrapperSource, sandbox, { filename: wrapperPath });

  const open = {
    signal_id: 'sig-renderer-1',
    strategy_id: 'breakoutRetest',
    direction: 'LONG',
    symbol: 'ETHUSD',
    entry_price: 200,
    size_demo: 1.5,
    fees_simuladas: 0.75,
    spread_estimado: 0.25,
    slippage_estimado: 0.1,
    confidence_at_entry: 74
  };
  const exitContext = { price: 203 };
  const signal = { bias: 'SHORT', confidence: 52 };
  const options = {
    closedAt: '2026-05-09T15:00:00.000Z',
    lessonBuilder: () => ({ type: 'training_lesson', source: 'test' })
  };

  const backendClosed = buildClosedTradeFromPosition(open, exitContext, signal, options);
  const rendererClosed = sandbox.window.QuantTrainingClosure.buildClosedTradeFromPosition(open, exitContext, signal, options);

  assert.equal(JSON.stringify(rendererClosed), JSON.stringify(backendClosed));
});
