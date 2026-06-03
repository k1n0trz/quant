const fs = require('node:fs');
const path = require('node:path');
const { validateRiskConfig } = require('../risk/risk-policy');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const TAIL_READ_BYTES = 64 * 1024;
const SUPPORTED_SPOT_QUOTES = ['USDT', 'USDC', 'FDUSD'];

function boolFlag(value) {
  return String(value || 'false').trim().toLowerCase() === 'true';
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundedNumber(value, decimals = 8) {
  const number = finiteNumber(value);
  if (number === null) return null;
  return Number(number.toFixed(decimals));
}

function floorToStep(value, step) {
  const number = finiteNumber(value);
  const stepNumber = finiteNumber(step);
  if (number === null || number <= 0) return 0;
  if (stepNumber === null || stepNumber <= 0) return roundedNumber(number, 8);
  const precision = Math.max(0, Math.min(12, Math.round(-Math.log10(stepNumber))));
  return Number((Math.floor(number / stepNumber) * stepNumber).toFixed(precision));
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
  if (!/^[A-Z0-9]{3,32}$/.test(normalized)) return null;
  return SUPPORTED_SPOT_QUOTES.some((quote) => normalized.endsWith(quote)) ? normalized : null;
}

function normalizeSide(side) {
  const upper = String(side || '').trim().toUpperCase();
  return upper === 'BUY' || upper === 'SELL' ? upper : null;
}

function normalizeType(type) {
  const upper = String(type || 'MARKET').trim().toUpperCase();
  return upper === 'MARKET' || upper === 'LIMIT' ? upper : null;
}

function quoteAssetFromSymbol(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  return SUPPORTED_SPOT_QUOTES.find((quote) => normalized.endsWith(quote)) || null;
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

function hasPreflightDeps(deps = {}) {
  return typeof deps.getSymbolFilters === 'function'
    && typeof deps.getTicker === 'function'
    && typeof deps.getBinanceSpotBalance === 'function';
}

function summarizeEarnBalance(earn = {}, asset = 'USDT') {
  const positions = Array.isArray(earn?.positions) ? earn.positions : [];
  const total = finiteNumber(earn?.total ?? earn?.amount ?? earn?.totalAmount) || 0;
  const redeemable = finiteNumber(earn?.redeemable ?? earn?.redeemableAmount ?? earn?.available) || total;
  return {
    asset: String(earn?.asset || asset || 'USDT').toUpperCase(),
    total: roundedNumber(total, 8),
    redeemable: roundedNumber(redeemable, 8),
    positions: positions.slice(0, 5).map((position) => ({
      productId: sanitizeText(position.productId || '', 64),
      asset: sanitizeText(position.asset || asset || 'USDT', 16),
      totalAmount: roundedNumber(position.totalAmount ?? position.amount, 8),
      redeemableAmount: roundedNumber(position.redeemableAmount ?? position.totalAmount ?? position.amount, 8)
    })),
    error: earn?.error ? sanitizeText(earn.error) : ''
  };
}

function normalizeRequest(input = {}) {
  const venue = String(input.venue || 'BINANCE').trim().toUpperCase();
  if (venue !== 'BINANCE') return { ok: false, error: 'Solo Binance Spot esta soportado en este canal real.' };

  const symbol = normalizeSymbol(input.symbol);
  if (!symbol) return { ok: false, error: 'Simbolo Binance Spot invalido. Usa un par USDT, USDC o FDUSD soportado.' };

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

async function preflightBinanceRealOrder({ input = {}, env = {}, botState = {}, riskConfig = {}, deps = {} } = {}) {
  const normalized = normalizeRequest(input);
  if (!normalized.ok) {
    return { ok: false, status: 'blocked', error: sanitizeText(normalized.error), reasons: [sanitizeText(normalized.error)], request: null };
  }
  const request = normalized.request;
  const gates = validateExecutionGates({ env, botState, riskConfig });
  if (!gates.ok) {
    return { ok: false, status: 'blocked', error: sanitizeText(gates.issues[0]), reasons: gates.issues.map((issue) => sanitizeText(issue)), request };
  }
  if (!hasPreflightDeps(deps)) {
    return { ok: false, status: 'blocked', error: 'Preflight Binance incompleto.', reasons: ['Preflight Binance incompleto.'], request };
  }

  const filters = await deps.getSymbolFilters(request.symbol);
  const minQty = finiteNumber(filters?.minQty) || 0;
  const stepSize = finiteNumber(filters?.stepSize) || 0;
  const minNotional = finiteNumber(filters?.minNotional) || 0;
  const quoteAsset = String(filters?.quoteAsset || 'USDT').toUpperCase();
  const ticker = request.type === 'LIMIT' ? null : await deps.getTicker(request.symbol);
  const effectivePrice = request.type === 'LIMIT'
    ? request.price
    : finiteNumber(ticker?.price ?? ticker?.lastPrice ?? ticker);
  const balance = await deps.getBinanceSpotBalance(quoteAsset);
  const quoteFree = finiteNumber(balance?.free ?? balance?.available ?? balance) || 0;
  const requestedNotional = roundedNumber(request.qty * effectivePrice, 8);
  const maxAffordableQty = effectivePrice > 0 ? floorToStep(quoteFree / effectivePrice, stepSize) : 0;
  const suggestedQty = Math.min(request.qty, maxAffordableQty);
  const suggestedNotional = roundedNumber(suggestedQty * effectivePrice, 8);
  const spotShortfall = roundedNumber(Math.max((requestedNotional || 0) - quoteFree, 0), 8);
  let earn = { asset: quoteAsset, total: 0, redeemable: 0, positions: [], error: '' };
  if (typeof deps.getBinanceEarnBalance === 'function') {
    try {
      earn = summarizeEarnBalance(await deps.getBinanceEarnBalance(quoteAsset), quoteAsset);
    } catch (error) {
      earn = { asset: quoteAsset, total: 0, redeemable: 0, positions: [], error: sanitizeText(error?.message || error) };
    }
  }
  const totalPotentialQuote = roundedNumber(quoteFree + (earn.redeemable || 0), 8);
  const canCoverWithEarn = spotShortfall > 0 && (earn.redeemable || 0) >= spotShortfall;

  const checks = {
    symbolTrading: String(filters?.status || 'TRADING').toUpperCase() === 'TRADING',
    priceKnown: effectivePrice > 0,
    qtyAboveMin: request.qty >= minQty,
    minNotionalOk: requestedNotional >= minNotional,
    balanceEnough: quoteFree >= requestedNotional,
    suggestedMeetsMin: suggestedQty >= minQty && suggestedNotional >= minNotional,
    earnCanCoverShortfall: canCoverWithEarn,
    orderTestOk: null
  };
  const reasons = [];
  if (!checks.symbolTrading) reasons.push(`${request.symbol} no esta en estado TRADING.`);
  if (!checks.priceKnown) reasons.push('Precio Binance no disponible para preflight.');
  if (!checks.qtyAboveMin) reasons.push(`Cantidad ${request.qty} menor al minimo ${minQty}.`);
  if (!checks.minNotionalOk) reasons.push(`Notional ${requestedNotional} ${quoteAsset} menor al minimo ${minNotional}.`);
  if (!checks.balanceEnough) reasons.push(`Saldo insuficiente: libre ${quoteFree} ${quoteAsset}, requerido ${requestedNotional} ${quoteAsset}.`);
  if (!checks.balanceEnough && earn.redeemable > 0) {
    reasons.push(`Hay ${earn.redeemable} ${quoteAsset} en Earn Flexible, pero Spot no puede usarlo hasta redimirlo a Spot.`);
  }
  if (!checks.suggestedMeetsMin) reasons.push(`Saldo libre no permite una orden minima valida en ${request.symbol}.`);
  if (reasons.length === 0 && typeof deps.testOrderBinance === 'function') {
    try {
      const testOrder = await deps.testOrderBinance(request.side, request.symbol, request.qty, request.type, request.price);
      checks.orderTestOk = testOrder?.ok === true;
      if (!checks.orderTestOk) reasons.push(`Binance order/test rechazo la orden: ${sanitizeText(testOrder?.error || testOrder?.msg || 'order_test_failed')}`);
    } catch (error) {
      checks.orderTestOk = false;
      reasons.push(`Binance order/test rechazo la orden: ${sanitizeText(error?.message || error)}`);
    }
  }

  return {
    ok: reasons.length === 0,
    status: reasons.length === 0 ? 'ready' : 'blocked',
    error: reasons.length ? sanitizeText(reasons[0]) : null,
    reasons: reasons.map((reason) => sanitizeText(reason)),
    request,
    quoteAsset,
    quoteFree,
    effectivePrice: roundedNumber(effectivePrice, 8),
    requestedNotional,
    spotShortfall,
    minQty,
    stepSize,
    minNotional,
    earn,
    totalPotentialQuote,
    canCoverWithEarn,
    maxAffordableQty,
    suggestedQty: roundedNumber(suggestedQty, 8),
    suggestedNotional,
    checks
  };
}

async function executeBinanceRealOrder({ input = {}, env = {}, botState = {}, riskConfig = {}, deps = {} } = {}) {
  const normalized = normalizeRequest(input);
  if (!normalized.ok) return buildBlockedResult(normalized.error, null);
  const request = normalized.request;

  const gates = validateExecutionGates({ env, botState, riskConfig });
  if (!gates.ok) return buildBlockedResult(gates.issues[0], request, gates.issues);

  if (hasPreflightDeps(deps)) {
    const preflight = await preflightBinanceRealOrder({ input, env, botState, riskConfig, deps });
    if (!preflight.ok) {
      const blocked = buildBlockedResult(preflight.error || 'Preflight Binance bloqueado.', request, preflight.reasons);
      blocked.preflight = preflight;
      return blocked;
    }
  }

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

function clampDiscoveryLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n)) return 80;
  return Math.max(1, Math.min(500, Math.floor(n)));
}

async function discoverBinanceRealSpotUniverse(input = {}) {
  const symbols = Array.isArray(input.symbols) ? input.symbols : [];
  const env = input.env || {};
  const botState = input.botState || {};
  const riskConfig = input.riskConfig || {};
  const deps = input.deps || {};
  const limit = clampDiscoveryLimit(input.limit);
  const maxChecks = clampDiscoveryLimit(input.maxChecks || limit);
  const quoteAssets = Array.isArray(input.quoteAssets) && input.quoteAssets.length
    ? input.quoteAssets.map((quote) => String(quote).trim().toUpperCase()).filter((quote) => SUPPORTED_SPOT_QUOTES.includes(quote))
    : SUPPORTED_SPOT_QUOTES;

  const balances = {};
  for (const asset of quoteAssets) {
    let spot = { asset, free: 0, locked: 0 };
    let earn = { asset, total: 0, redeemable: 0, positions: [], error: '' };
    try {
      if (typeof deps.getBinanceSpotBalance === 'function') spot = await deps.getBinanceSpotBalance(asset);
    } catch (error) {
      spot = { asset, free: 0, locked: 0, error: sanitizeText(error?.message || error) };
    }
    try {
      if (typeof deps.getBinanceEarnBalance === 'function') earn = summarizeEarnBalance(await deps.getBinanceEarnBalance(asset), asset);
    } catch (error) {
      earn = { asset, total: 0, redeemable: 0, positions: [], error: sanitizeText(error?.message || error) };
    }
    balances[asset] = {
      asset,
      free: roundedNumber(finiteNumber(spot?.free ?? spot?.available ?? spot) || 0, 8),
      locked: roundedNumber(finiteNumber(spot?.locked) || 0, 8),
      earn
    };
  }

  const unique = [];
  const seen = new Set();
  for (const raw of symbols) {
    const symbol = normalizeSymbol(raw);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    const quoteAsset = quoteAssetFromSymbol(symbol);
    if (!quoteAsset || !quoteAssets.includes(quoteAsset)) continue;
    const quoteFree = balances[quoteAsset]?.free || 0;
    if (quoteFree <= 0) continue;
    unique.push(symbol);
  }

  const perCandidateTimeoutMs = Math.max(25, Math.min(15000, Number(input.perCandidateTimeoutMs || 4500)));
  const concurrency = Math.max(1, Math.min(10, Math.floor(Number(input.concurrency || 5))));
  const scanSymbols = unique.slice(0, maxChecks);

  function withTimeout(promise, ms, label) {
    let timer = null;
    return Promise.race([
      promise.finally(() => { if (timer) clearTimeout(timer); }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
      })
    ]);
  }

  async function evaluateUniverseSymbol(symbol) {
    try {
      let filters = null;
      let market = null;
      filters = typeof deps.getSymbolFilters === 'function' ? await deps.getSymbolFilters(symbol) : null;
      market = typeof deps.getTicker === 'function' ? await deps.getTicker(symbol) : null;
      const quoteAsset = String(filters?.quoteAsset || quoteAssetFromSymbol(symbol) || 'USDT').toUpperCase();
      const price = finiteNumber(market?.price ?? market?.lastPrice ?? market);
      const quoteFree = balances[quoteAsset]?.free || 0;
      const minNotional = finiteNumber(filters?.minNotional) || 5;
      const stepSize = finiteNumber(filters?.stepSize) || 0;
      const minQty = finiteNumber(filters?.minQty) || 0;
      if (!price || price <= 0 || quoteFree < minNotional) {
        return { type: 'blocked', row: { symbol, quoteAsset, reason: quoteFree < minNotional ? 'quote_balance_below_min_notional' : 'price_unavailable' } };
      }
      const requestedNotional = Math.min(quoteFree, Math.max(minNotional, Math.min(quoteFree, Number(input.targetNotional || minNotional * 2))));
      const qty = floorToStep(requestedNotional / price, stepSize);
      if (!qty || qty < minQty) {
        return { type: 'blocked', row: { symbol, quoteAsset, reason: 'qty_below_min_after_sizing' } };
      }
      const preflight = await preflightBinanceRealOrder({
        input: { venue: 'BINANCE', side: 'BUY', symbol, qty, type: 'MARKET' },
        env,
        botState,
        riskConfig,
        deps
      });
      const row = {
        symbol,
        venue: 'BINANCE',
        side: 'BUY',
        type: 'MARKET',
        quoteAsset: preflight.quoteAsset || quoteAsset,
        qty: roundedNumber(qty, 8),
        price: preflight.effectivePrice || roundedNumber(price, 8),
        requestedNotional: preflight.requestedNotional,
        quoteFree: preflight.quoteFree,
        minNotional: preflight.minNotional,
        orderTestOk: preflight.checks?.orderTestOk === true,
        status: preflight.status,
        reasons: preflight.reasons || []
      };
      if (preflight.ok) return { type: 'ready', row };
      return { type: 'blocked', row: { ...row, reason: row.reasons[0] || preflight.error || 'preflight_blocked' } };
    } catch (error) {
      return { type: 'blocked', row: { symbol, reason: sanitizeText(error?.message || error) } };
    }
  }

  const results = [];
  for (let index = 0; index < scanSymbols.length; index += concurrency) {
    const batch = scanSymbols.slice(index, index + concurrency);
    const resolved = await Promise.all(batch.map((symbol) => (
      withTimeout(evaluateUniverseSymbol(symbol), perCandidateTimeoutMs, `${symbol}_real_universe`)
        .catch((error) => ({ type: 'blocked', row: { symbol, reason: sanitizeText(error?.message || error) } }))
    )));
    results.push(...resolved);
  }

  const ready = [];
  const blocked = [];
  for (const result of results) {
    if (result?.type === 'ready' && ready.length < limit) ready.push(result.row);
    else if (result?.row) blocked.push(result.row);
  }
  const checked = scanSymbols.length;

  return {
    ok: true,
    checked,
    totalSymbols: unique.length,
    readyCount: ready.length,
    blockedCount: blocked.length,
    balances,
    ready,
    blocked: blocked.slice(0, Math.max(limit, 20)),
    safety: {
      readOnly: true,
      realTradingTouched: false,
      orderTestOnly: true
    }
  };
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
  preflightBinanceRealOrder,
  discoverBinanceRealSpotUniverse,
  summarizeBinanceRealOrderAudit,
  appendBinanceRealOrderAudit,
  readBinanceRealOrderAudit
};
