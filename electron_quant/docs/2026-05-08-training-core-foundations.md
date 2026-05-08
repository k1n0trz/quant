# Quant-Core Training Foundations

Date: 2026-05-08

## Scope

This phase creates backend-side foundations for autonomous training without moving the live renderer loops yet.

Implemented:
- `backend/training/training-state.js`
- `backend/training/metrics-engine.js`
- `backend/training/strategy-registry.js`
- `backend/training/strategy-runner.js`
- `tests/training_state.test.js`
- `tests/training_metrics.test.js`

Not activated:
- No backend scheduler.
- No backend training writes.
- No renderer loop removal.
- No PM2 runtime change.
- No Binance real trading.
- No MT5 execution.
- No `quant_data` migration.

## Safety Defaults

Backend training is explicit opt-in through:

```env
TRAINING_BACKEND_ENABLED=true
```

The default remains disabled. The new modules are read-compatible and shadow-mode ready.

## Validation

Local and VPS validation command:

```bash
cd /opt/quant/quant/electron_quant
npm run test:backend
```

Expected:
- backend state tests pass
- backend route tests pass
- training state tests pass
- training metrics tests pass
- existing static/runtime/UI tests pass

## Migration Rule

Until a later phase moves the engine:
- renderer may still run existing training loops
- backend modules may compute state/metrics in isolation
- frontend remains visual client in the target architecture
- `quant_data` must not be moved or rewritten without a snapshot
