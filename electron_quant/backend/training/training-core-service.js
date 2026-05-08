const { computeTrainingMetrics } = require('./metrics-engine');
const { createStrategyRegistry } = require('./strategy-registry');
const { normalizeTrainingState, isBackendTrainingEnabled } = require('./training-state');

function readCoreState(deps = {}) {
  const raw = typeof deps.readTrainingState === 'function' ? deps.readTrainingState() : null;
  return normalizeTrainingState(raw || {});
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
  const state = readCoreState(deps);
  return {
    ok: true,
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
    safety: coreSafetySummary()
  };
}

function getTrainingCoreMetrics(_env = {}, deps = {}) {
  const state = readCoreState(deps);
  return {
    ok: true,
    mode: 'shadow',
    metrics: computeTrainingMetrics({
      balanceStart: state.balanceStart,
      closedTrades: state.closedTrades
    }),
    safety: coreSafetySummary()
  };
}

function getTrainingCoreStrategies() {
  const registry = createStrategyRegistry();
  return {
    ok: true,
    mode: 'shadow',
    strategies: registry.list(),
    safety: coreSafetySummary()
  };
}

function getTrainingCoreEquity(_env = {}, deps = {}) {
  const state = readCoreState(deps);
  const metrics = computeTrainingMetrics({
    balanceStart: state.balanceStart,
    closedTrades: state.closedTrades
  });
  return {
    ok: true,
    mode: 'shadow',
    equity: {
      balanceStart: state.balanceStart,
      balance: state.balance,
      points: metrics.equityCurve.length,
      curve: metrics.equityCurve,
      maxDrawdown: metrics.maxDrawdown,
      maxDrawdownPct: metrics.maxDrawdownPct
    },
    safety: coreSafetySummary()
  };
}

function getTrainingCoreEdge(env = {}, deps = {}) {
  const state = readCoreState(deps);
  const metrics = computeTrainingMetrics({
    balanceStart: state.balanceStart,
    closedTrades: state.closedTrades
  });
  return {
    ok: true,
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
