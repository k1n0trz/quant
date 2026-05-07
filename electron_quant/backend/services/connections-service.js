const { retryWithBackoff } = require('../utils/retry');

async function testBinanceConnection(env, deps = {}) {
  const { syncBinanceTime } = deps;
  if (!env.BINANCE_API_KEY || !env.BINANCE_SECRET) {
    return { ok: false, adapter: 'binance', message: 'Missing BINANCE_API_KEY or BINANCE_SECRET' };
  }
  if (typeof syncBinanceTime !== 'function') {
    return { ok: false, adapter: 'binance', message: 'Binance adapter not attached' };
  }
  await retryWithBackoff(() => syncBinanceTime(), { retries: 2, baseDelayMs: 250 });
  return { ok: true, adapter: 'binance', primary: true };
}

async function testMt5Connection(env, deps = {}) {
  const { mt5AccountInfo } = deps;
  if (String(env.MT5_CONNECTOR_ENABLED || 'false').toLowerCase() !== 'true') {
    return { ok: false, adapter: 'mt5', optional: true, message: 'MT5 adapter disabled' };
  }
  if (typeof mt5AccountInfo !== 'function') {
    return { ok: false, adapter: 'mt5', optional: true, message: 'MT5 adapter not attached' };
  }
  const info = await retryWithBackoff(() => mt5AccountInfo(env), { retries: 1, baseDelayMs: 250 });
  return {
    ok: Boolean(info && info.available),
    adapter: 'mt5',
    optional: true,
    info
  };
}

function getConnectionsSummary(env) {
  return {
    adapters: {
      binance: {
        required: true,
        configured: Boolean(env.BINANCE_API_KEY && env.BINANCE_SECRET)
      },
      mt5: {
        optional: true,
        enabled: String(env.MT5_CONNECTOR_ENABLED || 'false').toLowerCase() === 'true'
      }
    }
  };
}

module.exports = {
  testBinanceConnection,
  testMt5Connection,
  getConnectionsSummary
};
