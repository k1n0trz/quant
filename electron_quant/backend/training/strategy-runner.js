const { createStrategyRegistry } = require('./strategy-registry');

function normalizeScore(row, registry) {
  const strategy = registry.get(row?.id);
  if (!strategy) return null;
  return {
    id: strategy.id,
    name: strategy.name,
    bias: row.bias || 'NEUTRAL',
    score: Math.max(0, Math.min(100, Math.round(Number(row.score || 0)))),
    reason: row.reason || '',
    minScore: strategy.minScore,
    rrMin: strategy.rrMin,
    backendExecutable: strategy.backendExecutable === true,
    phase: strategy.phase || 'shadow'
  };
}

function runStrategyPortfolio(context = {}, registry = createStrategyRegistry()) {
  const strategyScores = Array.isArray(context.strategyScores) ? context.strategyScores : [];
  const ranked = strategyScores
    .map((row) => normalizeScore(row, registry))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  return {
    mode: 'shadow',
    ranked,
    primary: ranked[0] || null,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  runStrategyPortfolio
};
