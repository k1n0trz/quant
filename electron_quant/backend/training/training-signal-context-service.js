const { readSignalsFromMemory } = require('../signals/signal-history-service');
const {
  isTrainingBackendSignalCandidatesEnabled,
  generateTrainingSignalCandidate
} = require('./training-signal-candidate-engine');

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

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

function collectSignalCandidates(readMemory) {
  return readSignalsFromMemory(readMemory).map((entry) => {
    if (isObject(entry?.payload)) return entry.payload;
    return isObject(entry) ? entry : null;
  }).filter(isObject);
}

function normalizeResolvedSignal(source, signal, reason = null) {
  return {
    ...signal,
    source,
    defensive: false,
    missing_signal: false,
    reason
  };
}

function buildDefensiveSignal(position, reason = 'missing_signal') {
  return {
    bias: textValue(position?.direction) || 'LONG',
    confidence: 100,
    source: 'defensive_fallback',
    defensive: true,
    missing_signal: true,
    reason
  };
}

async function resolveTrainingSignalContext(position, options = {}) {
  const deps = options.deps || options;
  const signalCandidates = collectSignalCandidates(deps.readMemory);
  const signalId = textValue(position?.signal_id, position?.signalId);
  const symbol = textValue(position?.symbol);
  const venue = textValue(position?.venue);
  const horizon = textValue(position?.horizon);

  if (signalId) {
    const exactSignal = signalCandidates.find((candidate) => sameText(candidate.signal_id || candidate.signalId, signalId));
    if (exactSignal) {
      return normalizeResolvedSignal('memory_signal_id', exactSignal);
    }
  }

  const matchedBySymbol = signalCandidates.find((candidate) => (
    sameText(candidate.symbol, symbol)
    && (textValue(candidate.venue) ? sameText(candidate.venue, venue) : true)
    && (textValue(candidate.horizon) && horizon ? sameText(candidate.horizon, horizon) : true)
  ));
  if (matchedBySymbol) {
    return normalizeResolvedSignal('memory_symbol_horizon', matchedBySymbol);
  }

  if (isTrainingBackendSignalCandidatesEnabled(options.env || {})) {
    const candidate = await generateTrainingSignalCandidate(symbol, {
      ...options,
      venue,
      pair: options.pair || null
    }, options);
    if (candidate.available) {
      return normalizeResolvedSignal('backend_signal_candidate', candidate, null);
    }
  }

  return buildDefensiveSignal(position, 'missing_signal');
}

module.exports = {
  resolveTrainingSignalContext
};
