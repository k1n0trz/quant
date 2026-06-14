const test = require('node:test');
const assert = require('node:assert/strict');

const { planMt5ProtectionSweep, runMt5ProtectionSweep, positionMissingProtection } = require('../backend/adapters/mt5/mt5-protection-sweep');

test('detects naked positions (missing sl or tp)', () => {
  assert.equal(positionMissingProtection({ sl: 0, tp: 0 }), true);
  assert.equal(positionMissingProtection({ sl: 100, tp: 0 }), true);
  assert.equal(positionMissingProtection({ sl: 0, tp: 200 }), true);
  assert.equal(positionMissingProtection({ sl: 100, tp: 200 }), false);
});

test('plans SL/TP for a naked BTC BUY from current price', () => {
  const { plans } = planMt5ProtectionSweep({
    positions: [
      { ticket: 1838243146, symbol: 'BTCUSD', side: 'BUY', volume: 0.01, priceOpen: 109000, priceCurrent: 108800, sl: 0, tp: 0 }
    ],
    env: {}
  });
  assert.equal(plans.length, 1);
  const p = plans[0];
  assert.equal(p.ticket, 1838243146);
  assert.equal(p.symbol, 'BTCUSD');
  assert.ok(p.sl > 0 && p.sl < 108800, 'BUY stop below current price');
  assert.ok(p.tp > 108800, 'BUY take profit above current price');
});

test('skips already-protected positions', () => {
  const { plans } = planMt5ProtectionSweep({
    positions: [
      { ticket: 1, symbol: 'EURUSD', side: 'SELL', priceCurrent: 1.16, sl: 1.165, tp: 1.142 },
      { ticket: 2, symbol: 'XAUUSD', side: 'BUY', priceCurrent: 4200, sl: 0, tp: 0 }
    ],
    env: {}
  });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].ticket, 2);
});

test('uses MT5 position type when side text is absent (0=BUY,1=SELL)', () => {
  const { plans } = planMt5ProtectionSweep({
    positions: [{ ticket: 5, symbol: 'GBPUSD', type: 1, priceCurrent: 1.27, sl: 0, tp: 0 }],
    env: {}
  });
  assert.equal(plans[0].side, 'SELL');
  assert.ok(plans[0].sl > 1.27, 'SELL stop above current');
});

test('runMt5ProtectionSweep repairs each naked position via MODIFY', async () => {
  const modified = [];
  const result = await runMt5ProtectionSweep({
    positions: [
      { ticket: 1838243146, symbol: 'BTCUSD', side: 'BUY', priceCurrent: 108800, sl: 0, tp: 0 },
      { ticket: 1838243350, symbol: 'BTCUSD', side: 'BUY', priceCurrent: 108800, sl: 0, tp: 0 },
      { ticket: 99, symbol: 'EURUSD', side: 'SELL', priceCurrent: 1.16, sl: 1.165, tp: 1.142 }
    ],
    env: {},
    modifyPosition: async (ticket, levels) => { modified.push({ ticket, ...levels }); return { ok: true }; }
  });
  assert.equal(result.ran, true);
  assert.equal(result.attempted, 2);
  assert.equal(result.repaired, 2);
  assert.equal(modified.length, 2, 'only the 2 naked BTC positions get a MODIFY');
  assert.ok(modified.every((m) => m.sl > 0 && m.tp > 0));
});

test('runMt5ProtectionSweep is a no-op when nothing is naked', async () => {
  const result = await runMt5ProtectionSweep({
    positions: [{ ticket: 1, symbol: 'EURUSD', side: 'BUY', priceCurrent: 1.1, sl: 1.09, tp: 1.12 }],
    env: {},
    modifyPosition: async () => ({ ok: true })
  });
  assert.equal(result.ran, false);
  assert.equal(result.reason, 'no_naked_positions');
});

test('reports a failed MODIFY without crashing the sweep', async () => {
  const result = await runMt5ProtectionSweep({
    positions: [{ ticket: 7, symbol: 'BTCUSD', side: 'BUY', priceCurrent: 100000, sl: 0, tp: 0 }],
    env: {},
    modifyPosition: async () => ({ ok: false, reason: 'bridge_down' })
  });
  assert.equal(result.repaired, 0);
  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[0].reason, 'bridge_down');
});
