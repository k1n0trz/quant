# Global Shell Purple Refactor Design

## Goal

Convert the purple glass design system that was introduced as a temporary "Quant Lab" visual experiment into the single global frontend shell for Quant, without touching backend behavior, trading logic, scheduler logic, Binance integrations, or persisted training data.

## Scope

This refactor is frontend-only and keeps the current runtime model:

- One app
- One global shell
- Existing backend and endpoints unchanged
- Existing frontend logic preserved and reorganized

The outcome must remove the concept of "Quant Lab" as a separate product surface and make the dashboard the main executive workspace of Quant.

## Non-Goals

This phase will not:

- change backend routes or contracts
- add or remove endpoints
- modify Binance or real trading behavior
- modify scheduler behavior
- touch `quant_data` or persisted training state
- redesign business logic for training, charting, chat, or performance calculations

## Product Decisions

### Single Quant

The application must stop presenting:

- a legacy dashboard shell
- a separate `Quant Lab` view
- two visual systems coexisting

The user must enter a single product with one institutional shell.

### Global Shell

The permanent shell is:

- Left sidebar
- Top status bar
- Main content
- Right chat dock

Only the central content area changes per route/view.

### Navigation

Navigation remains explicit, but grouped visually:

- Core
  - Dashboard
  - Noticias & Macro
  - Training
- Execution
  - Ordenes
  - Posiciones
  - Wallets
- Analysis
  - Rendimiento
  - Backtesting
  - Conversaciones
- System
  - Alertas
  - Configuracion

The `Quant Lab` item, `v1` badges, and any textual references to "Quant Lab" are removed entirely.

### Chat Dock

The chat dock remains a permanent copilot, not the dominant interface element:

- Desktop: visible by default, compact width, expandable, collapsible
- Tablet: collapsible, collapsed by default
- Mobile: hidden by default, opens as overlay

### Dashboard Priority

Dashboard becomes the main executive workspace and must prioritize:

1. chart workspace
2. active pair context
3. key metrics
4. training and scheduler state
5. open positions summary
6. recent trades summary
7. recent lessons summary
8. strategy ranking and signal candidates as second-level context

## Architecture

### Shell Migration Strategy

Use a new global shell while keeping the same frontend runtime and bindings. Migrate views progressively inside that shell instead of attempting a frontend rewrite.

This means:

- keep `src/index.html` as the main entry
- preserve existing ids and JS bindings where practical
- replace shell-level structure and styling first
- rebuild Dashboard inside the new shell
- then adapt legacy views one by one

### Design System Promotion

The purple glass system currently scoped to the Lab view is promoted to the global design language:

- tokens
- surfaces
- borders
- typography
- spacing rhythm
- glass panel primitives
- compact KPI and hero primitives

The old shell visual rules stop being authoritative.

### Dashboard Composition

Dashboard will be reorganized into three clear levels:

#### Level 1: Executive Hero

Contains:

- balance
- equity
- overall engine state
- training ON/OFF
- scheduler active/inactive
- ticks run
- open positions count
- closed trades count
- active pair data
- last updated

#### Level 2: Main Workspace

Two-column layout:

- Primary column
  - chart
  - timeframes
  - tools
  - indicators
  - OHLC/context
- Operational rail
  - training/scheduler status
  - open positions compact summary
  - strategy ranking top 3-5
  - signal candidates top 3-5

#### Level 3: Compact Activity

- Recent Trades
  - max 5 items
  - compact feed rows
  - CTA to see more
- Recent Lessons
  - max 5 items
  - compact feed rows
  - CTA to open Training / see more
- Performance snapshot

### Legacy Views

Training, Rendimiento, Backtesting, Configuracion, and the remaining legacy views stay functionally intact but are visually adapted to the new shell and panel system.

The goal is not to rewrite those views in this phase, but to:

- normalize layout
- normalize headers
- normalize cards/tables/panels
- avoid visual leakage from a removed split-shell architecture

## Files Expected to Change

Primary frontend files:

- `src/index.html`
- `src/styles.css`
- `src/ui/tokens.css`
- `src/ui/lab.css`
- `src/renderer.js`

Frontend verification/tests:

- `tests/ui_entry.test.js`
- any existing frontend/static integration tests that assert shell or dashboard structure

## Removals

This phase explicitly removes:

- `Quant Lab` menu item
- `#view-lab`
- `v1` badges
- textual references to "Quant Lab"
- CSS coexistence rules whose only purpose was to support two shells

## Preservation Rules

This phase must preserve:

- backend contracts
- training behavior
- scheduler behavior
- chat behavior
- chart behavior
- trading real safeguards
- backend authority for training state

## Validation

### Functional Validation

The user must be able to:

1. open Quant
2. see the global purple institutional shell
3. load Dashboard as the main view
4. use chat normally
5. navigate to Training, Rendimiento, Backtesting, and Configuracion without layout breakage
6. refresh and confirm training remains ON from backend authority

### Dashboard Validation

Dashboard must visibly include:

- executive hero
- dominant chart workspace
- operational rail
- compact recent trades
- compact recent lessons

### Technical Validation

- frontend JS syntax checks on touched files
- `npm run test:backend` still passes because backend remains untouched
- existing route/view tests updated to assert:
  - no `Quant Lab` shell remains
  - dashboard loads in the new shell
  - required frontend assets still exist

## Rollback Strategy

Implementation will be split into small commits so rollback can happen at shell, dashboard, chat, or legacy-view adaptation boundaries.

If a migration step destabilizes the UI:

- revert the last frontend commit only
- keep backend unchanged
- preserve the current production-safe branch state

## Implementation Sequence

1. Introduce global purple shell and remove `Quant Lab` navigation identity
2. Remove `#view-lab` and promote design system globally
3. Rebuild Dashboard as the executive workspace
4. Add responsive chat dock behavior
5. Adapt legacy views to the new shell
