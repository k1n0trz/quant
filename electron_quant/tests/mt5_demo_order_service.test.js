const assert = require('node:assert/strict');

const {
  isMt5DemoTradingEnabled,
  buildMt5DemoOrderRequest,
  placeMt5DemoOrder
} = require('../backend/adapters/mt5/mt5-demo-order-service');

const demoEnv = {
  MT5_CONNECTOR_ENABLED: 'true',
  MT5_DEMO_TRADING_ENABLED: 'true',
  MT5_ACCOUNT2_LOGIN: '106075877',
  MT5_ACCOUNT2_PASSWORD: 'secret-demo',
  MT5_ACCOUNT2_SERVER: 'FBS-Demo',
  MT5_DEMO_MAX_LOTS: '0.05'
};

assert.equal(isMt5DemoTradingEnabled({}), false, 'MT5 demo trading debe ser opt-in explicito.');
assert.equal(isMt5DemoTradingEnabled(demoEnv), true, 'MT5 demo trading debe activarse solo con flag y credenciales demo.');
assert.equal(isMt5DemoTradingEnabled({ ...demoEnv, MT5_ACCOUNT2_SERVER: 'FBS-REAL' }), false, 'Servidor real no debe habilitar demo trading.');

{
  const req = buildMt5DemoOrderRequest({
    symbol: 'XAUUSD',
    side: 'BUY',
    volume: 0.01,
    type: 'MARKET',
    reason: 'training-demo-entry',
    trainingPositionId: 'pos_abc'
  }, demoEnv);
  assert.equal(req.ok, true);
  assert.deepEqual(req.order, {
    login: 106075877,
    server: 'FBS-Demo',
    symbol: 'XAUUSD',
    side: 'BUY',
    volume: 0.01,
    type: 'MARKET',
    price: null,
    deviation: 20,
    magic: 260530,
    comment: 'Quant demo training pos_abc'
  });
  assert.equal(req.safety.demoOnly, true);
  assert.equal(req.safety.realTradingTouched, false);
}

{
  const req = buildMt5DemoOrderRequest({ symbol: 'XAUUSD', side: 'SELL', volume: 0.5 }, demoEnv);
  assert.equal(req.ok, false);
  assert.equal(req.reason, 'volume_exceeds_demo_cap');
}

{
  const req = buildMt5DemoOrderRequest({ symbol: 'BTCUSDT', side: 'BUY', volume: 0.01 }, demoEnv);
  assert.equal(req.ok, false);
  assert.equal(req.reason, 'symbol_not_mt5_demo_safe');
}

{
  const req = buildMt5DemoOrderRequest({ symbol: 'XAUUSD', side: 'SHORT', volume: 0.01 }, demoEnv);
  assert.equal(req.ok, false);
  assert.equal(req.reason, 'unsupported_side');
}

(async () => {
  let captured = null;
  const result = await placeMt5DemoOrder({
    symbol: 'XAUUSD',
    side: 'BUY',
    volume: 0.01,
    trainingPositionId: 'pos_demo'
  }, {
    env: demoEnv,
    executePython: async (script, payload) => {
      captured = { script, payload };
      return { ok: true, ticket: 123456, retcode: 10009, comment: 'done', account: { login: 106075877, trade_mode: 0 } };
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.ticket, 123456);
  assert.equal(result.demoOnly, true);
  assert.equal(result.realTradingTouched, false);
  assert.equal(captured.payload.order.symbol, 'XAUUSD');
  assert.match(captured.script, /order_send/);
  assert.match(captured.script, /ACCOUNT_TRADE_MODE_DEMO/);
})()
  .then(() => {
    console.log('mt5_demo_order_service.test.js OK');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
