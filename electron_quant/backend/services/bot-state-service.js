const { assertTradingRealCanBeEnabled } = require('../risk/risk-policy');

function createDefaultBotState() {
  return {
    tradingRealEnabled: false,
    trainingEnabled: true,
    killSwitch: false,
    paperMode: true,
    updatedAt: new Date().toISOString()
  };
}

function mergeBotState(current, patch, updatedAt = new Date().toISOString()) {
  return {
    ...createDefaultBotState(),
    ...(current || {}),
    ...(patch || {}),
    updatedAt
  };
}

function toggleTradingReal(state, enabled, riskConfig) {
  if (enabled) assertTradingRealCanBeEnabled(state, riskConfig);
  return mergeBotState(state, {
    tradingRealEnabled: Boolean(enabled),
    paperMode: !Boolean(enabled)
  });
}

function toggleTraining(state, enabled) {
  return mergeBotState(state, {
    trainingEnabled: Boolean(enabled)
  });
}

function setKillSwitch(state, enabled) {
  return mergeBotState(state, {
    killSwitch: Boolean(enabled),
    tradingRealEnabled: Boolean(enabled) ? false : Boolean(state.tradingRealEnabled),
    paperMode: Boolean(enabled) ? true : Boolean(state.paperMode)
  });
}

module.exports = {
  createDefaultBotState,
  mergeBotState,
  toggleTradingReal,
  toggleTraining,
  setKillSwitch
};
