// Autonomous bot lifecycle: Quant continuously CREATES a bot for every pair it
// watches, SCORES each by recent performance, and PRUNES (deletes/regenerates)
// the underperformers. Runs alongside the AI manual trades. Compilation and
// chart attachment of the generated .mq5 happen on the MT5 host (see
// docs/BOT_GENERATION.md); this service owns the create/keep/prune decisions.

function finiteNumber(...values) {
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function scoreOutcomes(trades = []) {
  const pnls = (Array.isArray(trades) ? trades : [])
    .map((t) => finiteNumber(t.pnl, t.pnl_demo, t.profit))
    .filter((n) => n !== null);
  if (!pnls.length) return { count: 0, winRate: null, net: 0, lossStreak: 0 };
  const wins = pnls.filter((p) => p > 0).length;
  let streak = 0;
  for (let i = pnls.length - 1; i >= 0; i--) { if (pnls[i] < 0) streak++; else break; }
  return {
    count: pnls.length,
    winRate: Number(((wins / pnls.length) * 100).toFixed(0)),
    net: Number(pnls.reduce((a, b) => a + b, 0).toFixed(2)),
    lossStreak: streak
  };
}

// Pure: decide which bots to create, keep or prune.
function planBotLifecycle({ watchlist = [], existingSymbols = [], outcomesByPair = {}, env = {} } = {}) {
  const minTradesToJudge = Math.max(3, finiteNumber(env.BOT_LIFECYCLE_MIN_TRADES) || 8);
  const pruneWinRate = Math.max(0, Math.min(100, finiteNumber(env.BOT_LIFECYCLE_PRUNE_WINRATE) || 35));
  const pruneLossStreak = Math.max(2, finiteNumber(env.BOT_LIFECYCLE_PRUNE_LOSS_STREAK) || 6);

  const watch = watchlist.map((s) => String(s).toUpperCase()).filter(Boolean);
  const existing = new Set(existingSymbols.map((s) => String(s).toUpperCase()));

  const toCreate = watch.filter((s) => !existing.has(s));
  const toPrune = [];
  const keep = [];
  for (const symbol of existing) {
    const score = scoreOutcomes(outcomesByPair[symbol] || []);
    if (score.count >= minTradesToJudge && (score.winRate <= pruneWinRate || score.lossStreak >= pruneLossStreak)) {
      toPrune.push({ symbol, reason: score.lossStreak >= pruneLossStreak ? `loss_streak_${score.lossStreak}` : `low_winrate_${score.winRate}`, score });
    } else {
      keep.push({ symbol, score });
    }
  }
  return { toCreate, toPrune, keep };
}

// Execute the plan via injected deps:
//   deps.listBotSymbols() -> [symbols]
//   deps.getOutcomes(symbol) -> [trades]
//   deps.generateBot(symbol) -> { ok }
//   deps.removeBot(symbol) -> { ok }
async function runBotLifecycle({ watchlist = [], env = {}, deps = {}, logger = null } = {}) {
  if (typeof deps.generateBot !== 'function' || typeof deps.listBotSymbols !== 'function') {
    return { ok: false, ran: false, reason: 'lifecycle_deps_missing' };
  }
  const existingSymbols = (await deps.listBotSymbols().catch(() => [])) || [];
  const outcomesByPair = {};
  if (typeof deps.getOutcomes === 'function') {
    for (const s of new Set([...watchlist, ...existingSymbols].map((x) => String(x).toUpperCase()))) {
      outcomesByPair[s] = (await deps.getOutcomes(s).catch(() => [])) || [];
    }
  }
  const plan = planBotLifecycle({ watchlist, existingSymbols, outcomesByPair, env });

  const created = [];
  const maxCreatePerRun = Math.max(1, finiteNumber(env.BOT_LIFECYCLE_MAX_CREATE_PER_RUN) || 3);
  for (const symbol of plan.toCreate.slice(0, maxCreatePerRun)) {
    const r = await deps.generateBot(symbol).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    if (r?.ok) created.push(symbol);
  }
  const pruned = [];
  if (typeof deps.removeBot === 'function') {
    for (const item of plan.toPrune) {
      const r = await deps.removeBot(item.symbol).catch((e) => ({ ok: false, error: String(e?.message || e) }));
      if (r?.ok) pruned.push(item);
    }
  }
  const summary = {
    ok: true,
    ran: true,
    created,
    prunedCount: pruned.length,
    pruned: pruned.map((p) => ({ symbol: p.symbol, reason: p.reason })),
    keptCount: plan.keep.length
  };
  if (logger?.info) logger.info('bot.lifecycle', { created: created.length, pruned: pruned.length, kept: plan.keep.length });
  return summary;
}

module.exports = { scoreOutcomes, planBotLifecycle, runBotLifecycle };
