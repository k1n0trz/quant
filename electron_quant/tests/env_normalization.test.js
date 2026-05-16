const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyRuntimeEnvAliases,
  applyAutonomousTrainingDefaults
} = require('../backend/config/env-normalization');

test('runtime env aliases materialize common API key names without overriding canonical values', () => {
  const env = applyRuntimeEnvAliases({
    BINANCE_API_KEY: 'binance-key',
    BINANCE_API_SECRET: 'binance-secret',
    DEEPSEEK_KEY: 'deepseek-key',
    FINNHUB_TOKEN: 'finnhub-key',
    ALPHAVANTAGE_API_KEY: 'alpha-key',
    MT5_ENABLED: 'true'
  });

  assert.equal(env.BINANCE_API_KEY, 'binance-key');
  assert.equal(env.BINANCE_SECRET, 'binance-secret');
  assert.equal(env.DEEPSEEK_API_KEY, 'deepseek-key');
  assert.equal(env.FINNHUB_API_KEY, 'finnhub-key');
  assert.equal(env.ALPHA_VANTAGE_API_KEY, 'alpha-key');
  assert.equal(env.MT5_CONNECTOR_ENABLED, 'true');

  const canonicalWins = applyRuntimeEnvAliases({
    BINANCE_SECRET: 'canonical-secret',
    BINANCE_API_SECRET: 'alias-secret'
  });
  assert.equal(canonicalWins.BINANCE_SECRET, 'canonical-secret');
});

test('autonomous training defaults are safe paper-training defaults and preserve explicit operator values', () => {
  const env = applyAutonomousTrainingDefaults({});

  assert.equal(env.REAL_TRADING, 'false');
  assert.equal(env.TRAINING_BACKEND_LOOP_ENABLED, 'true');
  assert.equal(env.TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED, 'true');
  assert.equal(env.TRAINING_BACKEND_DEMO_ENTRY_ENABLED, 'true');
  assert.equal(env.TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED, 'true');
  assert.equal(env.TRAINING_TARGET_OPEN_POSITIONS, '20');
  assert.equal(env.TRAINING_MIN_OPEN_POSITIONS, '20');
  assert.equal(env.TRAINING_MAX_OPEN_POSITIONS, '40');

  const explicit = applyAutonomousTrainingDefaults({
    TRAINING_BACKEND_LOOP_ENABLED: 'false',
    TRAINING_TARGET_OPEN_POSITIONS: '24',
    REAL_TRADING: 'true'
  });
  assert.equal(explicit.TRAINING_BACKEND_LOOP_ENABLED, 'false');
  assert.equal(explicit.TRAINING_TARGET_OPEN_POSITIONS, '24');
  assert.equal(explicit.REAL_TRADING, 'true');
});
