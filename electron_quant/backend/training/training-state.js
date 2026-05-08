const fs = require('node:fs');
const path = require('node:path');

function createDefaultTrainingState(now = new Date().toISOString()) {
  return {
    version: 2,
    mode: 'training',
    simulated: true,
    blockRealExecution: true,
    backendManaged: false,
    shadowModeReady: true,
    balanceStart: 100000,
    balance: 100000,
    positions: [],
    closedTrades: [],
    lessons: [],
    strategyStats: {},
    pairCooldowns: {},
    xp: 0,
    targets: {
      total: 20,
      intraday: 10,
      swing: 10
    },
    persistedAt: now
  };
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeTrainingState(raw = {}, now = new Date().toISOString()) {
  const defaults = createDefaultTrainingState(now);
  const source = objectOrEmpty(raw);
  const targets = {
    ...defaults.targets,
    ...objectOrEmpty(source.targets)
  };

  return {
    ...defaults,
    ...source,
    version: Number(source.version || defaults.version),
    mode: source.mode || defaults.mode,
    simulated: source.simulated !== false,
    blockRealExecution: source.blockRealExecution !== false,
    backendManaged: source.backendManaged === true,
    shadowModeReady: source.shadowModeReady !== false,
    balanceStart: Number.isFinite(Number(source.balanceStart)) ? Number(source.balanceStart) : defaults.balanceStart,
    balance: Number.isFinite(Number(source.balance)) ? Number(source.balance) : Number(source.balanceStart || defaults.balance),
    positions: arrayOrEmpty(source.positions),
    closedTrades: arrayOrEmpty(source.closedTrades),
    lessons: arrayOrEmpty(source.lessons),
    strategyStats: objectOrEmpty(source.strategyStats),
    pairCooldowns: objectOrEmpty(source.pairCooldowns),
    xp: Number.isFinite(Number(source.xp)) ? Number(source.xp) : defaults.xp,
    targets,
    persistedAt: now
  };
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createTrainingStateStore(filePath) {
  function read() {
    if (!fs.existsSync(filePath)) return createDefaultTrainingState();
    try {
      return normalizeTrainingState(JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch {
      return createDefaultTrainingState();
    }
  }

  function write(nextState) {
    ensureParentDir(filePath);
    const normalized = normalizeTrainingState(nextState);
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf8');
    return normalized;
  }

  return {
    filePath,
    read,
    write
  };
}

function isBackendTrainingEnabled(env = {}) {
  return String(env.TRAINING_BACKEND_ENABLED || 'false').toLowerCase() === 'true';
}

module.exports = {
  createDefaultTrainingState,
  normalizeTrainingState,
  createTrainingStateStore,
  isBackendTrainingEnabled
};
