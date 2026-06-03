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

function bridgeSymbolsFromStatus(status = {}) {
  const symbol = textValue(status.symbol);
  if (status.ok !== true || status.connected !== true || !symbol) {
    return { ok: false, symbols: [], source: 'mt5_bridge_status', reason: 'bridge_symbol_unavailable' };
  }
  return { ok: true, symbols: [symbol], source: 'mt5_bridge_status' };
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
  bridgeTickerFromStatus
};
