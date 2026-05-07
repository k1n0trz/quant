# Kill Switch Backend Integration

## Summary

- Kill Switch is now backed by official API endpoints.
- Frontend hero consumes backend state instead of relying on local-only behavior.
- Training remains independent when Kill Switch is active.
- Real trading remains blocked while `killSwitch=true`.

## Official endpoints

- `POST /api/bot/kill-switch/on`
- `POST /api/bot/kill-switch/off`

Both return the authoritative `BotState` object.

## Backend behavior

When Kill Switch is activated:

- `tradingRealEnabled` becomes `false`
- `paperMode` becomes `true`
- `trainingEnabled` is preserved
- backend real-order execution remains blocked

When Kill Switch is deactivated:

- `killSwitch` becomes `false`
- real trading stays disabled until explicitly re-enabled through `/api/bot/trading-real/on`

## VPS test commands

Log in first if web auth is enabled, then run:

```bash
curl -X POST http://127.0.0.1:47829/api/bot/kill-switch/on \
  -H 'Content-Type: application/json' \
  -b cookies.txt -c cookies.txt \
  -d '{}'
```

Expected result:

```json
{
  "tradingRealEnabled": false,
  "trainingEnabled": true,
  "killSwitch": true,
  "paperMode": true,
  "updatedAt": "..."
}
```

Verify status:

```bash
curl http://127.0.0.1:47829/api/status -b cookies.txt
```

Disable Kill Switch:

```bash
curl -X POST http://127.0.0.1:47829/api/bot/kill-switch/off \
  -H 'Content-Type: application/json' \
  -b cookies.txt -c cookies.txt \
  -d '{}'
```

## Local verification

```bash
cd electron_quant
npm run test:backend
node --check main.js
node --check src/renderer.js
node --check src/modules/state-manager.js
node --check src/modules/hero-controller.js
```
