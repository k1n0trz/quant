const { resolveTrainingMarketContext } = require('./training-market-context-service');

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

function normalizeReadOnlyDeps(input = {}) {
  const deps = input.deps && typeof input.deps === 'object' ? { ...input.deps } : {};
  if (typeof deps.getTicker !== 'function' && typeof input.getTicker === 'function') deps.getTicker = input.getTicker;
  if (typeof deps.readMt5Snapshot !== 'function' && typeof input.readMt5Snapshot === 'function') deps.readMt5Snapshot = input.readMt5Snapshot;
  if (typeof deps.readMemory !== 'function' && typeof input.readMemory === 'function') deps.readMemory = input.readMemory;
  return deps;
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

function isTrainingBackendSignalCandidatesEnabled(env = {}) {
  return String(env.TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED || 'false').toLowerCase() === 'true';
}

function collectSignalCandidatePairs(state = {}) {
  const sources = [];
  if (Array.isArray(state.activePairs)) sources.push(...state.activePairs);
  else if (Array.isArray(state.pairs)) sources.push(...state.pairs);
  else if (Array.isArray(state.configuredSymbols)) sources.push(...state.configuredSymbols);
  else if (Array.isArray(state.symbols)) sources.push(...state.symbols);
  return sources.filter(isObject);
}

function findCandidatePair(symbol, venue, state = {}) {
  return collectSignalCandidatePairs(state).find((pair) => (
    sameText(pair.symbol, symbol)
    && (textValue(venue) ? sameText(pair.venue, venue) : true)
  )) || null;
}

function buildUnavailableCandidate(symbol, venue, reason) {
  return {
    available: false,
    symbol: textValue(symbol),
    venue: textValue(venue),
    price: null,
    source: 'backend_signal_candidate',
    stale: false,
    ageMs: null,
    reason
  };
}

function buildSignalCandidateId(symbol, venue, bias, horizon, strategyId, generatedAt) {
  return `sig_${stableTraceHash([
    'backend-signal-candidate',
    venue || 'unknown',
    symbol || 'unknown',
    bias || 'NEUTRAL',
    horizon || 'intraday',
    strategyId || 'unknown',
    generatedAt
  ].join('|'))}`;
}

async function generateTrainingSignalCandidate(symbol, context = {}, options = {}) {
  const env = context.env || options.env || {};
  const state = context.state || options.state || {};
  const deps = {
    ...normalizeReadOnlyDeps(options),
    ...normalizeReadOnlyDeps(context)
  };
  const nowMs = Number.isFinite(Number(context.nowMs || options.nowMs)) ? Number(context.nowMs || options.nowMs) : Date.now();
  const pair = context.pair || findCandidatePair(symbol, context.venue, state);
  const resolvedSymbol = textValue(symbol, pair?.symbol);
  const resolvedVenue = textValue(context.venue, pair?.venue, 'BINANCE');

  if (!isTrainingBackendSignalCandidatesEnabled(env)) {
    return buildUnavailableCandidate(resolvedSymbol, resolvedVenue, 'signal_candidates_disabled');
  }

  const marketContext = context.marketContext || await resolveTrainingMarketContext(resolvedSymbol, {
    venue: resolvedVenue,
    state,
    deps,
    nowMs
  });
  if (!marketContext.available || !Number.isFinite(Number(marketContext.price))) {
    return buildUnavailableCandidate(resolvedSymbol, resolvedVenue, marketContext.reason || 'insufficient_context');
  }

  const indicators = isObject(pair?.indicators) ? pair.indicators : null;
  if (!indicators) {
    return buildUnavailableCandidate(resolvedSymbol, resolvedVenue, 'insufficient_context');
  }

  const bias = textValue(indicators.bias);
  const confidence = finiteNumber(indicators.confidence);
  const horizon = textValue(indicators.horizon, 'intraday');
  const htfAlignmentScore = finiteNumber(indicators.htfAlignmentScore, indicators.htf_alignment_score);
  const patternScore = finiteNumber(indicators.patternScore, indicators.pattern_score);
  const volumeRatio = finiteNumber(indicators.volumeRatio, indicators.volume_ratio);
  const pairScore = finiteNumber(pair?.score, indicators.pairScore, indicators.score);
  const primaryStrategy = isObject(indicators.primaryStrategy) ? indicators.primaryStrategy : {};
  const strategyId = textValue(indicators.strategy_id, primaryStrategy.id);
  const strategyName = textValue(indicators.strategy_name, primaryStrategy.name);

  if (!bias || confidence === null || htfAlignmentScore === null || patternScore === null || volumeRatio === null || pairScore === null) {
    return buildUnavailableCandidate(resolvedSymbol, resolvedVenue, 'insufficient_context');
  }

  const reasonCodes = [
    `market_source:${marketContext.source}`,
    'active_pair_indicators'
  ];
  if (strategyId && state.strategyStats?.[strategyId]) reasonCodes.push(`strategy_stats:${strategyId}`);
  if (Array.isArray(state.lessons) && state.lessons.some((lesson) => sameText(lesson.symbol, resolvedSymbol))) reasonCodes.push('lessons_symbol_history');
  if (typeof deps.readMemory === 'function' && Array.isArray(deps.readMemory(50)) && deps.readMemory(50).some((entry) => sameText(entry?.payload?.symbol || entry?.symbol, resolvedSymbol))) {
    reasonCodes.push('memory_symbol_context');
  }

  const generatedAt = new Date(nowMs).toISOString();
  return {
    available: true,
    signal_id: buildSignalCandidateId(resolvedSymbol, resolvedVenue, bias, horizon, strategyId, generatedAt),
    symbol: resolvedSymbol,
    venue: resolvedVenue,
    bias,
    confidence,
    horizon,
    strategy_id: strategyId || 'unknown',
    strategy_name: strategyName || 'Estrategia no clasificada',
    htfAlignmentScore,
    patternScore,
    volumeRatio,
    pairScore,
    source: 'backend_signal_candidate',
    reason_codes: reasonCodes,
    generated_at: generatedAt
  };
}

async function generateTrainingSignalCandidates(symbols = [], options = {}) {
  const items = Array.isArray(symbols) ? symbols : [];
  const results = [];
  for (const item of items) {
    if (typeof item === 'string') {
      results.push(await generateTrainingSignalCandidate(item, options, options));
      continue;
    }
    if (isObject(item)) {
      results.push(await generateTrainingSignalCandidate(item.symbol, {
        ...options,
        pair: item,
        venue: item.venue
      }, options));
    }
  }
  return results;
}

module.exports = {
  isTrainingBackendSignalCandidatesEnabled,
  generateTrainingSignalCandidate,
  generateTrainingSignalCandidates
};
