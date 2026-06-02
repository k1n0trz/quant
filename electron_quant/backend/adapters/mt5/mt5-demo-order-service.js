const { spawn } = require('node:child_process');

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

  const order = {
    login: Number(env.MT5_ACCOUNT2_LOGIN),
    server: String(env.MT5_ACCOUNT2_SERVER),
    symbol,
    side,
    volume,
    type,
    price: price || null,
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
  const payload = {
    order: built.order,
    password: String(env.MT5_ACCOUNT2_PASSWORD || '')
  };
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

module.exports = {
  isMt5DemoTradingEnabled,
  buildMt5DemoOrderRequest,
  placeMt5DemoOrder,
  mt5DemoOrderPythonScript
};
