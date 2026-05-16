const ENV_ALIASES = {
  BINANCE_SECRET: [
    'BINANCE_API_SECRET',
    'BINANCE_SECRET_KEY',
    'BINANCE_API_SECRET_KEY'
  ],
  DEEPSEEK_API_KEY: [
    'DEEPSEEK_KEY',
    'DEEPSEEK_TOKEN'
  ],
  DEEPINFRA_API_KEY: [
    'DEEPINFRA_KEY',
    'DEEPINFRA_TOKEN'
  ],
  FINNHUB_API_KEY: [
    'FINNHUB_TOKEN',
    'FINNHUB_KEY'
  ],
  ALPHA_VANTAGE_API_KEY: [
    'ALPHAVANTAGE_API_KEY',
    'ALPHAVANTAGE_KEY',
    'ALPHA_VANTAGE_KEY'
  ],
  MT5_CONNECTOR_ENABLED: [
    'MT5_ENABLED'
  ],
  DEFAULT_PROVIDER: [
    'AI_PROVIDER'
  ],
  QUANT_PRIMARY_MODEL: [
    'AI_MODEL',
    'MODEL_NAME'
  ]
};

const ENV_ALIAS_KEYS = Object.values(ENV_ALIASES).flat();

const AUTONOMOUS_TRAINING_DEFAULTS = {
  REAL_TRADING: 'false',
  TRAINING_BACKEND_LOOP_ENABLED: 'true',
  TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED: 'true',
  TRAINING_BACKEND_LOOP_INTERVAL_MS: '60000',
  TRAINING_BACKEND_DEMO_ENTRY_ENABLED: 'true',
  TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED: 'true',
  TRAINING_TARGET_OPEN_POSITIONS: '20',
  TRAINING_TARGET_INTRADAY_POSITIONS: '10',
  TRAINING_TARGET_SWING_POSITIONS: '10',
  TRAINING_MIN_OPEN_POSITIONS: '20',
  TRAINING_MAX_OPEN_POSITIONS: '40'
};

function hasText(value) {
  return String(value ?? '').trim() !== '';
}

function applyRuntimeEnvAliases(env = {}) {
  const next = { ...env };
  for (const [canonical, aliases] of Object.entries(ENV_ALIASES)) {
    if (hasText(next[canonical])) continue;
    const alias = aliases.find((key) => hasText(next[key]));
    if (alias) next[canonical] = String(next[alias]).trim();
  }
  return next;
}

function applyAutonomousTrainingDefaults(env = {}) {
  const next = { ...env };
  for (const [key, value] of Object.entries(AUTONOMOUS_TRAINING_DEFAULTS)) {
    if (!hasText(next[key])) next[key] = value;
  }
  return next;
}

function normalizeRuntimeEnv(env = {}) {
  return applyAutonomousTrainingDefaults(applyRuntimeEnvAliases(env));
}

module.exports = {
  AUTONOMOUS_TRAINING_DEFAULTS,
  ENV_ALIASES,
  ENV_ALIAS_KEYS,
  applyAutonomousTrainingDefaults,
  applyRuntimeEnvAliases,
  normalizeRuntimeEnv
};
