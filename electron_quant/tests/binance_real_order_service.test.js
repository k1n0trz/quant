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
