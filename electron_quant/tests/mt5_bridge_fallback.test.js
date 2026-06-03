const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bridgeSymbolsFromStatus,
  bridgeTickerFromStatus
} = require('../backend/adapters/mt5/mt5-bridge-fallback');

test('bridgeSymbolsFromStatus exposes current connected bridge symbol', () => {
  const result = bridgeSymbolsFromStatus({
    ok: true,
    connected: true,
    symbol: 'EURUSD'
  });

  assert.deepEqual(result, { ok: true, symbols: ['EURUSD'], source: 'mt5_bridge_status' });
});

test('bridgeTickerFromStatus exposes midpoint and spread for the matching symbol', () => {
  const result = bridgeTickerFromStatus('EURUSD', {
    ok: true,
    connected: true,
    symbol: 'EURUSD',
    bid: 1.1628,
    ask: 1.1629,
    ts: 1780457821
  });

  assert.equal(result.ok, true);
  assert.equal(result.symbol, 'EURUSD');
  assert.equal(result.venue, 'MT5');
  assert.equal(result.price, 1.16285);
  assert.equal(result.spread, 0.0001);
  assert.equal(result.source, 'mt5_bridge_status');
});

test('bridgeTickerFromStatus refuses disconnected or mismatched symbols', () => {
  assert.equal(bridgeTickerFromStatus('XAUUSD', { ok: true, connected: true, symbol: 'EURUSD' }).ok, false);
  assert.equal(bridgeTickerFromStatus('EURUSD', { ok: true, connected: false, symbol: 'EURUSD' }).ok, false);
});
