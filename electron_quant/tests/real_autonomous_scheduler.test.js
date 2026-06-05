const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isRealAutonomousSchedulerEnabled,
  resolveRealAutonomousLimits,
  runRealAutonomousTick,
  createRealAutonomousSchedulerController
} = require('../backend/execution/real-autonomous-scheduler');

function armedContext(overrides = {}) {
  return {
    env: {
      REAL_TRADING: 'true',
      BINANCE_API_KEY: 'key',
      BINANCE_SECRET: 'secret',
      REAL_AUTONOMOUS_SCHEDULER_ENABLED: 'true',
      REAL_AUTONOMOUS_MAX_NOTIONAL_USDT: '6',
      REAL_AUTONOMOUS_MIN_CONFIDENCE: '50',
      ...overrides.env
    },
    botState: {
      tradingRealEnabled: true,
      killSwitch: false,
      paperMode: false,
      ...overrides.botState
    },
    riskConfig: {
      enabled: true,
      maxRiskPerTradePct: 1,
      maxDailyLossPct: 3,
      maxOpenPositions: 5,
      requireStopLoss: true,
      allowRealTrading: false,
      allowedVenues: ['BINANCE'],
      trainingCanChangeCriticalRules: false,
      ...overrides.riskConfig
    },
    deps: overrides.deps || {}
  };
}

test('autonomous scheduler is opt-in and exposes conservative defaults', () => {
  assert.equal(isRealAutonomousSchedulerEnabled({}), false);
  assert.equal(isRealAutonomousSchedulerEnabled({ REAL_AUTONOMOUS_SCHEDULER_ENABLED: 'true' }), true);

  const limits = resolveRealAutonomousLimits({ REAL_TRADING_MAX_NOTIONAL_USDT: '25' }, { maxOpenPositions: 7 });
  assert.equal(limits.maxOrdersPerTick, 1);
  assert.equal(limits.maxOpenPositions, 7);
  assert.equal(limits.minOpenPositions, 0);
  assert.equal(limits.autonomyMode, 'opportunity_only');
  assert.equal(limits.maxNotionalUsdt, 5);
  assert.equal(limits.stopLossPct, 2);
  assert.equal(limits.takeProfitPct, 3);
  assert.equal(limits.mt5AllowOvernight, false);
  assert.equal(limits.mt5MaxHoldHours, 22);
  assert.deepEqual(limits.allowedVenues, ['BINANCE', 'MT5']);

  const defaultLimits = resolveRealAutonomousLimits({}, {});
  assert.equal(defaultLimits.maxOpenPositions, 4);
});

test('tick does not force a minimum number of real positions when no opportunity is available', async () => {
  let called = false;
  const result = await runRealAutonomousTick(armedContext({
    deps: {
      readTrainingStateSnapshot: () => ({ state: { activePairs: [] } }),
      discoverBinanceRealUniverse: async () => ({ ok: true, ready: [] }),
      executeBinanceRealOrder: async () => { called = true; return { ok: true }; }
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.executedCount, 0);
  assert.equal(called, false);
  assert.equal(result.limits.minOpenPositions, 0);
  assert.equal(result.limits.autonomyMode, 'opportunity_only');
});

test('tick refuses real execution when real gates are not armed', async () => {
  let called = false;
  const result = await runRealAutonomousTick(armedContext({
    env: { REAL_TRADING: 'false' },
    deps: {
      executeBinanceRealOrder: async () => { called = true; return { ok: true }; }
    }
  }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'real_autonomous_gates_not_armed');
  assert.equal(result.realTradingTouched, false);
  assert.equal(called, false);
});

test('tick uses executable USDT universe instead of hardcoded BTC and respects max orders', async () => {
  const executions = [];
  const result = await runRealAutonomousTick(armedContext({
    env: { REAL_AUTONOMOUS_MAX_ORDERS_PER_TICK: '2' },
    deps: {
      readTrainingStateSnapshot: () => ({
        state: {
          activePairs: [
            { venue: 'BINANCE', symbol: 'BTCUSDT', bias: 'LONG', confidence: 51, score: 51 },
            { venue: 'BINANCE', symbol: 'ACXUSDT', bias: 'LONG', confidence: 92, score: 92 },
            { venue: 'BINANCE', symbol: 'ALLOUSDT', bias: 'LONG', confidence: 88, score: 88 }
          ],
          positions: []
        }
      }),
      discoverBinanceRealUniverse: async () => ({
        ok: true,
        ready: [
          { venue: 'BINANCE', symbol: 'BTCUSDT', side: 'BUY', type: 'MARKET', qty: 0.00008, requestedNotional: 5.5, price: 68000 },
          { venue: 'BINANCE', symbol: 'ACXUSDT', side: 'BUY', type: 'MARKET', qty: 140, requestedNotional: 5.7, price: 0.041 },
          { venue: 'BINANCE', symbol: 'ALLOUSDT', side: 'BUY', type: 'MARKET', qty: 30, requestedNotional: 5.2, price: 0.17 }
        ]
      }),
      executeBinanceRealOrder: async ({ input }) => {
        executions.push(input);
        return { ok: true, status: 'executed', request: input, order: { orderId: executions.length } };
      }
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.executedCount, 2);
  assert.deepEqual(executions.map((input) => input.symbol), ['ACXUSDT', 'ALLOUSDT']);
  assert.equal(executions.every((input) => input.type === 'MARKET' && input.side === 'BUY'), true);
  assert.equal(executions.every((input) => input.stopLoss > 0 && input.takeProfit > 0), true);
  assert.equal(executions.every((input) => input.stopLoss < input.entryPrice && input.takeProfit > input.entryPrice), true);
});

test('tick avoids symbols already open in real accounts', async () => {
  const executions = [];
  const result = await runRealAutonomousTick(armedContext({
    env: { REAL_AUTONOMOUS_MAX_ORDERS_PER_TICK: '3' },
    deps: {
      readTrainingStateSnapshot: () => ({
        state: { activePairs: [
          { venue: 'BINANCE', symbol: 'ACXUSDT', bias: 'LONG', confidence: 92 },
          { venue: 'BINANCE', symbol: 'ALLOUSDT', bias: 'LONG', confidence: 88 }
        ] }
      }),
      getOpenRealPositions: async () => [{ venue: 'BINANCE', symbol: 'ACXUSDT' }],
      discoverBinanceRealUniverse: async () => ({
        ok: true,
        ready: [
          { venue: 'BINANCE', symbol: 'ACXUSDT', side: 'BUY', type: 'MARKET', qty: 100, requestedNotional: 5, price: 0.041 },
          { venue: 'BINANCE', symbol: 'ALLOUSDT', side: 'BUY', type: 'MARKET', qty: 20, requestedNotional: 5, price: 0.17 }
        ]
      }),
      executeBinanceRealOrder: async ({ input }) => {
        executions.push(input);
        return { ok: true, status: 'executed', request: input, order: { orderId: 1 } };
      }
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.executedCount, 1);
  assert.deepEqual(executions.map((input) => input.symbol), ['ALLOUSDT']);
  assert.equal(result.skipped.some((row) => row.symbol === 'ACXUSDT' && row.reason === 'already_open_real_position'), true);
});

test('tick respects max autonomous orders per day from audit/deps', async () => {
  let called = false;
  const result = await runRealAutonomousTick(armedContext({
    env: { REAL_AUTONOMOUS_MAX_ORDERS_PER_DAY: '10' },
    deps: {
      getRealAutonomousOrdersToday: async () => 10,
      discoverBinanceRealUniverse: async () => ({
        ok: true,
        ready: [{ venue: 'BINANCE', symbol: 'ACXUSDT', side: 'BUY', type: 'MARKET', qty: 100, requestedNotional: 5, price: 0.041 }]
      }),
      executeBinanceRealOrder: async () => { called = true; return { ok: true }; }
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'max_daily_orders_reached');
  assert.equal(result.executedCount, 0);
  assert.equal(called, false);
});

test('tick continues to next candidate when the highest ranked preflight is blocked', async () => {
  const executions = [];
  const result = await runRealAutonomousTick(armedContext({
    env: {
      REAL_AUTONOMOUS_ALLOWED_VENUES: 'MT5,BINANCE',
      REAL_AUTONOMOUS_MT5_ENABLED: 'true',
      MT5_REAL_TRADING_ENABLED: 'true',
      MT5_CONNECTOR_ENABLED: 'true',
      REAL_AUTONOMOUS_MAX_ORDERS_PER_TICK: '1'
    },
    riskConfig: { allowedVenues: ['BINANCE', 'MT5'] },
    deps: {
      readTrainingStateSnapshot: () => ({
        state: {
          activePairs: [
            { venue: 'MT5', symbol: 'GBPUSD', bias: 'LONG', confidence: 100, price: 1.27 },
            { venue: 'BINANCE', symbol: 'ACXUSDT', bias: 'LONG', confidence: 90 }
          ]
        }
      }),
      getMt5MarketSession: () => ({ open: true }),
      checkMt5RealOrder: async () => ({ ok: false, reason: 'mt5_check_failed' }),
      placeMt5RealOrder: async () => { throw new Error('should_not_place_mt5'); },
      discoverBinanceRealUniverse: async () => ({
        ok: true,
        ready: [{ venue: 'BINANCE', symbol: 'ACXUSDT', side: 'BUY', type: 'MARKET', qty: 100, requestedNotional: 5, price: 0.041 }]
      }),
      executeBinanceRealOrder: async ({ input }) => {
        executions.push(input);
        return { ok: true, status: 'executed', request: input, order: { orderId: 77 } };
      }
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.executedCount, 1);
  assert.equal(result.executed.length, 2);
  assert.equal(result.executed[0].venue, 'MT5');
  assert.equal(result.executed[0].ok, false);
  assert.deepEqual(executions.map((input) => input.symbol), ['ACXUSDT']);
});

test('Binance ready universe can trade when persisted training pair has no score yet', async () => {
  const executions = [];
  const result = await runRealAutonomousTick(armedContext({
    env: { REAL_AUTONOMOUS_MIN_CONFIDENCE: '60' },
    deps: {
      readTrainingStateSnapshot: () => ({
        state: { activePairs: [{ venue: 'BINANCE', symbol: 'ACXUSDT' }] }
      }),
      discoverBinanceRealUniverse: async () => ({
        ok: true,
        ready: [{ venue: 'BINANCE', symbol: 'ACXUSDT', side: 'BUY', type: 'MARKET', qty: 100, requestedNotional: 5, price: 0.041 }]
      }),
      executeBinanceRealOrder: async ({ input }) => {
        executions.push(input);
        return { ok: true, status: 'executed', request: input, order: { orderId: 99 } };
      }
    }
  }));

  assert.equal(result.executedCount, 1);
  assert.deepEqual(executions.map((input) => input.symbol), ['ACXUSDT']);
  assert.equal(result.candidates[0].priorityScore, 60);
  assert.equal(executions[0].stopLoss < executions[0].entryPrice, true);
  assert.equal(executions[0].takeProfit > executions[0].entryPrice, true);
});

test('autonomous Binance candidates without a protection price are skipped before execution', async () => {
  let called = false;
  const result = await runRealAutonomousTick(armedContext({
    deps: {
      readTrainingStateSnapshot: () => ({
        state: { activePairs: [{ venue: 'BINANCE', symbol: 'ACXUSDT', bias: 'LONG', confidence: 90 }] }
      }),
      discoverBinanceRealUniverse: async () => ({
        ok: true,
        ready: [{ venue: 'BINANCE', symbol: 'ACXUSDT', side: 'BUY', type: 'MARKET', qty: 100, requestedNotional: 5 }]
      }),
      executeBinanceRealOrder: async () => { called = true; return { ok: true }; }
    }
  }));

  assert.equal(result.executedCount, 0);
  assert.equal(called, false);
  assert.equal(result.skipped.some((row) => row.symbol === 'ACXUSDT' && row.reason === 'missing_protection_price'), true);
});

test('MT5 real candidates run only when explicitly enabled and market is open', async () => {
  const mt5Orders = [];
  const result = await runRealAutonomousTick(armedContext({
    env: {
      REAL_AUTONOMOUS_ALLOWED_VENUES: 'MT5',
      REAL_AUTONOMOUS_MT5_ENABLED: 'true',
      MT5_REAL_TRADING_ENABLED: 'true',
      MT5_CONNECTOR_ENABLED: 'true',
      MT5_REAL_MAX_LOTS: '0.01'
    },
    riskConfig: { allowedVenues: ['BINANCE', 'MT5'] },
    deps: {
      readTrainingStateSnapshot: () => ({
        state: {
          activePairs: [
            { venue: 'MT5', symbol: 'XAUUSD', bias: 'LONG', confidence: 91, horizon: 'intraday', price: 2350 }
          ]
        }
      }),
      getMt5MarketSession: () => ({ open: true, reason: 'open' }),
      checkMt5RealOrder: async () => ({ ok: true, reason: 'check_ok' }),
      placeMt5RealOrder: async (input) => {
        mt5Orders.push(input);
        return { ok: true, order: input, realTradingTouched: true };
      }
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.executedCount, 1);
  assert.deepEqual(mt5Orders.map((input) => [input.symbol, input.side, input.volume]), [['XAUUSD', 'BUY', 0.01]]);
  assert.equal(mt5Orders[0].stopLoss > 0, true);
  assert.equal(mt5Orders[0].takeProfit > 0, true);
  assert.equal(mt5Orders[0].stopLoss < mt5Orders[0].entryPrice, true);
  assert.equal(mt5Orders[0].takeProfit > mt5Orders[0].entryPrice, true);
});

test('MT5 real scheduler blocks swing/overnight horizons unless explicitly allowed', async () => {
  let called = false;
  const blocked = await runRealAutonomousTick(armedContext({
    env: {
      REAL_AUTONOMOUS_ALLOWED_VENUES: 'MT5',
      REAL_AUTONOMOUS_MT5_ENABLED: 'true',
      MT5_REAL_TRADING_ENABLED: 'true',
      MT5_CONNECTOR_ENABLED: 'true'
    },
    riskConfig: { allowedVenues: ['BINANCE', 'MT5'] },
    deps: {
      readTrainingStateSnapshot: () => ({
        state: {
          activePairs: [
            { venue: 'MT5', symbol: 'AUDCAD', bias: 'SHORT', confidence: 92, horizon: 'swing', price: 0.9922 }
          ]
        }
      }),
      getMt5MarketSession: () => ({ open: true, reason: 'open' }),
      checkMt5RealOrder: async () => { called = true; return { ok: true }; },
      placeMt5RealOrder: async () => { called = true; return { ok: true }; }
    }
  }));

  assert.equal(blocked.executedCount, 0);
  assert.equal(called, false);
  assert.equal(blocked.skipped.some((row) => row.symbol === 'AUDCAD' && row.reason === 'mt5_overnight_horizon_blocked'), true);

  const allowed = await runRealAutonomousTick(armedContext({
    env: {
      REAL_AUTONOMOUS_ALLOWED_VENUES: 'MT5',
      REAL_AUTONOMOUS_MT5_ENABLED: 'true',
      MT5_REAL_TRADING_ENABLED: 'true',
      MT5_CONNECTOR_ENABLED: 'true',
      REAL_AUTONOMOUS_MT5_ALLOW_OVERNIGHT: 'true'
    },
    riskConfig: { allowedVenues: ['BINANCE', 'MT5'] },
    deps: {
      readTrainingStateSnapshot: () => ({
        state: {
          activePairs: [
            { venue: 'MT5', symbol: 'AUDCAD', bias: 'SHORT', confidence: 92, horizon: 'swing', price: 0.9922 }
          ]
        }
      }),
      getMt5MarketSession: () => ({ open: true, reason: 'open' }),
      checkMt5RealOrder: async () => ({ ok: true }),
      placeMt5RealOrder: async (input) => ({ ok: true, order: input, realTradingTouched: true })
    }
  }));

  assert.equal(allowed.executedCount, 1);
  assert.equal(allowed.candidates[0].maxHoldHours, 22);
});

test('controller prevents overlapping autonomous ticks', async () => {
  let resolveRun;
  const controller = createRealAutonomousSchedulerController({
    runner: () => new Promise((resolve) => { resolveRun = resolve; }),
    timers: { setInterval: () => 1, clearInterval: () => {} },
    now: () => Date.parse('2026-06-04T12:00:00.000Z')
  });

  const first = controller.runNow(armedContext());
  const second = await controller.runNow(armedContext());
  resolveRun({ ok: true, executedCount: 0 });
  await first;

  assert.equal(second.reason, 'real_autonomous_tick_in_progress');
  assert.equal(controller.status(armedContext()).ticksSkipped, 1);
});

test('scheduler autonomously closes stale MT5 real positions before opening more risk', async () => {
  const closed = [];
  const result = await runRealAutonomousTick(armedContext({
    env: {
      REAL_AUTONOMOUS_ALLOWED_VENUES: 'MT5',
      REAL_AUTONOMOUS_MT5_ENABLED: 'true',
      MT5_REAL_TRADING_ENABLED: 'true',
      MT5_CONNECTOR_ENABLED: 'true',
      REAL_AUTONOMOUS_MT5_MAX_HOLD_HOURS: '22',
      REAL_AUTONOMOUS_MT5_ORPHAN_MAX_HOLD_HOURS: '72',
      REAL_AUTONOMOUS_MAX_ORDERS_PER_TICK: '2'
    },
    riskConfig: { allowedVenues: ['BINANCE', 'MT5'], maxOpenPositions: 4 },
    deps: {
      readTrainingStateSnapshot: () => ({ state: { activePairs: [] } }),
      getMt5MarketSession: () => ({ open: true, reason: 'open' }),
      getOpenRealPositions: async () => [
        {
          venue: 'MT5',
          symbol: 'USDCAD',
          ticket: 445566,
          openedAt: '2026-06-03T10:00:00.000Z',
          swap: -0.42
        }
      ],
      closeMt5RealPosition: async (input) => {
        closed.push(input);
        return { ok: true, action: 'CLOSE', ticket: input.ticket, realTradingTouched: true };
      }
    },
    nowMs: Date.parse('2026-06-04T10:30:00.000Z')
  }));

  assert.equal(result.ok, true);
  assert.equal(result.executedCount, 1);
  assert.equal(result.executed[0].action, 'CLOSE');
  assert.equal(result.executed[0].symbol, 'USDCAD');
  assert.deepEqual(closed.map((input) => input.ticket), [445566]);
  assert.equal(closed[0].reason, 'real-autonomous-stale-mt5-close');
});

test('scheduler autonomously closes MT5 real position when live signal flips against it', async () => {
  const closed = [];
  const result = await runRealAutonomousTick(armedContext({
    env: {
      REAL_AUTONOMOUS_ALLOWED_VENUES: 'MT5',
      REAL_AUTONOMOUS_MT5_ENABLED: 'true',
      MT5_REAL_TRADING_ENABLED: 'true',
      MT5_CONNECTOR_ENABLED: 'true',
      REAL_AUTONOMOUS_MIN_CONFIDENCE: '60',
      REAL_AUTONOMOUS_MAX_ORDERS_PER_TICK: '1'
    },
    riskConfig: { allowedVenues: ['BINANCE', 'MT5'], maxOpenPositions: 4 },
    deps: {
      readTrainingStateSnapshot: () => ({
        state: {
          activePairs: [
            { venue: 'MT5', symbol: 'EURUSD', bias: 'SHORT', confidence: 84, horizon: 'intraday', price: 1.081 }
          ]
        }
      }),
      getMt5MarketSession: () => ({ open: true, reason: 'open' }),
      getOpenRealPositions: async () => [
        { venue: 'MT5', symbol: 'EURUSD', ticket: 11001, side: 'BUY', openedAt: '2026-06-05T05:00:00.000Z' }
      ],
      closeMt5RealPosition: async (input) => {
        closed.push(input);
        return { ok: true, ticket: input.ticket, commandId: 'cmd-close-1', realTradingTouched: true };
      }
    },
    nowMs: Date.parse('2026-06-05T06:00:00.000Z')
  }));

  assert.equal(result.ok, true);
  assert.equal(result.executedCount, 1);
  assert.equal(result.executed[0].action, 'CLOSE');
  assert.equal(result.executed[0].reason, 'mt5_signal_flipped');
  assert.equal(result.executed[0].signalBias, 'SHORT');
  assert.deepEqual(closed, [{ ticket: 11001, symbol: 'EURUSD', reason: 'real-autonomous-mt5_signal_flipped' }]);
});

test('scheduler autonomously closes MT5 real position when hold signal collapses', async () => {
  const closed = [];
  const result = await runRealAutonomousTick(armedContext({
    env: {
      REAL_AUTONOMOUS_ALLOWED_VENUES: 'MT5',
      REAL_AUTONOMOUS_MT5_ENABLED: 'true',
      MT5_REAL_TRADING_ENABLED: 'true',
      MT5_CONNECTOR_ENABLED: 'true',
      REAL_AUTONOMOUS_MIN_CONFIDENCE: '60',
      REAL_AUTONOMOUS_MIN_HOLD_CONFIDENCE: '45',
      REAL_AUTONOMOUS_MAX_ORDERS_PER_TICK: '1'
    },
    riskConfig: { allowedVenues: ['BINANCE', 'MT5'], maxOpenPositions: 4 },
    deps: {
      readTrainingStateSnapshot: () => ({
        state: {
          activePairs: [
            { venue: 'MT5', symbol: 'USDCAD', bias: 'LONG', confidence: 32, horizon: 'intraday', price: 1.36 }
          ]
        }
      }),
      getMt5MarketSession: () => ({ open: true, reason: 'open' }),
      getOpenRealPositions: async () => [
        { venue: 'MT5', symbol: 'USDCAD', ticket: 22002, side: 'BUY', openedAt: '2026-06-05T04:00:00.000Z' }
      ],
      closeMt5RealPosition: async (input) => {
        closed.push(input);
        return { ok: true, ticket: input.ticket, commandId: 'cmd-close-2', realTradingTouched: true };
      }
    },
    nowMs: Date.parse('2026-06-05T06:00:00.000Z')
  }));

  assert.equal(result.ok, true);
  assert.equal(result.executedCount, 1);
  assert.equal(result.executed[0].action, 'CLOSE');
  assert.equal(result.executed[0].reason, 'mt5_signal_below_hold_confidence');
  assert.equal(result.executed[0].signalScore, 32);
  assert.deepEqual(closed, [{ ticket: 22002, symbol: 'USDCAD', reason: 'real-autonomous-mt5_signal_below_hold_confidence' }]);
});

test('scheduler repairs unprotected Binance spot balances before opening more risk', async () => {
  const protections = [];
  const openings = [];
  const result = await runRealAutonomousTick(armedContext({
    env: {
      REAL_AUTONOMOUS_MAX_ORDERS_PER_TICK: '2',
      REAL_AUTONOMOUS_MAX_NOTIONAL_USDT: '5'
    },
    deps: {
      readTrainingStateSnapshot: () => ({
        state: {
          activePairs: [
            { venue: 'BINANCE', symbol: 'ALLOUSDT', bias: 'LONG', confidence: 90 }
          ]
        }
      }),
      getOpenRealPositions: async () => [
        {
          venue: 'BINANCE',
          source: 'SPOT_BALANCE',
          symbol: '1000CHEEMSUSDT',
          quantity: 1000,
          price: 0.005,
          valueQuote: 5,
          hasOpenOrders: false
        }
      ],
      placeProtectionBinance: async (request, order) => {
        protections.push({ request, order });
        return { ok: true, orderListId: 991 };
      },
      discoverBinanceRealUniverse: async () => ({
        ok: true,
        ready: [{ venue: 'BINANCE', symbol: 'ALLOUSDT', side: 'BUY', type: 'MARKET', qty: 30, requestedNotional: 5.2, price: 0.17 }]
      }),
      executeBinanceRealOrder: async ({ input }) => {
        openings.push(input);
        return { ok: true, status: 'executed', request: input, order: { orderId: 44 } };
      }
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.executedCount, 2);
  assert.equal(result.executed[0].action, 'PROTECT');
  assert.equal(result.executed[0].symbol, '1000CHEEMSUSDT');
  assert.equal(protections[0].request.stopLoss > 0, true);
  assert.equal(protections[0].request.takeProfit > protections[0].request.stopLoss, true);
  assert.deepEqual(openings.map((input) => input.symbol), ['ALLOUSDT']);
});

test('scheduler closes small unprotected Binance spot balance when OCO repair fails', async () => {
  const sells = [];
  const result = await runRealAutonomousTick(armedContext({
    env: {
      REAL_AUTONOMOUS_MAX_ORDERS_PER_TICK: '1',
      REAL_AUTONOMOUS_MAX_NOTIONAL_USDT: '5'
    },
    deps: {
      readTrainingStateSnapshot: () => ({ state: { activePairs: [] } }),
      getOpenRealPositions: async () => [
        {
          venue: 'BINANCE',
          source: 'SPOT_BALANCE',
          symbol: 'ACTUSDT',
          quantity: 20,
          price: 0.25,
          valueQuote: 5,
          hasOpenOrders: false
        }
      ],
      placeProtectionBinance: async () => ({ ok: false, error: 'oco_rejected' }),
      placeOrderBinance: async (side, symbol, qty, type) => {
        sells.push({ side, symbol, qty, type });
        return { ok: true, orderId: 1234, symbol, side, qty };
      },
      discoverBinanceRealUniverse: async () => ({ ok: true, ready: [] })
    }
  }));

  assert.equal(result.ok, true);
  assert.equal(result.executedCount, 1);
  assert.equal(result.executed[0].action, 'CLOSE');
  assert.equal(result.executed[0].status, 'closed_unprotected');
  assert.deepEqual(sells, [{ side: 'SELL', symbol: 'ACTUSDT', qty: 20, type: 'MARKET' }]);
});
