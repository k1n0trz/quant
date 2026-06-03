function textValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function sameText(left, right) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return String(left).trim().toUpperCase() === String(right).trim().toUpperCase();
}

function finiteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function parseTimeMs(...values) {
  for (const value of values) {
    if (Number.isFinite(Number(value))) {
      const numeric = Number(value);
      return Math.abs(numeric) < 1000000000000 ? numeric * 1000 : numeric;
    }
    if (typeof value === 'string' && value.trim()) {
      const timeMs = Date.parse(value);
      if (Number.isFinite(timeMs)) return timeMs;
    }
  }
  return null;
}

function normalizeReadOnlyDeps(options = {}) {
  const deps = options.deps && typeof options.deps === 'object' ? { ...options.deps } : {};
  if (typeof deps.getTicker !== 'function' && typeof options.getTicker === 'function') deps.getTicker = options.getTicker;
  if (typeof deps.getMt5Ticker !== 'function' && typeof options.getMt5Ticker === 'function') deps.getMt5Ticker = options.getMt5Ticker;
  if (typeof deps.readMt5Snapshot !== 'function' && typeof options.readMt5Snapshot === 'function') deps.readMt5Snapshot = options.readMt5Snapshot;
  if (typeof deps.readMemory !== 'function' && typeof options.readMemory === 'function') deps.readMemory = options.readMemory;
  return deps;
}

function createUnavailableMarketContext(symbol, venue, source, reason, stale = false, ageMs = null) {
  return {
    symbol: textValue(symbol),
    venue: textValue(venue),
    price: null,
    source,
    stale,
    ageMs,
    available: false,
    reason
  };
}

function finalizeResolvedMarketContext(symbol, venue, source, price, timestampMs, nowMs, staleAfterMs, allowStale) {
  const ageMs = timestampMs === null ? 0 : Math.max(0, nowMs - timestampMs);
  const stale = ageMs > staleAfterMs;
  if (stale && !allowStale) {
    return createUnavailableMarketContext(symbol, venue, source, 'stale_price', true, ageMs);
  }
  return {
    symbol: textValue(symbol),
    venue: textValue(venue),
    price: Number(price),
    source,
    stale,
    ageMs,
    available: true,
    reason: stale ? 'stale_price' : null
  };
}

function resolveStatePairPrice(symbol, venue, state = {}) {
  const candidates = Array.isArray(state.activePairs) ? state.activePairs : [];
  const matched = candidates.find((candidate) => sameText(candidate.symbol, symbol) && (textValue(candidate.venue) ? sameText(candidate.venue, venue) : true));
  if (!matched) return null;
  const price = finiteNumber(matched.price, matched.current_price, matched.price_current, matched.market_price);
  if (price === null || price <= 0) return null;
  return {
    venue: textValue(venue, matched.venue),
    price,
    timestampMs: parseTimeMs(matched.updatedAt, matched.refreshedAt, matched.ts, matched.timestamp, state.persistedAt)
  };
}

async function resolveTrainingMarketContext(symbol, options = {}) {
  const resolvedSymbol = textValue(symbol);
  const resolvedVenue = textValue(options.venue, options.position?.venue);
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const staleAfterMs = Number.isFinite(Number(options.staleAfterMs)) ? Number(options.staleAfterMs) : 5 * 60 * 1000;
  const allowStale = options.allowStale === true;
  const deps = normalizeReadOnlyDeps(options);
  const state = options.state || {};

  if (!resolvedSymbol) {
    return createUnavailableMarketContext(symbol, resolvedVenue, 'none', 'missing_symbol');
  }

  if (sameText(resolvedVenue, 'MT5') && typeof deps.getMt5Ticker === 'function') {
    try {
      const tickerResult = await deps.getMt5Ticker(resolvedSymbol);
      const tickerPrice = finiteNumber(
        tickerResult?.price,
        tickerResult?.lastPrice,
        tickerResult?.bid && tickerResult?.ask ? (Number(tickerResult.bid) + Number(tickerResult.ask)) / 2 : null
      );
      if (tickerPrice !== null && tickerPrice > 0) {
        return finalizeResolvedMarketContext(
          resolvedSymbol,
          'MT5',
          'mt5_ticker',
          tickerPrice,
          parseTimeMs(tickerResult?.updatedAt, tickerResult?.ts) || nowMs,
          nowMs,
          staleAfterMs,
          allowStale
        );
      }
    } catch {}
  }

  if (typeof deps.getTicker === 'function') {
    let tickerResult = null;
    try {
      tickerResult = await deps.getTicker(resolvedSymbol);
    } catch {
      tickerResult = null;
    }
    const tickerPrice = finiteNumber(
      tickerResult?.price,
      tickerResult?.lastPrice,
      tickerResult?.bid && tickerResult?.ask ? (Number(tickerResult.bid) + Number(tickerResult.ask)) / 2 : null
    );
    if (tickerPrice !== null && tickerPrice > 0) {
      return finalizeResolvedMarketContext(
        resolvedSymbol,
        textValue(resolvedVenue, tickerResult?.venue),
        'ticker',
        tickerPrice,
        nowMs,
        nowMs,
        staleAfterMs,
        allowStale
      );
    }
  }

  if (typeof deps.readMt5Snapshot === 'function') {
    const mt5Snapshot = deps.readMt5Snapshot();
    const positions = Array.isArray(mt5Snapshot?.positions) ? mt5Snapshot.positions : [];
    const matched = positions.find((candidate) => sameText(candidate.symbol, resolvedSymbol));
    const mt5Price = finiteNumber(
      matched?.price_current,
      matched?.price,
      matched?.bid && matched?.ask ? (Number(matched.bid) + Number(matched.ask)) / 2 : null
    );
    if (mt5Price !== null && mt5Price > 0) {
      return finalizeResolvedMarketContext(
        resolvedSymbol,
        textValue(resolvedVenue, matched?.venue, mt5Snapshot?.venue, 'MT5'),
        'mt5_snapshot',
        mt5Price,
        parseTimeMs(mt5Snapshot?.syncedAt, mt5Snapshot?.updatedAt),
        nowMs,
        staleAfterMs,
        allowStale
      );
    }
  }

  const statePairPrice = resolveStatePairPrice(resolvedSymbol, resolvedVenue, state);
  if (statePairPrice) {
    return finalizeResolvedMarketContext(
      resolvedSymbol,
      statePairPrice.venue,
      'training_state_last_known',
      statePairPrice.price,
      statePairPrice.timestampMs,
      nowMs,
      staleAfterMs,
      allowStale
    );
  }

  return createUnavailableMarketContext(resolvedSymbol, resolvedVenue, 'none', 'missing_price');
}

module.exports = {
  resolveTrainingMarketContext
};
