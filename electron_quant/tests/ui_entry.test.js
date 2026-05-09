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

test('full UI exposes the unified shell without legacy lab runtime coupling', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const indexPath = path.join(repoRoot, 'src', 'index.html');
  const indexBuffer = fs.readFileSync(indexPath);
  const indexHtml = indexBuffer.toString('utf8');

  assert.notEqual(indexBuffer[0], 0xef, 'index.html should not start with a UTF-8 BOM');
  assert.doesNotMatch(
    indexHtml,
    /â€”|â€“|â€|â†|âŒ|â—|âš|âŸ|â¬|Ã[\u0080-\u00bf]|Â·|ðŸ|Ã°|Ãƒ|âˆ’/,
    'index.html should not contain common mojibake sequences'
  );

  assert.match(indexHtml, /class="app-shell app-shell--global"/);
  assert.match(indexHtml, /class="sidebar shell-sidebar"/);
  assert.match(indexHtml, /class="topbar shell-topbar"/);
  assert.match(indexHtml, /class="content shell-content"/);
  assert.match(indexHtml, /<nav class="nav nav--grouped" id="nav">/);
  assert.match(indexHtml, /data-nav-group="core"/);
  assert.match(indexHtml, /data-nav-group="execution"/);
  assert.match(indexHtml, /data-nav-group="analysis"/);
  assert.match(indexHtml, /data-nav-group="system"/);
  assert.match(indexHtml, /<button class="nav-item active" data-view="dashboard">/);
  assert.match(indexHtml, /<section class="view active" id="view-dashboard">/);
  assert.doesNotMatch(indexHtml, /<button class="nav-item[^"]*" data-view="lab">/);
  assert.doesNotMatch(indexHtml, /data-view="lab"/);
  assert.doesNotMatch(indexHtml, /Quant Lab|lab-badge|Purple workspace preview/i);
  assert.ok(fs.existsSync(path.join(repoRoot, 'src', 'ui', 'tokens.css')));
  assert.ok(fs.existsSync(path.join(repoRoot, 'src', 'ui', 'lab.css')));
  assert.doesNotMatch(indexHtml, /<script src="\.\/services\/quant-lab-api\.js"><\/script>/);
  assert.doesNotMatch(indexHtml, /<script src="\.\/views\/quant-lab-hero\.js"><\/script>/);
  assert.doesNotMatch(indexHtml, /<script src="\.\/views\/quant-lab-panels\.js"><\/script>/);
});

test('frontend defaults and boot path keep training on until backend sync wins', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const stateManager = fs.readFileSync(path.join(repoRoot, 'src', 'modules', 'state-manager.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(repoRoot, 'src', 'renderer.js'), 'utf8');

  assert.match(stateManager, /training:\s*\{\s*enabled:\s*true,/s);
  assert.match(stateManager, /reset:\s*\(\)\s*=>\s*\{[\s\S]*training\.enabled = true;/);
  assert.match(renderer, /await runSelfAudit\(\);\s*await updateHeroSection\(\);/);
});
