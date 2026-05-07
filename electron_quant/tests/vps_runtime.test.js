const test = require('node:test');
const assert = require('node:assert/strict');

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
