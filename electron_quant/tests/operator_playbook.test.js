const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computeRsi, computeSma, maRegime, rsiEntrySignal,
  inOperatorSession, operatorTargets, operatorTrailing, evaluateOperatorSetup
} = require('../backend/strategy/operator-playbook');

// --- indicators ------------------------------------------------------------
test('computeRsi is ~100 on a pure uptrend and ~0 on a pure downtrend', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const down = Array.from({ length: 30 }, (_, i) => 100 - i);
  const rUp = computeRsi(up); const rDown = computeRsi(down);
  assert.ok(rUp[rUp.length - 1] > 99, 'uptrend RSI near 100');
  assert.ok(rDown[rDown.length - 1] < 1, 'downtrend RSI near 0');
});

test('computeSma averages the last N values', () => {
  assert.equal(computeSma([1, 2, 3, 4, 5], 5), 3);
  assert.equal(computeSma([2, 4, 6], 2), 5);
  assert.equal(computeSma([1, 2], 5), null);
});

test('maRegime: fanned & ordered up = UP trend; tight oscillation = CHOP', () => {
  const upTrend = Array.from({ length: 220 }, (_, i) => 1.0 + i * 0.001);
  assert.equal(maRegime(upTrend).trend, 'UP');
  const chop = Array.from({ length: 220 }, (_, i) => 1.10 + (i % 2 ? 0.0002 : -0.0002));
  assert.equal(maRegime(chop).trend, 'CHOP', 'converged MAs = no clear sentiment');
});

// --- RSI reversal trigger (Edi's rule) -------------------------------------
test('rsiEntrySignal: BUY when RSI dipped to oversold and turns up', () => {
  // strong rise, then a sharp multi-bar drop into oversold, then one up tick
  const closes = [];
  for (let i = 0; i < 40; i++) closes.push(1.0 + i * 0.001);     // up -> RSI high
  for (let i = 0; i < 15; i++) closes.push(closes[closes.length - 1] - 0.003); // crater RSI
  closes.push(closes[closes.length - 1] + 0.0005);              // turn up
  const sig = rsiEntrySignal(computeRsi(closes));
  assert.equal(sig.side, 'BUY');
  assert.ok(sig.rsi <= 35, 'enters while RSI still near/under the 30 zone');
});

test('rsiEntrySignal: no trigger when RSI is mid-range (the USDJPY chase case)', () => {
  const closes = Array.from({ length: 40 }, (_, i) => 1.10 + i * 0.0003); // steady drift, RSI ~mid/high but no recent oversold dip
  const sig = rsiEntrySignal(computeRsi(closes));
  assert.equal(sig.side, null, 'a mid-RSI trend-chase is NOT his setup');
});

// --- sessions (Colombia, UTC-5) --------------------------------------------
test('inOperatorSession honors Edi windows', () => {
  // Tue 07:00 COL (12:00 UTC) -> morning open
  assert.equal(inOperatorSession(new Date(Date.UTC(2026, 5, 24, 12, 0))).open, true);
  // Tue 16:00 COL (21:00 UTC) -> forbidden 15-17
  assert.equal(inOperatorSession(new Date(Date.UTC(2026, 5, 24, 21, 0))).open, false);
  // Sun 07:00 COL -> weekend
  assert.equal(inOperatorSession(new Date(Date.UTC(2026, 5, 21, 12, 0))).open, false);
  // Friday afternoon (June 26, 14:00 COL / 19:00 UTC) -> closed
  assert.equal(inOperatorSession(new Date(Date.UTC(2026, 5, 26, 19, 0))).open, false);
  // Friday morning (June 26, 07:00 COL / 12:00 UTC) -> open
  assert.equal(inOperatorSession(new Date(Date.UTC(2026, 5, 26, 12, 0))).open, true);
});

// --- targets & trailing ----------------------------------------------------
test('operatorTargets sizes SL/TP from $ risk/target via pip value', () => {
  const t = operatorTargets({ side: 'BUY', price: 1.1545, digits: 5, pipValueUsd: 0.1, riskUsd: 1.5, targetUsd: 2 });
  assert.ok(t.stopLoss < 1.1545 && t.takeProfit > 1.1545);
  assert.equal(t.slPips, 15); // $1.5 / $0.10 per pip
  assert.equal(t.tpPips, 20);
});

test('operatorTrailing locks >=$1.5 once a position is >$2 in profit, else nothing', () => {
  const lock = operatorTrailing({ side: 'BUY', entryPrice: 1.15, profitUsd: 2.5, pipValueUsd: 0.1, digits: 5, lockUsd: 1.5 });
  assert.ok(lock && lock.stopLoss > 1.15, 'SL pulled into profit');
  assert.equal(operatorTrailing({ side: 'BUY', entryPrice: 1.15, profitUsd: 1.0, pipValueUsd: 0.1 }), null);
});

// --- full verdict ----------------------------------------------------------
function buyableUptrend() {
  const closes = [];
  for (let i = 0; i < 200; i++) closes.push(1.0 + i * 0.001);   // long ordered uptrend (MA200 valid)
  for (let i = 0; i < 15; i++) closes.push(closes[closes.length - 1] - 0.003); // pullback craters RSI
  closes.push(closes[closes.length - 1] + 0.0005);             // turn up
  return closes;
}

test('evaluateOperatorSetup: BUY on an oversold turn within an uptrend', () => {
  const v = evaluateOperatorSetup({ closes: buyableUptrend(), allowOutOfSession: true, digits: 5, pipValueUsd: 0.1 });
  assert.equal(v.matches, true);
  assert.equal(v.side, 'BUY');
  assert.ok(v.stopLoss < v.entryPrice && v.takeProfit > v.entryPrice);
});

test('evaluateOperatorSetup: stands aside in a tight range (MAs converged)', () => {
  const chop = Array.from({ length: 220 }, (_, i) => 1.10 + (i % 2 ? 0.0002 : -0.0002));
  const v = evaluateOperatorSetup({ closes: chop, allowOutOfSession: true });
  assert.equal(v.matches, false);
  assert.match(v.reason, /rango_estrecho/);
});

test('evaluateOperatorSetup: refuses to trade outside Edi sessions', () => {
  const v = evaluateOperatorSetup({ closes: buyableUptrend(), nowMs: Date.UTC(2026, 5, 21, 12, 0) /* Sat */ });
  assert.equal(v.matches, false);
  assert.match(v.reason, /fuera_de_sesion/);
});
