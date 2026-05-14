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
  assert.match(indexHtml, /id="trainingStatus">ON</);
  assert.match(indexHtml, /id="trainingToggle"[^>]*>Autonomous</);
  assert.match(indexHtml, /id="dashboardTrainingRailStatus">Sincronizando</);
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
  const heroController = fs.readFileSync(path.join(repoRoot, 'src', 'modules', 'hero-controller.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(repoRoot, 'src', 'renderer.js'), 'utf8');

  assert.match(stateManager, /training:\s*\{\s*enabled:\s*true,/s);
  assert.match(stateManager, /reset:\s*\(\)\s*=>\s*\{[\s\S]*training\.enabled = true;/);
  assert.match(renderer, /await runSelfAudit\(\);\s*await updateHeroSection\(\);/);
  assert.match(renderer, /refreshTrainingLoopStatus\(\)/);
  assert.match(renderer, /window\.quantStateManager\.training\.locked = Boolean\(loopStatus\?\.active \|\| \(loopStatus\?\.enabled && loopStatus\?\.loopEnabled\)\);/);
  assert.match(heroController, /const autonomousTraining = Boolean\(window\.quantStateManager\.training\.locked\);/);
  assert.match(heroController, /el\.trainingStatus\.textContent = state\.training \? \(autonomousTraining \? 'ON · AUTONOMOUS' : 'ON'\) : 'OFF';/);
  assert.match(heroController, /el\.trainingToggle\.disabled = autonomousTraining;/);
  assert.match(heroController, /setToggleStateLabel:\s*\(button,\s*label\)\s*=>/);
  assert.match(heroController, /window\.heroController\.setToggleStateLabel\(el\.trainingToggle,\s*autonomousTraining/);
  assert.match(renderer, /if \(this\.training\.locked && !enable\)/);
  assert.match(renderer, /dashboardTrainingRailStatus', trainingRailStatus/);
  assert.match(renderer, /compactDashboardText\(lesson\.lesson \|\| lesson\.text \|\| 'Sin nota detallada\.', 92\)/);
  assert.doesNotMatch(
    renderer,
    /(?:\u00C3[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]|\u00E2[\u0080-\u00BF]{2}|\uFFFD)/,
    'renderer.js should not keep known mojibake in visible dashboard, chat, or manual trading copy'
  );
});

test('global shell chat dock supports compact desktop, collapsed tablet, and mobile overlay defaults', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'src', 'index.html'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(repoRoot, 'src', 'styles.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(repoRoot, 'src', 'renderer.js'), 'utf8');

  assert.match(indexHtml, /<section class="panel chat-dock" id="chatDock"/);
  assert.match(indexHtml, /id="chatDockToggle"/);
  assert.match(indexHtml, /id="chatDockCollapse"/);
  assert.match(indexHtml, /id="chatDockOverlay"/);
  assert.match(indexHtml, /id="chatDockBody"/);
  assert.match(indexHtml, /id="chatLog"/);
  assert.match(indexHtml, /id="chatInput"/);
  assert.match(indexHtml, /id="sendChat"/);
  assert.match(indexHtml, /id="chatContextPanel"/);

  assert.match(stylesCss, /\.app-shell--global\s+\.shell-content\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*clamp\(320px,\s*28vw,\s*380px\);/);
  assert.match(stylesCss, /\.chat-dock\[data-chat-state="compact"\]/);
  assert.match(stylesCss, /\.chat-dock\[data-chat-state="collapsed"\]/);
  assert.match(stylesCss, /\.chat-dock-overlay/);
  assert.match(stylesCss, /@media\s*\(max-width:\s*1220px\)[\s\S]*data-chat-state="collapsed"/);
  assert.match(stylesCss, /@media\s*\(max-width:\s*980px\)[\s\S]*position:\s*fixed/);

  assert.match(renderer, /const CHAT_DOCK_STORAGE_KEY = 'quant-global-chat-dock-state';/);
  assert.match(renderer, /function getDefaultChatDockState\(/);
  assert.match(renderer, /function applyChatDockState\(/);
  assert.match(renderer, /function setChatDockState\(/);
  assert.match(renderer, /window\.matchMedia\('\(max-width: 980px\)'\)/);
  assert.match(renderer, /window\.matchMedia\('\(max-width: 1220px\)'\)/);
  assert.match(renderer, /localStorage\.getItem\(CHAT_DOCK_STORAGE_KEY\)/);
  assert.match(renderer, /localStorage\.setItem\(CHAT_DOCK_STORAGE_KEY,\s*nextState\)/);
  assert.match(renderer, /\$\('chatDockToggle'\)\.addEventListener\('click',/);
  assert.match(renderer, /\$\('chatDockCollapse'\)\.addEventListener\('click',/);
});

test('legacy views inherit the purple shell wrappers, table surfaces, and generated row classes', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'src', 'index.html'), 'utf8');
  const stylesCss = fs.readFileSync(path.join(repoRoot, 'src', 'styles.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(repoRoot, 'src', 'renderer.js'), 'utf8');

  assert.match(indexHtml, /<section class="view legacy-shell-view" id="view-news">/);
  assert.match(indexHtml, /<section class="view legacy-shell-view" id="view-wallet">/);
  assert.match(indexHtml, /<section class="view legacy-shell-view" id="view-orders">/);
  assert.match(indexHtml, /<section class="view legacy-shell-view" id="view-positions">/);
  assert.match(indexHtml, /<section class="view legacy-shell-view" id="view-conversations">/);
  assert.match(indexHtml, /<section class="view legacy-shell-view" id="view-history">/);
  assert.match(indexHtml, /<section class="view legacy-shell-view" id="view-backtest">/);
  assert.match(indexHtml, /<section class="view legacy-shell-view" id="view-alerts">/);
  assert.match(indexHtml, /<section class="view legacy-shell-view" id="view-settings">/);

  assert.match(indexHtml, /class="view-head legacy-view-head"/);
  assert.match(indexHtml, /class="legacy-view-stack"/);
  assert.match(indexHtml, /class="panel full-panel legacy-panel"/);
  assert.match(indexHtml, /class="[^"]*shell-table shell-table--orders[^"]*"/);
  assert.match(indexHtml, /class="[^"]*shell-table shell-table--positions[^"]*"/);
  assert.match(indexHtml, /class="[^"]*shell-table shell-table--backtest[^"]*"/);
  assert.match(indexHtml, /class="[^"]*shell-table shell-table--alerts[^"]*"/);
  assert.match(indexHtml, /id="ordersTable" class="shell-table-body"/);
  assert.match(indexHtml, /id="mt5PositionsTable" class="shell-table-body"/);
  assert.match(indexHtml, /id="binanceOrdersTable" class="shell-table-body"/);
  assert.match(indexHtml, /id="backtestSymbolTable" class="shell-table-body"/);
  assert.match(indexHtml, /id="alertLogTable" class="shell-table-body"/);
  assert.match(indexHtml, /id="convList" class="legacy-list"/);
  assert.match(indexHtml, /id="alertTriggersGrid" class="legacy-form-grid legacy-form-grid--compact"/);
  assert.match(indexHtml, /id="settingsBox" class="settings-grid legacy-settings-grid"/);

  assert.match(stylesCss, /\.legacy-shell-view\b/);
  assert.match(stylesCss, /\.legacy-view-head\b/);
  assert.match(stylesCss, /\.legacy-view-stack\b/);
  assert.match(stylesCss, /\.legacy-panel\b/);
  assert.match(stylesCss, /\.shell-table\b/);
  assert.match(stylesCss, /\.shell-table-body\b/);
  assert.match(stylesCss, /\.shell-table-row\b/);
  assert.match(stylesCss, /\.legacy-list\b/);
  assert.match(stylesCss, /\.legacy-form-grid\b/);
  assert.match(stylesCss, /\.legacy-modal\b/);
  assert.match(stylesCss, /\.legacy-chip-grid\b/);

  assert.match(renderer, /walletRowClass = 'balance-row shell-table-row shell-table-row--wallet';/);
  assert.match(renderer, /class="shell-table-row shell-table-row--order"/);
  assert.match(renderer, /class="shell-table-row shell-table-row--mt5"/);
  assert.match(renderer, /class="shell-table-row shell-table-row--binance"/);
  assert.match(renderer, /class="shell-table-row shell-table-row--backtest"/);
  assert.match(renderer, /class="shell-table-row shell-table-row--alert"/);
  assert.match(renderer, /class="legacy-trigger-card"/);
  assert.match(renderer, /class="[^"]*legacy-conversation-card[^"]*"/);
});
