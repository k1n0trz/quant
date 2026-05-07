const { createDefaultBotState } = require('../services/bot-state-service');
const { createDefaultRiskConfig } = require('../risk/risk-policy');

function createBackendContext(options = {}) {
  let botState = options.botState || createDefaultBotState();
  let riskConfig = options.riskConfig || createDefaultRiskConfig();

  return {
    env: options.env || {},
    logger: options.logger || null,
    deps: options.deps || {},
    getBotState: () => botState,
    setBotState: (next) => {
      botState = next;
      return botState;
    },
    getRiskConfig: () => riskConfig,
    setRiskConfig: (next) => {
      riskConfig = next;
      return riskConfig;
    }
  };
}

module.exports = {
  createBackendContext
};
