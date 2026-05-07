# Secret Rotation Checklist

The current workspace contains exposed secrets in `.env`. Rotate all of these before any production or VPS deployment:

- `BINANCE_API_KEY`
- `BINANCE_SECRET`
- `DEEPSEEK_API_KEY`
- `DEEPINFRA_API_KEY`
- `WEB_AUTH_PASSWORD`
- `FINNHUB_API_KEY`
- `ALPHA_VANTAGE_API_KEY`
- `MT5_ACCOUNT1_PASSWORD`
- `MT5_ACCOUNT2_PASSWORD`
- `QUANT_SYNC_KEY`

## Immediate actions
1. Revoke and reissue Binance API credentials.
2. Rotate AI provider keys.
3. Change web auth credentials.
4. Change sync key.
5. Update MT5 credentials if they are still valid.
6. Move secrets to VPS environment variables or a secret manager.
7. Keep `.env` out of future source control and deployment bundles.
