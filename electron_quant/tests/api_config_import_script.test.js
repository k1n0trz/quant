const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('import-api-config script writes user_api_config from env aliases without leaking secrets', () => {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-api-import-'));
  const envText = [
    'WEB_AUTH_EMAIL=ops@example.com',
    'QUANT_DATA_DIR=quant_data',
    'BINANCE_API_KEY=binance-key',
    'BINANCE_API_SECRET=binance-secret',
    'DEEPSEEK_KEY=deepseek-key',
    'FINNHUB_TOKEN=finnhub-key',
    'ALPHAVANTAGE_API_KEY=alpha-key',
    'MT5_ENABLED=true',
    'REAL_TRADING=true'
  ].join('\n');
  fs.writeFileSync(path.join(tmpRoot, '.env'), envText, 'utf8');

  const result = spawnSync(process.execPath, [
    path.join(repoRoot, 'scripts', 'import-api-config-from-env.js'),
    '--root',
    tmpRoot
  ], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /importedCount/);
  assert.doesNotMatch(result.stdout, /binance-secret|deepseek-key|finnhub-key|alpha-key/);

  const storeFile = path.join(tmpRoot, 'quant_data', 'user_api_config.json');
  const store = JSON.parse(fs.readFileSync(storeFile, 'utf8'));
  const cfg = store.configs['ops@example.com'];
  assert.equal(cfg.BINANCE_API_KEY, 'binance-key');
  assert.equal(cfg.BINANCE_SECRET, 'binance-secret');
  assert.equal(cfg.DEEPSEEK_API_KEY, 'deepseek-key');
  assert.equal(cfg.FINNHUB_API_KEY, 'finnhub-key');
  assert.equal(cfg.ALPHA_VANTAGE_API_KEY, 'alpha-key');
  assert.equal(cfg.MT5_CONNECTOR_ENABLED, 'true');
  assert.equal(Object.hasOwn(cfg, 'REAL_TRADING'), false);
});
