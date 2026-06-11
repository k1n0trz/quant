const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateMt5Protection } = require('./mt5-protection-policy');

function textValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function finiteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function boolFlag(value) {
  return String(value || 'false').trim().toLowerCase() === 'true';
}

function defaultRealBridgeStatusFile(env = {}) {
  return env.MT5_REAL_BRIDGE_STATUS_FILE || process.env.MT5_REAL_BRIDGE_STATUS_FILE || '';
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function removeFileQuietly(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {}
}

function bridgeStatus(env = {}) {
  const file = defaultRealBridgeStatusFile(env);
  if (!file) return null;
  const data = readJsonFile(file);
  if (!data?.ok) return null;
  const ageMs = data.ts ? Math.max(0, Date.now() - Number(data.ts) * 1000) : Infinity;
  return { ...data, file, dir: path.dirname(file), ageMs, fresh: ageMs <= 30000 };
}

function serverLooksDemo(server) {
  return /\bdemo\b/i.test(String(server || ''));
}

function bridgeCanSendRealOrder(status) {
  if (!status?.fresh || !status.connected) return false;
  if (serverLooksDemo(status.server)) return false;
  if (Number(status.tradeMode) === 0) return false;
  return Boolean(status.tradeAllowed && status.mqlTradeAllowed);
}

function isMt5RealTradingEnabled(env = {}) {
  return Boolean(
    boolFlag(env.REAL_TRADING)
    && boolFlag(env.MT5_CONNECTOR_ENABLED)
    && boolFlag(env.MT5_REAL_TRADING_ENABLED)
  );
}

function normalizeSide(side) {
  const upper = String(side || '').trim().toUpperCase();
  if (upper === 'BUY' || upper === 'SELL') return upper;
  if (upper === 'LONG') return 'BUY';
  if (upper === 'SHORT') return 'SELL';
  return null;
}

function normalizeOrderType(type) {
  const upper = String(type || 'MARKET').trim().toUpperCase();
  return upper === 'LIMIT' ? 'LIMIT' : 'MARKET';
}

function safeMt5Symbol(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!/^[A-Z0-9._-]{3,24}$/.test(normalized)) return null;
  if (normalized.endsWith('USDT')) return null;
  return normalized;
}

function safeComment(reason, requestId) {
  const id = textValue(requestId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 20);
  const prefix = String(reason || '').includes('chat') ? 'Quant real chat' : 'Quant real order';
  return `${prefix}${id ? ` ${id}` : ''}`.slice(0, 31);
}

function bridgeCommandText(command) {
  return Object.entries(command)
    .map(([key, value]) => `${key}=${String(value ?? '').replace(/[\r\n=]/g, ' ').slice(0, 120)}`)
    .join('\n') + '\n';
}

function buildBridgeRealCommand(order, action) {
  return {
    id: `qr${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`,
    action,
    ticket: order.ticket || '',
    symbol: order.symbol,
    side: order.side,
    volume: order.volume,
    type: order.type,
    price: order.price || '',
    sl: order.sl || '',
    tp: order.tp || '',
    deviation: order.deviation,
    magic: order.magic,
    comment: order.comment
  };
}

function buildMt5RealCloseRequest(input = {}, env = {}) {
  if (!isMt5RealTradingEnabled(env)) {
    return { ok: false, reason: 'mt5_real_trading_disabled', safety: { realTradingTouched: false } };
  }
  const ticket = finiteNumber(input.ticket, input.positionTicket, input.order);
  if (!ticket || ticket <= 0) {
    return { ok: false, reason: 'invalid_close_ticket', safety: { realTradingTouched: false } };
  }
  return {
    ok: true,
    close: {
      ticket: Math.trunc(ticket),
      symbol: safeMt5Symbol(input.symbol) || '',
      side: normalizeSide(input.side) || '',
      volume: finiteNumber(input.volume, input.lots, input.qty) || '',
      type: 'MARKET',
      price: '',
      sl: '',
      tp: '',
      deviation: Math.max(1, Math.min(100, finiteNumber(input.deviation, env.MT5_REAL_DEVIATION, 20) || 20)),
      magic: finiteNumber(env.MT5_REAL_MAGIC, 260531) || 260531,
      comment: safeComment(input.reason || 'close', input.requestId)
    },
    safety: {
      realTradingTouched: true,
      demoOnly: false,
      accountSlot: 'MT5_ACCOUNT1'
    }
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeBridgeRealCommand(command, env = {}) {
  const status = bridgeStatus(env);
  if (!status?.fresh || !status.connected) {
    return { ok: false, reason: 'mt5_real_bridge_unavailable', realTradingTouched: false };
  }
  if (serverLooksDemo(status.server) || Number(status.tradeMode) === 0) {
    return { ok: false, reason: 'mt5_real_bridge_requires_real_account', realTradingTouched: false };
  }
  if (!bridgeCanSendRealOrder(status)) {
    return {
      ok: false,
      reason: 'mt5_real_terminal_trade_not_allowed',
      realTradingTouched: false,
      terminal: {
        connected: Boolean(status.connected),
        tradeAllowed: Boolean(status.tradeAllowed),
        mqlTradeAllowed: Boolean(status.mqlTradeAllowed),
        server: status.server || null,
        login: status.login || null
      }
    };
  }

  const commandFile = path.join(status.dir, 'quant_bridge_command.txt');
  const resultFile = path.join(status.dir, `quant_bridge_result_${command.id}.json`);
  fs.writeFileSync(commandFile, bridgeCommandText(command), 'utf8');
  const timeoutMs = Math.max(3000, Math.min(60000, finiteNumber(env.MT5_REAL_ORDER_TIMEOUT_MS, 15000) || 15000));
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = readJsonFile(resultFile);
    if (result) {
      removeFileQuietly(commandFile);
      return {
        ...result,
        bridge: true,
        commandId: command.id,
        realTradingTouched: command.action === 'ORDER' || command.action === 'CLOSE'
      };
    }
    await wait(500);
  }
  removeFileQuietly(commandFile);
  return {
    ok: false,
    bridge: true,
    commandId: command.id,
    reason: 'mt5_real_bridge_order_timeout',
    error: `MT5 real bridge timeout after ${timeoutMs}ms`,
    realTradingTouched: false
  };
}

function buildMt5RealOrderRequest(input = {}, env = {}) {
  if (!isMt5RealTradingEnabled(env)) {
    return { ok: false, reason: 'mt5_real_trading_disabled', safety: { realTradingTouched: false } };
  }

  const symbol = safeMt5Symbol(input.symbol);
  if (!symbol) return { ok: false, reason: 'symbol_not_mt5_real_safe', safety: { realTradingTouched: false } };

  const side = normalizeSide(input.side);
  if (!side) return { ok: false, reason: 'unsupported_side', safety: { realTradingTouched: false } };

  const volume = finiteNumber(input.volume, input.lots, input.qty);
  if (volume === null || volume <= 0) return { ok: false, reason: 'invalid_volume', safety: { realTradingTouched: false } };

  const maxLots = finiteNumber(env.MT5_REAL_MAX_LOTS, 0.02) || 0.02;
  if (volume > maxLots) return { ok: false, reason: 'volume_exceeds_real_cap', safety: { realTradingTouched: false } };

  const type = normalizeOrderType(input.type);
  const price = type === 'LIMIT' ? finiteNumber(input.price) : null;
  if (type === 'LIMIT' && (!price || price <= 0)) {
    return { ok: false, reason: 'limit_price_required', safety: { realTradingTouched: false } };
  }
  const sl = finiteNumber(input.sl, input.stopLoss);
  const tp = finiteNumber(input.tp, input.takeProfit);
  if ((sl !== null && sl <= 0) || (tp !== null && tp <= 0)) {
    return { ok: false, reason: 'invalid_sl_tp', safety: { realTradingTouched: false } };
  }
  const protection = validateMt5Protection({
    ...input,
    side,
    symbol,
    entryPrice: finiteNumber(input.entryPrice, input.entry_price, price)
  }, env);
  if (!protection.ok) {
    return { ok: false, reason: protection.reason, safety: { realTradingTouched: false }, protection };
  }

  return {
    ok: true,
    order: {
      login: finiteNumber(env.MT5_ACCOUNT1_LOGIN) || null,
      server: textValue(env.MT5_ACCOUNT1_SERVER),
      symbol,
      side,
      volume,
      type,
      price: price || null,
      sl: protection.sl,
      tp: protection.tp,
      deviation: Math.max(1, Math.min(100, finiteNumber(input.deviation, env.MT5_REAL_DEVIATION, 20) || 20)),
      magic: finiteNumber(env.MT5_REAL_MAGIC, 260531) || 260531,
      comment: safeComment(input.reason, input.requestId)
    },
    safety: {
      realTradingTouched: true,
      demoOnly: false,
      accountSlot: 'MT5_ACCOUNT1',
      blockRealExecutionIgnoredForRealChannel: input.blockRealExecution === true
    }
  };
}

async function checkMt5RealOrder(input = {}, options = {}) {
  const env = options.env || {};
  const built = buildMt5RealOrderRequest(input, env);
  if (!built.ok) return { ok: false, reason: built.reason, realTradingTouched: false };
  const result = await executeBridgeRealCommand(buildBridgeRealCommand(built.order, 'CHECK'), env);
  return {
    ...result,
    action: result.action || 'CHECK',
    order: {
      symbol: built.order.symbol,
      side: built.order.side,
      volume: built.order.volume,
      type: built.order.type,
      price: built.order.price,
      server: built.order.server,
      login: built.order.login
    },
    realTradingTouched: false
  };
}

async function placeMt5RealOrder(input = {}, options = {}) {
  const env = options.env || {};
  const built = buildMt5RealOrderRequest(input, env);
  if (!built.ok) return { ok: false, reason: built.reason, realTradingTouched: false };
  const result = await executeBridgeRealCommand(buildBridgeRealCommand(built.order, 'ORDER'), env);
  return {
    ...result,
    action: result.action || 'ORDER',
    order: {
      symbol: built.order.symbol,
      side: built.order.side,
      volume: built.order.volume,
      type: built.order.type,
      price: built.order.price,
      server: built.order.server,
      login: built.order.login
    },
    realTradingTouched: result.ok === true
  };
}

async function closeMt5RealPosition(input = {}, options = {}) {
  const env = options.env || {};
  const built = buildMt5RealCloseRequest(input, env);
  if (!built.ok) return { ok: false, reason: built.reason, realTradingTouched: false };
  const result = await executeBridgeRealCommand(buildBridgeRealCommand(built.close, 'CLOSE'), env);
  return {
    ...result,
    action: result.action || 'CLOSE',
    ticket: result.ticket || built.close.ticket,
    close: {
      ticket: built.close.ticket,
      server: textValue(env.MT5_ACCOUNT1_SERVER),
      login: finiteNumber(env.MT5_ACCOUNT1_LOGIN) || null
    },
    realTradingTouched: result.ok === true
  };
}

module.exports = {
  isMt5RealTradingEnabled,
  buildMt5RealOrderRequest,
  buildMt5RealCloseRequest,
  checkMt5RealOrder,
  placeMt5RealOrder,
  closeMt5RealPosition,
  bridgeCommandText,
  buildBridgeRealCommand
};
