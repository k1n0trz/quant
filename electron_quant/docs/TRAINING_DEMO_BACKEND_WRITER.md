# Training Demo Backend Writer

## Flags

- Backend writer:
  - `TRAINING_BACKEND_WRITER_ENABLED=true`
- Frontend shadow write:
  - `window.quantConfig.trainingDemoBackendWriterShadow = true`
  - or `window.QUANT_TRAINING_DEMO_BACKEND_WRITER_SHADOW = 'true'`
  - or `localStorage['quant.trainingDemoBackendWriterShadow']='true'`
- Frontend atomic preferred:
  - `window.quantConfig.trainingDemoBackendAtomicPreferred = true`
  - or `window.QUANT_TRAINING_DEMO_BACKEND_ATOMIC_PREFERRED = 'true'`
  - or `localStorage['quant.trainingDemoBackendAtomicPreferred']='true'`

## Modes

- Default:
  - Legacy renderer close only.
- Shadow:
  - Renderer calls backend writer, but still completes local legacy close and local persistence.
- Atomic preferred:
  - Renderer accepts backend atomic close on `200`, refreshes backend training state, and skips duplicate local close persistence for that trade.

## Remaining Risks

- Backend is still optional, not global authority.
- Legacy fallback remains active by design.
- `lessonPending` can still appear until backend lesson generation fully matches renderer logic.

## VPS Quick Test

1. Set `TRAINING_BACKEND_WRITER_ENABLED=true` on the backend service.
2. Enable frontend shadow write.
3. Optionally enable frontend atomic preferred.
4. Trigger a demo close in Training.
5. Verify logs:
   - Shadow mode: `shadow write registrado`
   - Atomic preferred: `atomic close aceptado` and `estado refrescado desde backend`
6. If backend is unavailable, verify fallback continues and dashboard stays usable.
