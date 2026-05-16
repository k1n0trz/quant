const { createDefaultTrainingState, normalizeTrainingState } = require('./training-state');

const DEFAULT_AUTONOMOUS_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'ADAUSDT',
  'DOGEUSDT',
  'LINKUSDT',
  'AVAXUSDT',
  'TRXUSDT',
  'DOTUSDT',
  'LTCUSDT',
  'BCHUSDT',
  'NEARUSDT',
  'APTUSDT',
  'ARBUSDT',
  'OPUSDT',
  'INJUSDT',
  'ATOMUSDT',
  'UNIUSDT'
];

const BOOTSTRAP_STRATEGIES = [
  {
    id: 'trendMomentum',
    name: 'Trend Momentum / EMA-MACD',
    setup: 'Bootstrap trend-following paper hypothesis with live market price'
  },
  {
    id: 'meanReversion',
    name: 'Mean Reversion / RSI-ATR',
    setup: 'Bootstrap mean-reversion paper hypothesis with live market price'
  },
  {
    id: 'breakoutRetest',
    name: 'Breakout + Retest',
    setup: 'Bootstrap breakout paper hypothesis with live market price'
  },
  {
    id: 'volumePullback',
    name: 'Volume Pullback Continuation',
    setup: 'Bootstrap pullback continuation paper hypothesis with live market price'
  }
];

function numberFromEnv(env = {}, key, fallback) {
  const value = Number(env[key]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampInteger(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || min)));
}

function resolveBootstrapTargets(env = {}) {
  const minTotal = clampInteger(numberFromEnv(env, 'TRAINING_MIN_OPEN_POSITIONS', 20), 1, 200);
  const maxTotal = clampInteger(numberFromEnv(env, 'TRAINING_MAX_OPEN_POSITIONS', 40), minTotal, 200);
  const target = clampInteger(numberFromEnv(env, 'TRAINING_TARGET_OPEN_POSITIONS', minTotal), minTotal, maxTotal);
  const intraday = clampInteger(numberFromEnv(env, 'TRAINING_TARGET_INTRADAY_POSITIONS', Math.ceil(target / 2)), 0, target);
  const swing = clampInteger(numberFromEnv(env, 'TRAINING_TARGET_SWING_POSITIONS', target - intraday), 0, target);

  return {
    total: target,
    intraday,
    swing,
    minTotal,
    maxTotal
  };
}

function createBootstrapPair(symbol, index) {
  const strategy = BOOTSTRAP_STRATEGIES[index % BOOTSTRAP_STRATEGIES.length];
  const bias = index % 2 === 0 ? 'LONG' : 'SHORT';
  const score = 72 + (index % 6);
  const confidence = 74 + (index % 8);

  return {
    venue: 'BINANCE',
    symbol,
    score,
    source: 'backend.training.bootstrap',
    indicators: {
      bias,
      confidence,
      horizon: index % 3 === 0 ? 'swing' : 'intraday',
      htfAlignmentScore: 0.56 + ((index % 5) * 0.03),
      patternScore: 0.48 + ((index % 4) * 0.04),
      volumeRatio: 0.95 + ((index % 5) * 0.07),
      pairScore: score,
      strategy_id: strategy.id,
      strategy_name: strategy.name,
      primaryStrategy: {
        id: strategy.id,
        name: strategy.name,
        score,
        backendExecutable: true,
        phase: 'bootstrap'
      },
      setup: strategy.setup,
      source: 'backend.training.bootstrap',
      entry_reason_code: 'autonomous_bootstrap_paper',
      learning_mode: 'exploration_paper'
    }
  };
}

function createBootstrapTrainingState(options = {}) {
  const now = options.now || new Date().toISOString();
  const env = options.env || {};
  const targets = resolveBootstrapTargets(env);
  const configuredSymbols = Array.isArray(options.symbols) && options.symbols.length
    ? options.symbols
    : DEFAULT_AUTONOMOUS_SYMBOLS;
  const activePairs = configuredSymbols
    .slice(0, targets.total)
    .map((symbol, index) => createBootstrapPair(symbol, index));

  return normalizeTrainingState({
    ...createDefaultTrainingState(now),
    backendManaged: true,
    shadowModeReady: true,
    targets,
    targetOpenPositions: targets.total,
    targetIntradayPositions: targets.intraday,
    targetSwingPositions: targets.swing,
    activePairs,
    strategies: {},
    bootstrap: {
      source: 'backend.training.bootstrap',
      reason: 'training_state_missing_or_empty',
      createdAt: now
    },
    persistedAt: now
  }, now);
}

function shouldBootstrapTrainingSnapshot(snapshot) {
  if (!snapshot || snapshot.available !== true) return true;
  const state = snapshot.state || {};
  const hasPositions = Array.isArray(state.positions) && state.positions.length > 0;
  const hasClosedTrades = Array.isArray(state.closedTrades) && state.closedTrades.length > 0;
  const hasActivePairs = Array.isArray(state.activePairs) && state.activePairs.length > 0;
  return !hasPositions && !hasClosedTrades && !hasActivePairs;
}

function ensureBootstrapTrainingState(options = {}) {
  const deps = options.deps || {};
  if (typeof deps.readTrainingStateSnapshot !== 'function') {
    return {
      ok: false,
      bootstrapped: false,
      reason: 'training_state_reader_missing'
    };
  }
  if (typeof deps.writeTrainingState !== 'function') {
    return {
      ok: false,
      bootstrapped: false,
      reason: 'training_state_writer_missing'
    };
  }

  const snapshot = deps.readTrainingStateSnapshot();
  if (!shouldBootstrapTrainingSnapshot(snapshot)) {
    return {
      ok: true,
      bootstrapped: false,
      reason: null,
      snapshot
    };
  }

  const state = createBootstrapTrainingState({
    env: options.env || {},
    now: options.now || new Date().toISOString(),
    symbols: options.symbols
  });
  const persistence = deps.writeTrainingState(state);

  return {
    ok: true,
    bootstrapped: true,
    reason: snapshot?.reason || 'training_state_empty',
    state,
    persistence
  };
}

module.exports = {
  DEFAULT_AUTONOMOUS_SYMBOLS,
  createBootstrapTrainingState,
  ensureBootstrapTrainingState,
  resolveBootstrapTargets,
  shouldBootstrapTrainingSnapshot
};
