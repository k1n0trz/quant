const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isMt5RealTradingEnabled,
  buildMt5RealOrderRequest,
  checkMt5RealOrder,
  placeMt5RealOrder
} = require('../backend/adapters/mt5/mt5-real-order-service');

const realEnv = {
  REAL_TRADING: 'true',
  MT5_CONNECTOR_ENABLED: 'true',
  MT5_REAL_TRADING_ENABLED: 'true',
  MT5_ACCOUNT1_LOGIN: '110994506',
  MT5_ACCOUNT1_SERVER: 'FBS-REAL',
  MT5_REAL_MAX_LOTS: '0.02'
};

function writeBridgeStatus(dir, overrides = {}) {
  const file = path.join(dir, 'quant_bridge_status.json');
  fs.writeFileSync(file, JSON.stringify({
    ok: true,
    ts: Math.floor(Date.now() / 1000),
    connected: true,
    tradeAllowed: true,
    mqlTradeAllowed: true,
    tradeMode: 2,
    login: 110994506,
    server: 'FBS-REAL',
    ...overrides
  }));
  return file;
}

test('MT5 real trading requires explicit REAL and MT5 real flags', () => {
  assert.equal(isMt5RealTradingEnabled(realEnv), true);
  assert.equal(isMt5RealTradingEnabled({ ...realEnv, REAL_TRADING: 'false' }), false);
  assert.equal(isMt5RealTradingEnabled({ ...realEnv, MT5_REAL_TRADING_ENABLED: 'false' }), false);
  assert.equal(isMt5RealTradingEnabled({ ...realEnv, MT5_CONNECTOR_ENABLED: 'false' }), false);
});

test('MT5 real order request is independent from training blockRealExecution', () => {
  const req = buildMt5RealOrderRequest({
    symbol: 'EURUSD',
    side: 'BUY',
    volume: 0.01,
    type: 'MARKET',
    stopLoss: 1.078,
    takeProfit: 1.105,
    blockRealExecution: true
  }, realEnv);

  assert.equal(req.ok, true);
  assert.equal(req.order.symbol, 'EURUSD');
  assert.equal(req.order.side, 'BUY');
  assert.equal(req.order.volume, 0.01);
  assert.equal(req.order.sl, 1.078);
  assert.equal(req.order.tp, 1.105);
  assert.equal(req.safety.realTradingTouched, true);
  assert.equal(req.safety.blockRealExecutionIgnoredForRealChannel, true);
});

test('MT5 real bridge check writes CHECK command without sending an order', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-mt5-real-check-'));
  const statusFile = writeBridgeStatus(dir);
  const env = { ...realEnv, MT5_REAL_BRIDGE_STATUS_FILE: statusFile, MT5_REAL_ORDER_TIMEOUT_MS: '5000' };
  const watcher = (async () => {
    const commandFile = path.join(dir, 'quant_bridge_command.txt');
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(commandFile)) {
        const text = fs.readFileSync(commandFile, 'utf8');
        const id = text.match(/^id=(.+)$/m)?.[1];
        assert.ok(id);
        assert.match(text, /^action=CHECK$/m);
        assert.match(text, /^symbol=EURUSD$/m);
        fs.writeFileSync(path.join(dir, `quant_bridge_result_${id}.json`), JSON.stringify({
          ok: true,
          action: 'CHECK',
          retcode: 10009,
          comment: 'check ok'
        }));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('real check command not written');
  })();

  const result = await checkMt5RealOrder({ symbol: 'EURUSD', side: 'BUY', volume: 0.01 }, { env });
  await watcher;

  assert.equal(result.ok, true);
  assert.equal(result.action, 'CHECK');
  assert.equal(result.realTradingTouched, false);
  assert.equal(fs.existsSync(path.join(dir, 'quant_bridge_command.txt')), false);
});

test('MT5 real order writes ORDER command only through a real bridge', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-mt5-real-order-'));
  const statusFile = writeBridgeStatus(dir);
  const env = { ...realEnv, MT5_REAL_BRIDGE_STATUS_FILE: statusFile, MT5_REAL_ORDER_TIMEOUT_MS: '5000' };
  const watcher = (async () => {
    const commandFile = path.join(dir, 'quant_bridge_command.txt');
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(commandFile)) {
        const text = fs.readFileSync(commandFile, 'utf8');
        const id = text.match(/^id=(.+)$/m)?.[1];
        assert.ok(id);
        assert.match(text, /^action=ORDER$/m);
        assert.match(text, /^symbol=EURUSD$/m);
        assert.match(text, /^sl=1\.078$/m);
        assert.match(text, /^tp=1\.105$/m);
        fs.writeFileSync(path.join(dir, `quant_bridge_result_${id}.json`), JSON.stringify({
          ok: true,
          action: 'ORDER',
          retcode: 10009,
          ticket: 778899,
          deal: 112233,
          comment: 'order done'
        }));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('real order command not written');
  })();

  const result = await placeMt5RealOrder({ symbol: 'EURUSD', side: 'BUY', volume: 0.01, stopLoss: 1.078, takeProfit: 1.105 }, { env });
  await watcher;

  assert.equal(result.ok, true);
  assert.equal(result.ticket, 778899);
  assert.equal(result.realTradingTouched, true);
});

test('MT5 real order blocks demo bridge status', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-mt5-real-demo-block-'));
  const statusFile = writeBridgeStatus(dir, { server: 'FBS-Demo', tradeMode: 0 });
  const result = await placeMt5RealOrder(
    { symbol: 'EURUSD', side: 'BUY', volume: 0.01 },
    { env: { ...realEnv, MT5_REAL_BRIDGE_STATUS_FILE: statusFile } }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'mt5_real_bridge_requires_real_account');
  assert.equal(result.realTradingTouched, false);
  assert.equal(fs.existsSync(path.join(dir, 'quant_bridge_command.txt')), false);
});
