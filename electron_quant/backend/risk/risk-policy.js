const { ApiError } = require('../utils/errors');

function createDefaultRiskConfig() {
  return {
    enabled: true,
    maxRiskPerTradePct: 1,
    maxDailyLossPct: 3,
    maxOpenPositions: 5,
    requireStopLoss: true,
    allowRealTrading: false,
    allowedVenues: ['BINANCE'],
    trainingCanChangeCriticalRules: false,
    updatedAt: new Date().toISOString()
  };
}

function validateRiskConfig(config = {}) {
  const issues = [];
  if (!(Number(config.maxRiskPerTradePct) > 0)) issues.push('maxRiskPerTradePct must be greater than 0');
  if (!(Number(config.maxDailyLossPct) > 0)) issues.push('maxDailyLossPct must be greater than 0');
  if (!(Number(config.maxOpenPositions) >= 1)) issues.push('maxOpenPositions must be at least 1');
  if (config.requireStopLoss !== true) issues.push('requireStopLoss must be true');
  if (!Array.isArray(config.allowedVenues) || !config.allowedVenues.includes('BINANCE')) issues.push('allowedVenues must include BINANCE');
  if (config.trainingCanChangeCriticalRules !== false) issues.push('trainingCanChangeCriticalRules must remain false');
  return {
    ok: issues.length === 0,
    issues
  };
}

function assertTradingRealCanBeEnabled(state, riskConfig) {
  if (state.killSwitch) throw new ApiError(409, 'Global kill switch is active');
  const validation = validateRiskConfig(riskConfig);
  if (!validation.ok) {
    throw new ApiError(409, 'Risk configuration does not meet minimum requirements', validation.issues);
  }
}

module.exports = {
  createDefaultRiskConfig,
  validateRiskConfig,
  assertTradingRealCanBeEnabled
};
