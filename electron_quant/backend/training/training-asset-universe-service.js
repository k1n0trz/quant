const { resolveBootstrapTargets } = require('./training-bootstrap-service');

const SUPPORTED_BINANCE_QUOTES = ['USDT', 'USDC', 'FDUSD'];

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

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSymbolRow(row) {
  if (typeof row === 'string') return { venue: 'BINANCE', symbol: row };
  if (!isObject(row)) return null;
  return {
    ...row,
    venue: textValue(row.venue, 'BINANCE'),
    symbol: textValue(row.symbol)
  };
}

function quoteAsset(symbol) {
  const text = textValue(symbol) || '';
  return SUPPORTED_BINANCE_QUOTES.find((quote) => text.endsWith(quote)) || null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function spreadPctFromTicker(ticker = {}) {
  const bid = finiteNumber(ticker.bid, ticker.bidPrice);
  const ask = finiteNumber(ticker.ask, ticker.askPrice);
  const price = finiteNumber(ticker.price, ticker.lastPrice, bid && ask ? (bid + ask) / 2 : null);
  const explicitSpread = finiteNumber(ticker.spread);
  if (price === null || price <= 0) return null;
  if (bid !== null && ask !== null && ask >= bid) return (ask - bid) / price;
  if (explicitSpread !== null) return explicitSpread / price;
  return 0;
}

function chooseStrategy(changePct, spreadPct) {
  const absMomentum = Math.abs(changePct);
  if (absMomentum >= 3.5) {
    return {
      id: 'breakoutRetest',
      name: 'Breakout + Retest',
      setup: 'High momentum expansion candidate selected from backend asset universe'
    };
  }
  if (absMomentum <= 0.45 && spreadPct <= 0.0008) {
    return {
      id: 'meanReversion',
      name: 'Mean Reversion / RSI-ATR',
      setup: 'Low momentum liquid candidate selected for controlled reversion paper test'
    };
  }
  return {
    id: 'trendMomentum',
    name: 'Trend Momentum / EMA-MACD',
    setup: 'Liquid momentum candidate selected from backend asset universe'
  };
}

function scoreTickerCandidate(symbolRow, ticker, index, nowMs) {
  const symbol = textValue(symbolRow.symbol);
  const venue = textValue(symbolRow.venue, 'BINANCE');
  const price = finiteNumber(ticker?.price, ticker?.lastPrice);
  const quoteVolume = finiteNumber(ticker?.quoteVolume, ticker?.quote_volume, 0) || 0;
  const volume = finiteNumber(ticker?.volume, 0) || 0;
  const changePct = finiteNumber(ticker?.changePct, ticker?.priceChangePercent, 0) || 0;
  const spreadPct = spreadPctFromTicker(ticker);

  if (!symbol) return { ok: false, reason: 'missing_symbol' };
  if (venue === 'BINANCE' && !quoteAsset(symbol)) return { ok: false, symbol, venue, reason: 'unsupported_quote' };
  if (price === null || price <= 0) return { ok: false, symbol, venue, reason: 'missing_price' };
  if (spreadPct === null) return { ok: false, symbol, venue, reason: 'missing_spread' };
  if (spreadPct > 0.003) return { ok: false, symbol, venue, reason: 'spread_too_wide', spreadPct };
  if (quoteVolume < 100000) return { ok: false, symbol, venue, reason: 'insufficient_liquidity', quoteVolume };

  const liquidityScore = clamp(Math.log10(Math.max(quoteVolume, 1)) * 8, 0, 80);
  const spreadScore = clamp((0.003 - spreadPct) / 0.003 * 18, 0, 18);
  const momentumScore = clamp(Math.abs(changePct) * 2.5, 0, 12);
  const score = Math.round(clamp(54 + liquidityScore * 0.35 + spreadScore + momentumScore, 62, 96));
  const confidence = Math.round(clamp(70 + (score - 62) * 0.45 + Math.min(8, Math.abs(changePct)), 74, 92));
  const bias = changePct < 0 ? 'SHORT' : 'LONG';
  const strategy = chooseStrategy(changePct, spreadPct);
  const htfAlignmentScore = clamp(0.52 + Math.min(0.22, Math.abs(changePct) / 20), 0.52, 0.78);
  const patternScore = clamp(0.46 + Math.min(0.28, (score - 62) / 100), 0.46, 0.76);
  const volumeRatio = clamp(0.9 + Math.min(0.45, Math.log10(Math.max(volume, 1)) / 30), 0.9, 1.35);

  return {
    ok: true,
    pair: {
      venue,
      symbol,
      price,
      score,
      spreadPct,
      quoteVolume,
      source: 'backend.training.asset_universe',
      refreshedAt: new Date(nowMs).toISOString(),
      indicators: {
        bias,
        confidence,
        horizon: index % 3 === 0 ? 'swing' : 'intraday',
        htfAlignmentScore,
        patternScore,
        volumeRatio,
        volatilityPct: Math.abs(changePct) / 100,
        momentum: changePct,
        pairScore: score,
        strategy_id: strategy.id,
        strategy_name: strategy.name,
        primaryStrategy: {
          id: strategy.id,
          name: strategy.name,
          score,
          backendExecutable: true,
          phase: 'asset_universe'
        },
        setup: strategy.setup,
        source: 'backend.training.asset_universe',
        entry_reason_code: 'asset_universe_ranked_paper',
        learning_mode: confidence >= 78 ? 'professional_setup' : 'exploration_paper'
      }
    }
  };
}

async function collectBinanceRows(deps = {}, scanLimit = 40) {
  if (typeof deps.getBinanceSymbols !== 'function') return [];
  const raw = await deps.getBinanceSymbols();
  const rows = Array.isArray(raw) ? raw : [];
  return rows
    .map(normalizeSymbolRow)
    .filter(Boolean)
    .slice(0, scanLimit);
}

async function resolveTrainingAssetUniverse(options = {}) {
  const deps = options.deps || {};
  const env = options.env || {};
  const nowMs = Number.isFinite(Number(options.nowMs)) ? Number(options.nowMs) : Date.now();
  const targets = options.targets || resolveBootstrapTargets(env);
  const scanLimit = Number.isFinite(Number(env.TRAINING_ASSET_UNIVERSE_SCAN_LIMIT))
    ? Math.max(1, Number(env.TRAINING_ASSET_UNIVERSE_SCAN_LIMIT))
    : Math.max(targets.maxTotal || targets.total || 20, 40);

  if (typeof deps.getTicker !== 'function') {
    return {
      ok: false,
      reason: 'ticker_reader_missing',
      pairs: [],
      skipped: [],
      source: 'backend.training.asset_universe'
    };
  }

  const rows = await collectBinanceRows(deps, scanLimit);
  const pairs = [];
  const skipped = [];

  for (const row of rows) {
    if (row.venue === 'BINANCE' && !quoteAsset(row.symbol)) {
      skipped.push({ symbol: row.symbol, venue: row.venue, reason: 'unsupported_quote' });
      continue;
    }

    let ticker = null;
    try {
      ticker = await deps.getTicker(row.symbol);
    } catch (error) {
      skipped.push({ symbol: row.symbol, venue: row.venue, reason: 'ticker_failed', error: String(error?.message || error) });
      continue;
    }

    const scored = scoreTickerCandidate(row, ticker, pairs.length, nowMs);
    if (!scored.ok) {
      skipped.push({
        symbol: scored.symbol || row.symbol,
        venue: scored.venue || row.venue,
        reason: scored.reason,
        spreadPct: scored.spreadPct,
        quoteVolume: scored.quoteVolume
      });
      continue;
    }
    pairs.push(scored.pair);
  }

  const ranked = pairs
    .sort((left, right) => (Number(right.score || 0) - Number(left.score || 0)) || (Number(right.quoteVolume || 0) - Number(left.quoteVolume || 0)))
    .slice(0, targets.total || 20)
    .map((pair, index) => ({
      ...pair,
      indicators: {
        ...pair.indicators,
        horizon: index < (targets.swing || 0) ? 'swing' : 'intraday'
      }
    }));

  return {
    ok: true,
    reason: null,
    pairs: ranked,
    skipped,
    source: 'backend.training.asset_universe',
    generatedAt: new Date(nowMs).toISOString(),
    targets,
    scanLimit
  };
}

module.exports = {
  resolveTrainingAssetUniverse,
  scoreTickerCandidate
};
