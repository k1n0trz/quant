const {
  isTrainingBackendLoopEnabled
} = require('./training-loop-service');
const {
  isTrainingBackendLoopSchedulerEnabled,
  startTrainingDemoLoopScheduler
} = require('./training-loop-scheduler');

function createLoggerFacade(logger = null) {
  return {
    info(event, payload) {
      if (logger && typeof logger.info === 'function') logger.info(event, payload);
    },
    error(event, payload) {
      if (logger && typeof logger.error === 'function') logger.error(event, payload);
    }
  };
}

function autoStartTrainingDemoLoopScheduler(options = {}) {
  const env = options.env || {};
  const deps = options.deps || {};
  const scheduler = options.scheduler || { startTrainingDemoLoopScheduler };
  const logger = createLoggerFacade(options.logger);

  if (!isTrainingBackendLoopEnabled(env)) {
    logger.info('training.loop.autostart.skipped', {
      reason: 'training_backend_loop_disabled'
    });
    return {
      ok: true,
      started: false,
      reason: 'training_backend_loop_disabled'
    };
  }

  if (!isTrainingBackendLoopSchedulerEnabled(env)) {
    logger.info('training.loop.autostart.skipped', {
      reason: 'training_backend_loop_scheduler_disabled'
    });
    return {
      ok: true,
      started: false,
      reason: 'training_backend_loop_scheduler_disabled'
    };
  }

  try {
    const result = scheduler.startTrainingDemoLoopScheduler({
      env,
      deps,
      logger: options.logger || null
    });
    if (!result || result.ok !== true) {
      logger.error('training.loop.autostart.failed', {
        reason: result?.reason || 'training_backend_loop_autostart_failed',
        status: result?.status || null
      });
      return {
        ok: false,
        started: false,
        reason: result?.reason || 'training_backend_loop_autostart_failed',
        status: result?.status || null
      };
    }

    logger.info('training.loop.autostart.started', {
      alreadyRunning: result.alreadyRunning === true,
      status: result.status || null
    });
    return {
      ok: true,
      started: true,
      alreadyRunning: result.alreadyRunning === true,
      status: result.status || null
    };
  } catch (error) {
    logger.error('training.loop.autostart.failed', {
      reason: 'training_backend_loop_autostart_exception',
      error: String(error?.message || error)
    });
    return {
      ok: false,
      started: false,
      reason: 'training_backend_loop_autostart_exception',
      error: String(error?.message || error)
    };
  }
}

module.exports = {
  autoStartTrainingDemoLoopScheduler
};
