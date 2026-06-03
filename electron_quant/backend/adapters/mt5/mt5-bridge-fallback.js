function textValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function finiteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function roundPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100000000) / 100000000;
}

function sameText(left, right) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return String(left).trim().toUpperCase() === String(right).trim().toUpperCase();
}

function timeframeAliases(timeframe) {
  const raw = String(timeframe || 'M1').trim().toUpperCase();
  const compact = raw.replace(/^TIMEFRAME_/, '');
  const periodByTf = { M1: 1, M5: 5, M15: 15, M30: 30, H1: 60, H4: 240, D1: 1440, W1: 10080, MN1: 43200 };
  return new Set([raw, compact, String(periodByTf[compact] || compact)]);
}

function normalizeBridgeCandle(row = {}) {
  const openTime = finiteNumber(row.openTime, row.time, row.t);
  const open = finiteNumber(row.open, row.o);
  const high = finiteNumber(row.high, row.h);
  const low = finiteNumber(row.low, row.l);
  const close = finiteNumber(row.close, row.c);
  if (openTime === null || open === null || high === null || low === null || close === null) return null;
  return {
    openTime: openTime > 100000000000 ? Math.round(openTime) : Math.round(openTime * 1000),
    open,
    high,
    low,
    close,
    volume: finiteNumber(row.volume, row.tickVolume, row.v) || 0,
    closeTime: finiteNumber(row.closeTime) || (openTime > 100000000000 ? Math.round(openTime) : Math.round(openTime * 1000))
  };
}

function bridgeSymbolsFromStatus(status = {}) {
  const symbol = textValue(status.symbol);
  if (status.ok !== true || status.connected !== true || !symbol) {
    return { ok: false, symbols: [], source: 'mt5_bridge_status', reason: 'bridge_symbol_unavailable' };
  }
  return { ok: true, symbols: [symbol], source: 'mt5_bridge_status' };
}

function bridgeRatesFromStatus(symbol, timeframe, status = {}) {
  const requested = textValue(symbol);
  const aliases = timeframeAliases(timeframe);
  const ratesRoot = status?.rates;
  if (status.ok !== true || status.connected !== true || !requested || !ratesRoot || typeof ratesRoot !== 'object') {
    return { ok: false, symbol: requested, venue: 'MT5', source: 'mt5_bridge_rates', reason: 'bridge_rates_unavailable', candles: [] };
  }
  const symbolKey = Object.keys(ratesRoot).find((key) => sameText(key, requested));
  const symbolRates = symbolKey ? ratesRoot[symbolKey] : null;
  if (!symbolRates || typeof symbolRates !== 'object') {
    return { ok: false, symbol: requested, venue: 'MT5', source: 'mt5_bridge_rates', reason: 'bridge_rates_symbol_missing', candles: [] };
  }
  let packet = null;
  if (Array.isArray(symbolRates.candles)) {
    const packetTf = textValue(symbolRates.timeframe, symbolRates.period);
    if (!packetTf || aliases.has(String(packetTf).toUpperCase())) packet = symbolRates;
  } else {
    const tfKey = Object.keys(symbolRates).find((key) => aliases.has(String(key).toUpperCase()));
    packet = tfKey ? symbolRates[tfKey] : null;
  }
  const candles = (Array.isArray(packet?.candles) ? packet.candles : [])
    .map(normalizeBridgeCandle)
    .filter(Boolean)
    .sort((a, b) => a.openTime - b.openTime);
  if (!candles.length) {
    return { ok: false, symbol: requested, venue: 'MT5', source: 'mt5_bridge_rates', reason: 'bridge_rates_empty', candles: [] };
  }
  const ticker = bridgeTickerFromStatus(requested, status);
  return {
    ok: true,
    symbol: symbolKey || requested,
    venue: 'MT5',
    source: 'mt5_bridge_rates',
    timeframe: textValue(packet?.timeframe) || String(timeframe || 'M1').toUpperCase(),
    candles,
    ticker: ticker.ok ? ticker : null,
    updatedAt: status.updatedAt || status.ts || null
  };
}

function bridgeTickCandlesFromStatus(symbol, timeframe, status = {}, count = 60) {
  const ticker = bridgeTickerFromStatus(symbol, status);
  if (!ticker.ok) {
    return { ok: false, symbol, venue: 'MT5', source: 'mt5_bridge_tick_fallback', reason: ticker.reason || 'bridge_tick_unavailable', candles: [] };
  }
  const price = ticker.price;
  const range = Math.max(Number(ticker.spread || 0), Math.abs(price) * 0.00003, 1e-8);
  const tf = String(timeframe || 'M1').toUpperCase();
  const secondsByTf = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400, W1: 604800 };
  const stepMs = (secondsByTf[tf] || 60) * 1000;
  const n = Math.max(24, Math.min(120, Number(count) || 60));
  const base = Date.now() - (n - 1) * stepMs;
  const candles = [];
  for (let i = 0; i < n; i++) {
    const wobble = Math.sin(i / 3) * range * 0.35;
    const close = roundPrice(price + wobble);
    const open = roundPrice(price + Math.sin((i - 1) / 3) * range * 0.35);
    candles.push({
      openTime: base + i * stepMs,
      open,
      high: roundPrice(Math.max(open, close) + range * 0.45),
      low: roundPrice(Math.min(open, close) - range * 0.45),
      close,
      volume: 0,
      closeTime: base + (i + 1) * stepMs
    });
  }
  return {
    ok: true,
    symbol: ticker.symbol,
    venue: 'MT5',
    source: 'mt5_bridge_tick_fallback',
    degraded: true,
    reason: 'MT5 OHLC no disponible; usando tick del bridge para mantener grafica visible',
    candles,
    ticker
  };
}

function bridgeTickerFromStatus(symbol, status = {}) {
  const requested = textValue(symbol);
  const bridgeSymbol = textValue(status.symbol);
  const bid = finiteNumber(status.bid);
  const ask = finiteNumber(status.ask);
  const price = roundPrice(finiteNumber(
    status.price,
    status.lastPrice,
    bid !== null && ask !== null ? (bid + ask) / 2 : null,
    bid,
    ask
  ));
  if (status.ok !== true || status.connected !== true || !requested || !sameText(requested, bridgeSymbol) || price === null || price <= 0) {
    return { ok: false, symbol: requested, venue: 'MT5', source: 'mt5_bridge_status', reason: 'bridge_ticker_unavailable' };
  }
  return {
    ok: true,
    symbol: bridgeSymbol,
    venue: 'MT5',
    price,
    bid,
    ask,
    spread: bid !== null && ask !== null ? roundPrice(Math.max(ask - bid, 0)) : 0,
    updatedAt: status.updatedAt || status.ts || null,
    source: 'mt5_bridge_status'
  };
}

module.exports = {
  bridgeSymbolsFromStatus,
  bridgeTickerFromStatus,
  bridgeRatesFromStatus,
  bridgeTickCandlesFromStatus
};
