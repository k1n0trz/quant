const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreOutcomes, planBotLifecycle, runBotLifecycle } = require('../backend/training/bot-lifecycle-service');

test('scoreOutcomes computes winRate, net and loss streak', () => {
  const s = scoreOutcomes([{ pnl: 1 }, { pnl: -1 }, { pnl: -1 }, { pnl: -1 }]);
  assert.equal(s.count, 4);
  assert.equal(s.winRate, 25);
  assert.equal(s.lossStreak, 3);
});

test('planBotLifecycle creates missing watchlist bots and prunes losers', () => {
  const plan = planBotLifecycle({
    watchlist: ['EURUSD', 'GBPUSD', 'USDJPY'],
    existingSymbols: ['EURUSD', 'AUDUSD'],
    outcomesByPair: {
      EURUSD: [{ pnl: 1 }, { pnl: 1 }, { pnl: -0.5 }, { pnl: 1 }, { pnl: 1 }, { pnl: 1 }, { pnl: 1 }, { pnl: 1 }],
      AUDUSD: [{ pnl: -1 }, { pnl: -1 }, { pnl: -1 }, { pnl: -1 }, { pnl: -1 }, { pnl: -1 }, { pnl: -1 }, { pnl: -1 }]
    }
  });
  assert.deepEqual(plan.toCreate.sort(), ['GBPUSD', 'USDJPY']);
  assert.equal(plan.toPrune.some((p) => p.symbol === 'AUDUSD'), true, 'bad-record bot pruned');
  assert.equal(plan.keep.some((k) => k.symbol === 'EURUSD'), true, 'good bot kept');
});

test('planBotLifecycle does not prune bots with too few trades to judge', () => {
  const plan = planBotLifecycle({
    watchlist: [],
    existingSymbols: ['NZDUSD'],
    outcomesByPair: { NZDUSD: [{ pnl: -1 }, { pnl: -1 }] } // only 2 trades
  });
  assert.equal(plan.toPrune.length, 0);
  assert.equal(plan.keep.length, 1);
});

test('runBotLifecycle creates and prunes via deps, bounded per run', async () => {
  const generated = [];
  const removed = [];
  const result = await runBotLifecycle({
    watchlist: ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD'],
    env: { BOT_LIFECYCLE_MAX_CREATE_PER_RUN: '2', BOT_LIFECYCLE_MIN_TRADES: '4' },
    deps: {
      listBotSymbols: async () => ['AUDUSD'],
      getOutcomes: async (s) => (s === 'AUDUSD' ? [{ pnl: -1 }, { pnl: -1 }, { pnl: -1 }, { pnl: -1 }] : []),
      generateBot: async (s) => { generated.push(s); return { ok: true }; },
      removeBot: async (s) => { removed.push(s); return { ok: true }; }
    }
  });
  assert.equal(result.ran, true);
  assert.equal(generated.length, 2, 'create bounded per run');
  assert.deepEqual(removed, ['AUDUSD'], 'pruned the losing bot');
});

test('runBotLifecycle no-ops when deps missing', async () => {
  const r = await runBotLifecycle({ deps: {} });
  assert.equal(r.ran, false);
  assert.equal(r.reason, 'lifecycle_deps_missing');
});
