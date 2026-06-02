const fs = require('node:fs');
const path = require('node:path');
const { validateRiskConfig } = require('../risk/risk-policy');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const TAIL_READ_BYTES = 64 * 1024;

function boolFlag(value) {
  return String(value || 'false').trim().toLowerCase() === 'true';
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeText(value, max = 240) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]+/gi, 'sk-[REDACTED]')
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^,\s]+/gi, '$1=[REDACTED]')
    .slice(0, max);
}

function normalizeSymbol(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  return /^[A-Z0-9]{3,24}USDT$/.test(normalized) ? normalized : null;
}

function normalizeSide(side) {
  const upper = String(side || '').trim().toUpperCase();
  return upper === 'BUY' || upper === 'SELL' ? upper : null;
}

function normalizeType(type) {
  const upper = String(type || 'MARKET').trim().toUpperCase();
  return upper === 'MARKET' || upper === 'LIMIT' ? upper : null;
}

function buildBlockedResult(error, request = null, details = []) {
  return {
    ok: false,
    status: 'blocked',
    error: sanitizeText(error),
    details: Array.isArray(details) ? details.map((item) => sanitizeText(item)).slice(0, 8) : [],
    request,
    order: null,
    safety: {
      realTradingTouched: false,
      binanceSpotOnly: true
    }
  };
}

function normalizeRequest(input = {}) {
  const venue = String(input.venue || 'BINANCE').trim().toUpperCase();
  if (venue !== 'BINANCE') return { ok: false, error: 'Solo Binance Spot esta soportado en este canal real.' };

  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) return { ok: false, error: 'Simbolo Binance Spot USDT invalido.' };

  const side = normalizeSide(input.side);
  if (!side) return { ok: false, error: 'Side invalido. Usa BUY o SELL.' };

  const type = normalizeType(input.type);
  if (!type) return { ok: false, error: 'Tipo invalido. Usa MARKET o LIMIT.' };

  const qty = finiteNumber(input.qty ?? input.quantity);
  if (qty === null || qty <= 0) return { ok: false, error: 'Cantidad invalida.' };

  const price = type === 'LIMIT' ? finiteNumber(input.price) : null;
  if (type === 'LIMIT' && (price === null || price <= 0)) return { ok: false, error: 'Precio limite requerido.' };

  return {
    ok: true,
    request: {
      venue,
      symbol,
      side,
      type,
      qty,
      price
    }
  };
}

function validateExecutionGates({ env = {}, botState = {}, riskConfig = {} }) {
  const issues = [];
  if (!boolFlag(env.REAL_TRADING)) issues.push('REAL_TRADING no esta armado.');
  if (!env.BINANCE_API_KEY || !env.BINANCE_SECRET) issues.push('Faltan claves Binance.');
  if (botState.tradingRealEnabled !== true) issues.push('Trading real deshabilitado en estado backend.');
  if (botState.killSwitch === true) issues.push('Kill switch activo.');
  const risk = validateRiskConfig(riskConfig);
  if (!risk.ok) issues.push(...risk.issues);
  return {
    ok: issues.length === 0,
    issues
  };
}

async function executeBinanceRealOrder({ input = {}, env = {}, botState = {}, riskConfig = {}, deps = {} } = {}) {
  const normalized = normalizeRequest(input);
  if (!normalized.ok) return buildBlockedResult(normalized.error, null);
  const request = normalized.request;

  const gates = validateExecutionGates({ env, botState, riskConfig });
  if (!gates.ok) return buildBlockedResult(gates.issues[0], request, gates.issues);

  if (typeof deps.placeOrderBinance !== 'function') {
    return buildBlockedResult('Executor Binance real no disponible.', request);
  }

  try {
    const order = await deps.placeOrderBinance(request.side, request.symbol, request.qty, request.type, request.price);
    if (!order || order.ok !== true) {
      return {
        ok: false,
        status: 'error',
        error: sanitizeText(order?.error || 'Executor Binance devolvio fallo.'),
        request,
        order: null,
        safety: {
          realTradingTouched: true,
          binanceSpotOnly: true
        }
      };
    }
    return {
      ok: true,
      status: 'executed',
      request,
      order,
      safety: {
        realTradingTouched: true,
        binanceSpotOnly: true
      }
    };
  } catch (error) {
    return {
      ok: false,
      status: 'error',
      error: sanitizeText(error?.message || error),
      request,
      order: null,
      safety: {
        realTradingTouched: true,
        binanceSpotOnly: true
      }
    };
  }
}

function summarizeBinanceRealOrderAudit({ request = {}, result = {}, now = () => new Date() } = {}) {
  const req = result.request || request || {};
  const order = result.order || {};
  return {
    ts: new Date(now()).toISOString(),
    status: result.status || (result.ok ? 'executed' : 'blocked'),
    ok: result.ok === true,
    symbol: sanitizeText(req.symbol || request.symbol || '', 32),
    side: sanitizeText(req.side || request.side || '', 8),
    type: sanitizeText(req.type || request.type || 'MARKET', 10),
    qty: finiteNumber(req.qty ?? request.qty ?? request.quantity),
    price: finiteNumber(req.price ?? request.price),
    orderId: order.orderId || null,
    exchangeStatus: order.status || null,
    notional: finiteNumber(order.notional),
    error: result.error ? sanitizeText(result.error) : null,
    realTradingTouched: result.safety?.realTradingTouched === true
  };
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function appendBinanceRealOrderAudit(filePath, entry) {
  if (!filePath) return { ok: false, reason: 'audit_file_missing' };
  ensureDir(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  return { ok: true, file: filePath };
}

function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function readBinanceRealOrderAudit(filePath, limit = DEFAULT_LIMIT) {
  const resolvedLimit = clampLimit(limit);
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: true, exists: false, file: filePath || null, sizeBytes: 0, limit: resolvedLimit, entries: [] };
  }
  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, 'r');
  try {
    const bytesToRead = Math.min(stat.size, TAIL_READ_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    fs.readSync(fd, buffer, 0, bytesToRead, Math.max(0, stat.size - bytesToRead));
    let lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
    if (stat.size > TAIL_READ_BYTES && lines.length) lines = lines.slice(1);
    const entries = [];
    for (const line of lines) {
      try { entries.push(JSON.parse(line)); } catch {}
    }
    return { ok: true, exists: true, file: filePath, sizeBytes: stat.size, limit: resolvedLimit, entries: entries.slice(-resolvedLimit) };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  executeBinanceRealOrder,
  summarizeBinanceRealOrderAudit,
  appendBinanceRealOrderAudit,
  readBinanceRealOrderAudit
};
