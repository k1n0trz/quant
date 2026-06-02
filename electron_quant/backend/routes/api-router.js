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
const {
  getTrainingDemoOpenPositions,
  getTrainingDemoRecentTrades,
  getTrainingDemoRecentLessons,
  getTrainingDemoPerformanceSummary
} = require('../training/training-monitoring-service');
const { registerTrainingDemoClosedTrade } = require('../training/training-demo-writer-service');
const { isTrainingBackendLoopEnabled, runTrainingDemoTick } = require('../training/training-loop-service');
const { buildTrainingPositionContexts } = require('../training/training-position-context-service');
const { resolveTrainingMarketContext } = require('../training/training-market-context-service');
const { resolveTrainingSignalContext } = require('../training/training-signal-context-service');
const { generateTrainingSignalCandidates } = require('../training/training-signal-candidate-engine');
const { buildTrainingBotsStatus } = require('../training/bot-registry-service');
const { placeMt5DemoOrder } = require('../adapters/mt5/mt5-demo-order-service');
const {
  runSystemSelfAudit,
  writeSystemSelfAuditStatus,
  readSystemSelfAuditStatus,
  appendSystemSelfAuditHistory,
  readSystemSelfAuditHistory
} = require('../system/system-self-audit-service');
const {
  startTrainingDemoLoopScheduler,
  stopTrainingDemoLoopScheduler,
  getTrainingDemoLoopSchedulerStatus
} = require('../training/training-loop-scheduler');
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
    const loopScheduler = deps.trainingLoopScheduler || {
      startTrainingDemoLoopScheduler,
      stopTrainingDemoLoopScheduler,
      getTrainingDemoLoopSchedulerStatus
    };

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

      if (method === 'POST' && pathname === '/api/system/self-audit/run') {
        const audit = await runSystemSelfAudit({
          env,
          botState: context.getBotState(),
          riskValidation: validateRiskConfig(context.getRiskConfig()),
          deps: {
            ...deps,
            getTrainingLoopStatus: typeof deps.getTrainingLoopStatus === 'function'
              ? deps.getTrainingLoopStatus
              : () => loopScheduler.getTrainingDemoLoopSchedulerStatus({
                env,
                deps,
                logger: context.logger || null
              })
          }
        });
        if (deps.systemSelfAuditStatusFile) writeSystemSelfAuditStatus(deps.systemSelfAuditStatusFile, audit);
        if (deps.systemSelfAuditHistoryFile) appendSystemSelfAuditHistory(deps.systemSelfAuditHistoryFile, audit);
        return response(200, audit);
      }

      if (method === 'GET' && pathname === '/api/system/self-audit/status') {
        return response(200, readSystemSelfAuditStatus(deps.systemSelfAuditStatusFile));
      }

      if (method === 'GET' && pathname === '/api/system/self-audit/history') {
        return response(200, readSystemSelfAuditHistory(deps.systemSelfAuditHistoryFile, body.limit));
      }

      if (method === 'GET' && pathname === '/api/system/self-audit/scheduler/status') {
        const scheduler = deps.systemSelfAuditScheduler;
        return response(200, {
          ok: true,
          scheduler: scheduler && typeof scheduler.status === 'function'
            ? scheduler.status({ env, deps, logger: context.logger || null })
            : { enabled: true, active: false, reason: 'system_self_audit_scheduler_unavailable' },
          safety: {
            readOnly: true,
            writesPerformed: false,
            realTradingTouched: false
          }
        });
      }

      if (method === 'POST' && pathname === '/api/system/self-audit/scheduler/start') {
        const scheduler = deps.systemSelfAuditScheduler;
        const result = scheduler && typeof scheduler.start === 'function'
          ? scheduler.start({ env, deps, logger: context.logger || null })
          : { ok: false, reason: 'system_self_audit_scheduler_unavailable', status: { active: false } };
        return response(result.ok ? 200 : 409, {
          ok: result.ok === true,
          reason: result.reason || null,
          scheduler: result.status,
          safety: {
            readOnly: false,
            writesPerformed: false,
            realTradingTouched: false
          }
        });
      }

      if (method === 'POST' && pathname === '/api/system/self-audit/scheduler/stop') {
        const scheduler = deps.systemSelfAuditScheduler;
        const result = scheduler && typeof scheduler.stop === 'function'
          ? scheduler.stop({ env, deps, logger: context.logger || null })
          : { ok: false, reason: 'system_self_audit_scheduler_unavailable', status: { active: false } };
        return response(result.ok ? 200 : 409, {
          ok: result.ok === true,
          reason: result.reason || null,
          scheduler: result.status,
          safety: {
            readOnly: false,
            writesPerformed: false,
            realTradingTouched: false
          }
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

      if (method === 'POST' && pathname === '/api/training/demo/closed-trade') {
        const result = registerTrainingDemoClosedTrade(env, deps, body);
        return response(result.status, result.body);
      }

      if (method === 'GET' && pathname === '/api/training/demo/state') {
        const snapshot = typeof deps.readTrainingStateSnapshot === 'function'
          ? deps.readTrainingStateSnapshot()
          : null;
        if (!snapshot || snapshot.available !== true) {
          return response(200, {
            ok: true,
            available: false,
            reason: snapshot?.reason || 'training_state_unavailable',
            state: null,
            safety: {
              readOnly: true,
              writesPerformed: false,
              realTradingTouched: false
            }
          });
        }
        return response(200, {
          ok: true,
          available: true,
          reason: null,
          state: snapshot.state,
          safety: {
            readOnly: true,
            writesPerformed: false,
            realTradingTouched: false
          }
        });
      }

      if (method === 'GET' && pathname === '/api/training/demo/positions/open') {
        return response(200, getTrainingDemoOpenPositions(deps));
      }

      if (method === 'GET' && pathname === '/api/training/demo/trades/recent') {
        return response(200, getTrainingDemoRecentTrades(deps, body));
      }

      if (method === 'GET' && pathname === '/api/training/demo/lessons/recent') {
        return response(200, getTrainingDemoRecentLessons(deps, body));
      }

      if (method === 'GET' && pathname === '/api/training/demo/performance/summary') {
        const schedulerStatus = loopScheduler.getTrainingDemoLoopSchedulerStatus({
          env,
          deps,
          logger: context.logger || null
        });
        return response(200, getTrainingDemoPerformanceSummary(deps, schedulerStatus));
      }

      if (method === 'POST' && pathname === '/api/training/demo/tick') {
        if (!isTrainingBackendLoopEnabled(env)) {
          return response(409, {
            ok: false,
            reason: 'training_backend_loop_disabled',
            safety: {
              readOnly: false,
              writesPerformed: false,
              realTradingTouched: false
            }
          });
        }
        const snapshot = typeof deps.readTrainingStateSnapshot === 'function'
          ? deps.readTrainingStateSnapshot()
          : null;
        const hasManualContexts = Array.isArray(body.positionContexts) && body.positionContexts.length > 0;
        const builtContexts = hasManualContexts ? null : await buildTrainingPositionContexts(snapshot?.state || null, deps, { nowMs: body.nowMs, env });
        if (!hasManualContexts && !builtContexts?.ok) {
          return response(409, {
            ok: false,
            reason: builtContexts?.reason || 'training_position_contexts_unavailable',
            safety: {
              readOnly: false,
              writesPerformed: false,
              realTradingTouched: false
            }
          });
        }
        const tickResult = await runTrainingDemoTick({
          state: snapshot?.state || null,
          positionContexts: hasManualContexts ? body.positionContexts : builtContexts.contexts,
          nowMs: body.nowMs,
          env,
          deps
        });
        if (!tickResult.ok) {
          return response(409, {
            ok: false,
            reason: tickResult.reason,
            safety: {
              readOnly: false,
              writesPerformed: false,
              realTradingTouched: false
            }
          });
        }

        let persistence = null;
        if (tickResult.closedPositions > 0 || tickResult.openedPositions > 0) {
          if (typeof deps.writeTrainingState !== 'function') {
            return response(503, {
              ok: false,
              reason: 'training_state_writer_missing',
              safety: {
                readOnly: false,
                writesPerformed: false,
                realTradingTouched: false
              }
            });
          }
          persistence = deps.writeTrainingState(tickResult.nextState);
        }

        return response(200, {
          ok: true,
          tickId: tickResult.tickId,
          evaluatedPositions: tickResult.evaluatedPositions,
          closedPositions: tickResult.closedPositions,
          openedPositions: tickResult.openedPositions,
          skippedPositions: [
            ...(Array.isArray(builtContexts?.skipped) ? builtContexts.skipped : []),
            ...tickResult.skippedPositions
          ],
          skippedEntries: tickResult.skippedEntries,
          balanceBefore: tickResult.balanceBefore,
          balanceAfter: tickResult.balanceAfter,
          lessonPendingCount: tickResult.lessonPendingCount,
          contextSource: hasManualContexts ? 'manual' : 'backend',
          entryEnabled: tickResult.entryEnabled,
          persistence,
          safety: {
            readOnly: false,
            writesPerformed: tickResult.closedPositions > 0 || tickResult.openedPositions > 0,
            realTradingTouched: false
          }
        });
      }

      if (method === 'GET' && pathname === '/api/training/demo/context/status') {
        const snapshot = typeof deps.readTrainingStateSnapshot === 'function'
          ? deps.readTrainingStateSnapshot()
          : null;
        const state = snapshot?.state || null;
        const openPositions = (Array.isArray(state?.positions) ? state.positions : []).filter((position) => !position.exit_price);
        const diagnostics = [];
        for (const position of openPositions) {
          const market = await resolveTrainingMarketContext(position.symbol, {
            venue: position.venue,
            position,
            state: snapshot?.raw || state,
            deps
          });
          const signal = await resolveTrainingSignalContext(position, {
            ...deps,
            state: snapshot?.raw || state,
            env
          });
          diagnostics.push({
            positionId: position.id || null,
            signalId: position.signal_id || null,
            symbol: position.symbol || null,
            venue: position.venue || null,
            horizon: position.horizon || null,
            market,
            signal
          });
        }
        return response(200, {
          ok: true,
          available: snapshot?.available === true,
          reason: snapshot?.available === true ? null : (snapshot?.reason || 'training_state_unavailable'),
          positions: diagnostics,
          safety: {
            readOnly: true,
            writesPerformed: false,
            realTradingTouched: false
          }
        });
      }

      if (method === 'GET' && pathname === '/api/training/demo/signals/candidates') {
        const snapshot = typeof deps.readTrainingStateSnapshot === 'function'
          ? deps.readTrainingStateSnapshot()
          : null;
        const state = snapshot?.state || null;
        const symbols = Array.isArray(state?.activePairs)
          ? state.activePairs.map((pair) => ({ symbol: pair.symbol, venue: pair.venue, ...pair }))
          : [];
        const candidates = await generateTrainingSignalCandidates(symbols, {
          state: snapshot?.raw || state,
          env,
          deps
        });
        return response(200, {
          ok: true,
          available: snapshot?.available === true,
          reason: snapshot?.available === true ? null : (snapshot?.reason || 'training_state_unavailable'),
          candidates,
          safety: {
            readOnly: true,
            writesPerformed: false,
            realTradingTouched: false
          }
        });
      }

      if (method === 'GET' && pathname === '/api/training/bots/status') {
        const snapshot = typeof deps.readTrainingStateSnapshot === 'function'
          ? deps.readTrainingStateSnapshot()
          : null;
        return response(200, buildTrainingBotsStatus({
          templatesRoot: deps.botTemplatesRoot,
          state: snapshot?.state || snapshot?.raw || {}
        }));
      }

      if (method === 'GET' && pathname === '/api/training/demo/loop/status') {
        return response(200, {
          ok: true,
          scheduler: loopScheduler.getTrainingDemoLoopSchedulerStatus({
            env,
            deps,
            logger: context.logger || null
          }),
          safety: {
            readOnly: true,
            writesPerformed: false,
            realTradingTouched: false
          }
        });
      }

      if (method === 'POST' && pathname === '/api/training/demo/loop/start') {
        const result = loopScheduler.startTrainingDemoLoopScheduler({
          env,
          deps,
          logger: context.logger || null
        });
        if (!result.ok) {
          return response(409, {
            ok: false,
            reason: result.reason,
            scheduler: result.status,
            safety: {
              readOnly: false,
              writesPerformed: false,
              realTradingTouched: false
            }
          });
        }
        return response(200, {
          ok: true,
          alreadyRunning: result.alreadyRunning === true,
          scheduler: result.status,
          safety: {
            readOnly: false,
            writesPerformed: false,
            realTradingTouched: false
          }
        });
      }

      if (method === 'POST' && pathname === '/api/training/demo/loop/stop') {
        const result = loopScheduler.stopTrainingDemoLoopScheduler({
          env,
          deps,
          logger: context.logger || null
        });
        return response(200, {
          ok: true,
          scheduler: result.status,
          safety: {
            readOnly: false,
            writesPerformed: false,
            realTradingTouched: false
          }
        });
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

      if (method === 'POST' && pathname === '/api/mt5-demo/order') {
        const executor = typeof deps.placeMt5DemoOrder === 'function'
          ? deps.placeMt5DemoOrder
          : (input) => placeMt5DemoOrder(input, { env });
        const result = await executor(body);
        return response(result.ok ? 200 : 409, {
          ...result,
          safety: {
            demoOnly: true,
            realTradingTouched: false
          }
        });
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
