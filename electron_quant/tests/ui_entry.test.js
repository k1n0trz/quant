const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

test('full UI exposes the unified Quant shell without Quant Lab navigation', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'src', 'index.html'), 'utf8');

  assert.match(indexHtml, /data-nav-group="core"/);
  assert.match(indexHtml, /data-nav-group="execution"/);
  assert.match(indexHtml, /data-nav-group="analysis"/);
  assert.match(indexHtml, /data-nav-group="system"/);
  assert.doesNotMatch(indexHtml, /data-view="lab"/);
  assert.doesNotMatch(indexHtml, /Quant Lab/);
  assert.ok(fs.existsSync(path.join(repoRoot, 'src', 'ui', 'tokens.css')));
  assert.ok(fs.existsSync(path.join(repoRoot, 'src', 'ui', 'lab.css')));
  assert.ok(fs.existsSync(path.join(repoRoot, 'src', 'services', 'quant-lab-api.js')));
  assert.ok(fs.existsSync(path.join(repoRoot, 'src', 'views', 'quant-lab-hero.js')));
  assert.ok(fs.existsSync(path.join(repoRoot, 'src', 'views', 'quant-lab-panels.js')));
});

test('frontend defaults and boot path keep training on until backend sync wins', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const stateManager = fs.readFileSync(path.join(repoRoot, 'src', 'modules', 'state-manager.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(repoRoot, 'src', 'renderer.js'), 'utf8');

  assert.match(stateManager, /training:\s*\{\s*enabled:\s*true,/s);
  assert.match(stateManager, /reset:\s*\(\)\s*=>\s*\{[\s\S]*training\.enabled = true;/);
  assert.match(renderer, /await runSelfAudit\(\);\s*await updateHeroSection\(\);/);
});
