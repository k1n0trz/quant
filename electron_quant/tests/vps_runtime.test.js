const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { resolveListenHost } = require('../backend/config/runtime');

test('headless backend defaults to 127.0.0.1 for VPS deployments', () => {
  const host = resolveListenHost({
    isElectron: false,
    env: {}
  });
  assert.equal(host, '127.0.0.1');
});

test('cloud-style runtime can still bind to 0.0.0.0 when PORT is injected', () => {
  const host = resolveListenHost({
    isElectron: false,
    env: { PORT: '8080' }
  });
  assert.equal(host, '0.0.0.0');
});

test('explicit QUANT_WEB_HOST overrides defaults', () => {
  const host = resolveListenHost({
    isElectron: false,
    env: { QUANT_WEB_HOST: '0.0.0.0' }
  });
  assert.equal(host, '0.0.0.0');
});

test('cloud runtime wiring keeps training loop flags available to the web backend', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  assert.match(mainSource, /TRAINING_BACKEND_LOOP_ENABLED/);
  assert.match(mainSource, /TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED/);
  assert.match(mainSource, /TRAINING_BACKEND_DEMO_ENTRY_ENABLED/);
  assert.match(mainSource, /TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED/);
});

test('training loop autostart reads snapshots from the read-only training state reader', () => {
  const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  assert.match(
    mainSource,
    /readTrainingStateSnapshot:\s*\(\)\s*=>\s*trainingStateReader\.readSnapshot\(\)/
  );
});
