# Training Backend Loop v1

## Flag

- `TRAINING_BACKEND_LOOP_ENABLED=true`
- `TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED=true`
- `TRAINING_BACKEND_LOOP_INTERVAL_MS=60000`
- `TRAINING_BACKEND_DEMO_ENTRY_ENABLED=true`
- `TRAINING_BACKEND_DEMO_ENTRY_ALLOW_DEFENSIVE_SIGNAL=false`
- `TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED=false`

Default is `false`.

## Endpoint

- `POST /api/training/demo/tick`
- `GET /api/training/demo/context/status`
- `GET /api/training/demo/signals/candidates`
- `GET /api/training/demo/positions/open`
- `GET /api/training/demo/trades/recent`
- `GET /api/training/demo/lessons/recent`
- `GET /api/training/demo/performance/summary`
- `GET /api/training/demo/loop/status`
- `POST /api/training/demo/loop/start`
- `POST /api/training/demo/loop/stop`

Manual tick remains available, and the scheduler is now an explicit opt-in layer on top of the same backend close/evaluation flow.

## Request

Manual contexts:

```json
{
  "nowMs": 1778414400000,
  "positionContexts": [
    {
      "positionId": "pos-tick-1",
      "pair": {
        "symbol": "BTCUSDT",
        "venue": "BINANCE",
        "price": 105
      },
      "signal": {
        "bias": "LONG",
        "confidence": 70
      }
    }
  ]
}
```

Backend-built contexts:

```json
{
  "nowMs": 1778414400000
}
```

## What It Does

- Reads current training state
- Evaluates existing open demo positions
- Applies current close rules only
- Uses atomic backend close when a position should be closed
- Can open new demo positions from backend when `TRAINING_BACKEND_DEMO_ENTRY_ENABLED=true`
- Persists the next state only when at least one position is closed
- Accepts manual `positionContexts` when the caller provides them
- Builds backend `positionContexts` automatically when the request omits them
- Can run automatically on an interval after an explicit scheduler start
- Skips overlapping runs with `tick_in_progress`

## Backend Context Sources

- Price:
  - `getTicker(symbol)` when available
  - `readMt5Snapshot()` as read-only fallback for symbols present in the snapshot
  - last known `trainingState.activePairs[*].price` when recent enough
- Signal:
  - latest matching `training_signal` / `signal` / `observation` from memory
  - backend-generated signal candidates when `TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED=true`
  - if no reliable signal exists, a defensive signal is used with current position direction and `confidence=100`

## Missing Data Behavior

- Missing price: the position is skipped with `reason: "missing_price"`
- Stale last known price: marked `stale=true` and rejected by default with `reason: "stale_price"`
- Missing signal: the position is still evaluable with a defensive signal so hard-stop, profit-target, and time-exit remain available
- New demo entries reject defensive signals by default unless `TRAINING_BACKEND_DEMO_ENTRY_ALLOW_DEFENSIVE_SIGNAL=true`

## Backend Demo Entry Rules

- Demo entry stays disabled unless `TRAINING_BACKEND_DEMO_ENTRY_ENABLED=true`
- Uses the conservative frontend-equivalent professional gate
- Rejects duplicate open positions for the same `symbol` / `venue` / `horizon` / `strategy`
- Rejects cooldowned symbols
- Preserves `signal_id`, `strategy_id`, `strategy_name`, `horizon`, `source`, `confidence_at_entry`, `entry_price`, `opened_at`, and `traceability_version`

## Backend Signal Candidates

- Candidate generation stays disabled unless `TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED=true`
- Uses read-only backend context only
- Candidate fields include:
  - `signal_id`
  - `symbol`
  - `venue`
  - `bias`
  - `confidence`
  - `horizon`
  - `strategy_id`
  - `strategy_name`
  - `htfAlignmentScore`
  - `patternScore`
  - `volumeRatio`
  - `pairScore`
  - `source`
  - `reason_codes`
  - `generated_at`

## What It Does Not Do Yet

- No real trading
- No Binance trading actions or order creation
- No backend optimization of strategies
- No authority over real execution

## VPS Manual Test

1. Set `TRAINING_BACKEND_LOOP_ENABLED=true`.
2. Ensure `quant_training_state.json` contains at least one open demo position.
3. For manual mode, send `POST /api/training/demo/tick` with `positionContexts` carrying current price and signal data for the target position.
4. For backend mode, send `POST /api/training/demo/tick` with only `nowMs` or an empty JSON body.
5. If you want backend demo entries too, set `TRAINING_BACKEND_DEMO_ENTRY_ENABLED=true`.
6. Confirm response reports `contextSource`, `openedPositions`, `skippedEntries`, evaluated/closed/skipped counts, and updated balance.
7. Verify `GET /api/training/demo/state` reflects the persisted close or new demo entry when writes occur.

## VPS Context Diagnostics

1. Call `GET /api/training/demo/context/status`.
2. Inspect `positions[*].market.source` to see whether Quant is using `ticker`, `mt5_snapshot`, or `training_state_last_known`.
3. Inspect `positions[*].signal.source` to see whether Quant is using `memory_signal_id`, `memory_symbol_horizon`, `backend_signal_candidate`, or `defensive_fallback`.
4. If `positions[*].market.available=false`, review `reason` such as `missing_price` or `stale_price`.
5. Call `GET /api/training/demo/signals/candidates` to inspect backend-generated candidates by symbol.

## VPS Monitoring Dashboard API

1. Call `GET /api/training/demo/positions/open` to inspect current open demo positions from the persisted backend state.
2. Call `GET /api/training/demo/trades/recent` to inspect the most recent closed demo trades.
3. Call `GET /api/training/demo/lessons/recent` to inspect the latest persisted lessons.
4. Call `GET /api/training/demo/performance/summary` to inspect:
   - current `balance`
   - current `equity`
   - `openPositions`
   - `closedTrades`
   - `winRate`
   - `expectancy`
   - `profitFactor`
   - `maxDrawdown`
   - `schedulerStatus`
5. All monitoring endpoints are read-only and never write state or touch real trading.

## VPS Scheduler Test

1. Set `TRAINING_BACKEND_LOOP_ENABLED=true`.
2. Set `TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED=true`.
3. Optionally set `TRAINING_BACKEND_LOOP_INTERVAL_MS=15000` for faster validation.
4. Optionally set `TRAINING_BACKEND_DEMO_ENTRY_ENABLED=true` if you want the scheduler to open demo entries as well.
5. Start it with `POST /api/training/demo/loop/start`.
6. Inspect `GET /api/training/demo/loop/status` and verify:
   - `active=true`
   - `ticksRun` increases over time
   - `lastTickResult.realTradingTouched=false`
7. Stop it with `POST /api/training/demo/loop/stop`.
