const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isMt5RealTradingEnabled,
  buildMt5RealOrderRequest,
  checkMt5RealOrder,
  placeMt5RealOrder,
  closeMt5RealPosition
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
    balance: 5000,
    equity: 5000,
    positions: [],
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
    entryPrice: 1.09,
    stopLoss: 1.087,
    takeProfit: 1.096,
    blockRealExecution: true
  }, realEnv);

  assert.equal(req.ok, true);
  assert.equal(req.order.symbol, 'EURUSD');
  assert.equal(req.order.side, 'BUY');
  assert.equal(req.order.volume, 0.01);
  assert.equal(req.order.sl, 1.087);
  assert.equal(req.order.tp, 1.096);
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

  const result = await checkMt5RealOrder({
    symbol: 'EURUSD',
    side: 'BUY',
    volume: 0.01,
    entryPrice: 1.09,
    stopLoss: 1.087,
    takeProfit: 1.096
  }, { env });
  await watcher;

  assert.equal(result.ok, true);
  assert.equal(result.action, 'CHECK');
  assert.equal(result.realTradingTouched, false);
  assert.equal(fs.existsSync(path.join(dir, 'quant_bridge_command.txt')), false);
});

test('MT5 real order blocks missing SL TP before touching the bridge', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-mt5-real-no-protection-'));
  const statusFile = writeBridgeStatus(dir);
  const result = await placeMt5RealOrder(
    { symbol: 'XAUUSD', side: 'BUY', volume: 0.01, entryPrice: 2300 },
    { env: { ...realEnv, MT5_REAL_BRIDGE_STATUS_FILE: statusFile } }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_sl_tp');
  assert.equal(result.realTradingTouched, false);
  assert.equal(fs.existsSync(path.join(dir, 'quant_bridge_command.txt')), false);
});

test('MT5 real order blocks XAUUSD stop loss that is too far from entry', async () => {
  const result = buildMt5RealOrderRequest({
    symbol: 'XAUUSD',
    side: 'BUY',
    volume: 0.01,
    entryPrice: 2300,
    stopLoss: 2200,
    takeProfit: 2315
  }, realEnv);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'stop_loss_too_far');
  assert.equal(result.safety.realTradingTouched, false);
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
        assert.match(text, /^sl=1\.087$/m);
        assert.match(text, /^tp=1\.096$/m);
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

  const result = await placeMt5RealOrder({
    symbol: 'EURUSD',
    side: 'BUY',
    volume: 0.01,
    entryPrice: 1.09,
    stopLoss: 1.087,
    takeProfit: 1.096
  }, { env });
  await watcher;

  assert.equal(result.ok, true);
  assert.equal(result.ticket, 778899);
  assert.equal(result.realTradingTouched, true);
});

test('MT5 real order blocks demo bridge status', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-mt5-real-demo-block-'));
  const statusFile = writeBridgeStatus(dir, { server: 'FBS-Demo', tradeMode: 0 });
  const result = await placeMt5RealOrder(
    { symbol: 'EURUSD', side: 'BUY', volume: 0.01, entryPrice: 1.09, stopLoss: 1.087, takeProfit: 1.096 },
    { env: { ...realEnv, MT5_REAL_BRIDGE_STATUS_FILE: statusFile } }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'mt5_real_bridge_requires_real_account');
  assert.equal(result.realTradingTouched, false);
  assert.equal(fs.existsSync(path.join(dir, 'quant_bridge_command.txt')), false);
});

test('MT5 real order blocks risk above the per-trade equity budget', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-mt5-real-risk-trade-'));
  // $25 account: XAUUSD 0.01 lots with a $10 stop distance risks $10, far above 10% of equity
  const statusFile = writeBridgeStatus(dir, { balance: 25, equity: 25 });
  const result = await placeMt5RealOrder(
    { symbol: 'XAUUSD', side: 'BUY', volume: 0.01, entryPrice: 3300, stopLoss: 3290, takeProfit: 3320 },
    { env: { ...realEnv, MT5_REAL_BRIDGE_STATUS_FILE: statusFile } }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'risk_exceeds_per_trade_budget');
  assert.equal(result.realTradingTouched, false);
  assert.ok(result.riskCheck.riskUsd > result.riskCheck.perTradeBudgetUsd);
  assert.equal(fs.existsSync(path.join(dir, 'quant_bridge_command.txt')), false);
});

test('MT5 real order blocks when open positions already consume the total risk budget', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-mt5-real-risk-total-'));
  const statusFile = writeBridgeStatus(dir, {
    balance: 1000,
    equity: 1000,
    positions: [
      { ticket: 1, symbol: 'XAUUSD', side: 'BUY', volume: 0.05, priceOpen: 3300, sl: 3260, tp: 3350 }
    ]
  });
  const result = await placeMt5RealOrder(
    { symbol: 'EURUSD', side: 'BUY', volume: 0.01, entryPrice: 1.09, stopLoss: 1.087, takeProfit: 1.096 },
    { env: { ...realEnv, MT5_REAL_BRIDGE_STATUS_FILE: statusFile, MT5_REAL_TOTAL_RISK_PCT: '20' } }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'risk_exceeds_total_budget');
  assert.ok(result.riskCheck.openRiskUsd > 180);
  assert.equal(fs.existsSync(path.join(dir, 'quant_bridge_command.txt')), false);
});

test('MT5 real order blocks new risk while an unprotected position is open', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-mt5-real-risk-unprotected-'));
  const statusFile = writeBridgeStatus(dir, {
    positions: [
      { ticket: 42, symbol: 'XAUUSD', side: 'BUY', volume: 0.01, priceOpen: 3300, sl: 0, tp: 0 }
    ]
  });
  const result = await placeMt5RealOrder(
    { symbol: 'EURUSD', side: 'BUY', volume: 0.01, entryPrice: 1.09, stopLoss: 1.087, takeProfit: 1.096 },
    { env: { ...realEnv, MT5_REAL_BRIDGE_STATUS_FILE: statusFile } }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unprotected_position_blocks_new_risk');
  assert.equal(result.position.ticket, 42);
  assert.equal(fs.existsSync(path.join(dir, 'quant_bridge_command.txt')), false);
});

test('MT5 real order blocks when bridge status carries no equity', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-mt5-real-risk-no-equity-'));
  const statusFile = writeBridgeStatus(dir, { balance: null, equity: null });
  const result = await placeMt5RealOrder(
    { symbol: 'EURUSD', side: 'BUY', volume: 0.01, entryPrice: 1.09, stopLoss: 1.087, takeProfit: 1.096 },
    { env: { ...realEnv, MT5_REAL_BRIDGE_STATUS_FILE: statusFile } }
  );

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'mt5_equity_unavailable');
  assert.equal(fs.existsSync(path.join(dir, 'quant_bridge_command.txt')), false);
});

test('MT5 real close writes CLOSE command by ticket through the real bridge', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-mt5-real-close-'));
  const statusFile = writeBridgeStatus(dir);
  const env = { ...realEnv, MT5_REAL_BRIDGE_STATUS_FILE: statusFile, MT5_REAL_ORDER_TIMEOUT_MS: '5000' };
  const watcher = (async () => {
    const commandFile = path.join(dir, 'quant_bridge_command.txt');
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(commandFile)) {
        const text = fs.readFileSync(commandFile, 'utf8');
        const id = text.match(/^id=(.+)$/m)?.[1];
        assert.ok(id);
        assert.match(text, /^action=CLOSE$/m);
        assert.match(text, /^ticket=445566$/m);
        fs.writeFileSync(path.join(dir, `quant_bridge_result_${id}.json`), JSON.stringify({
          ok: true,
          action: 'CLOSE',
          retcode: 10009,
          ticket: 445566,
          deal: 998877,
          comment: 'closed'
        }));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('real close command not written');
  })();

  const result = await closeMt5RealPosition({ ticket: 445566, reason: 'autonomous-close' }, { env });
  await watcher;

  assert.equal(result.ok, true);
  assert.equal(result.action, 'CLOSE');
  assert.equal(result.ticket, 445566);
  assert.equal(result.realTradingTouched, true);
});
