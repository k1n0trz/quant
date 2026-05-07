const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveUiEntry } = require('../backend/server/ui-entry');

test('root path resolves to the full src UI', () => {
  const result = resolveUiEntry({
    pathname: '/',
    searchParams: new URLSearchParams()
  });

  assert.equal(result.root, 'src');
  assert.equal(result.file, 'index.html');
  assert.equal(result.mode, 'full');
});

test('lite path resolves to the rollback public UI', () => {
  const result = resolveUiEntry({
    pathname: '/lite',
    searchParams: new URLSearchParams()
  });

  assert.equal(result.root, 'public');
  assert.equal(result.file, 'index.html');
  assert.equal(result.mode, 'lite');
});

test('ui=lite query preserves rollback without changing other routes', () => {
  const result = resolveUiEntry({
    pathname: '/',
    searchParams: new URLSearchParams('ui=lite')
  });

  assert.equal(result.root, 'public');
  assert.equal(result.file, 'index.html');
  assert.equal(result.mode, 'lite');
});
