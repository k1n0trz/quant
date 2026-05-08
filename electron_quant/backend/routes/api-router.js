const { toggleTradingReal, toggleTraining, setKillSwitch } = require('../services/bot-state-service');
const { createDefaultRiskConfig, validateRiskConfig } = require('../risk/risk-policy');
const { getConnectionsSummary, testBinanceConnection, testMt5Connection } = require('../services/connections-service');
const { readTradesFromMemory } = require('../trades/trade-history-service');
const { readSignalsFromMemory } = require('../signals/signal-history-service');
const { readTrainingLogs } = require('../training/training-log-service');
const {
  getTrainingCoreStatus,
  getTrainingCoreMetrics,
  getTrainingCoreStrategies,
  getTrainingCoreEquity,
  getTrainingCoreEdge
} = require('../training/training-core-service');
const { ApiError, toErrorPayload } = require('../utils/errors');

function response(status, body) {
  return { status, body };
}

function createApiRouter(context) {
  async function dispatch(req) {
    const method = String(req.method || 'GET').toUpperCase();
    const pathname = req.pathname || '/';
    const body = req.body || {};
    const env = context.env || {};
    const deps = context.deps || {};

    try {
      if (method === 'GET' && pathname === '/healthz') {
        return response(200, { ok: true, service: 'quant-backend', ts: new Date().toISOString() });
      }

      if (method === 'GET' && pathname === '/api/status') {
        return response(200, {
          ok: true,
          bot: context.getBotState(),
          risk: validateRiskConfig(context.getRiskConfig()),
          adapters: getConnectionsSummary(env).adapters
        });
      }

      if (method === 'GET' && pathname === '/api/bot/state') {
        return response(200, context.getBotState());
      }

      if (method === 'POST' && pathname === '/api/bot/trading-real/on') {
        const next = toggleTradingReal(context.getBotState(), true, context.getRiskConfig());
        context.setBotState(next);
        return response(200, next);
      }

      if (method === 'POST' && pathname === '/api/bot/trading-real/off') {
        const next = toggleTradingReal(context.getBotState(), false, context.getRiskConfig());
        context.setBotState(next);
        return response(200, next);
      }

      if (method === 'POST' && pathname === '/api/bot/training/on') {
        const next = toggleTraining(context.getBotState(), true);
        context.setBotState(next);
        return response(200, next);
      }

      if (method === 'POST' && pathname === '/api/bot/training/off') {
        const next = toggleTraining(context.getBotState(), false);
        context.setBotState(next);
        return response(200, next);
      }

      if (method === 'POST' && pathname === '/api/bot/kill-switch/on') {
        const next = setKillSwitch(context.getBotState(), true);
        context.setBotState(next);
        return response(200, next);
      }

      if (method === 'POST' && pathname === '/api/bot/kill-switch/off') {
        const next = setKillSwitch(context.getBotState(), false);
        context.setBotState(next);
        return response(200, next);
      }

      if (method === 'GET' && pathname === '/api/trades') {
        return response(200, { items: readTradesFromMemory(deps.readMemory) });
      }

      if (method === 'GET' && pathname === '/api/signals') {
        return response(200, { items: readSignalsFromMemory(deps.readMemory) });
      }

      if (method === 'GET' && pathname === '/api/training/logs') {
        return response(200, readTrainingLogs(deps.readMemory, deps.readTrainingState));
      }

      if (method === 'GET' && pathname === '/api/training/core/status') {
        return response(200, getTrainingCoreStatus(env, deps));
      }

      if (method === 'GET' && pathname === '/api/training/core/metrics') {
        return response(200, getTrainingCoreMetrics(env, deps));
      }

      if (method === 'GET' && pathname === '/api/training/core/strategies') {
        return response(200, getTrainingCoreStrategies(env, deps));
      }

      if (method === 'GET' && pathname === '/api/training/core/equity') {
        return response(200, getTrainingCoreEquity(env, deps));
      }

      if (method === 'GET' && pathname === '/api/training/core/edge') {
        return response(200, getTrainingCoreEdge(env, deps));
      }

      if (method === 'GET' && pathname === '/api/risk') {
        return response(200, context.getRiskConfig());
      }

      if (method === 'POST' && pathname === '/api/risk/update') {
        const candidate = {
          ...createDefaultRiskConfig(),
          ...context.getRiskConfig(),
          ...body,
          trainingCanChangeCriticalRules: false,
          updatedAt: new Date().toISOString()
        };
        const validation = validateRiskConfig(candidate);
        if (!validation.ok) throw new ApiError(409, 'Invalid risk configuration', validation.issues);
        context.setRiskConfig(candidate);
        return response(200, candidate);
      }

      if (method === 'GET' && pathname === '/api/connections') {
        return response(200, getConnectionsSummary(env));
      }

      if (method === 'POST' && pathname === '/api/connections/binance/test') {
        return response(200, await testBinanceConnection(env, deps));
      }

      if (method === 'POST' && pathname === '/api/connections/mt5/test') {
        return response(200, await testMt5Connection(env, deps));
      }

      return null;
    } catch (error) {
      return response(error instanceof ApiError ? error.status : 500, toErrorPayload(error));
    }
  }

  return { dispatch };
}

module.exports = {
  createApiRouter
};
