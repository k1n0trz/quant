const test = require('node:test');
const assert = require('node:assert/strict');

const { planProfitHarvest, runProfitHarvest, resolveHarvestConfig } = require('../backend/execution/binance-profit-harvest');

test('no harvest when balance is at or below the trading float', () => {
  const p = planProfitHarvest({ usdtFree: 12, floatUsdt: 12, minHarvestUsdt: 5, maxHarvestUsdt: 1000 });
  assert.equal(p.shouldHarvest, false);
  assert.equal(p.reason, 'no_profit_above_float');
});

test('no harvest when profit above float is below the minimum', () => {
  const p = planProfitHarvest({ usdtFree: 15, floatUsdt: 12, minHarvestUsdt: 5, maxHarvestUsdt: 1000 });
  assert.equal(p.shouldHarvest, false);
  assert.equal(p.reason, 'below_min_harvest');
});

test('harvests the excess above the float once it clears the minimum', () => {
  const p = planProfitHarvest({ usdtFree: 30, floatUsdt: 12, minHarvestUsdt: 5, maxHarvestUsdt: 1000 });
  assert.equal(p.shouldHarvest, true);
  assert.equal(p.amountUsdt, 18);
});

test('harvest is capped by the per-run maximum', () => {
  const p = planProfitHarvest({ usdtFree: 5000, floatUsdt: 12, minHarvestUsdt: 5, maxHarvestUsdt: 100 });
  assert.equal(p.shouldHarvest, true);
  assert.equal(p.amountUsdt, 100);
});

test('min harvest is floored by the pair min notional', () => {
  // minHarvest 2 but USDCUSDT min notional 6 -> needs 6 above float
  const below = planProfitHarvest({ usdtFree: 16, floatUsdt: 12, minHarvestUsdt: 2, maxHarvestUsdt: 1000, minNotionalUsdt: 6 });
  assert.equal(below.shouldHarvest, false);
  const ok = planProfitHarvest({ usdtFree: 20, floatUsdt: 12, minHarvestUsdt: 2, maxHarvestUsdt: 1000, minNotionalUsdt: 6 });
  assert.equal(ok.shouldHarvest, true);
  assert.equal(ok.amountUsdt, 8);
});

test('runProfitHarvest is a no-op when disabled', async () => {
  const r = await runProfitHarvest({ env: {}, deps: {} });
  assert.equal(r.ran, false);
  assert.equal(r.reason, 'profit_harvest_disabled');
});

test('runProfitHarvest converts then subscribes, never redeeming Earn', async () => {
  const calls = [];
  const env = {
    REAL_AUTONOMOUS_PROFIT_HARVEST_ENABLED: 'true',
    REAL_AUTONOMOUS_TRADING_FLOAT_USDT: '12',
    REAL_AUTONOMOUS_PROFIT_HARVEST_MIN_USDT: '5'
  };
  const deps = {
    getQuoteFree: async (a) => { calls.push(['getQuoteFree', a]); return 30; },
    getUsdcUsdtMinNotional: async () => 1,
    convertUsdtToUsdc: async (amt) => { calls.push(['convert', amt]); return { ok: true, usdcReceived: amt - 0.01 }; },
    subscribeUsdcEarn: async (amt, pid) => { calls.push(['subscribe', amt, pid]); return { ok: true }; }
  };
  const r = await runProfitHarvest({ env, deps });
  assert.equal(r.ok, true);
  assert.equal(r.ran, true);
  assert.equal(r.harvestedUsdt, 18);
  assert.equal(r.earnProductId, 'USDC001');
  // order: balance -> convert -> subscribe; no redeem/transfer calls present
  assert.deepEqual(calls.map((c) => c[0]), ['getQuoteFree', 'convert', 'subscribe']);
});

test('runProfitHarvest surfaces a failed subscribe without losing the converted USDC', async () => {
  const env = { REAL_AUTONOMOUS_PROFIT_HARVEST_ENABLED: 'true', REAL_AUTONOMOUS_TRADING_FLOAT_USDT: '12', REAL_AUTONOMOUS_PROFIT_HARVEST_MIN_USDT: '5' };
  const deps = {
    getQuoteFree: async () => 30,
    convertUsdtToUsdc: async (amt) => ({ ok: true, usdcReceived: amt }),
    subscribeUsdcEarn: async () => ({ ok: false, error: 'earn_down' })
  };
  const r = await runProfitHarvest({ env, deps });
  assert.equal(r.ok, false);
  assert.equal(r.ran, true);
  assert.equal(r.reason, 'earn_subscribe_rejected');
  assert.equal(r.usdcReceived, 18);
});

test('resolveHarvestConfig clamps and defaults', () => {
  const c = resolveHarvestConfig({});
  assert.equal(c.enabled, false);
  assert.equal(c.floatUsdt, 12);
  assert.equal(c.minHarvestUsdt, 5);
  assert.equal(c.earnProductId, 'USDC001');
});
