const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDefaultBotState,
  mergeBotState,
  toggleTradingReal,
  toggleTraining,
  setKillSwitch
} = require('../backend/services/bot-state-service');
const {
  createDefaultRiskConfig,
  validateRiskConfig,
  assertTradingRealCanBeEnabled
} = require('../backend/risk/risk-policy');

test('default bot state starts safe for VPS migration', () => {
  const state = createDefaultBotState();
  assert.equal(state.tradingRealEnabled, false);
  assert.equal(state.trainingEnabled, true);
  assert.equal(state.killSwitch, false);
  assert.equal(state.paperMode, true);
});

test('trading real and training are independent toggles', () => {
  let state = createDefaultBotState();
  const risk = createDefaultRiskConfig();

  state = toggleTraining(state, false);
  assert.equal(state.trainingEnabled, false);
  assert.equal(state.tradingRealEnabled, false);

  state = toggleTradingReal(state, true, risk);
  assert.equal(state.tradingRealEnabled, true);
  assert.equal(state.trainingEnabled, false);

  state = toggleTraining(state, true);
  assert.equal(state.trainingEnabled, true);
  assert.equal(state.tradingRealEnabled, true);
});

test('kill switch blocks enabling real trading', () => {
  const state = setKillSwitch(createDefaultBotState(), true);
  const risk = createDefaultRiskConfig();
  assert.throws(() => toggleTradingReal(state, true, risk), /kill switch/i);
});

test('real trading requires minimum risk rules', () => {
  const state = createDefaultBotState();
  const risk = {
    enabled: true,
    maxRiskPerTradePct: 0,
    maxDailyLossPct: 0,
    maxOpenPositions: 0,
    requireStopLoss: false
  };

  const result = validateRiskConfig(risk);
  assert.equal(result.ok, false);
  assert.throws(() => assertTradingRealCanBeEnabled(state, risk), /risk/i);
});

test('merge preserves explicit state and stamps update time', () => {
  const now = new Date('2026-05-06T20:00:00.000Z').toISOString();
  const merged = mergeBotState(
    createDefaultBotState(),
    { trainingEnabled: false, tradingRealEnabled: true },
    now
  );

  assert.equal(merged.trainingEnabled, false);
  assert.equal(merged.tradingRealEnabled, true);
  assert.equal(merged.updatedAt, now);
});
