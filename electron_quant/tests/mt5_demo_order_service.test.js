const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isMt5DemoTradingEnabled,
  buildMt5DemoOrderRequest,
  placeMt5DemoOrder,
  closeMt5DemoPosition
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
    entryPrice: 2300,
    stopLoss: 2294,
    takeProfit: 2312,
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
    sl: 2294,
    tp: 2312,
    deviation: 20,
    magic: 260530,
    comment: 'Quant demo training pos_abc'
  });
  assert.equal(req.safety.demoOnly, true);
  assert.equal(req.safety.realTradingTouched, false);
}

{
  const req = buildMt5DemoOrderRequest({
    symbol: 'XAUUSD',
    side: 'BUY',
    volume: 0.01,
    type: 'MARKET',
    entryPrice: 2300
  }, demoEnv);
  assert.equal(req.ok, false);
  assert.equal(req.reason, 'missing_sl_tp');
}

{
  const req = buildMt5DemoOrderRequest({
    symbol: 'XAUUSD',
    side: 'BUY',
    volume: 0.01,
    type: 'MARKET',
    entryPrice: 2300,
    stopLoss: 2200,
    takeProfit: 2310
  }, demoEnv);
  assert.equal(req.ok, false);
  assert.equal(req.reason, 'stop_loss_too_far');
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
    entryPrice: 2300,
    stopLoss: 2294,
    takeProfit: 2312,
    trainingPositionId: 'pos_demo'
  }, {
    env: demoEnv,
    executeBridge: false,
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

  const bridgeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-mt5-bridge-'));
  const statusFile = path.join(bridgeDir, 'quant_bridge_status.json');
  fs.writeFileSync(statusFile, JSON.stringify({
    ok: true,
    ts: Math.floor(Date.now() / 1000),
    connected: true,
    tradeMode: 0,
    server: 'FBS-Demo'
  }));
  const bridgeEnv = { ...demoEnv, MT5_BRIDGE_STATUS_FILE: statusFile, MT5_BRIDGE_ORDER_TIMEOUT_MS: '5000' };
  const watcher = (async () => {
    const commandFile = path.join(bridgeDir, 'quant_bridge_command.txt');
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(commandFile)) {
        const text = fs.readFileSync(commandFile, 'utf8');
        const id = text.match(/^id=(.+)$/m)?.[1];
        assert.ok(id, 'bridge command debe incluir id');
        assert.match(text, /^action=ORDER$/m);
        assert.match(text, /^symbol=XAUUSD$/m);
        assert.match(text, /^sl=2306$/m);
        assert.match(text, /^tp=2288$/m);
        fs.writeFileSync(path.join(bridgeDir, `quant_bridge_result_${id}.json`), JSON.stringify({
          ok: true,
          retcode: 10009,
          ticket: 987654,
          deal: 123,
          comment: 'bridge done'
        }));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('bridge command not written');
  })();
  const bridgeOrder = await placeMt5DemoOrder({
    symbol: 'XAUUSD',
    side: 'SELL',
    volume: 0.01,
    entryPrice: 2300,
    stopLoss: 2306,
    takeProfit: 2288,
    trainingPositionId: 'bridge_demo'
  }, { env: bridgeEnv });
  await watcher;
  assert.equal(bridgeOrder.ok, true);
  assert.equal(bridgeOrder.bridge, true);
  assert.equal(bridgeOrder.ticket, 987654);
  assert.equal(bridgeOrder.realTradingTouched, false);
  assert.equal(fs.existsSync(path.join(bridgeDir, 'quant_bridge_command.txt')), false, 'order command file debe consumirse una sola vez');

  const realBridgeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-mt5-real-bridge-'));
  const realStatusFile = path.join(realBridgeDir, 'quant_bridge_status.json');
  fs.writeFileSync(realStatusFile, JSON.stringify({
    ok: true,
    ts: Math.floor(Date.now() / 1000),
    connected: true,
    tradeMode: 0,
    server: 'FBS-Real'
  }));
  let pythonFallbackUsed = false;
  const realBridgeOrder = await placeMt5DemoOrder({
    symbol: 'XAUUSD',
    side: 'BUY',
    volume: 0.01,
    entryPrice: 2300,
    stopLoss: 2294,
    takeProfit: 2312,
    trainingPositionId: 'real_bridge_must_not_send'
  }, {
    env: { ...demoEnv, MT5_BRIDGE_STATUS_FILE: realStatusFile },
    executePython: async () => {
      pythonFallbackUsed = true;
      return { ok: true, ticket: 111222, retcode: 10009 };
    }
  });
  assert.equal(pythonFallbackUsed, true, 'bridge con server real no debe recibir comandos demo.');
  assert.equal(realBridgeOrder.bridge, undefined);
  assert.equal(fs.existsSync(path.join(realBridgeDir, 'quant_bridge_command.txt')), false, 'no debe escribir command file contra bridge real.');

  const closeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-mt5-close-'));
  const closeStatusFile = path.join(closeDir, 'quant_bridge_status.json');
  fs.writeFileSync(closeStatusFile, JSON.stringify({
    ok: true,
    ts: Math.floor(Date.now() / 1000),
    connected: true,
    tradeMode: 0,
    server: 'FBS-Demo'
  }));
  const closeEnv = { ...demoEnv, MT5_BRIDGE_STATUS_FILE: closeStatusFile, MT5_BRIDGE_ORDER_TIMEOUT_MS: '5000' };
  const closeWatcher = (async () => {
    const commandFile = path.join(closeDir, 'quant_bridge_command.txt');
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(commandFile)) {
        const text = fs.readFileSync(commandFile, 'utf8');
        const id = text.match(/^id=(.+)$/m)?.[1];
        assert.ok(id, 'close bridge command debe incluir id');
        assert.match(text, /^action=CLOSE$/m);
        assert.match(text, /^ticket=1811606880$/m);
        fs.writeFileSync(path.join(closeDir, `quant_bridge_result_${id}.json`), JSON.stringify({
          ok: true,
          retcode: 10009,
          ticket: 1811606880,
          deal: 456,
          comment: 'close done'
        }));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('bridge close command not written');
  })();
  const closeResult = await closeMt5DemoPosition({
    ticket: 1811606880,
    symbol: 'EURUSD',
    trainingPositionId: 'bridge_close'
  }, { env: closeEnv });
  await closeWatcher;
  assert.equal(closeResult.ok, true);
  assert.equal(closeResult.bridge, true);
  assert.equal(closeResult.ticket, 1811606880);
  assert.equal(closeResult.demoOnly, true);
  assert.equal(closeResult.realTradingTouched, false);
  assert.equal(fs.existsSync(path.join(closeDir, 'quant_bridge_command.txt')), false, 'close command file debe consumirse una sola vez');
})()
  .then(() => {
    console.log('mt5_demo_order_service.test.js OK');
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
