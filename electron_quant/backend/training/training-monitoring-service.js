const { computeTrainingMetrics } = require('./metrics-engine');
const {
  createDefaultTrainingState,
  createTrainingStateSnapshot,
  normalizeTrainingState
} = require('./training-state');

function normalizeSnapshot(snapshot = {}) {
  const available = snapshot.available === true;
  const reason = available ? null : (snapshot.reason || 'training_state_unavailable');
  const source = snapshot.source && typeof snapshot.source === 'object' ? snapshot.source : {};
  const state = available
    ? normalizeTrainingState(snapshot.state || snapshot.raw || {})
    : createDefaultTrainingState();

  return {
    available,
    reason,
    source,
    state
  };
}

function readMonitoringState(deps = {}) {
  if (typeof deps.readTrainingStateSnapshot === 'function') {
    return normalizeSnapshot(deps.readTrainingStateSnapshot());
  }

  const raw = typeof deps.readTrainingState === 'function' ? deps.readTrainingState() : null;
  return normalizeSnapshot(
    raw
      ? createTrainingStateSnapshot(raw, { source: 'deps.readTrainingState' })
      : {
          available: false,
          reason: 'training_state_reader_missing',
          state: createDefaultTrainingState(),
          source: { source: 'deps.readTrainingState' }
        }
  );
}

function safety() {
  return {
    readOnly: true,
    writesPerformed: false,
    realTradingTouched: false
  };
}

function parseTimeMs(...values) {
  for (const value of values) {
    if (Number.isFinite(Number(value))) return Number(value);
    if (typeof value === 'string' && value.trim()) {
      const timeMs = Date.parse(value);
      if (Number.isFinite(timeMs)) return timeMs;
    }
  }
  return null;
}

function sortRecent(items, resolver) {
  return [...items]
    .map((item, index) => ({
      item,
      index,
      timeMs: resolver(item)
    }))
    .sort((left, right) => {
      if (left.timeMs !== null && right.timeMs !== null && left.timeMs !== right.timeMs) {
        return right.timeMs - left.timeMs;
      }
      if (left.timeMs !== null && right.timeMs === null) return -1;
      if (left.timeMs === null && right.timeMs !== null) return 1;
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

function getTrainingDemoOpenPositions(deps = {}) {
  const snapshot = readMonitoringState(deps);
  const positions = (Array.isArray(snapshot.state.positions) ? snapshot.state.positions : [])
    .filter((position) => !position.exit_price);

  return {
    ok: true,
    available: snapshot.available,
    reason: snapshot.reason,
    total: positions.length,
    positions,
    source: snapshot.source,
    safety: safety()
  };
}

function getTrainingDemoRecentTrades(deps = {}, options = {}) {
  const snapshot = readMonitoringState(deps);
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 50;
  const trades = sortRecent(
    Array.isArray(snapshot.state.closedTrades) ? snapshot.state.closedTrades : [],
    (trade) => parseTimeMs(trade?.closed_timestamp, trade?.closedAt, trade?.timestamp)
  ).slice(0, limit);

  return {
    ok: true,
    available: snapshot.available,
    reason: snapshot.reason,
    total: trades.length,
    trades,
    source: snapshot.source,
    safety: safety()
  };
}

function getTrainingDemoRecentLessons(deps = {}, options = {}) {
  const snapshot = readMonitoringState(deps);
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Number(options.limit)) : 50;
  const lessons = sortRecent(
    Array.isArray(snapshot.state.lessons) ? snapshot.state.lessons : [],
    (lesson) => parseTimeMs(lesson?.recorded_at, lesson?.created_at, lesson?.timestamp)
  ).slice(0, limit);

  return {
    ok: true,
    available: snapshot.available,
    reason: snapshot.reason,
    total: lessons.length,
    lessons,
    source: snapshot.source,
    safety: safety()
  };
}

function getTrainingDemoPerformanceSummary(deps = {}, schedulerStatus = null) {
  const snapshot = readMonitoringState(deps);
  const state = snapshot.state;
  const metrics = computeTrainingMetrics({
    balanceStart: state.balanceStart,
    closedTrades: state.closedTrades
  });
  const openPositions = (Array.isArray(state.positions) ? state.positions : []).filter((position) => !position.exit_price);

  return {
    ok: true,
    available: snapshot.available,
    reason: snapshot.reason,
    summary: {
      balance: state.balance,
      equity: state.balance,
      openPositions: openPositions.length,
      closedTrades: Array.isArray(state.closedTrades) ? state.closedTrades.length : 0,
      winRate: metrics.winRate,
      expectancy: metrics.expectancy,
      profitFactor: metrics.profitFactor,
      maxDrawdown: metrics.maxDrawdown
    },
    schedulerStatus: schedulerStatus || {
      active: false,
      enabled: false,
      loopEnabled: false,
      ticksRun: 0,
      ticksSkipped: 0,
      realTradingTouched: false
    },
    source: snapshot.source,
    safety: safety()
  };
}

function clampLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function compactActivePair(pair = {}) {
  const indicators = pair.indicators && typeof pair.indicators === 'object' ? pair.indicators : {};
  const primaryStrategy = indicators.primaryStrategy && typeof indicators.primaryStrategy === 'object'
    ? {
        id: indicators.primaryStrategy.id,
        name: indicators.primaryStrategy.name,
        score: indicators.primaryStrategy.score
      }
    : null;
  return {
    venue: pair.venue,
    symbol: pair.symbol,
    score: pair.score,
    price: pair.price,
    spreadPct: pair.spreadPct,
    bias: indicators.bias,
    confidence: indicators.confidence,
    horizon: indicators.horizon,
    signalQuality: indicators.signalQuality,
    primaryStrategy,
    macroRisk: indicators.macroRisk,
    macroReasons: indicators.macroReasons
  };
}

function compactOpenPosition(position = {}) {
  return {
    id: position.id,
    signal_id: position.signal_id,
    strategy_id: position.strategy_id,
    strategy_name: position.strategy_name,
    symbol: position.symbol,
    venue: position.venue,
    direction: position.direction,
    bias: position.bias,
    horizon: position.horizon,
    entry_price: position.entry_price,
    mark_price: position.mark_price,
    size_demo: position.size_demo,
    confidence: position.confidence,
    strategy_score: position.strategy_score,
    opened_tick: position.opened_tick,
    opened_at: position.opened_at,
    timestamp: position.timestamp,
    fees_simuladas: position.fees_simuladas,
    spread_estimado: position.spread_estimado,
    slippage_estimado: position.slippage_estimado
  };
}

function compactClosedTrade(trade = {}) {
  return {
    id: trade.id,
    signal_id: trade.signal_id,
    strategy_id: trade.strategy_id,
    strategy_name: trade.strategy_name,
    symbol: trade.symbol,
    venue: trade.venue,
    direction: trade.direction,
    horizon: trade.horizon,
    entry_price: trade.entry_price,
    exit_price: trade.exit_price,
    size_demo: trade.size_demo,
    pnl_demo: trade.pnl_demo,
    confidence: trade.confidence,
    closed_timestamp: trade.closed_timestamp,
    closedAt: trade.closedAt,
    timestamp: trade.timestamp,
    lesson_learned: trade.lesson_learned
  };
}

function compactLesson(lesson = {}) {
  return {
    symbol: lesson.symbol,
    venue: lesson.venue,
    outcome: lesson.outcome,
    lesson: lesson.lesson,
    summary: lesson.summary,
    created_at: lesson.created_at,
    recorded_at: lesson.recorded_at,
    timestamp: lesson.timestamp
  };
}

function getTrainingDemoLiveSnapshot(deps = {}, options = {}, schedulerStatus = null) {
  const snapshot = readMonitoringState(deps);
  const state = snapshot.state;
  const tradeLimit = clampLimit(options.tradeLimit || options.limit, 80, 120);
  const lessonLimit = clampLimit(options.lessonLimit || options.limit, 80, 120);
  const pairLimit = clampLimit(options.pairLimit, Number(state.targets?.total || 40), 80);
  const positions = (Array.isArray(state.positions) ? state.positions : [])
    .filter((position) => !position.exit_price)
    .map(compactOpenPosition);
  const allTrades = Array.isArray(state.closedTrades) ? state.closedTrades : [];
  const allLessons = Array.isArray(state.lessons) ? state.lessons : [];
  const activePairs = (Array.isArray(state.activePairs) ? state.activePairs : [])
    .slice(0, pairLimit)
    .map(compactActivePair);
  const closedTrades = sortRecent(
    allTrades,
    (trade) => parseTimeMs(trade?.closed_timestamp, trade?.closedAt, trade?.timestamp)
  ).slice(0, tradeLimit).map(compactClosedTrade);
  const lessons = sortRecent(
    allLessons,
    (lesson) => parseTimeMs(lesson?.recorded_at, lesson?.created_at, lesson?.timestamp)
  ).slice(0, lessonLimit).map(compactLesson);
  const metrics = computeTrainingMetrics({
    balanceStart: state.balanceStart,
    closedTrades: allTrades
  });

  return {
    ok: true,
    available: snapshot.available,
    reason: snapshot.reason,
    compact: true,
    state: {
      version: state.version,
      mode: state.mode,
      simulated: state.simulated,
      blockRealExecution: state.blockRealExecution,
      backendManaged: state.backendManaged,
      shadowModeReady: state.shadowModeReady,
      balanceStart: state.balanceStart,
      balance: state.balance,
      activePairs,
      positions,
      closedTrades,
      lessons,
      strategyStats: state.strategyStats,
      pairCooldowns: state.pairCooldowns,
      xp: state.xp,
      targets: state.targets,
      persistedAt: state.persistedAt,
      totals: {
        positions: Array.isArray(state.positions) ? state.positions.length : positions.length,
        openPositions: positions.length,
        closedTrades: allTrades.length,
        lessons: allLessons.length,
        activePairs: Array.isArray(state.activePairs) ? state.activePairs.length : activePairs.length
      },
      metrics
    },
    source: snapshot.source,
    schedulerStatus: schedulerStatus || {
      active: false,
      enabled: false,
      loopEnabled: false,
      ticksRun: 0,
      ticksSkipped: 0,
      realTradingTouched: false
    },
    safety: safety()
  };
}

module.exports = {
  getTrainingDemoOpenPositions,
  getTrainingDemoRecentTrades,
  getTrainingDemoRecentLessons,
  getTrainingDemoPerformanceSummary,
  getTrainingDemoLiveSnapshot
};
