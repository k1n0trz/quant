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
      total: 40,
      intraday: 20,
      swing: 20
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

function hasCompatibleTrainingShape(source) {
  return (
    Array.isArray(source.closedTrades) ||
    Array.isArray(source.positions) ||
    Array.isArray(source.lessons) ||
    Object.keys(objectOrEmpty(source.strategyStats)).length > 0 ||
    Object.keys(objectOrEmpty(source.strategies)).length > 0 ||
    Number.isFinite(Number(source.balanceStart)) ||
    Number.isFinite(Number(source.balance)) ||
    typeof source.mode === 'string' ||
    typeof source.version !== 'undefined'
  );
}

function normalizeTrainingState(raw = {}, now = new Date().toISOString()) {
  const defaults = createDefaultTrainingState(now);
  const source = objectOrEmpty(raw);
  let targets = {
    ...defaults.targets,
    ...objectOrEmpty(source.targets)
  };
  if (
    Number(targets.total) === 20
    && Number(targets.intraday) === 10
    && Number(targets.swing) === 10
  ) {
    targets = { total: 40, intraday: 20, swing: 20 };
  }

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
    persistedAt: source.persistedAt || now
  };
}

function unavailableTrainingState(reason, source = {}) {
  return {
    available: false,
    reason,
    state: createDefaultTrainingState(),
    raw: null,
    source: {
      ...source,
      compatible: false
    }
  };
}

function createTrainingStateSnapshot(raw, source = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return unavailableTrainingState(source.reason || 'training_state_shape_incompatible', source);
  }
  if (!hasCompatibleTrainingShape(raw)) {
    return unavailableTrainingState('training_state_shape_incompatible', source);
  }
  return {
    available: true,
    reason: null,
    state: normalizeTrainingState(raw),
    raw,
    source: {
      ...source,
      compatible: true,
      closedTradesPath: Array.isArray(raw.closedTrades) ? 'closedTrades' : null
    }
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

function createReadOnlyTrainingStateReader(filePath) {
  function readSnapshot() {
    if (!fs.existsSync(filePath)) {
      return unavailableTrainingState('training_state_file_missing', { filePath, exists: false });
    }

    let rawText = '';
    try {
      rawText = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
      return unavailableTrainingState('training_state_read_failed', {
        filePath,
        exists: true,
        error: String(error?.message || error)
      });
    }

    if (!rawText.trim()) {
      return unavailableTrainingState('training_state_empty', { filePath, exists: true });
    }

    try {
      return createTrainingStateSnapshot(JSON.parse(rawText), { filePath, exists: true });
    } catch (error) {
      return unavailableTrainingState('training_state_json_invalid', {
        filePath,
        exists: true,
        error: String(error?.message || error)
      });
    }
  }

  return {
    filePath,
    readSnapshot
  };
}

function isBackendTrainingEnabled(env = {}) {
  return String(env.TRAINING_BACKEND_ENABLED || 'false').toLowerCase() === 'true';
}

module.exports = {
  createDefaultTrainingState,
  normalizeTrainingState,
  createTrainingStateSnapshot,
  createReadOnlyTrainingStateReader,
  createTrainingStateStore,
  isBackendTrainingEnabled
};
