const test = require('node:test');
const assert = require('node:assert/strict');

const {
  shouldAttemptTrainingDemoShadowWrite,
  shouldAcceptTrainingDemoAtomicClose,
  buildTrainingDemoClosedTradePayload,
  interpretTrainingDemoWriterResponse,
  createTrainingDemoWriterClient
} = require('../src/services/training-demo-writer-client');

function createSampleOpenPosition() {
  return {
    symbol: 'BTCUSDT',
    venue: 'BINANCE',
    direction: 'LONG',
    entry_price: 100,
    size_demo: 2,
    fees_simuladas: 1,
    spread_estimado: 0.5,
    slippage_estimado: 0.25,
    strategy_id: 'trendMomentum',
    strategy_name: 'Trend Momentum / EMA-MACD',
    signal_id: 'sig-123',
    confidence_at_entry: 78
  };
}

function createSampleSignal() {
  return {
    bias: 'SHORT',
    confidence: 61,
    setup: 'flip',
    signal_id: 'sig-123',
    strategy_id: 'trendMomentum'
  };
}

test('shadow writer remains off without explicit frontend opt-in', () => {
  assert.equal(shouldAttemptTrainingDemoShadowWrite({ frontendEnabled: false, backendEnabled: true }), false);
  assert.equal(shouldAttemptTrainingDemoShadowWrite({ frontendEnabled: null, backendEnabled: true }), false);
  assert.equal(shouldAttemptTrainingDemoShadowWrite({ frontendEnabled: undefined, backendEnabled: true }), false);
});

test('shadow writer requires backend enabled hint in addition to frontend opt-in', () => {
  assert.equal(shouldAttemptTrainingDemoShadowWrite({ frontendEnabled: true, backendEnabled: false }), false);
  assert.equal(shouldAttemptTrainingDemoShadowWrite({ frontendEnabled: true, backendEnabled: null }), false);
  assert.equal(shouldAttemptTrainingDemoShadowWrite({ frontendEnabled: true, backendEnabled: true }), true);
});

test('payload preserves strategy_id and signal_id', () => {
  const payload = buildTrainingDemoClosedTradePayload({
    openPosition: createSampleOpenPosition(),
    signal: createSampleSignal(),
    exitContext: { price: 104.5 },
    options: { maxClosedTrades: 80 }
  });

  assert.equal(payload.openPosition.strategy_id, 'trendMomentum');
  assert.equal(payload.openPosition.signal_id, 'sig-123');
  assert.equal(payload.signal.strategy_id, 'trendMomentum');
  assert.equal(payload.signal.signal_id, 'sig-123');
});

test('response interpreter marks disabled and invalid payload as fallback cases', () => {
  assert.deepEqual(
    interpretTrainingDemoWriterResponse({ status: 409, body: { reason: 'training_backend_writer_disabled' } }),
    { ok: false, fallback: true, reason: 'disabled', warning: null, acceptAtomic: false, mode: 'fallback_legacy' }
  );
  assert.deepEqual(
    interpretTrainingDemoWriterResponse({ status: 400, body: { error: 'openPosition object is required' } }),
    {
      ok: false,
      fallback: true,
      reason: 'invalid_payload',
      warning: 'training-demo-writer invalid payload: openPosition object is required',
      acceptAtomic: false,
      mode: 'fallback_legacy'
    }
  );
});

test('atomic preferred requires explicit secondary frontend opt-in plus backend ok', () => {
  assert.equal(shouldAcceptTrainingDemoAtomicClose({ frontendEnabled: true, backendEnabled: true, atomicPreferred: false }, { ok: true }), false);
  assert.equal(shouldAcceptTrainingDemoAtomicClose({ frontendEnabled: true, backendEnabled: true, atomicPreferred: true }, { ok: false }), false);
  assert.equal(shouldAcceptTrainingDemoAtomicClose({ frontendEnabled: true, backendEnabled: true, atomicPreferred: true }, { ok: true }), true);
});

test('client falls back cleanly when backend is disabled', async () => {
  const client = createTrainingDemoWriterClient({
    fetchImpl: async () => ({ status: 409, json: async () => ({ reason: 'training_backend_writer_disabled' }) }),
    getBackendWriterConfig: async () => ({ frontendEnabled: true, backendEnabled: true }),
    getEndpoint: (path) => `http://localhost${path}`
  });

  const result = await client.writeClosedTradeShadow({
    openPosition: createSampleOpenPosition(),
    signal: createSampleSignal(),
    exitContext: { price: 105 }
  });

  assert.equal(result.ok, false);
  assert.equal(result.fallback, true);
  assert.equal(result.reason, 'disabled');
  assert.equal(result.mode, 'fallback_legacy');
});

test('client falls back cleanly on network failure', async () => {
  const client = createTrainingDemoWriterClient({
    fetchImpl: async () => { throw new Error('connect ECONNREFUSED'); },
    getBackendWriterConfig: async () => ({ frontendEnabled: true, backendEnabled: true }),
    getEndpoint: (path) => `http://localhost${path}`
  });

  const result = await client.writeClosedTradeShadow({
    openPosition: createSampleOpenPosition(),
    signal: createSampleSignal(),
    exitContext: { price: 105 }
  });

  assert.equal(result.ok, false);
  assert.equal(result.fallback, true);
  assert.equal(result.reason, 'network');
  assert.equal(result.mode, 'fallback_legacy');
});

test('client does not attempt request unless both flags explicitly allow it', async () => {
  let called = 0;
  const client = createTrainingDemoWriterClient({
    fetchImpl: async () => {
      called += 1;
      return { status: 200, json: async () => ({ ok: true }) };
    },
    getBackendWriterConfig: async () => ({ frontendEnabled: false, backendEnabled: true }),
    getEndpoint: (path) => `http://localhost${path}`
  });

  const result = await client.writeClosedTradeShadow({
    openPosition: createSampleOpenPosition(),
    signal: createSampleSignal(),
    exitContext: { price: 105 }
  });

  assert.equal(called, 0);
  assert.equal(result.ok, false);
  assert.equal(result.fallback, true);
  assert.equal(result.reason, 'not_enabled');
  assert.equal(result.mode, 'fallback_legacy');
});

test('client returns shadow-only mode when backend ok but atomic preferred is off', async () => {
  const client = createTrainingDemoWriterClient({
    fetchImpl: async () => ({
      status: 200,
      json: async () => ({ ok: true, closedTrade: { signal_id: 'sig-123', strategy_id: 'trendMomentum', pnl_demo: 8.25 } })
    }),
    getBackendWriterConfig: async () => ({ frontendEnabled: true, backendEnabled: true, atomicPreferred: false }),
    getEndpoint: (path) => `http://localhost${path}`
  });

  const result = await client.writeClosedTradeShadow({
    openPosition: createSampleOpenPosition(),
    signal: createSampleSignal(),
    exitContext: { price: 105 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.acceptAtomic, false);
  assert.equal(result.mode, 'shadow_only');
  assert.equal(result.body.closedTrade.signal_id, 'sig-123');
});

test('client returns atomic-preferred mode when backend ok and secondary opt-in is on', async () => {
  const client = createTrainingDemoWriterClient({
    fetchImpl: async () => ({
      status: 200,
      json: async () => ({
        ok: true,
        closedTrade: { signal_id: 'sig-123', strategy_id: 'trendMomentum', pnl_demo: 8.25 },
        balanceAfter: 100008.25,
        removedSignalId: 'sig-123',
        lessonPending: true
      })
    }),
    getBackendWriterConfig: async () => ({ frontendEnabled: true, backendEnabled: true, atomicPreferred: true }),
    getEndpoint: (path) => `http://localhost${path}`
  });

  const result = await client.writeClosedTradeShadow({
    openPosition: createSampleOpenPosition(),
    signal: createSampleSignal(),
    exitContext: { price: 105 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.acceptAtomic, true);
  assert.equal(result.mode, 'atomic_preferred');
  assert.equal(result.body.balanceAfter, 100008.25);
  assert.equal(result.body.removedSignalId, 'sig-123');
});

test('client can refresh training demo state after atomic close', async () => {
  const client = createTrainingDemoWriterClient({
    fetchImpl: async (url, options) => {
      if (String(url).includes('/api/training/demo/state')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            available: true,
            state: {
              balance: 100008.25,
              positions: [],
              closedTrades: [{ signal_id: 'sig-123', strategy_id: 'trendMomentum', pnl_demo: 8.25 }],
              lessons: [],
              persistedAt: '2026-05-09T16:00:00.000Z'
            }
          })
        };
      }
      return {
        status: 200,
        json: async () => ({ ok: true })
      };
    },
    getEndpoint: (path) => `http://localhost${path}`
  });

  const result = await client.readTrainingDemoState();

  assert.equal(result.ok, true);
  assert.equal(result.state.balance, 100008.25);
  assert.equal(result.state.closedTrades[0].signal_id, 'sig-123');
});

test('client reports refresh failure without breaking fallback path', async () => {
  const client = createTrainingDemoWriterClient({
    fetchImpl: async () => { throw new Error('socket hang up'); },
    getEndpoint: (path) => `http://localhost${path}`
  });

  const result = await client.readTrainingDemoState();

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'network');
  assert.match(String(result.warning || ''), /refresh/i);
});
