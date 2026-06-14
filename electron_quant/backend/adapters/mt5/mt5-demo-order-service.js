const { spawn } = require('node:child_process');
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

function pythonCommand(env = {}) {
  return env.MT5_PYTHON_COMMAND || env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');
}

function defaultBridgeStatusFile(env = {}) {
  return env.MT5_BRIDGE_STATUS_FILE
    || process.env.MT5_BRIDGE_STATUS_FILE
    || (process.platform === 'win32'
      ? ''
      : '/var/lib/quant/mt5/kinotrance/drive_c/Program Files/MetaTrader 5/MQL5/Files/quant_bridge_status.json');
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
  } catch {
    // best effort cleanup; bridge result remains authoritative
  }
}

function bridgeStatus(env = {}) {
  const file = defaultBridgeStatusFile(env);
  if (!file) return null;
  const data = readJsonFile(file);
  if (!data?.ok) return null;
  const ageMs = data.ts ? Math.max(0, Date.now() - Number(data.ts) * 1000) : Infinity;
  return { ...data, file, dir: path.dirname(file), ageMs, fresh: ageMs <= 30000 };
}

function bridgeCanSendDemoOrder(status) {
  if (!status?.fresh || !status.connected) return false;
  const server = String(status.server || '');
  return demoServerLooksSafe(server);
}

function demoServerLooksSafe(server) {
  return /\bdemo\b/i.test(String(server || ''));
}

function isMt5DemoTradingEnabled(env = {}) {
  return Boolean(
    boolFlag(env.MT5_CONNECTOR_ENABLED)
    && boolFlag(env.MT5_DEMO_TRADING_ENABLED)
    && textValue(env.MT5_ACCOUNT2_LOGIN)
    && textValue(env.MT5_ACCOUNT2_PASSWORD)
    && demoServerLooksSafe(env.MT5_ACCOUNT2_SERVER)
  );
}

function normalizeSide(side) {
  const upper = String(side || '').trim().toUpperCase();
  if (upper === 'BUY' || upper === 'SELL') return upper;
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

function safeComment(reason, trainingPositionId) {
  const id = textValue(trainingPositionId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24);
  const prefix = String(reason || '').includes('training') ? 'Quant demo training' : 'Quant demo order';
  return `${prefix}${id ? ` ${id}` : ''}`.slice(0, 31);
}

function bridgeCommandText(command) {
  return Object.entries(command)
    .map(([key, value]) => `${key}=${String(value ?? '').replace(/[\r\n=]/g, ' ').slice(0, 120)}`)
    .join('\n') + '\n';
}

function buildBridgeOrderCommand(order) {
  return {
    id: `q${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`,
    action: 'ORDER',
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

function buildBridgeCloseCommand(close) {
  return {
    id: `q${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`,
    action: 'CLOSE',
    ticket: close.ticket,
    symbol: close.symbol || '',
    volume: close.volume || '',
    deviation: close.deviation,
    magic: close.magic,
    comment: close.comment
  };
}

function buildBridgeModifyCommand(modify) {
  return {
    id: `q${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`,
    action: 'MODIFY',
    ticket: modify.ticket,
    sl: modify.sl || '',
    tp: modify.tp || '',
    deviation: modify.deviation,
    magic: modify.magic,
    comment: modify.comment
  };
}

// True when the fresh demo bridge already holds an open position on this symbol.
function demoBridgeHasOpenSymbol(env = {}, symbol = '') {
  const status = bridgeStatus(env);
  if (!status?.fresh) return false;
  const target = String(symbol || '').trim().toUpperCase();
  if (!target) return false;
  return (Array.isArray(status.positions) ? status.positions : [])
    .some((position) => String(position.symbol || '').trim().toUpperCase() === target);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeBridgeDemoCommand(command, env = {}) {
  const status = bridgeStatus(env);
  if (!bridgeCanSendDemoOrder(status)) return null;
  const commandFile = path.join(status.dir, 'quant_bridge_command.txt');
  const resultFile = path.join(status.dir, `quant_bridge_result_${command.id}.json`);
  fs.writeFileSync(commandFile, bridgeCommandText(command), 'utf8');
  const timeoutMs = Math.max(3000, Math.min(60000, finiteNumber(env.MT5_BRIDGE_ORDER_TIMEOUT_MS, 15000) || 15000));
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = readJsonFile(resultFile);
    if (result) {
      removeFileQuietly(commandFile);
      return {
        ...result,
        bridge: true,
        commandId: command.id
      };
    }
    await wait(500);
  }
  removeFileQuietly(commandFile);
  return {
    ok: false,
    bridge: true,
    commandId: command.id,
    reason: 'mt5_bridge_order_timeout',
    error: `MT5 bridge order timeout after ${timeoutMs}ms`
  };
}

async function executeBridgeDemoOrder(order, env = {}) {
  return executeBridgeDemoCommand(buildBridgeOrderCommand(order), env);
}

async function executeBridgeDemoClose(close, env = {}) {
  return executeBridgeDemoCommand(buildBridgeCloseCommand(close), env);
}

async function executeBridgeDemoModify(modify, env = {}) {
  return executeBridgeDemoCommand(buildBridgeModifyCommand(modify), env);
}

// Set SL/TP on an already-open demo position (used by the protection sweep).
async function modifyMt5DemoPosition(input = {}, options = {}) {
  const env = options.env || {};
  const ticket = finiteNumber(input.ticket, input.positionTicket, input.order);
  const sl = finiteNumber(input.sl, input.stopLoss, input.stop_loss);
  const tp = finiteNumber(input.tp, input.takeProfit, input.take_profit);
  if (!ticket || ticket <= 0) return { ok: false, reason: 'invalid_ticket', demoOnly: true, realTradingTouched: false };
  if ((sl === null || sl <= 0) && (tp === null || tp <= 0)) {
    return { ok: false, reason: 'invalid_modify_levels', demoOnly: true, realTradingTouched: false };
  }
  const modify = {
    ticket: Math.trunc(ticket),
    sl: sl && sl > 0 ? sl : '',
    tp: tp && tp > 0 ? tp : '',
    deviation: Math.max(1, Math.min(100, finiteNumber(input.deviation, env.MT5_DEMO_DEVIATION, 20) || 20)),
    magic: finiteNumber(env.MT5_DEMO_MAGIC, 260530) || 260530,
    comment: safeComment(input.reason || 'training-demo-protect', input.symbol)
  };
  const bridgeResult = options.executeBridge === false ? null : await executeBridgeDemoModify(modify, env);
  if (!bridgeResult) return { ok: false, reason: 'mt5_demo_bridge_unavailable', demoOnly: true, realTradingTouched: false };
  return { ...bridgeResult, demoOnly: true, realTradingTouched: false };
}

function buildMt5DemoOrderRequest(input = {}, env = {}) {
  if (!isMt5DemoTradingEnabled(env)) {
    return {
      ok: false,
      reason: 'mt5_demo_trading_disabled',
      safety: { demoOnly: true, realTradingTouched: false }
    };
  }

  const symbol = safeMt5Symbol(input.symbol);
  if (!symbol) {
    return { ok: false, reason: 'symbol_not_mt5_demo_safe', safety: { demoOnly: true, realTradingTouched: false } };
  }

  const side = normalizeSide(input.side);
  if (!side) {
    return { ok: false, reason: 'unsupported_side', safety: { demoOnly: true, realTradingTouched: false } };
  }

  const volume = finiteNumber(input.volume, input.lots);
  if (volume === null || volume <= 0) {
    return { ok: false, reason: 'invalid_volume', safety: { demoOnly: true, realTradingTouched: false } };
  }

  const maxLots = finiteNumber(env.MT5_DEMO_MAX_LOTS, 0.05) || 0.05;
  if (volume > maxLots) {
    return { ok: false, reason: 'volume_exceeds_demo_cap', safety: { demoOnly: true, realTradingTouched: false } };
  }

  const type = normalizeOrderType(input.type);
  const price = type === 'LIMIT' ? finiteNumber(input.price) : null;
  if (type === 'LIMIT' && (!price || price <= 0)) {
    return { ok: false, reason: 'limit_price_required', safety: { demoOnly: true, realTradingTouched: false } };
  }
  const protection = validateMt5Protection({
    ...input,
    side,
    symbol,
    entryPrice: finiteNumber(input.entryPrice, input.entry_price, price)
  }, env);
  if (!protection.ok) {
    return { ok: false, reason: protection.reason, safety: { demoOnly: true, realTradingTouched: false }, protection };
  }

  const order = {
    login: Number(env.MT5_ACCOUNT2_LOGIN),
    server: String(env.MT5_ACCOUNT2_SERVER),
    symbol,
    side,
    volume,
    type,
    price: price || null,
    sl: protection.sl,
    tp: protection.tp,
    deviation: Math.max(1, Math.min(100, finiteNumber(input.deviation, env.MT5_DEMO_DEVIATION, 20) || 20)),
    magic: finiteNumber(env.MT5_DEMO_MAGIC, 260530) || 260530,
    comment: safeComment(input.reason, input.trainingPositionId)
  };

  return {
    ok: true,
    order,
    safety: {
      demoOnly: true,
      realTradingTouched: false,
      accountSlot: 'MT5_ACCOUNT2',
      requiresDemoServer: true
    }
  };
}

function buildMt5DemoCloseRequest(input = {}, env = {}) {
  if (!isMt5DemoTradingEnabled(env)) {
    return {
      ok: false,
      reason: 'mt5_demo_trading_disabled',
      safety: { demoOnly: true, realTradingTouched: false }
    };
  }

  const ticket = finiteNumber(input.ticket, input.positionTicket, input.order);
  if (!ticket || ticket <= 0) {
    return { ok: false, reason: 'invalid_ticket', safety: { demoOnly: true, realTradingTouched: false } };
  }

  const symbol = input.symbol ? safeMt5Symbol(input.symbol) : '';
  if (input.symbol && !symbol) {
    return { ok: false, reason: 'symbol_not_mt5_demo_safe', safety: { demoOnly: true, realTradingTouched: false } };
  }

  const volume = finiteNumber(input.volume, input.lots);
  const close = {
    ticket: Math.trunc(ticket),
    symbol,
    volume: volume && volume > 0 ? volume : null,
    deviation: Math.max(1, Math.min(100, finiteNumber(input.deviation, env.MT5_DEMO_DEVIATION, 20) || 20)),
    magic: finiteNumber(env.MT5_DEMO_MAGIC, 260530) || 260530,
    comment: safeComment(input.reason || 'training-demo-close', input.trainingPositionId)
  };

  return {
    ok: true,
    close,
    safety: {
      demoOnly: true,
      realTradingTouched: false,
      accountSlot: 'MT5_ACCOUNT2',
      requiresDemoServer: true
    }
  };
}

function mt5DemoOrderPythonScript() {
  return `
import json, sys
payload = json.loads(sys.stdin.read() or "{}")
order = payload.get("order") or {}
try:
    import MetaTrader5 as mt5
    if not mt5.initialize():
        print(json.dumps({"ok": False, "reason": "mt5_initialize_failed", "error": str(mt5.last_error())}))
        raise SystemExit
    if not mt5.login(int(order.get("login")), password=payload.get("password", ""), server=order.get("server", "")):
        print(json.dumps({"ok": False, "reason": "mt5_demo_login_failed", "error": str(mt5.last_error())}))
        raise SystemExit
    info = mt5.account_info()
    if info is None:
        print(json.dumps({"ok": False, "reason": "mt5_demo_account_unavailable", "error": str(mt5.last_error())}))
        raise SystemExit
    account = info._asdict()
    demo_mode = getattr(mt5, "ACCOUNT_TRADE_MODE_DEMO", 0)
    server_text = str(account.get("server") or order.get("server") or "")
    if account.get("trade_mode") != demo_mode and "demo" not in server_text.lower():
        print(json.dumps({"ok": False, "reason": "account_not_demo", "account": {"login": account.get("login"), "server": account.get("server"), "trade_mode": account.get("trade_mode")}}))
        raise SystemExit
    symbol = str(order.get("symbol"))
    if not mt5.symbol_select(symbol, True):
        print(json.dumps({"ok": False, "reason": "symbol_select_failed", "error": str(mt5.last_error())}))
        raise SystemExit
    side = str(order.get("side")).upper()
    typ = str(order.get("type") or "MARKET").upper()
    action = mt5.TRADE_ACTION_DEAL if typ == "MARKET" else mt5.TRADE_ACTION_PENDING
    order_type = mt5.ORDER_TYPE_BUY if side == "BUY" else mt5.ORDER_TYPE_SELL
    request = {
        "action": action,
        "symbol": symbol,
        "volume": float(order.get("volume")),
        "type": order_type,
        "deviation": int(order.get("deviation") or 20),
        "magic": int(order.get("magic") or 260530),
        "comment": str(order.get("comment") or "Quant demo order"),
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC
    }
    if typ == "LIMIT":
        request["price"] = float(order.get("price"))
        request["type"] = mt5.ORDER_TYPE_BUY_LIMIT if side == "BUY" else mt5.ORDER_TYPE_SELL_LIMIT
    if order.get("sl"):
        request["sl"] = float(order.get("sl"))
    if order.get("tp"):
        request["tp"] = float(order.get("tp"))
    result = mt5.order_send(request)
    if result is None:
        print(json.dumps({"ok": False, "reason": "order_send_failed", "error": str(mt5.last_error())}))
    else:
        data = result._asdict()
        print(json.dumps({"ok": bool(data.get("retcode") in (10008, 10009)), "retcode": data.get("retcode"), "ticket": data.get("order"), "deal": data.get("deal"), "comment": data.get("comment"), "account": {"login": account.get("login"), "server": account.get("server"), "trade_mode": account.get("trade_mode")}}))
except SystemExit:
    pass
except Exception as exc:
    print(json.dumps({"ok": False, "reason": "mt5_demo_order_exception", "error": str(exc)}))
finally:
    try:
        mt5.shutdown()
    except Exception:
        pass
`;
}

function defaultExecutePython(script, payload, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(pythonCommand(env), ['-c', script], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.on('close', () => {
      try { resolve(JSON.parse(out.trim())); }
      catch { resolve({ ok: false, reason: 'mt5_demo_order_parse_failed', error: out.trim() }); }
    });
    child.on('error', (err) => resolve({ ok: false, reason: 'python_spawn_failed', error: err.message }));
    child.stdin.end(JSON.stringify(payload));
  });
}

async function placeMt5DemoOrder(input = {}, options = {}) {
  const env = options.env || {};
  const built = buildMt5DemoOrderRequest(input, env);
  if (!built.ok) {
    return {
      ok: false,
      reason: built.reason,
      demoOnly: true,
      realTradingTouched: false
    };
  }
  // One position per symbol: never stack a second demo position on a pair that
  // the demo account already holds (checked against live bridge positions).
  if (options.enforceOnePerSymbol !== false && demoBridgeHasOpenSymbol(env, built.order.symbol)) {
    return {
      ok: false,
      reason: 'mt5_demo_symbol_already_open',
      symbol: built.order.symbol,
      demoOnly: true,
      realTradingTouched: false
    };
  }
  const payload = {
    order: built.order,
    password: String(env.MT5_ACCOUNT2_PASSWORD || '')
  };
  const bridgeResult = options.executeBridge === false ? null : await executeBridgeDemoOrder(built.order, env);
  if (bridgeResult) {
    return {
      ...bridgeResult,
      order: {
        symbol: built.order.symbol,
        side: built.order.side,
        volume: built.order.volume,
        type: built.order.type,
        price: built.order.price,
        server: built.order.server,
        login: built.order.login
      },
      demoOnly: true,
      realTradingTouched: false
    };
  }
  const executePython = options.executePython || ((script, nextPayload) => defaultExecutePython(script, nextPayload, env));
  const result = await executePython(mt5DemoOrderPythonScript(), payload);
  return {
    ...result,
    order: {
      symbol: built.order.symbol,
      side: built.order.side,
      volume: built.order.volume,
      type: built.order.type,
      price: built.order.price,
      server: built.order.server,
      login: built.order.login
    },
    demoOnly: true,
    realTradingTouched: false
  };
}

async function closeMt5DemoPosition(input = {}, options = {}) {
  const env = options.env || {};
  const built = buildMt5DemoCloseRequest(input, env);
  if (!built.ok) {
    return {
      ok: false,
      reason: built.reason,
      demoOnly: true,
      realTradingTouched: false
    };
  }

  const bridgeResult = options.executeBridge === false ? null : await executeBridgeDemoClose(built.close, env);
  if (bridgeResult) {
    return {
      ...bridgeResult,
      close: {
        ticket: built.close.ticket,
        symbol: built.close.symbol,
        volume: built.close.volume,
        server: String(env.MT5_ACCOUNT2_SERVER),
        login: Number(env.MT5_ACCOUNT2_LOGIN)
      },
      demoOnly: true,
      realTradingTouched: false
    };
  }

  return {
    ok: false,
    reason: 'mt5_bridge_unavailable',
    close: {
      ticket: built.close.ticket,
      symbol: built.close.symbol,
      volume: built.close.volume,
      server: String(env.MT5_ACCOUNT2_SERVER),
      login: Number(env.MT5_ACCOUNT2_LOGIN)
    },
    demoOnly: true,
    realTradingTouched: false
  };
}

module.exports = {
  isMt5DemoTradingEnabled,
  buildMt5DemoOrderRequest,
  buildMt5DemoCloseRequest,
  placeMt5DemoOrder,
  closeMt5DemoPosition,
  modifyMt5DemoPosition,
  demoBridgeHasOpenSymbol,
  mt5DemoOrderPythonScript,
  buildBridgeOrderCommand,
  buildBridgeCloseCommand,
  buildBridgeModifyCommand,
  bridgeCommandText
};
