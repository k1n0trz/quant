const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateTrainingPnl } = require('../backend/training/training-closure-service');

test('training close PnL remains unchanged by shadow-writer transition', () => {
  const result = calculateTrainingPnl({
    direction: 'LONG',
    entry_price: 100,
    size_demo: 2,
    fees_simuladas: 1,
    spread_estimado: 0.5,
    slippage_estimado: 0.25
  }, {
    price: 105
  });

  assert.equal(result.price, 105);
  assert.equal(result.pnl, 8.25);
});

test('renderer threshold contract remains unchanged for close logic', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const renderer = readFileSync(join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

  assert.match(renderer, /signal\.confidence >= 74/);
  assert.match(renderer, /signal\.confidence < 55/);
  assert.match(renderer, /-0\.018 : -0\.009/);
  assert.match(renderer, /0\.035 : 0\.012/);
});

test('renderer preserves explicit backend atomic preferred opt-in and fallback paths', () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const renderer = readFileSync(join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
  const client = readFileSync(join(__dirname, '..', 'src', 'services', 'training-demo-writer-client.js'), 'utf8');

  assert.match(client, /trainingDemoBackendAtomicPreferred/);
  assert.match(renderer, /backendCloseResult && backendCloseResult\.acceptAtomic/);
  assert.match(renderer, /Training backend writer: atomic close aceptado/);
  assert.match(renderer, /refreshTrainingStateAfterAtomicClose/);
  assert.match(renderer, /Training backend writer: estado refrescado desde backend/);
  assert.match(renderer, /training-demo-state refresh failed|training-demo-state refresh unavailable/);
  assert.match(renderer, /await saveTrainingState\(\)/);
});
