// Profit harvest: skim realized trading profit out of the Spot quote balance
// into USDC Simple-Earn Flexible, so gains are protected from being re-risked
// and accumulate in a yield wallet the operator uses.
//
// Design: the operator keeps a configured "trading float" working in Spot. Any
// free quote balance (USDT) above that float is treated as realized profit and
// harvested: USDT -> USDC (market convert) -> subscribe to USDC Flexible Earn.
// It NEVER touches Earn/Funding except to deposit INTO Earn, never redeems, and
// never sells the asset positions the scheduler holds.

function boolFlag(value) {
  return String(value || 'false').trim().toLowerCase() === 'true';
}

function finiteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function clampNumber(value, fallback, min, max) {
  const n = finiteNumber(value);
  const resolved = n === null ? fallback : n;
  return Math.max(min, Math.min(max, resolved));
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function resolveHarvestConfig(env = {}) {
  return {
    enabled: boolFlag(env.REAL_AUTONOMOUS_PROFIT_HARVEST_ENABLED),
    floatUsdt: clampNumber(env.REAL_AUTONOMOUS_TRADING_FLOAT_USDT, 12, 0, 1e9),
    minHarvestUsdt: clampNumber(env.REAL_AUTONOMOUS_PROFIT_HARVEST_MIN_USDT, 5, 1, 1e9),
    maxHarvestUsdt: clampNumber(env.REAL_AUTONOMOUS_PROFIT_HARVEST_MAX_USDT, 1000, 1, 1e9),
    earnProductId: String(env.REAL_AUTONOMOUS_PROFIT_HARVEST_EARN_PRODUCT || 'USDC001').trim() || 'USDC001'
  };
}

// Pure decision: how much USDT (if any) to harvest given the free balance.
function planProfitHarvest({ usdtFree, floatUsdt, minHarvestUsdt, maxHarvestUsdt, minNotionalUsdt = 1 } = {}) {
  const free = finiteNumber(usdtFree) || 0;
  const float = Math.max(0, finiteNumber(floatUsdt) || 0);
  const minH = Math.max(minNotionalUsdt, finiteNumber(minHarvestUsdt) || 0);
  const maxH = Math.max(minH, finiteNumber(maxHarvestUsdt) || minH);
  const excess = round2(free - float);
  if (excess < minH) {
    return { shouldHarvest: false, amountUsdt: 0, excess, reason: excess <= 0 ? 'no_profit_above_float' : 'below_min_harvest' };
  }
  const amountUsdt = round2(Math.min(excess, maxH));
  return { shouldHarvest: true, amountUsdt, excess, reason: null };
}

// Execute the harvest with injected deps:
//   deps.getQuoteFree(asset)        -> number (free spot balance)
//   deps.convertUsdtToUsdc(amount)  -> { ok, usdcReceived, ... }
//   deps.subscribeUsdcEarn(amount, productId) -> { ok, ... }
//   deps.getUsdcUsdtMinNotional()   -> number (optional)
async function runProfitHarvest({ env = {}, deps = {}, logger = null } = {}) {
  const cfg = resolveHarvestConfig(env);
  if (!cfg.enabled) return { ok: true, ran: false, reason: 'profit_harvest_disabled' };
  if (typeof deps.getQuoteFree !== 'function'
    || typeof deps.convertUsdtToUsdc !== 'function'
    || typeof deps.subscribeUsdcEarn !== 'function') {
    return { ok: false, ran: false, reason: 'harvest_deps_missing' };
  }

  let usdtFree;
  try {
    usdtFree = finiteNumber(await deps.getQuoteFree('USDT')) || 0;
  } catch (error) {
    return { ok: false, ran: false, reason: 'balance_read_failed', error: String(error?.message || error) };
  }

  const minNotionalUsdt = typeof deps.getUsdcUsdtMinNotional === 'function'
    ? (finiteNumber(await deps.getUsdcUsdtMinNotional().catch(() => null)) || 1)
    : 1;

  const plan = planProfitHarvest({
    usdtFree,
    floatUsdt: cfg.floatUsdt,
    minHarvestUsdt: cfg.minHarvestUsdt,
    maxHarvestUsdt: cfg.maxHarvestUsdt,
    minNotionalUsdt
  });
  if (!plan.shouldHarvest) {
    return { ok: true, ran: false, reason: plan.reason, usdtFree, floatUsdt: cfg.floatUsdt, excess: plan.excess };
  }

  // 1. Convert USDT -> USDC (spend plan.amountUsdt of USDT).
  let convert;
  try {
    convert = await deps.convertUsdtToUsdc(plan.amountUsdt);
  } catch (error) {
    return { ok: false, ran: false, reason: 'convert_failed', error: String(error?.message || error), plan };
  }
  if (!convert || convert.ok !== true) {
    return { ok: false, ran: false, reason: 'convert_rejected', detail: convert?.error || null, plan };
  }
  const usdcReceived = finiteNumber(convert.usdcReceived, convert.qty, convert.executedQty) || 0;
  if (usdcReceived <= 0) {
    return { ok: false, ran: false, reason: 'convert_zero_received', plan, convert };
  }

  // 2. Subscribe the received USDC to Flexible Earn.
  let subscribe;
  try {
    subscribe = await deps.subscribeUsdcEarn(usdcReceived, cfg.earnProductId);
  } catch (error) {
    // USDC is already in Spot; surface so the next tick can retry the subscribe.
    return { ok: false, ran: true, reason: 'earn_subscribe_failed', error: String(error?.message || error), plan, usdcReceived };
  }
  if (!subscribe || subscribe.ok !== true) {
    return { ok: false, ran: true, reason: 'earn_subscribe_rejected', detail: subscribe?.error || null, plan, usdcReceived };
  }

  const result = {
    ok: true,
    ran: true,
    harvestedUsdt: plan.amountUsdt,
    usdcSubscribed: round2(usdcReceived),
    earnProductId: cfg.earnProductId,
    floatUsdt: cfg.floatUsdt,
    usdtFreeBefore: usdtFree,
    ts: new Date().toISOString()
  };
  if (logger && typeof logger.info === 'function') logger.info('binance.profit_harvest', result);
  return result;
}

module.exports = {
  resolveHarvestConfig,
  planProfitHarvest,
  runProfitHarvest
};
