const test = require('node:test');
const assert = require('node:assert/strict');

const {
  summarizeCandles,
  summarizeOutcomes,
  parseTradeDecision,
  validateAndClampDecision,
  resolveMinStopDistance,
  buildTradeDecisionMessages,
  decideTrade
} = require('../backend/ai/ai-trade-advisor');

test('summarizeOutcomes computes win rate and flags a loss streak', () => {
  const s = summarizeOutcomes([{ pnl: 1.2 }, { pnl: -0.5 }, { pnl: -0.3 }, { pnl: -0.8 }]);
  assert.equal(s.available, true);
  assert.equal(s.wins, 1);
  assert.equal(s.losses, 3);
  assert.equal(s.lossStreak, 3, 'trailing losses counted');
  assert.equal(s.netPnl, -0.4);
});

test('advisor prompt warns the model about a loss streak so it learns', () => {
  const { user } = buildTradeDecisionMessages({
    symbol: 'USDJPY', venue: 'MT5', marketPrice: 156, minStopDistance: 0.2, funds: { equity: 37 },
    h1: summarizeCandles(rising(), 'H1'), m15: summarizeCandles(rising(), 'M15'), h4: { label: 'H4', available: false },
    outcomes: summarizeOutcomes([{ pnl: -0.3 }, { pnl: -0.4 }, { pnl: -0.2 }])
  });
  assert.match(user, /historial reciente en USDJPY/);
  assert.match(user, /perdidas seguidas/);
});

test('decideTrade feeds recent outcomes to the model', async () => {
  let promptSeen = '';
  const res = await decideTrade({
    symbol: 'EURUSD',
    deps: {
      getMarket: async () => ({ price: 1.10, digits: 5 }),
      getCandles: async () => rising(),
      getNews: async () => [],
      getFunds: async () => ({ equity: 37 }),
      getRecentOutcomes: async () => [{ pnl: -0.5 }, { pnl: -0.6 }, { pnl: -0.4 }],
      callModel: async (m) => { promptSeen = m.user; return '{"decision":"SKIP","side":"BUY","stopLossPrice":1.09,"takeProfitPrice":1.12,"confidence":20,"reasoning":"racha perdedora, evito"}'; }
    }
  });
  assert.equal(res.decision, 'SKIP');
  assert.match(promptSeen, /perdidas seguidas/);
});

function rising(n = 30, start = 1.10, step = 0.001) {
  return Array.from({ length: n }, (_, i) => {
    const c = start + i * step;
    return { o: c - step / 2, h: c + step / 2, l: c - step, c };
  });
}

test('summarizeCandles detects an uptrend and computes ATR', () => {
  const s = summarizeCandles(rising(), 'H1');
  assert.equal(s.available, true);
  assert.equal(s.trend, 'UP');
  assert.ok(s.atr > 0);
  assert.ok(s.lastClose > s.windowLow);
});

test('summarizeCandles reports unavailable for too few bars', () => {
  assert.equal(summarizeCandles([{ c: 1 }], 'H1').available, false);
});

test('parseTradeDecision extracts JSON even with surrounding text', () => {
  const d = parseTradeDecision('Claro:\n{"decision":"OPEN","side":"BUY","stopLossPrice":1.09,"takeProfitPrice":1.12,"confidence":72,"reasoning":"tendencia alcista"}');
  assert.equal(d.ok, true);
  assert.equal(d.decision, 'OPEN');
  assert.equal(d.side, 'BUY');
  assert.equal(d.confidence, 72);
});

test('parseTradeDecision rejects malformed/absent json', () => {
  assert.equal(parseTradeDecision('no').ok, false);
  assert.equal(parseTradeDecision('{"decision":"MAYBE"}').ok, false);
});

test('validateAndClampDecision forces SL/TP to the correct side and min distance (fixes invalid stops)', () => {
  // BUY with SL above price and TP below price (wrong) -> clamped to valid sides
  const bad = { ok: true, decision: 'OPEN', side: 'BUY', stopLossPrice: 1.105, takeProfitPrice: 1.095, confidence: 60 };
  const out = validateAndClampDecision(bad, { marketPrice: 1.10, minStopDistance: 0.002, digits: 5 });
  assert.ok(out.stopLoss <= 1.10 - 0.002, 'BUY stop must be at least minDist below price');
  assert.ok(out.takeProfit >= 1.10 + 0.002, 'BUY tp must be at least minDist above price');
});

test('validateAndClampDecision fills missing SL/TP with volatility-based defaults', () => {
  const d = { ok: true, decision: 'OPEN', side: 'SELL', stopLossPrice: null, takeProfitPrice: null, confidence: 55 };
  const out = validateAndClampDecision(d, { marketPrice: 150, minStopDistance: 0.3, digits: 3 });
  assert.ok(out.stopLoss >= 150 + 0.3, 'SELL stop above price');
  assert.ok(out.takeProfit <= 150 - 0.3, 'SELL tp below price');
});

test('resolveMinStopDistance takes the max of ATR, broker level and a price floor', () => {
  const d = resolveMinStopDistance({ atr: 0.001, brokerMinDistance: 0.003, marketPrice: 1.10 });
  assert.equal(d, 0.003);
  const volFloor = resolveMinStopDistance({ atr: 0, brokerMinDistance: 0, marketPrice: 100 });
  assert.ok(volFloor > 0, 'price floor applies when nothing else');
});

test('buildTradeDecisionMessages includes funds, min distance and demands strict JSON', () => {
  const { system, user } = buildTradeDecisionMessages({
    symbol: 'EURUSD', venue: 'MT5', marketPrice: 1.10, spread: 0.0001,
    funds: { equity: 37, currency: 'USD' }, minStopDistance: 0.002, maxRiskUsd: 3.7, news: ['ECB holds rates'],
    h1: summarizeCandles(rising(), 'H1'), m15: summarizeCandles(rising(), 'M15'), h4: { label: 'H4', available: false }
  });
  assert.match(system, /JSON/);
  assert.match(user, /equity=37/);
  assert.match(user, /ECB holds rates/);
  assert.match(user, /Distancia minima/);
});

test('decideTrade: model OPEN flows through with valid clamped stops', async () => {
  const calls = [];
  const res = await decideTrade({
    symbol: 'EURUSD', venue: 'MT5',
    env: { MT5_REAL_RISK_PER_TRADE_PCT: '10' },
    deps: {
      getMarket: async () => ({ price: 1.10, spread: 0.0001, brokerMinDistance: 0.0005, digits: 5 }),
      getCandles: async (s, tf) => { calls.push(tf); return rising(); },
      getNews: async () => ['risk-on tone'],
      getFunds: async () => ({ equity: 37, currency: 'USD' }),
      callModel: async () => '{"decision":"OPEN","side":"BUY","stopLossPrice":1.0985,"takeProfitPrice":1.1035,"confidence":68,"reasoning":"alza alineada H1/H4"}'
    }
  });
  assert.equal(res.ok, true);
  assert.equal(res.decision, 'OPEN');
  assert.equal(res.side, 'BUY');
  assert.ok(res.stopLoss < res.entryPrice && res.takeProfit > res.entryPrice);
  assert.ok(calls.includes('H1') && calls.includes('H4') && calls.includes('M15'), 'pulls multi-timeframe data');
});

test('decideTrade: model SKIP is honored (no execution)', async () => {
  const res = await decideTrade({
    symbol: 'XAUUSD',
    deps: {
      getMarket: async () => ({ price: 4400, digits: 2 }),
      getCandles: async () => rising(30, 4400, 1),
      getNews: async () => [],
      getFunds: async () => ({ equity: 37 }),
      callModel: async () => '{"decision":"SKIP","side":"SELL","stopLossPrice":4420,"takeProfitPrice":4360,"confidence":30,"reasoning":"sobre-extendido, espero"}'
    }
  });
  assert.equal(res.ok, true);
  assert.equal(res.executed, false);
  assert.equal(res.decision, 'SKIP');
  assert.match(res.reasoning, /espero/);
});

test('decideTrade blocks when no market price is available', async () => {
  const res = await decideTrade({
    symbol: 'EURUSD',
    deps: { getMarket: async () => ({ price: 0 }), getCandles: async () => [], callModel: async () => '{}' }
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no_market_price');
});
