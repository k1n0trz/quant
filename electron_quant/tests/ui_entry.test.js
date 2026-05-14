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
  const stylesPath = path.join(repoRoot, 'src', 'styles.css');
  const tokensPath = path.join(repoRoot, 'src', 'ui', 'tokens.css');
  const deadLabPaths = [
    path.join(repoRoot, 'src', 'ui', 'lab.css'),
    path.join(repoRoot, 'src', 'services', 'quant-lab-api.js'),
    path.join(repoRoot, 'src', 'views', 'quant-lab-hero.js'),
    path.join(repoRoot, 'src', 'views', 'quant-lab-panels.js')
  ];
  const indexBuffer = fs.readFileSync(indexPath);
  const indexHtml = indexBuffer.toString('utf8');
  const stylesCss = fs.readFileSync(stylesPath, 'utf8');
  const tokensCss = fs.readFileSync(tokensPath, 'utf8');

  assert.notEqual(indexBuffer[0], 0xef, 'index.html should not start with a UTF-8 BOM');
  assert.doesNotMatch(
    indexHtml,
    /(?:\uFFFD|\u00C3[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]|\u00E2[\u0080-\u00BF]{2}|\u00F0[\u0080-\u00BF]{2})/,
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
  assert.match(indexHtml, /class="dashboard-executive"/);
  assert.match(indexHtml, /class="[^"]*\bdashboard-hero\b/);
  assert.match(indexHtml, /class="[^"]*\bdashboard-workspace\b/);
  assert.match(indexHtml, /class="[^"]*\bdashboard-rail\b/);
  assert.match(indexHtml, /class="[^"]*\bdashboard-activity\b/);
  assert.match(indexHtml, /id="dashboardOpenPositions"/);
  assert.match(indexHtml, /id="dashboardStrategyRanking"/);
  assert.match(indexHtml, /id="dashboardSignalCandidates"/);
  assert.match(indexHtml, /id="dashboardRecentTrades"/);
  assert.match(indexHtml, /id="dashboardRecentLessons"/);
  assert.match(indexHtml, /id="dashboardPerformanceSnapshot"/);
  assert.doesNotMatch(indexHtml, /id="view-lab"/);
  assert.doesNotMatch(indexHtml, /<button class="nav-item[^"]*" data-view="lab">/);
  assert.doesNotMatch(indexHtml, /data-view="lab"/);
  assert.doesNotMatch(indexHtml, /Quant Lab|lab-badge|Purple workspace preview|>\s*v1\s*</i);
  assert.doesNotMatch(indexHtml, /#view-lab\.active/);
  assert.doesNotMatch(stylesCss, /#view-lab\.active/);
  assert.doesNotMatch(tokensCss, /#view-lab\.active/);
  assert.match(tokensCss, /Quant global design tokens/);
  assert.doesNotMatch(tokensCss, /--lab-/);
  assert.match(tokensCss, /--bg-base:\s*var\(--shell-bg-base\);/);
  assert.match(tokensCss, /--bg-surface:\s*var\(--shell-bg-surface\);/);
  assert.match(tokensCss, /--border-default:\s*var\(--shell-border\);/);
  assert.match(tokensCss, /--font-sans:\s*var\(--shell-font-sans\);/);
  assert.doesNotMatch(indexHtml, /<link rel="stylesheet" href="\.\/ui\/lab\.css"\s*\/?>/);
  assert.doesNotMatch(indexHtml, /<script src="\.\/services\/quant-lab-api\.js"><\/script>/);
  assert.doesNotMatch(indexHtml, /<script src="\.\/views\/quant-lab-hero\.js"><\/script>/);
  assert.doesNotMatch(indexHtml, /<script src="\.\/views\/quant-lab-panels\.js"><\/script>/);
  for (const deadLabPath of deadLabPaths) {
    assert.equal(
      fs.existsSync(deadLabPath),
      false,
      `${path.relative(repoRoot, deadLabPath)} should be removed after the global shell cleanup`
    );
  }
});

test('frontend defaults and boot path keep training on until backend sync wins', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const stateManager = fs.readFileSync(path.join(repoRoot, 'src', 'modules', 'state-manager.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(repoRoot, 'src', 'renderer.js'), 'utf8');

  assert.match(stateManager, /training:\s*\{\s*enabled:\s*true,/s);
  assert.match(stateManager, /reset:\s*\(\)\s*=>\s*\{[\s\S]*training\.enabled = true;/);
  assert.match(renderer, /await runSelfAudit\(\);\s*await updateHeroSection\(\);/);
  assert.match(renderer, /refreshTrainingLoopStatus\(\)/);
  assert.match(renderer, /dashboardTrainingRailStatus', trainingRailStatus/);
  assert.match(renderer, /compactDashboardText\(lesson\.lesson \|\| lesson\.text \|\| 'Sin nota detallada\.', 92\)/);
  assert.doesNotMatch(
    renderer,
    /(?:\u00C3[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]|\u00E2[\u0080-\u00BF]{2}|\uFFFD)/,
    'renderer.js should not keep known mojibake in visible dashboard, chat, or manual trading copy'
  );
});
