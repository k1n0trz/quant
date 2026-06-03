const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bridgeSymbolsFromStatus,
  bridgeTickerFromStatus,
  bridgeRatesFromStatus,
  bridgeTickCandlesFromStatus
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

test('bridgeRatesFromStatus exposes OHLC candles for requested symbol and timeframe', () => {
  const result = bridgeRatesFromStatus('AUDCAD', 'M1', {
    ok: true,
    connected: true,
    symbol: 'AUDCAD',
    bid: 0.901,
    ask: 0.9012,
    rates: {
      AUDCAD: {
        M1: {
          timeframe: 'M1',
          candles: [
            { t: 1780457700, o: 0.9, h: 0.902, l: 0.899, c: 0.901, v: 12 },
            { t: 1780457760, o: 0.901, h: 0.903, l: 0.9005, c: 0.902, v: 10 }
          ]
        }
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, 'mt5_bridge_rates');
  assert.equal(result.candles.length, 2);
  assert.equal(result.candles[0].openTime, 1780457700000);
  assert.equal(result.candles[1].close, 0.902);
  assert.equal(result.ticker.price, 0.9011);
});

test('bridgeTickCandlesFromStatus keeps chart visible when OHLC is unavailable', () => {
  const result = bridgeTickCandlesFromStatus('EURUSD', 'M5', {
    ok: true,
    connected: true,
    symbol: 'EURUSD',
    bid: 1.16,
    ask: 1.1602
  }, 30);

  assert.equal(result.ok, true);
  assert.equal(result.degraded, true);
  assert.equal(result.source, 'mt5_bridge_tick_fallback');
  assert.equal(result.candles.length >= 24, true);
  assert.equal(result.ticker.price, 1.1601);
});
