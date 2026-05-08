const DEFAULT_STRATEGIES = [
  {
    id: 'ictCrt',
    name: 'ICT + CRT Institutional Model',
    minScore: 80,
    rrMin: 2,
    backendExecutable: false,
    phase: 'shadow',
    rules: [
      'Use weekly CRT sweep context before promoting directional bias.',
      'Require liquidity, displacement, structure, timing and entry context before promotion.'
    ]
  },
  {
    id: 'trendMomentum',
    name: 'Trend Momentum / EMA-MACD',
    minScore: 72,
    rrMin: 1.8,
    backendExecutable: false,
    phase: 'shadow',
    rules: [
      'Trade with M15/H1 agreement and momentum confirmation.',
      'Reject exhausted RSI regimes.'
    ]
  },
  {
    id: 'breakoutRetest',
    name: 'Breakout + Retest',
    minScore: 70,
    rrMin: 2,
    backendExecutable: false,
    phase: 'shadow',
    rules: [
      'Prefer range expansion with volume confirmation.',
      'Reject breakouts into high macro risk.'
    ]
  },
  {
    id: 'meanReversion',
    name: 'Mean Reversion / RSI-ATR',
    minScore: 68,
    rrMin: 1.4,
    backendExecutable: false,
    phase: 'shadow',
    rules: [
      'Use only in range-bound or weak-trend regimes.',
      'Keep tighter targets than trend strategies.'
    ]
  },
  {
    id: 'volumePullback',
    name: 'Volume Pullback Continuation',
    minScore: 70,
    rrMin: 1.8,
    backendExecutable: false,
    phase: 'shadow',
    rules: [
      'Parent trend must be intact.',
      'Pullback must resolve in trend direction.'
    ]
  }
];

function createStrategyRegistry(overrides = []) {
  const rows = [...DEFAULT_STRATEGIES.map((strategy) => ({ ...strategy, rules: [...strategy.rules] }))];
  for (const override of Array.isArray(overrides) ? overrides : []) {
    const index = rows.findIndex((strategy) => strategy.id === override.id);
    if (index >= 0) rows[index] = { ...rows[index], ...override };
    else rows.push({ ...override });
  }
  const byId = new Map(rows.map((strategy) => [strategy.id, strategy]));

  return {
    list: () => rows.map((strategy) => ({ ...strategy, rules: [...(strategy.rules || [])] })),
    ids: () => rows.map((strategy) => strategy.id),
    has: (id) => byId.has(id),
    get: (id) => {
      const strategy = byId.get(id);
      return strategy ? { ...strategy, rules: [...(strategy.rules || [])] } : null;
    }
  };
}

module.exports = {
  DEFAULT_STRATEGIES,
  createStrategyRegistry
};
