const { resolveTrainingMarketContext } = require('./training-market-context-service');
const { resolveTrainingSignalContext } = require('./training-signal-context-service');

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

function sameText(left, right) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return String(left).trim().toUpperCase() === String(right).trim().toUpperCase();
}

function isTrainingBackendDemoEntryEnabled(env = {}) {
  return String(env.TRAINING_BACKEND_DEMO_ENTRY_ENABLED || 'false').toLowerCase() === 'true';
}

function isTrainingBackendDemoEntryAllowDefensiveSignalEnabled(env = {}) {
  return String(env.TRAINING_BACKEND_DEMO_ENTRY_ALLOW_DEFENSIVE_SIGNAL || 'false').toLowerCase() === 'true';
}

function isGuardedPaperTrainingState(state = {}) {
  return (
    String(state.mode || '').toLowerCase() === 'training'
    && state.simulated !== false
    && state.blockRealExecution !== false
  );
}

function isTrainingMt5DemoOrderSendEnabled(env = {}) {
  return String(env.TRAINING_MT5_DEMO_ORDER_SEND_ENABLED || 'false').toLowerCase() === 'true';
}

function stableTraceHash(input) {
  const text = String(input || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function trainingSignalId(pair = {}, signal = {}, createdAt = '') {
  const primary = signal.primaryStrategy || {};
  const strategyId = signal.strategy_id || primary.id || 'unknown';
  return `sig_${stableTraceHash([
    'training',
    pair.venue || 'unknown',
    pair.symbol || 'unknown',
    signal.bias || 'NEUTRAL',
    signal.horizon || 'intraday',
    strategyId,
    createdAt
  ].join('|'))}`;
}

function trainingPositionId(pair = {}, signal = {}, createdAt = '') {
  const primary = signal.primaryStrategy || {};
  const strategyId = signal.strategy_id || primary.id || 'unknown';
  return `pos_${stableTraceHash([
    'training-position',
    pair.venue || 'unknown',
    pair.symbol || 'unknown',
    signal.horizon || 'intraday',
    strategyId,
    createdAt
  ].join('|'))}`;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function resolveTargetCount(state = {}, horizon = 'intraday') {
  if (horizon === 'swing') {
    return finiteNumber(
      state.targetSwingPositions,
      state.targets?.swing,
      10
    );
  }
  return finiteNumber(
    state.targetIntradayPositions,
    state.targets?.intraday,
    10
  );
}

function resolveMinMt5OpenPositions(state = {}) {
  return finiteNumber(state.minMt5OpenPositions, 6);
}

function normalizeEntryPair(candidate) {
  if (typeof candidate === 'string') {
    return {
      symbol: candidate,
      venue: 'BINANCE',
      indicators: {}
    };
  }
  if (!isObject(candidate)) return null;
  return {
    ...candidate,
    symbol: textValue(candidate.symbol),
    venue: textValue(candidate.venue, 'BINANCE'),
    indicators: isObject(candidate.indicators) ? candidate.indicators : {}
  };
}

function collectTrainingEntryPairs(state = {}) {
  const sources = [];
  if (Array.isArray(state.activePairs)) sources.push(...state.activePairs);
  if (Array.isArray(state.pairs)) sources.push(...state.pairs);
  if (Array.isArray(state.configuredSymbols)) sources.push(...state.configuredSymbols);
  if (Array.isArray(state.symbols)) sources.push(...state.symbols);
  if (Array.isArray(state.positions)) {
    sources.push(...state.positions
      .filter((position) => position && !position.exit_price)
      .map((position) => ({
        venue: position.venue,
        symbol: position.symbol,
        score: finiteNumber(position.score, position.confidence_at_entry, position.confidence, 70) || 70,
        price: finiteNumber(position.price, position.current_price, position.price_current, position.entry_price),
        indicators: {
          bias: position.direction,
          confidence: finiteNumber(position.confidence_at_entry, position.confidence, 74) || 74,
          horizon: position.horizon,
          primaryStrategy: position.strategy_id ? {
            id: position.strategy_id,
            name: position.strategy_name || position.strategy_id,
            score: finiteNumber(position.strategy_score, 75) || 75
          } : null
        }
      })));
  }
  return sources.map(normalizeEntryPair).filter(Boolean);
}

function mergeEntryPairs(primary = [], fallback = []) {
  const seen = new Set();
  const out = [];
  for (const pair of primary.concat(fallback)) {
    const normalized = normalizeEntryPair(pair);
    if (!normalized?.symbol) continue;
    const key = `${String(normalized.venue || 'BINANCE').toUpperCase()}:${String(normalized.symbol).toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function balancedTrainingBootstrapPairs(mt5Pairs = [], binancePairs = [], maxPairs = 40) {
  const max = Math.max(1, Math.floor(finiteNumber(maxPairs, 40) || 40));
  const hasMt5 = mt5Pairs.length > 0;
  const hasBinance = binancePairs.length > 0;
  const mt5Quota = hasMt5 && hasBinance ? Math.floor(max / 2) : max;
  const binanceQuota = hasMt5 && hasBinance ? max - mt5Quota : max;
  const out = [];
  const seen = new Set();

  function add(pair) {
    const normalized = normalizeEntryPair(pair);
    if (!normalized?.symbol) return;
    const key = `${String(normalized.venue || 'BINANCE').toUpperCase()}:${String(normalized.symbol).toUpperCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  }

  const pairedQuota = Math.max(mt5Quota, binanceQuota);
  for (let index = 0; index < pairedQuota && out.length < max; index += 1) {
    if (index < mt5Quota) add(mt5Pairs[index]);
    if (index < binanceQuota) add(binancePairs[index]);
  }

  let mt5Index = mt5Quota;
  let binanceIndex = binanceQuota;
  while (out.length < max && (mt5Index < mt5Pairs.length || binanceIndex < binancePairs.length)) {
    if (mt5Index < mt5Pairs.length) add(mt5Pairs[mt5Index++]);
    if (out.length >= max) break;
    if (binanceIndex < binancePairs.length) add(binancePairs[binanceIndex++]);
  }

  return out.slice(0, max);
}

function hasActionableEntryIndicators(pair = {}) {
  const indicators = isObject(pair.indicators) ? pair.indicators : {};
  return Boolean(
    textValue(pair.symbol)
    && textValue(pair.venue)
    && finiteNumber(pair.score) !== null
    && textValue(indicators.bias)
    && finiteNumber(indicators.confidence) !== null
    && finiteNumber(indicators.htfAlignmentScore, indicators.htf_alignment_score) !== null
    && finiteNumber(indicators.patternScore, indicators.pattern_score) !== null
    && finiteNumber(indicators.volumeRatio, indicators.volume_ratio) !== null
  );
}

async function buildBackendBootstrapPairs(input = {}) {
  const deps = input.deps || {};
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();
  const preferred = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'LINKUSDT', 'LTCUSDT', 'AVAXUSDT'];
  const mt5Preferred = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDCAD', 'USDCAD', 'GBPJPY', 'EURJPY', 'BTCUSD', 'ETHUSD', 'NAS100', 'US30', 'SPX500'];
  let symbols = [];
  if (typeof deps.getBinanceSymbols === 'function') {
    try {
      const result = await deps.getBinanceSymbols();
      symbols = Array.isArray(result) ? result : Array.isArray(result?.symbols) ? result.symbols : [];
    } catch {
      symbols = [];
    }
  }
  const universe = [
    ...preferred.filter((symbol) => symbols.includes(symbol)),
    ...symbols.filter((symbol) => typeof symbol === 'string' && symbol.endsWith('USDT') && !preferred.includes(symbol))
  ];
  const candidates = (universe.length ? universe : preferred).slice(0, 40);
  const mt5Pairs = [];
  const binancePairs = [];

  function buildPair({ venue, symbol, ticker, fallbackChangePct = 0 }) {
    const price = finiteNumber(ticker?.price, ticker?.lastPrice, ticker?.bid && ticker?.ask ? (Number(ticker.bid) + Number(ticker.ask)) / 2 : null);
    if (!price || price <= 0) return null;
    const changePct = finiteNumber(ticker?.changePct, ticker?.priceChangePercent, fallbackChangePct) || 0;
    const quoteVolume = finiteNumber(ticker?.quoteVolume, venue === 'MT5' ? 35000000 : 0) || 0;
    const spread = finiteNumber(ticker?.spread, ticker?.ask && ticker?.bid ? Number(ticker.ask) - Number(ticker.bid) : 0) || 0;
    const spreadPct = price ? Math.max(0, spread) / price : 0;
    const direction = changePct >= 0 ? 'LONG' : 'SHORT';
    const momentumScore = Math.min(1, Math.abs(changePct) / 2.5);
    const volumeScore = Math.min(1, quoteVolume / 50000000);
    const signalQuality = Math.max(0.62, Math.min(1, 0.62 + momentumScore * 0.22 + volumeScore * 0.16));
    const confidence = Math.round(Math.max(venue === 'MT5' ? 72 : 76, Math.min(92, 76 + signalQuality * 12 + volumeScore * 4)));
    const score = Math.round(Math.max(venue === 'MT5' ? 62 : 64, Math.min(94, 64 + signalQuality * 20 + volumeScore * 10 - spreadPct * 5000)));
    const primaryStrategy = {
      id: 'trendMomentum',
      name: venue === 'MT5' ? 'Trend Momentum / MT5 Bootstrap' : 'Trend Momentum / Backend Bootstrap',
      score: Math.round(Math.max(76, Math.min(96, confidence + 6))),
      reason: `${venue} bootstrap ${direction}; 24h ${changePct.toFixed(2)}%; quoteVol ${Math.round(quoteVolume)}`
    };
    const indicators = {
      bias: direction,
      confidence,
      setup: `${venue} perpetual bootstrap: ${direction} ${symbol} con cambio proxy ${changePct.toFixed(2)}%`,
      momentum: changePct,
      volatilityPct: Math.max(0.003, Math.min(0.04, Math.abs(changePct) / 100)),
      volumeRatio: Math.max(1.05, Math.min(2.4, quoteVolume / 30000000)),
      baseline: price,
      rsi: direction === 'LONG' ? 58 : 42,
      macd: { hist: direction === 'LONG' ? 1 : -1 },
      atrPct: Math.max(0.004, Math.min(0.035, Math.abs(changePct) / 100 || spreadPct)),
      m15: { bias: direction },
      h1: { bias: direction },
      h4: { bias: direction },
      d1: { bias: direction },
      htfAlignmentScore: venue === 'MT5' ? 0.72 : 0.78,
      patternScore: venue === 'MT5' ? 0.58 : 0.66,
      ictCrt: { score: venue === 'MT5' ? 58 : 62 },
      strategyScores: [primaryStrategy],
      primaryStrategy,
      horizon: 'intraday',
      signalQuality,
      signal_id: trainingSignalId({ venue, symbol }, { ...primaryStrategy, bias: direction, horizon: 'intraday' }, new Date(nowMs).toISOString())
    };
    return {
      venue,
      symbol,
      score,
      price,
      spreadPct,
      indicators,
      backendBootstrap: true
    };
  }

  let mt5Symbols = [];
  if (typeof deps.getMt5Symbols === 'function') {
    try {
      const result = await deps.getMt5Symbols();
      mt5Symbols = Array.isArray(result) ? result : Array.isArray(result?.symbols) ? result.symbols : [];
    } catch {
      mt5Symbols = [];
    }
  }
  const mt5Candidates = [
    ...mt5Preferred.filter((symbol) => mt5Symbols.includes(symbol)),
    ...mt5Symbols.filter((symbol) => typeof symbol === 'string' && !mt5Preferred.includes(symbol))
  ].slice(0, 40);

  for (const symbol of mt5Candidates) {
    if (typeof deps.getMt5Ticker !== 'function') continue;
    let ticker = null;
    try {
      ticker = await deps.getMt5Ticker(symbol);
    } catch {
      ticker = null;
    }
    const hash = parseInt(stableTraceHash(symbol), 36);
    const fallbackChangePct = (hash % 2 === 0 ? 1 : -1) * (0.35 + (hash % 7) * 0.08);
    const pair = buildPair({ venue: 'MT5', symbol, ticker, fallbackChangePct });
    if (pair) mt5Pairs.push(pair);
  }

  for (const symbol of candidates) {
    let ticker = null;
    if (typeof deps.getTicker === 'function') {
      try {
        ticker = await deps.getTicker(symbol);
      } catch {
        ticker = null;
      }
    }
    const pair = buildPair({ venue: 'BINANCE', symbol, ticker });
    if (pair) binancePairs.push(pair);
  }

  return balancedTrainingBootstrapPairs(mt5Pairs, binancePairs, 40);
}

function mergeSignalForEntry(pair, signalContext, forcedHorizon = null) {
  const signal = {
    ...(isObject(pair?.indicators) ? pair.indicators : {}),
    ...(isObject(signalContext) ? signalContext : {})
  };
  const fallbackSignal = signal.missing_signal === true || signal.defensive === true || signal.source === 'defensive_fallback';
  const professional =
    !fallbackSignal &&
    signal.bias !== 'NEUTRAL' &&
    Number(signal.confidence || 0) >= 70 &&
    Number(signal.htfAlignmentScore || 0) >= 0.5 &&
    Number(signal.patternScore || 0) >= 0.35;
  let bias = textValue(signal.bias);
  let reason = textValue(signal.setup) || 'Hipotesis de mercado real';
  let confidence = Number(signal.confidence || 50);
  let horizon = forcedHorizon || textValue(signal.horizon) || 'intraday';
  let learningMode = professional ? 'professional_setup' : 'exploration_paper';

  if (bias === 'NEUTRAL' || !bias) {
    if (textValue(signal.h1?.bias) && signal.h1.bias !== 'NEUTRAL') bias = signal.h1.bias;
    else if (textValue(signal.m15?.bias) && signal.m15.bias !== 'NEUTRAL') bias = signal.m15.bias;
    else if (Number(signal.macd?.hist || 0) > 0) bias = 'LONG';
    else if (Number(signal.macd?.hist || 0) < 0) bias = 'SHORT';
    else bias = Number(signal.rsi || 50) <= 50 ? 'LONG' : 'SHORT';

    reason = `Exploracion paper con sesgo inferido (${bias}) usando M15 ${signal.m15?.bias || 'NA'}, H1 ${signal.h1?.bias || 'NA'}, RSI ${Number(signal.rsi || 50).toFixed(1)}, MACD ${Number(signal.macd?.hist || 0).toPrecision(3)}`;
    confidence = Math.max(52, Math.min(68, confidence));
    horizon = forcedHorizon || (signal.h1?.bias === bias || pair.venue === 'MT5' ? 'swing' : 'intraday');
  }

  return {
    ...signal,
    bias,
    confidence,
    horizon,
    setup: reason,
    learning_mode: learningMode,
    motivo: professional ? 'Setup tecnico validado' : 'Exploracion controlada para aprendizaje continuo'
  };
}

function buildTrainingTraceMetadata(pair = {}, signal = {}, options = {}) {
  const createdAt = options.createdAt || signal.created_at || new Date().toISOString();
  const primary = signal.primaryStrategy || {};
  const strategyId = signal.strategy_id || primary.id || null;
  const strategyName = signal.strategy_name || primary.name || null;
  const learningMode = signal.learning_mode || null;
  const professional = learningMode === 'professional_setup';
  const entryReason = signal.entry_reason_code || (learningMode ? (professional ? 'professional_setup' : 'exploration_paper') : null);

  return {
    traceability_version: 1,
    signal_id: signal.signal_id || trainingSignalId(pair, { ...signal, strategy_id: strategyId }, createdAt),
    strategy_id: strategyId,
    strategy_name: strategyName,
    timeframe: signal.timeframe || signal.tf || null,
    horizon: signal.horizon || options.horizon || null,
    session: signal.session || null,
    entry_reason_code: entryReason,
    risk_profile_id: signal.risk_profile_id || null,
    source: options.source || signal.source || 'backend.training.entry',
    confidence_at_entry: nullableNumber(signal.confidence),
    regime_at_entry: signal.regime_at_entry || signal.regime?.type || null,
    volatility_at_entry: nullableNumber(signal.volatilityPct),
    created_at: createdAt,
    opened_at: options.openedAt || createdAt
  };
}

function evaluateTrainingDemoEntry(input = {}) {
  const state = input.state || {};
  const pair = input.pair || {};
  const market = input.marketContext || {};
  const rawSignal = input.signalContext || {};
  const env = input.env || {};
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();
  const forcedHorizon = textValue(input.horizon) || 'intraday';
  const allowDefensive = isTrainingBackendDemoEntryAllowDefensiveSignalEnabled(env) || isGuardedPaperTrainingState(state);
  const mergedSignal = mergeSignalForEntry(pair, rawSignal, forcedHorizon);
  const defensiveFallback = rawSignal.missing_signal === true || rawSignal.defensive === true || rawSignal.source === 'defensive_fallback';
  const key = `${pair.venue}:${pair.symbol}:${forcedHorizon}`;
  const cooldownUntil = Number(state.pairCooldowns?.[key] || 0);
  const duplicatePosition = (Array.isArray(state.positions) ? state.positions : []).some((position) => (
    !position.exit_price
    && sameText(position.symbol, pair.symbol)
    && sameText(position.venue, pair.venue)
    && sameText(position.horizon || 'intraday', forcedHorizon)
    && sameText(position.strategy_id || 'unknown', mergedSignal.primaryStrategy?.id || mergedSignal.strategy_id || 'unknown')
  ));

  if (!market.available || !Number.isFinite(Number(market.price))) {
    return { ok: true, shouldOpen: false, reason: market.reason || 'missing_price', signal: mergedSignal };
  }
  if (rawSignal.missing_signal && !allowDefensive) {
    return { ok: true, shouldOpen: false, reason: 'defensive_signal_not_allowed', signal: mergedSignal };
  }
  if (duplicatePosition) {
    return { ok: true, shouldOpen: false, reason: 'duplicate_open_position', signal: mergedSignal };
  }
  if (cooldownUntil > nowMs) {
    return { ok: true, shouldOpen: false, reason: 'cooldown_active', signal: mergedSignal };
  }

  const spreadPct = finiteNumber(pair.spreadPct, pair.spread_pct) || 0;
  if (spreadPct > (pair.venue === 'MT5' ? 0.004 : 0.0025)) {
    return { ok: true, shouldOpen: false, reason: 'spread_too_wide', signal: mergedSignal };
  }
  if (mergedSignal.confidence < 74) {
    return { ok: true, shouldOpen: false, reason: 'confidence_below_threshold', signal: mergedSignal };
  }
  if (mergedSignal.bias === 'NEUTRAL') {
    return { ok: true, shouldOpen: false, reason: 'neutral_bias', signal: mergedSignal };
  }
  if (defensiveFallback && allowDefensive && mergedSignal.learning_mode === 'exploration_paper') {
    return {
      ok: true,
      shouldOpen: true,
      reason: null,
      signal: {
        ...mergedSignal,
        source: rawSignal.source || mergedSignal.source || 'backend.training.signal',
        signal_id: rawSignal.signal_id || rawSignal.signalId || mergedSignal.signal_id || null,
        strategy_id: rawSignal.strategy_id || mergedSignal.strategy_id || mergedSignal.primaryStrategy?.id || 'unknown',
        strategy_name: rawSignal.strategy_name || mergedSignal.strategy_name || mergedSignal.primaryStrategy?.name || 'Estrategia no clasificada'
      }
    };
  }
  if (Number(mergedSignal.htfAlignmentScore || 0) < 0.5) {
    return { ok: true, shouldOpen: false, reason: 'htf_alignment_below_threshold', signal: mergedSignal };
  }
  if (Number(mergedSignal.patternScore || 0) < 0.45) {
    return { ok: true, shouldOpen: false, reason: 'pattern_score_below_threshold', signal: mergedSignal };
  }
  if (Number(mergedSignal.volumeRatio || 0) < 0.85) {
    return { ok: true, shouldOpen: false, reason: 'volume_ratio_below_threshold', signal: mergedSignal };
  }
  if (Number(pair.score || 0) < 62) {
    return { ok: true, shouldOpen: false, reason: 'pair_score_below_threshold', signal: mergedSignal };
  }
  if (spreadPct > (pair.venue === 'MT5' ? 0.0022 : 0.0012)) {
    return { ok: true, shouldOpen: false, reason: 'professional_spread_gate_failed', signal: mergedSignal };
  }

  return {
    ok: true,
    shouldOpen: true,
    reason: null,
    signal: {
      ...mergedSignal,
      source: rawSignal.source || mergedSignal.source || 'backend.training.signal',
      signal_id: rawSignal.signal_id || rawSignal.signalId || mergedSignal.signal_id || null,
      strategy_id: rawSignal.strategy_id || mergedSignal.strategy_id || mergedSignal.primaryStrategy?.id || 'unknown',
      strategy_name: rawSignal.strategy_name || mergedSignal.strategy_name || mergedSignal.primaryStrategy?.name || 'Estrategia no clasificada'
    }
  };
}

function openTrainingDemoPosition(input = {}) {
  const pair = input.pair || {};
  const signal = input.signal || {};
  const market = input.marketContext || {};
  const openedAt = input.openedAt || new Date().toISOString();
  const learningMode = signal.learning_mode || 'professional_setup';
  const price = Number(market.price);
  const horizon = signal.horizon || 'intraday';
  const notionalBase = horizon === 'swing' ? (pair.venue === 'MT5' ? 1800 : 1400) : (pair.venue === 'MT5' ? 1200 : 950);
  const notional = learningMode === 'exploration_paper' ? notionalBase * 0.35 : notionalBase;
  const size = notional / Math.max(price, 1e-12);
  const fees = notional * 0.001;
  const spreadPct = finiteNumber(pair.spreadPct, pair.spread_pct) || 0;
  const spreadCost = notional * Math.max(spreadPct, 0);
  const slippage = notional * 0.00025;
  const trace = buildTrainingTraceMetadata(pair, signal, {
    source: 'backend.training.position',
    createdAt: signal.created_at || openedAt,
    openedAt
  });

  return {
    id: trainingPositionId(pair, signal, openedAt),
    simulated: true,
    venue: pair.venue,
    symbol: pair.symbol,
    timestamp: openedAt,
    direction: signal.bias,
    entry_price: price,
    exit_price: null,
    size_demo: size,
    notional_demo: notional,
    pnl_demo: 0,
    fees_simuladas: fees,
    spread_estimado: spreadCost,
    slippage_estimado: slippage,
    confidence: signal.confidence,
    setup_tecnico_detectado: signal.setup,
    traceability_version: trace.traceability_version,
    signal_id: trace.signal_id,
    strategy_id: trace.strategy_id || signal.primaryStrategy?.id || signal.strategy_id || 'unknown',
    strategy_name: trace.strategy_name || signal.primaryStrategy?.name || signal.strategy_name || 'Estrategia no clasificada',
    strategy_score: Number(signal.primaryStrategy?.score || signal.strategy_score || 0),
    strategy_reason: signal.primaryStrategy?.reason || signal.strategy_reason || '',
    strategy_scores: signal.strategyScores || [],
    timeframe: trace.timeframe,
    session: trace.session,
    entry_reason_code: trace.entry_reason_code,
    risk_profile_id: trace.risk_profile_id,
    source: trace.source,
    opened_at: trace.opened_at,
    confidence_at_entry: trace.confidence_at_entry,
    regime_at_entry: trace.regime_at_entry,
    volatility_at_entry: trace.volatility_at_entry,
    learning_mode: learningMode,
    motivo_entrada: `${signal.motivo || 'Setup demo'}; ${signal.setup || 'Sin setup'}; confianza ${signal.confidence}`,
    motivo_salida: null,
    lesson_learned: null,
    horizon,
    min_hold_ms: horizon === 'swing' ? 36 * 60 * 60000 : 90 * 60000,
    max_hold_ms: horizon === 'swing' ? 14 * 24 * 60 * 60000 : 12 * 60 * 60000,
    opened_tick: Date.parse(openedAt)
  };
}

async function evaluateTrainingDemoEntries(input = {}) {
  const state = input.state || {};
  const deps = input.deps || {};
  const env = input.env || {};
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Number(input.nowMs) : Date.now();
  let pairs = collectTrainingEntryPairs(state);
  const openPositions = (Array.isArray(state.positions) ? state.positions : []).filter((position) => !position.exit_price);
  const intradayNeeded = Math.max(0, resolveTargetCount(state, 'intraday') - openPositions.filter((position) => position.horizon !== 'swing').length);
  const swingNeeded = Math.max(0, resolveTargetCount(state, 'swing') - openPositions.filter((position) => position.horizon === 'swing').length);
  const mt5Open = openPositions.filter((position) => position.venue === 'MT5').length;
  const hasMt5EntryPair = pairs.some((pair) => sameText(pair.venue, 'MT5'));
  const mt5EntryPairCount = pairs.filter((pair) => sameText(pair.venue, 'MT5')).length;
  const minMt5EntryPairs = resolveMinMt5OpenPositions(state);
  const targetUniverseSize = Math.min(40, Math.max(
    resolveTargetCount(state, 'intraday'),
    resolveTargetCount(state, 'swing'),
    finiteNumber(state.targetOpenPositions, state.targets?.total, 40) || 40
  ));
  const needsIndicatorRefresh = pairs.some((pair) => !hasActionableEntryIndicators(pair));
  const hasMt5BootstrapSource = (
    typeof deps.getMt5Symbols === 'function'
    || typeof deps.getMt5Ticker === 'function'
    || String(env.MT5_CONNECTOR_ENABLED || 'false').toLowerCase() === 'true'
  );
  const bootstrappedPairs = (
    (pairs.length < targetUniverseSize && (intradayNeeded > 0 || swingNeeded > 0))
    || needsIndicatorRefresh
    || (!hasMt5EntryPair && hasMt5BootstrapSource)
    || (hasMt5BootstrapSource && mt5EntryPairCount < minMt5EntryPairs)
  )
    ? await buildBackendBootstrapPairs({ deps, env, nowMs })
    : [];
  if (bootstrappedPairs.length) {
    const mt5Bootstrapped = bootstrappedPairs.filter((pair) => sameText(pair.venue, 'MT5'));
    const bootstrapFirst = needsIndicatorRefresh || (!hasMt5EntryPair && mt5Bootstrapped.length);
    const mergedPairs = (bootstrapFirst
      ? mergeEntryPairs(bootstrappedPairs, pairs)
      : mergeEntryPairs(pairs, bootstrappedPairs)
    );
    pairs = balancedTrainingBootstrapPairs(
      mergedPairs.filter((pair) => sameText(pair.venue, 'MT5')),
      mergedPairs.filter((pair) => !sameText(pair.venue, 'MT5')),
      targetUniverseSize
    );
  }
  const ranked = pairs
    .filter((pair) => textValue(pair.symbol))
    .sort((left, right) => {
      const leftBonus = left.venue === 'MT5' && mt5Open < resolveMinMt5OpenPositions(state) ? 30 : 0;
      const rightBonus = right.venue === 'MT5' && mt5Open < resolveMinMt5OpenPositions(state) ? 30 : 0;
      return (Number(right.score || 0) + rightBonus) - (Number(left.score || 0) + leftBonus);
    });

  let nextState = {
    ...state,
    activePairs: pairs.length ? pairs.slice() : bootstrappedPairs,
    positions: Array.isArray(state.positions) ? state.positions.slice() : []
  };
  const skippedEntries = [];
  const openedEntries = [];

  async function openBucket(horizon, needed) {
    let opened = 0;
    for (const pair of ranked) {
      if (opened >= needed) break;
      const marketContext = await resolveTrainingMarketContext(pair.symbol, {
        venue: pair.venue,
        state: nextState,
        deps,
        nowMs
      });
      const signalContext = await resolveTrainingSignalContext({
        signal_id: pair.indicators?.signal_id,
        symbol: pair.symbol,
        venue: pair.venue,
        horizon
      }, {
        ...deps,
        state: nextState,
        env,
        nowMs,
        pair,
        marketContext
      });
      const evaluation = evaluateTrainingDemoEntry({
        state: nextState,
        pair,
        marketContext,
        signalContext,
        env,
        nowMs,
        horizon
      });
      if (!evaluation.shouldOpen) {
        skippedEntries.push({
          symbol: pair.symbol,
          venue: pair.venue,
          horizon,
          reason: evaluation.reason
        });
        continue;
      }

      const openedAt = new Date(nowMs).toISOString();
      const position = openTrainingDemoPosition({
        pair,
        signal: evaluation.signal,
        marketContext,
        openedAt
      });
      if (
        pair.venue === 'MT5'
        && isTrainingMt5DemoOrderSendEnabled(env)
        && typeof deps.placeMt5DemoOrder === 'function'
      ) {
        const demoSide = position.direction === 'LONG' ? 'BUY' : position.direction === 'SHORT' ? 'SELL' : null;
        const demoLots = finiteNumber(env.TRAINING_MT5_DEMO_LOT_SIZE, 0.01) || 0.01;
        try {
          const demoResult = demoSide
            ? await deps.placeMt5DemoOrder({
              symbol: position.symbol,
              side: demoSide,
              volume: demoLots,
              type: 'MARKET',
              reason: 'training-demo-entry',
              trainingPositionId: position.id
            })
            : { ok: false, reason: 'unsupported_training_direction' };
          position.mt5_demo_execution = {
            attempted: true,
            ok: Boolean(demoResult?.ok),
            reason: demoResult?.reason || null,
            ticket: demoResult?.ticket || null,
            retcode: demoResult?.retcode || null,
            volume: demoLots,
            demoOnly: demoResult?.demoOnly !== false,
            realTradingTouched: false
          };
        } catch (error) {
          position.mt5_demo_execution = {
            attempted: true,
            ok: false,
            reason: String(error?.message || error),
            ticket: null,
            retcode: null,
            volume: demoLots,
            demoOnly: true,
            realTradingTouched: false
          };
        }
      } else {
        position.mt5_demo_execution = {
          attempted: false,
          reason: pair.venue === 'MT5' ? 'TRAINING_MT5_DEMO_ORDER_SEND_ENABLED=false' : 'not_mt5',
          demoOnly: true,
          realTradingTouched: false
        };
      }
      nextState = {
        ...nextState,
        positions: nextState.positions.concat(position)
      };
      openedEntries.push(position);
      opened += 1;
    }
  }

  await openBucket('intraday', intradayNeeded);
  await openBucket('swing', swingNeeded);

  return {
    ok: true,
    nextState,
    openedEntries,
    skippedEntries
  };
}

module.exports = {
  isTrainingBackendDemoEntryEnabled,
  isTrainingBackendDemoEntryAllowDefensiveSignalEnabled,
  isTrainingMt5DemoOrderSendEnabled,
  buildBackendBootstrapPairs,
  evaluateTrainingDemoEntry,
  openTrainingDemoPosition,
  evaluateTrainingDemoEntries
};
