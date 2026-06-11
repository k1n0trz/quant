const test = require('node:test');
const assert = require('node:assert/strict');

const { buildLiveTelemetry, renderLiveTelemetryBlock } = require('../backend/chat/live-telemetry');

const NOW = 1_700_000_000_000;

test('real trading is only effective when armed, requested and kill switch off', () => {
  const armed = buildLiveTelemetry({
    env: { REAL_TRADING: 'true' },
    botState: { tradingRealEnabled: true, killSwitch: false },
    nowMs: NOW
  });
  assert.equal(armed.realTrading.effective, true);

  const killed = buildLiveTelemetry({
    env: { REAL_TRADING: 'true' },
    botState: { tradingRealEnabled: true, killSwitch: true },
    nowMs: NOW
  });
  assert.equal(killed.realTrading.effective, false);

  const notRequested = buildLiveTelemetry({
    env: { REAL_TRADING: 'true' },
    botState: { tradingRealEnabled: false },
    nowMs: NOW
  });
  assert.equal(notRequested.realTrading.effective, false);
});

test('bot counts come straight from registry totals, never invented', () => {
  const telemetry = buildLiveTelemetry({
    env: {},
    botsStatus: { templatesCount: 2, totals: { training: 3, real: 3 } },
    nowMs: NOW
  });
  assert.equal(telemetry.bots.templates, 2);
  assert.equal(telemetry.bots.training, 3);
  assert.equal(telemetry.bots.realCandidates, 3);
  assert.equal(telemetry.bots.deployedReal, 0);

  const empty = buildLiveTelemetry({ env: {}, nowMs: NOW });
  assert.equal(empty.bots.templates, 0);
  assert.equal(empty.bots.training, 0);
});

test('fresh MT5 real bridge surfaces equity and unprotected positions', () => {
  const telemetry = buildLiveTelemetry({
    env: {},
    nowMs: NOW,
    mt5RealBridge: {
      ts: Math.floor(NOW / 1000),
      connected: true,
      server: 'FBS-Real',
      currency: 'USD',
      equity: 312.5,
      tradeAllowed: true,
      mqlTradeAllowed: true,
      positions: [
        { sl: 1.1 },
        { sl: 0 }
      ]
    }
  });
  assert.equal(telemetry.mt5Real.present, true);
  assert.equal(telemetry.mt5Real.fresh, true);
  assert.equal(telemetry.mt5Real.equity, 312.5);
  assert.equal(telemetry.mt5Real.positionsTotal, 2);
  assert.equal(telemetry.mt5Real.unprotectedPositions, 1);

  const block = renderLiveTelemetryBlock(telemetry);
  assert.match(block, /MT5 real: conectado=SI/);
  assert.match(block, /sin SL=1/);
});

test('stale bridge telemetry is flagged, not trusted', () => {
  const telemetry = buildLiveTelemetry({
    env: {},
    nowMs: NOW,
    mt5DemoBridge: {
      ts: Math.floor((NOW - 120000) / 1000),
      connected: true,
      server: 'FBS-Demo',
      equity: 100000
    }
  });
  assert.equal(telemetry.mt5Demo.present, true);
  assert.equal(telemetry.mt5Demo.fresh, false);
  const block = renderLiveTelemetryBlock(telemetry);
  assert.match(block, /MT5 demo: telemetria OBSOLETA/);
});

test('missing bridge renders an explicit no-telemetry line, never a fake number', () => {
  const telemetry = buildLiveTelemetry({ env: {}, nowMs: NOW });
  const block = renderLiveTelemetryBlock(telemetry);
  assert.match(block, /MT5 real: sin telemetria/);
  assert.match(block, /nunca inventes cifras/);
  assert.match(block, /este bloque manda/);
});

test('training open positions exclude already-closed ones', () => {
  const telemetry = buildLiveTelemetry({
    env: {},
    nowMs: NOW,
    trainingState: {
      mode: 'training',
      balance: 98000,
      positions: [
        { exit_price: null },
        { exit_price: 123 },
        { exit_price: null }
      ]
    }
  });
  assert.equal(telemetry.training.present, true);
  assert.equal(telemetry.training.openPositions, 2);
  assert.equal(telemetry.training.balance, 98000);
});
