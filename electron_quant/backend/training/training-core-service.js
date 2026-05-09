const { computeTrainingMetrics } = require('./metrics-engine');
const { createStrategyRegistry } = require('./strategy-registry');
const {
  createDefaultTrainingState,
  createTrainingStateSnapshot,
  normalizeTrainingState,
  isBackendTrainingEnabled
} = require('./training-state');

function readCoreState(deps = {}) {
  if (typeof deps.readTrainingStateSnapshot === 'function') {
    return normalizeCoreSnapshot(deps.readTrainingStateSnapshot());
  }

  const raw = typeof deps.readTrainingState === 'function' ? deps.readTrainingState() : null;
  return normalizeCoreSnapshot(
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

function normalizeCoreSnapshot(snapshot = {}) {
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

function coreSafetySummary() {
  return {
    readOnly: true,
    schedulerActive: false,
    writesPerformed: false,
    realTradingTouched: false
  };
}

function getTrainingCoreStatus(env = {}, deps = {}) {
  const snapshot = readCoreState(deps);
  const state = snapshot.state;
  return {
    ok: true,
    available: snapshot.available,
    reason: snapshot.reason,
    core: {
      name: 'Quant-Core Training',
      mode: 'shadow',
      backendEnabled: isBackendTrainingEnabled(env),
      schedulerActive: false,
      backendManaged: state.backendManaged === true,
      shadowModeReady: state.shadowModeReady !== false
    },
    state: {
      version: state.version,
      mode: state.mode,
      simulated: state.simulated,
      blockRealExecution: state.blockRealExecution,
      balanceStart: state.balanceStart,
      balance: state.balance,
      positions: state.positions.length,
      closedTrades: state.closedTrades.length,
      lessons: state.lessons.length,
      persistedAt: state.persistedAt || null
    },
    source: snapshot.source,
    safety: coreSafetySummary()
  };
}

function getTrainingCoreMetrics(_env = {}, deps = {}) {
  const snapshot = readCoreState(deps);
  const state = snapshot.state;
  return {
    ok: true,
    available: snapshot.available,
    reason: snapshot.reason,
    mode: 'shadow',
    metrics: computeTrainingMetrics({
      balanceStart: state.balanceStart,
      closedTrades: state.closedTrades
    }),
    source: snapshot.source,
    safety: coreSafetySummary()
  };
}

function strategyRankingFromState(state = {}) {
  const rows = Object.entries(state.strategyStats || {}).map(([key, value]) => {
    const row = value && typeof value === 'object' ? value : {};
    const sampleSize = Number(row.closed ?? row.sampleSize ?? row.trades ?? 0) || 0;
    const wins = Number(row.wins ?? 0) || 0;
    const winRateRaw = Number(row.winrate ?? row.winRate);
    const winRate = Number.isFinite(winRateRaw)
      ? (winRateRaw > 1 ? winRateRaw / 100 : winRateRaw)
      : (sampleSize ? wins / sampleSize : 0);
    const avgScore = Number(row.avgScore ?? row.score ?? 0) || 0;
    const netProfit = Number(row.pnl ?? row.netProfit ?? row.profit ?? 0) || 0;

    return {
      id: row.id || key,
      name: row.name || row.id || key,
      sampleSize,
      wins,
      winRate: Math.round(winRate * 10000) / 10000,
      netProfit: Math.round(netProfit * 100) / 100,
      avgScore: Math.round(avgScore * 100) / 100,
      score: Math.round((avgScore || (winRate * 100)) * 100) / 100,
      backendExecutable: false,
      phase: 'shadow'
    };
  });

  return rows
    .filter((row) => row.sampleSize > 0 || row.avgScore > 0 || row.netProfit !== 0)
    .sort((a, b) => (b.score - a.score) || (b.sampleSize - a.sampleSize) || (b.netProfit - a.netProfit));
}

function getTrainingCoreStrategies(_env = {}, deps = {}) {
  const snapshot = readCoreState(deps);
  const registry = createStrategyRegistry();
  return {
    ok: true,
    available: snapshot.available,
    reason: snapshot.reason,
    mode: 'shadow',
    strategies: registry.list(),
    strategyRanking: snapshot.available ? strategyRankingFromState(snapshot.state) : [],
    source: snapshot.source,
    safety: coreSafetySummary()
  };
}

function getTrainingCoreEquity(_env = {}, deps = {}) {
  const snapshot = readCoreState(deps);
  const state = snapshot.state;
  const metrics = computeTrainingMetrics({
    balanceStart: state.balanceStart,
    closedTrades: state.closedTrades
  });
  return {
    ok: true,
    available: snapshot.available,
    reason: snapshot.reason,
    mode: 'shadow',
    equity: {
      balanceStart: state.balanceStart,
      balance: state.balance,
      points: metrics.equityCurve.length,
      curve: metrics.equityCurve,
      maxDrawdown: metrics.maxDrawdown,
      maxDrawdownPct: metrics.maxDrawdownPct
    },
    source: snapshot.source,
    safety: coreSafetySummary()
  };
}

function getTrainingCoreEdge(env = {}, deps = {}) {
  const snapshot = readCoreState(deps);
  const state = snapshot.state;
  const metrics = computeTrainingMetrics({
    balanceStart: state.balanceStart,
    closedTrades: state.closedTrades
  });
  return {
    ok: true,
    available: snapshot.available,
    reason: snapshot.reason,
    mode: 'shadow',
    edge: {
      sampleSize: metrics.sampleSize,
      sampleStatus: metrics.sampleStatus,
      confidenceScore: metrics.confidenceScore,
      stabilityScore: metrics.stabilityScore,
      degradation: metrics.edgeDegradation,
      backendEnabled: isBackendTrainingEnabled(env),
      schedulerActive: false
    },
    source: snapshot.source,
    safety: coreSafetySummary()
  };
}

module.exports = {
  getTrainingCoreStatus,
  getTrainingCoreMetrics,
  getTrainingCoreStrategies,
  getTrainingCoreEquity,
  getTrainingCoreEdge
};
