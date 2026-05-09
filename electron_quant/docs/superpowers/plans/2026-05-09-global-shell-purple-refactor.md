# Global Shell Purple Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split legacy shell plus temporary Quant Lab presentation with one global purple shell, remove Quant Lab as a functional entity, rebuild Dashboard as the executive workspace, then adapt chat and legacy views without touching backend behavior.

**Architecture:** Keep the existing frontend runtime, DOM bindings, and backend contracts, but replace the shell-level layout and visual primitives first. Promote the purple glass design system to global scope, then rebuild Dashboard inside that shell and adapt the remaining views progressively so every route lives under one unified UI system.

**Tech Stack:** Static HTML/CSS/JS frontend in `src/`, existing renderer runtime in `src/renderer.js`, backend verification via Node tests only, no backend/API changes.

---

### Task 1: Create the global shell foundation and remove Quant Lab navigation identity

**Files:**
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Modify: `src/ui/tokens.css`
- Modify: `src/ui/lab.css`
- Test: `tests/ui_entry.test.js`

- [ ] **Step 1: Write the failing structure assertions for the new shell**

```js
test('full UI exposes the unified Quant shell without Quant Lab navigation', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'src', 'index.html'), 'utf8');

  assert.match(indexHtml, /data-nav-group="core"/);
  assert.match(indexHtml, /data-nav-group="execution"/);
  assert.match(indexHtml, /data-nav-group="analysis"/);
  assert.match(indexHtml, /data-nav-group="system"/);
  assert.doesNotMatch(indexHtml, /data-view="lab"/);
  assert.doesNotMatch(indexHtml, /Quant Lab/);
});
```

- [ ] **Step 2: Run the focused UI entry test and verify it fails**

Run: `node tests/ui_entry.test.js`
Expected: FAIL because the current UI still contains the Quant Lab nav item and old navigation grouping is missing.

- [ ] **Step 3: Replace the shell-level navigation/header scaffolding in `src/index.html`**

```html
<div class="app-shell app-shell--global">
  <aside class="sidebar shell-sidebar">
    <div class="brand brand--global">...</div>

    <nav class="nav nav--grouped" id="nav">
      <section class="nav-group" data-nav-group="core">
        <div class="nav-group-label">Core</div>
        <button class="nav-item active" data-view="dashboard">Dashboard</button>
        <button class="nav-item" data-view="news">Noticias & Macro</button>
        <button class="nav-item" data-view="training">Training</button>
      </section>

      <section class="nav-group" data-nav-group="execution">
        <div class="nav-group-label">Execution</div>
        <button class="nav-item" data-view="orders">Ordenes</button>
        <button class="nav-item" data-view="positions">Posiciones</button>
        <button class="nav-item" data-view="wallet">Wallets</button>
      </section>

      <section class="nav-group" data-nav-group="analysis">
        <div class="nav-group-label">Analysis</div>
        <button class="nav-item" data-view="history">Rendimiento</button>
        <button class="nav-item" data-view="backtest">Backtesting</button>
        <button class="nav-item" data-view="conversations">Conversaciones</button>
      </section>

      <section class="nav-group" data-nav-group="system">
        <div class="nav-group-label">System</div>
        <button class="nav-item" data-view="alerts">Alertas</button>
        <button class="nav-item" data-view="settings">Configuracion</button>
      </section>
    </nav>
  </aside>

  <header class="topbar shell-topbar">...</header>
  <main class="content shell-content">...</main>
</div>
```

- [ ] **Step 4: Promote the purple shell base styles into the global shell**

```css
.app-shell--global {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 360px;
  grid-template-rows: 72px minmax(0, 1fr);
  background:
    radial-gradient(1100px 600px at 18% -8%, rgba(139, 92, 246, 0.18), transparent 60%),
    radial-gradient(900px 500px at 100% 110%, rgba(168, 85, 247, 0.10), transparent 55%),
    #050816;
  color: var(--lab-text);
}

.shell-sidebar,
.shell-topbar,
.chat-dock {
  background: linear-gradient(180deg, rgba(17,24,39,0.62), rgba(11,16,32,0.62));
  border: 1px solid var(--lab-border);
  box-shadow: var(--lab-shadow-card);
}
```

- [ ] **Step 5: Run the focused UI entry test and verify it passes**

Run: `node tests/ui_entry.test.js`
Expected: PASS with the Quant Lab nav references removed and grouped navigation present.

- [ ] **Step 6: Commit**

```bash
git add src/index.html src/styles.css src/ui/tokens.css src/ui/lab.css tests/ui_entry.test.js
git commit -m "refactor: introduce global purple shell and remove quant lab entry"
```

### Task 2: Remove the standalone Lab view and promote the design system globally

**Files:**
- Modify: `src/index.html`
- Modify: `src/ui/tokens.css`
- Modify: `src/ui/lab.css`
- Test: `tests/ui_entry.test.js`

- [ ] **Step 1: Write the failing test for standalone Lab removal**

```js
test('full UI no longer contains a standalone lab view shell', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'src', 'index.html'), 'utf8');

  assert.doesNotMatch(indexHtml, /id="view-lab"/);
  assert.doesNotMatch(indexHtml, /\.lab-shell/);
});
```

- [ ] **Step 2: Run the UI entry test and verify it fails**

Run: `node tests/ui_entry.test.js`
Expected: FAIL because `#view-lab` and `.lab-shell` references still exist.

- [ ] **Step 3: Remove `#view-lab` and merge reusable primitives back into the main shell**

```html
<!-- Remove -->
<section class="view lab-shell" id="view-lab">...</section>

<!-- Keep dashboard and legacy views under the main content area only -->
<section class="view active" id="view-dashboard">...</section>
<section class="view" id="view-training">...</section>
```

- [ ] **Step 4: Replace scoped `.lab-shell` token usage with global root or shell-scoped variables**

```css
:root {
  --bg-base: #050816;
  --bg-surface: #0B1020;
  --purple: #8B5CF6;
  --lab-border: rgba(139, 92, 246, 0.18);
  --lab-text: #F8FAFC;
  --lab-shadow-card:
    0 1px 0 rgba(255,255,255,0.03) inset,
    0 8px 28px -12px rgba(0,0,0,0.7),
    0 0 0 1px rgba(139, 92, 246, 0.04);
}

.panel--glass,
.shell-sidebar,
.shell-topbar,
.chat-dock {
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(17,24,39,0.62), rgba(11,16,32,0.62));
  border: 1px solid var(--lab-border);
}
```

- [ ] **Step 5: Remove coexistence CSS that hides topbar/chat when Lab is active**

```css
/* Delete patterns like these entirely */
.app-shell:has(#view-lab.active) > .topbar { display: none; }
.app-shell:has(#view-lab.active) > .content > .chat-dock { display: none; }
.app-shell:has(#view-lab.active) #view-lab { padding: 0; }
```

- [ ] **Step 6: Re-run the UI entry test and verify it passes**

Run: `node tests/ui_entry.test.js`
Expected: PASS with no standalone Lab view and no split-shell artifacts in the main entry file.

- [ ] **Step 7: Commit**

```bash
git add src/index.html src/ui/tokens.css src/ui/lab.css tests/ui_entry.test.js
git commit -m "refactor: remove standalone lab view and normalize global design tokens"
```

### Task 3: Rebuild Dashboard as the executive workspace

**Files:**
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Modify: `src/ui/lab.css`
- Modify: `src/renderer.js`
- Test: `tests/ui_entry.test.js`
- Test: `tests/training_demo_shadow_integration.test.js`

- [ ] **Step 1: Add failing dashboard structure assertions**

```js
test('dashboard exposes executive hero, chart workspace, operational rail, and compact activity feeds', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'src', 'index.html'), 'utf8');

  assert.match(indexHtml, /data-dashboard-zone="hero"/);
  assert.match(indexHtml, /data-dashboard-zone="workspace"/);
  assert.match(indexHtml, /data-dashboard-zone="rail"/);
  assert.match(indexHtml, /data-dashboard-zone="activity"/);
  assert.match(indexHtml, /data-feed="recent-trades"/);
  assert.match(indexHtml, /data-feed="recent-lessons"/);
});
```

- [ ] **Step 2: Run the UI entry test and verify it fails**

Run: `node tests/ui_entry.test.js`
Expected: FAIL because the current dashboard is still the legacy layout.

- [ ] **Step 3: Recompose the Dashboard HTML into hero, workspace, rail, and activity**

```html
<section class="view active dashboard-view" id="view-dashboard">
  <section class="dashboard-hero" data-dashboard-zone="hero">...</section>

  <section class="dashboard-workspace" data-dashboard-zone="workspace">
    <div class="dashboard-chart-column">
      <section class="panel panel--glass chart-panel">...</section>
    </div>

    <aside class="dashboard-rail" data-dashboard-zone="rail">
      <section class="panel panel--glass training-status-card">...</section>
      <section class="panel panel--glass open-positions-card">...</section>
      <section class="panel panel--glass strategy-ranking-card">...</section>
      <section class="panel panel--glass signal-candidates-card">...</section>
    </aside>
  </section>

  <section class="dashboard-activity" data-dashboard-zone="activity">
    <section class="panel panel--glass" data-feed="recent-trades">...</section>
    <section class="panel panel--glass" data-feed="recent-lessons">...</section>
    <section class="panel panel--glass performance-snapshot-card">...</section>
  </section>
</section>
```

- [ ] **Step 4: Limit recent activity panels to compact executive feeds**

```js
function summarizeRecentTrades(trades) {
  return (Array.isArray(trades) ? trades : []).slice(0, 5);
}

function summarizeRecentLessons(lessons) {
  return (Array.isArray(lessons) ? lessons : []).slice(0, 5);
}
```

- [ ] **Step 5: Preserve training/backend authority behavior while reorganizing dashboard render paths**

```js
test('renderer training authority and backend refresh path remain intact after dashboard refactor', () => {
  const renderer = fs.readFileSync(path.join(repoRoot, 'src', 'renderer.js'), 'utf8');

  assert.match(renderer, /await updateHeroSection\(\);/);
  assert.match(renderer, /statusData\.bot\.trainingEnabled/);
});
```

- [ ] **Step 6: Run the focused tests and verify they pass**

Run: `node tests/ui_entry.test.js`
Expected: PASS

Run: `node tests/training_demo_shadow_integration.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/index.html src/styles.css src/ui/lab.css src/renderer.js tests/ui_entry.test.js tests/training_demo_shadow_integration.test.js
git commit -m "feat: rebuild dashboard as primary executive workspace"
```

### Task 4: Add responsive chat dock behavior

**Files:**
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Modify: `src/ui/lab.css`
- Modify: `src/renderer.js`

- [ ] **Step 1: Add the chat shell controls markup**

```html
<section class="panel chat-dock chat-dock--compact" id="chatDock">
  <div class="chat-dock-head">
    <button id="chatDockToggle">Toggle</button>
    <button id="chatDockExpand">Expand</button>
  </div>
</section>
```

- [ ] **Step 2: Add responsive chat dock states**

```css
.chat-dock { width: 340px; }
.chat-dock--compact { width: 340px; }
.chat-dock--expanded { width: 420px; }
.chat-dock--collapsed { width: 72px; }

@media (max-width: 1180px) {
  .chat-dock { width: 72px; }
}

@media (max-width: 860px) {
  .chat-dock {
    position: fixed;
    inset: 72px 12px 12px auto;
    transform: translateX(110%);
  }
  .chat-dock.is-open { transform: translateX(0); }
}
```

- [ ] **Step 3: Add renderer state handlers without changing chat logic**

```js
const chatDockState = { expanded: false, collapsed: false, mobileOpen: false };

function applyChatDockState() {
  const dock = $('chatDock');
  if (!dock) return;
  dock.classList.toggle('chat-dock--expanded', chatDockState.expanded);
  dock.classList.toggle('chat-dock--collapsed', chatDockState.collapsed);
  dock.classList.toggle('is-open', chatDockState.mobileOpen);
}
```

- [ ] **Step 4: Run syntax checks on touched frontend JS**

Run: `node --check src/renderer.js`
Expected: no output

- [ ] **Step 5: Commit**

```bash
git add src/index.html src/styles.css src/ui/lab.css src/renderer.js
git commit -m "feat: add responsive chat dock behavior to global shell"
```

### Task 5: Adapt legacy views to the new shell design system

**Files:**
- Modify: `src/index.html`
- Modify: `src/styles.css`
- Modify: `src/ui/lab.css`
- Modify: `src/renderer.js` (only if a layout hook needs retargeting)
- Test: `tests/ui_entry.test.js`

- [ ] **Step 1: Add a high-level assertion that legacy views remain mounted under the unified shell**

```js
test('legacy operational views remain available under the unified shell', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const indexHtml = fs.readFileSync(path.join(repoRoot, 'src', 'index.html'), 'utf8');

  assert.match(indexHtml, /id="view-training"/);
  assert.match(indexHtml, /id="view-history"/);
  assert.match(indexHtml, /id="view-backtest"/);
  assert.match(indexHtml, /id="view-settings"/);
});
```

- [ ] **Step 2: Normalize view wrappers and panel headers**

```html
<section class="view shell-view" id="view-training">
  <div class="view-head">...</div>
  <div class="view-grid view-grid--training">...</div>
</section>
```

- [ ] **Step 3: Normalize reusable panel and table styling across legacy views**

```css
.shell-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.view-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.view-grid {
  display: grid;
  gap: 16px;
}
```

- [ ] **Step 4: Re-run syntax and UI entry tests**

Run: `node --check src/renderer.js`
Expected: no output

Run: `node tests/ui_entry.test.js`
Expected: PASS

- [ ] **Step 5: Run backend verification to ensure backend remained untouched**

Run: `npm run test:backend`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/index.html src/styles.css src/ui/lab.css src/renderer.js tests/ui_entry.test.js
git commit -m "refactor: adapt legacy views to global shell design system"
```

## Self-Review

Spec coverage:

- Shell unification: covered by Tasks 1 and 2
- Quant Lab removal: covered by Tasks 1 and 2
- Executive dashboard rebuild: covered by Task 3
- Chat dock permanence and responsiveness: covered by Task 4
- Legacy view adaptation: covered by Task 5
- Backend untouched validation: covered by Task 5 and repeated backend test pass

Placeholder scan:

- No `TBD`, `TODO`, or deferred placeholders remain in the plan tasks
- Each task includes explicit files, commands, and intended code structure

Type consistency:

- Uses the same frontend file paths throughout
- Uses stable ids and dashboard/data attributes consistently across Tasks 1-5
- Keeps `src/renderer.js` as the only JS coordination file for shell state changes
