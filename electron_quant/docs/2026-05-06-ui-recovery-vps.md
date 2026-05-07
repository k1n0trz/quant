# UI Recovery for VPS

## Summary

- Web/VPS root (`/`) now serves the full Quant UI from `src/index.html`.
- Temporary rollback remains available at `/lite` and `/?ui=lite`.
- `public/login.html` remains the login entrypoint at `/login`.
- Backend API routes and trading logic were not changed.

## Files changed

- `main.js`
- `src/config.js`
- `backend/server/ui-entry.js`
- `tests/ui_entry.test.js`
- `package.json`

## Rollback

If the full UI presents issues after deployment, use either:

- `http://<host>/lite`
- `http://<host>/?ui=lite`

This serves `public/index.html` without changing PM2, Nginx, or backend logic.

## Local test

```bash
cd electron_quant
npm run test:backend
node --check main.js
npm run start:backend
```

Then verify:

- `http://127.0.0.1:47829/healthz`
- `http://127.0.0.1:47829/`
- `http://127.0.0.1:47829/lite`

## VPS deploy

After pulling the latest repo version in the VPS:

```bash
cd /opt/quant/quant/electron_quant
npm install
npm run test:backend
pm2 restart quant-backend
curl http://127.0.0.1:47829/healthz
```

Then open:

- `http://37.60.227.190/` for the full UI
- `http://37.60.227.190/lite` for rollback
