const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDefaultRiskConfig } = require('../backend/risk/risk-policy');
const {
  executeBinanceRealOrder,
  preflightBinanceRealOrder,
  summarizeBinanceRealOrderAudit,
  appendBinanceRealOrderAudit,
  readBinanceRealOrderAudit
} = require('../backend/execution/binance-real-order-service');

function armedContext(overrides = {}) {
  return {
    env: { REAL_TRADING: 'true', BINANCE_API_KEY: 'k', BINANCE_SECRET: 's', ...overrides.env },
    botState: { tradingRealEnabled: true, killSwitch: false, paperMode: false, ...overrides.botState },
    riskConfig: { ...createDefaultRiskConfig(), ...overrides.riskConfig },
    deps: overrides.deps || {}
  };
}

test('executes a Binance real order through the injected executor and marks real trading touched', async () => {
  const calls = [];
  const result = await executeBinanceRealOrder({
    input: { venue: 'BINANCE', side: 'BUY', symbol: 'btcusdt', qty: '0.001', type: 'market' },
    ...armedContext({
      deps: {
        placeOrderBinance: async (...args) => {
          calls.push(args);
          return { ok: true, orderId: 123, status: 'FILLED', symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', qty: 0.001, price: 65000, notional: 65 };
        }
      }
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.safety.realTradingTouched, true);
  assert.deepEqual(calls, [['BUY', 'BTCUSDT', 0.001, 'MARKET', null]]);
  assert.equal(result.order.orderId, 123);
});

test('autonomous Binance real order requires SL TP protection before accepting execution', async () => {
  let placed = false;
  const result = await executeBinanceRealOrder({
    input: {
      venue: 'BINANCE',
      side: 'BUY',
      symbol: 'ACXUSDT',
      qty: 100,
      type: 'MARKET',
      entryPrice: 0.041,
      stopLoss: 0.04018,
      takeProfit: 0.04223,
      reason: 'real-autonomous-scheduler'
    },
    ...armedContext({
      deps: {
        placeOrderBinance: async () => { placed = true; return { ok: true, orderId: 1 }; }
      }
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.safety.realTradingTouched, false);
  assert.equal(placed, false);
  assert.match(result.error, /proteccion/i);
});

test('autonomous Binance real order places protection after filled spot entry', async () => {
  const orders = [];
  const protections = [];
  const result = await executeBinanceRealOrder({
    input: {
      venue: 'BINANCE',
      side: 'BUY',
      symbol: 'ACXUSDT',
      qty: 100,
      type: 'MARKET',
      entryPrice: 0.041,
      stopLoss: 0.04018,
      takeProfit: 0.04223,
      reason: 'real-autonomous-scheduler'
    },
    ...armedContext({
      deps: {
        placeOrderBinance: async (...args) => {
          orders.push(args);
          return { ok: true, orderId: 321, status: 'FILLED', symbol: 'ACXUSDT', side: 'BUY', type: 'MARKET', qty: 100, price: 0.041, notional: 4.1 };
        },
        placeProtectionBinance: async (request, order) => {
          protections.push({ request, order });
          return { ok: true, orderListId: 99, symbol: request.symbol };
        }
      }
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'executed');
  assert.deepEqual(orders, [['BUY', 'ACXUSDT', 100, 'MARKET', null]]);
  assert.equal(protections.length, 1);
  assert.equal(protections[0].request.stopLoss, 0.04018);
  assert.equal(protections[0].request.takeProfit, 0.04223);
  assert.equal(result.protection.ok, true);
});

test('manual Binance BUY with SL TP places OCO protection after filled spot entry', async () => {
  const protections = [];
  const result = await executeBinanceRealOrder({
    input: {
      venue: 'BINANCE',
      side: 'BUY',
      symbol: 'ACXUSDT',
      qty: 100,
      type: 'MARKET',
      stopLoss: 0.04018,
      takeProfit: 0.04223,
      reason: 'manual-real-order'
    },
    ...armedContext({
      deps: {
        placeOrderBinance: async () => ({ ok: true, orderId: 777, status: 'FILLED', symbol: 'ACXUSDT', side: 'BUY', type: 'MARKET', qty: 100, price: 0.041, notional: 4.1 }),
        placeProtectionBinance: async (request, order) => {
          protections.push({ request, order });
          return { ok: true, orderListId: 1001, symbol: request.symbol };
        }
      }
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'executed');
  assert.equal(protections.length, 1);
  assert.equal(protections[0].request.reason, 'manual-real-order');
  assert.equal(result.protection.orderListId, 1001);
});

test('manual Binance SL TP request blocks before entry when protection handler is unavailable', async () => {
  let placed = false;
  const result = await executeBinanceRealOrder({
    input: {
      venue: 'BINANCE',
      side: 'BUY',
      symbol: 'ACXUSDT',
      qty: 100,
      type: 'MARKET',
      stopLoss: 0.04018,
      takeProfit: 0.04223,
      reason: 'manual-real-order'
    },
    ...armedContext({
      deps: {
        placeOrderBinance: async () => { placed = true; return { ok: true, orderId: 1 }; }
      }
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(placed, false);
  assert.match(result.error, /proteccion/i);
});

test('autonomous Binance real order reports protection_failed when OCO placement fails after entry', async () => {
  const result = await executeBinanceRealOrder({
    input: {
      venue: 'BINANCE',
      side: 'BUY',
      symbol: 'ACXUSDT',
      qty: 100,
      type: 'MARKET',
      entryPrice: 0.041,
      stopLoss: 0.04018,
      takeProfit: 0.04223,
      reason: 'real-autonomous-scheduler'
    },
    ...armedContext({
      deps: {
        placeOrderBinance: async () => ({ ok: true, orderId: 654, status: 'FILLED', symbol: 'ACXUSDT', side: 'BUY', type: 'MARKET', qty: 100, price: 0.041 }),
        placeProtectionBinance: async () => { throw new Error('oco_rejected'); }
      }
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'protection_failed');
  assert.equal(result.order.orderId, 654);
  assert.equal(result.protection.ok, false);
  assert.match(result.error, /oco_rejected/);
  assert.equal(result.safety.realTradingTouched, true);
});

test('blocks real order when runtime is not armed and never calls executor', async () => {
  let called = false;
  const result = await executeBinanceRealOrder({
    input: { venue: 'BINANCE', side: 'BUY', symbol: 'BTCUSDT', qty: 0.001, type: 'MARKET' },
    ...armedContext({
      env: { REAL_TRADING: 'false' },
      deps: { placeOrderBinance: async () => { called = true; } }
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.safety.realTradingTouched, false);
  assert.equal(called, false);
  assert.match(result.error, /REAL_TRADING/i);
});

test('preflight blocks insufficient Binance balance before executor is touched', async () => {
  let called = false;
  const result = await executeBinanceRealOrder({
    input: { venue: 'BINANCE', side: 'BUY', symbol: 'BTCUSDT', qty: 0.001, type: 'MARKET' },
    ...armedContext({
      deps: {
        getSymbolFilters: async () => ({ minQty: 0.00001, stepSize: 0.00001, minNotional: 5, status: 'TRADING', quoteAsset: 'USDT' }),
        getTicker: async () => ({ price: 65000 }),
        getBinanceSpotBalance: async () => ({ asset: 'USDT', free: 0.005, locked: 0 }),
        placeOrderBinance: async () => { called = true; return { ok: true }; }
      }
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.safety.realTradingTouched, false);
  assert.equal(called, false);
  assert.match(result.error, /saldo insuficiente/i);
  assert.equal(result.preflight.quoteFree, 0.005);
  assert.equal(result.preflight.requestedNotional, 65);
});

test('preflight reports Earn funds as non-spot liquidity when they can cover the shortfall', async () => {
  const result = await preflightBinanceRealOrder({
    input: { venue: 'BINANCE', side: 'BUY', symbol: 'BTCUSDT', qty: 0.0002, type: 'MARKET' },
    env: { REAL_TRADING: 'true', BINANCE_API_KEY: 'k', BINANCE_SECRET: 's' },
    botState: { tradingRealEnabled: true, killSwitch: false },
    riskConfig: createDefaultRiskConfig(),
    deps: {
      getSymbolFilters: async () => ({ minQty: 0.00001, stepSize: 0.00001, minNotional: 5, status: 'TRADING', quoteAsset: 'USDT' }),
      getTicker: async () => ({ price: 68000 }),
      getBinanceSpotBalance: async () => ({ asset: 'USDT', free: 0, locked: 0 }),
      getBinanceEarnBalance: async () => ({
        asset: 'USDT',
        total: 55,
        redeemable: 55,
        positions: [{ productId: 'USDT001', asset: 'USDT', totalAmount: '55', redeemableAmount: '55' }]
      })
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.quoteFree, 0);
  assert.equal(result.requestedNotional, 13.6);
  assert.equal(result.spotShortfall, 13.6);
  assert.equal(result.earn.redeemable, 55);
  assert.equal(result.canCoverWithEarn, true);
  assert.equal(result.checks.earnCanCoverShortfall, true);
  assert.match(result.reasons.join(' '), /Earn Flexible/i);
});

test('preflight reports ready sizing when balance and minNotional are valid', async () => {
  const result = await preflightBinanceRealOrder({
    input: { venue: 'BINANCE', side: 'BUY', symbol: 'BTCUSDT', qty: 0.001, type: 'MARKET' },
    env: { REAL_TRADING: 'true', BINANCE_API_KEY: 'k', BINANCE_SECRET: 's' },
    botState: { tradingRealEnabled: true, killSwitch: false },
    riskConfig: createDefaultRiskConfig(),
    deps: {
      getSymbolFilters: async () => ({ minQty: 0.00001, stepSize: 0.00001, minNotional: 5, status: 'TRADING', quoteAsset: 'USDT' }),
      getTicker: async () => ({ price: 65000 }),
      getBinanceSpotBalance: async () => ({ asset: 'USDT', free: 100, locked: 0 })
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'ready');
  assert.equal(result.requestedNotional, 65);
  assert.equal(result.quoteFree, 100);
  assert.equal(result.checks.balanceEnough, true);
  assert.equal(result.checks.minNotionalOk, true);
  assert.equal(result.suggestedQty, 0.001);
});

test('preflight blocks Binance API key symbol whitelist failures before real order placement', async () => {
  const result = await preflightBinanceRealOrder({
    input: { venue: 'BINANCE', side: 'BUY', symbol: 'ALLOUSDC', qty: 57, type: 'MARKET' },
    env: { REAL_TRADING: 'true', BINANCE_API_KEY: 'k', BINANCE_SECRET: 's' },
    botState: { tradingRealEnabled: true, killSwitch: false },
    riskConfig: createDefaultRiskConfig(),
    deps: {
      getSymbolFilters: async () => ({ minQty: 0.1, stepSize: 0.1, minNotional: 5, status: 'TRADING', quoteAsset: 'USDC' }),
      getTicker: async () => ({ price: 0.1755 }),
      getBinanceSpotBalance: async () => ({ asset: 'USDC', free: 30, locked: 0 }),
      testOrderBinance: async () => ({ ok: false, error: 'HTTP 400: {"code":-2010,"msg":"Symbol not whitelisted for API key."}' })
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'blocked');
  assert.equal(result.checks.orderTestOk, false);
  assert.match(result.reasons.join(' '), /whitelisted/i);
});

test('preflight and execution support Binance Spot USDC quote pairs', async () => {
  const calls = [];
  const result = await executeBinanceRealOrder({
    input: { venue: 'BINANCE', side: 'BUY', symbol: 'btcusdc', qty: 0.0002, type: 'MARKET' },
    ...armedContext({
      deps: {
        getSymbolFilters: async (symbol) => {
          assert.equal(symbol, 'BTCUSDC');
          return { minQty: 0.00001, stepSize: 0.00001, minNotional: 5, status: 'TRADING', quoteAsset: 'USDC' };
        },
        getTicker: async (symbol) => {
          assert.equal(symbol, 'BTCUSDC');
          return { price: 68000 };
        },
        getBinanceSpotBalance: async (asset) => {
          assert.equal(asset, 'USDC');
          return { asset: 'USDC', free: 30, locked: 0 };
        },
        placeOrderBinance: async (...args) => {
          calls.push(args);
          return { ok: true, orderId: 456, status: 'FILLED', symbol: 'BTCUSDC', side: 'BUY', type: 'MARKET', qty: 0.0002, price: 68000, notional: 13.6 };
        }
      }
    })
  });

  assert.equal(result.ok, true);
  assert.equal(result.order.orderId, 456);
  assert.deepEqual(calls, [['BUY', 'BTCUSDC', 0.0002, 'MARKET', null]]);
});

test('rejects unsupported venue side type and invalid limit price before executor', async () => {
  for (const input of [
    { venue: 'MT5', side: 'BUY', symbol: 'XAUUSD', qty: 0.01, type: 'MARKET' },
    { venue: 'BINANCE', side: 'SHORT', symbol: 'BTCUSDT', qty: 0.001, type: 'MARKET' },
    { venue: 'BINANCE', side: 'BUY', symbol: 'BTCUSDT', qty: 0.001, type: 'STOP' },
    { venue: 'BINANCE', side: 'BUY', symbol: 'BTCUSDT', qty: 0.001, type: 'LIMIT' }
  ]) {
    const result = await executeBinanceRealOrder({
      input,
      ...armedContext({ deps: { placeOrderBinance: async () => { throw new Error('executor_should_not_run'); } } })
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'blocked');
    assert.equal(result.safety.realTradingTouched, false);
  }
});

test('binance real order audit is compact append-only and sanitized', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-binance-real-audit-'));
  const file = path.join(dir, 'audit.jsonl');
  const entry = summarizeBinanceRealOrderAudit({
    request: { rawText: 'Bearer abc token=secret', symbol: 'BTCUSDT', side: 'BUY', qty: 0.001 },
    result: { ok: false, status: 'blocked', error: 'sk-test token=abc', safety: { realTradingTouched: false } },
    now: () => new Date('2026-06-02T12:00:00.000Z')
  });

  appendBinanceRealOrderAudit(file, entry);
  appendBinanceRealOrderAudit(file, { ...entry, ts: '2026-06-02T12:01:00.000Z' });
  const read = readBinanceRealOrderAudit(file, 1);
  const raw = fs.readFileSync(file, 'utf8');

  assert.equal(read.entries.length, 1);
  assert.equal(read.entries[0].ts, '2026-06-02T12:01:00.000Z');
  assert.equal(/Bearer abc|sk-test|token=abc/.test(raw), false);
  assert.equal(JSON.stringify(entry).includes('fills'), false);
});

test('discovers executable Binance Spot universe from balances filters and order-test instead of preferring BTC only', async () => {
  const {
    discoverBinanceRealSpotUniverse
  } = require('../backend/execution/binance-real-order-service');
  const tested = [];
  const result = await discoverBinanceRealSpotUniverse({
    symbols: ['BTCUSDC', 'ALLOUSDC', 'ACXUSDC', 'ETHUSDT', 'BADBTC'],
    env: { REAL_TRADING: 'true', BINANCE_API_KEY: 'k', BINANCE_SECRET: 's' },
    botState: { tradingRealEnabled: true, killSwitch: false },
    riskConfig: createDefaultRiskConfig(),
    deps: {
      getSymbolFilters: async (symbol) => {
        const filters = {
          BTCUSDC: { minQty: 0.00001, stepSize: 0.00001, minNotional: 5, status: 'TRADING', quoteAsset: 'USDC' },
          ALLOUSDC: { minQty: 1, stepSize: 1, minNotional: 5, status: 'TRADING', quoteAsset: 'USDC' },
          ACXUSDC: { minQty: 1, stepSize: 1, minNotional: 5, status: 'TRADING', quoteAsset: 'USDC' },
          ETHUSDT: { minQty: 0.0001, stepSize: 0.0001, minNotional: 5, status: 'TRADING', quoteAsset: 'USDT' }
        };
        return filters[symbol] || { minQty: 1, stepSize: 1, minNotional: 5, status: 'BREAK', quoteAsset: 'BTC' };
      },
      getTicker: async (symbol) => ({
        BTCUSDC: { price: 68000 },
        ALLOUSDC: { price: 0.17 },
        ACXUSDC: { price: 0.041 },
        ETHUSDT: { price: 3000 }
      }[symbol] || { price: 0 }),
      getBinanceSpotBalance: async (asset) => ({ asset, free: asset === 'USDC' ? 30 : 0, locked: 0 }),
      testOrderBinance: async (side, symbol, qty) => {
        tested.push({ side, symbol, qty });
        return symbol === 'ALLOUSDC'
          ? { ok: false, error: 'Symbol not whitelisted for API key.' }
          : { ok: true };
      }
    },
    limit: 10
  });

  assert.equal(result.ok, true);
  assert.equal(result.readyCount, 2);
  assert.deepEqual(result.ready.map((item) => item.symbol), ['BTCUSDC', 'ACXUSDC']);
  assert.equal(result.ready.every((item) => item.quoteAsset === 'USDC'), true);
  assert.equal(result.blocked.some((item) => item.symbol === 'ALLOUSDC' && /whitelisted/i.test(item.reason)), true);
  assert.equal(tested.some((item) => item.symbol === 'ETHUSDT'), false);
  assert.equal(result.balances.USDC.free, 30);
});

test('real Spot universe discovery times out slow symbols instead of blocking the request', async () => {
  const {
    discoverBinanceRealSpotUniverse
  } = require('../backend/execution/binance-real-order-service');
  const startedAt = Date.now();
  const result = await discoverBinanceRealSpotUniverse({
    symbols: ['SLOWUSDC', 'FASTUSDC'],
    env: { REAL_TRADING: 'true', BINANCE_API_KEY: 'k', BINANCE_SECRET: 's' },
    botState: { tradingRealEnabled: true, killSwitch: false },
    riskConfig: createDefaultRiskConfig(),
    deps: {
      getSymbolFilters: async (symbol) => {
        if (symbol === 'SLOWUSDC') await new Promise((resolve) => setTimeout(resolve, 80));
        return { minQty: 1, stepSize: 1, minNotional: 5, status: 'TRADING', quoteAsset: 'USDC' };
      },
      getTicker: async () => ({ price: 1 }),
      getBinanceSpotBalance: async (asset) => ({ asset, free: 30, locked: 0 }),
      testOrderBinance: async () => ({ ok: true })
    },
    limit: 10,
    maxChecks: 2,
    concurrency: 2,
    perCandidateTimeoutMs: 20
  });

  assert.equal(result.ready.some((item) => item.symbol === 'FASTUSDC'), true);
  assert.equal(result.blocked.some((item) => item.symbol === 'SLOWUSDC' && /timeout/i.test(item.reason)), true);
  assert.equal(Date.now() - startedAt < 250, true);
});

test('real Spot universe discovery prioritizes liquid quote pairs before alphabetical altcoins', async () => {
  const {
    discoverBinanceRealSpotUniverse
  } = require('../backend/execution/binance-real-order-service');
  const tested = [];
  const result = await discoverBinanceRealSpotUniverse({
    symbols: ['0GUSDC', '1000SATSUSDC', 'BTCUSDC'],
    env: { REAL_TRADING: 'true', BINANCE_API_KEY: 'k', BINANCE_SECRET: 's' },
    botState: { tradingRealEnabled: true, killSwitch: false },
    riskConfig: createDefaultRiskConfig(),
    deps: {
      getSymbolFilters: async (symbol) => ({ minQty: 0.00001, stepSize: 0.00001, minNotional: 5, status: 'TRADING', quoteAsset: symbol.endsWith('USDC') ? 'USDC' : 'USDT' }),
      getTicker: async (symbol) => ({ price: symbol === 'BTCUSDC' ? 68000 : 1 }),
      getBinanceSpotBalance: async (asset) => ({ asset, free: asset === 'USDC' ? 30 : 0, locked: 0 }),
      testOrderBinance: async (_side, symbol) => {
        tested.push(symbol);
        return { ok: true };
      }
    },
    limit: 1,
    maxChecks: 1
  });

  assert.deepEqual(tested, ['BTCUSDC']);
  assert.deepEqual(result.ready.map((item) => item.symbol), ['BTCUSDC']);
});
