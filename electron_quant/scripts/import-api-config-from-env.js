#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const {
  ENV_ALIAS_KEYS,
  normalizeRuntimeEnv
} = require('../backend/config/env-normalization');

const API_FIELDS = [
  'BINANCE_API_KEY','BINANCE_SECRET','DEEPSEEK_API_KEY','DEEPINFRA_API_KEY',
  'DEFAULT_PROVIDER','QUANT_PRIMARY_MODEL','DEEPSEEK_MODEL','DEEPSEEK_BASE_URL',
  'DEEPINFRA_MODEL','DEEPINFRA_BASE_URL','FINNHUB_API_KEY','ALPHA_VANTAGE_API_KEY',
  'MT5_CONNECTOR_ENABLED','MT5_ACCOUNT1_LOGIN','MT5_ACCOUNT1_PASSWORD',
  'MT5_ACCOUNT1_SERVER','MT5_ACCOUNT2_LOGIN','MT5_ACCOUNT2_PASSWORD','MT5_ACCOUNT2_SERVER',
  'QUANT_SYNC_URL','QUANT_SYNC_KEY'
];

const PROCESS_KEYS = [...new Set(API_FIELDS.concat([
  'WEB_AUTH_EMAIL',
  'QUANT_DATA_DIR',
  ...ENV_ALIAS_KEYS
]))];

function parseArgs(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--root') out.root = argv[index + 1];
    if (item === '--email') out.email = argv[index + 1];
  }
  return out;
}

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean).map((candidate) => path.resolve(candidate)))];
}

function parseEnvFile(file) {
  const env = {};
  if (!file || !fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
  env.__ENV_FILE = file;
  return env;
}

function readRuntimeEnv(root) {
  const scriptRoot = path.resolve(__dirname, '..');
  const candidates = uniquePaths([
    path.join(root, '.env'),
    path.join(root, '..', '.env'),
    path.join(scriptRoot, '.env'),
    path.join(scriptRoot, '..', '.env'),
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '..', '.env')
  ]);
  const envFile = candidates.find((candidate) => fs.existsSync(candidate));
  const env = parseEnvFile(envFile);
  for (const key of PROCESS_KEYS) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return normalizeRuntimeEnv(env);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function resolveDataDir(env, root) {
  const configured = String(env.QUANT_DATA_DIR || '').trim();
  const base = env.__ENV_FILE ? path.dirname(env.__ENV_FILE) : root;
  if (!configured) return path.join(base, 'quant_data');
  return path.isAbsolute(configured) ? configured : path.resolve(base, configured);
}

function readStore(file) {
  if (!fs.existsSync(file)) return { users: {}, configs: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { users: parsed.users || {}, configs: parsed.configs || {} };
  } catch {
    return { users: {}, configs: {} };
  }
}

function writeStore(file, store) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    users: store.users || {},
    configs: store.configs || {},
    updatedAt: new Date().toISOString()
  }, null, 2), 'utf8');
}

function importApiConfigFromEnv(options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const env = readRuntimeEnv(root);
  const email = normalizeEmail(options.email || env.WEB_AUTH_EMAIL || 'kinotrance@gmail.com');
  const dataDir = resolveDataDir(env, root);
  const file = path.join(dataDir, 'user_api_config.json');
  const store = readStore(file);
  const current = { ...(store.configs[email] || {}) };
  const imported = [];

  for (const key of API_FIELDS) {
    const value = String(env[key] ?? '').trim();
    if (!value) continue;
    current[key] = value;
    imported.push(key);
  }

  store.configs[email] = current;
  writeStore(file, store);

  return {
    ok: true,
    user: email,
    file,
    importedCount: imported.length,
    imported
  };
}

if (require.main === module) {
  try {
    const result = importApiConfigFromEnv(parseArgs(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  importApiConfigFromEnv,
  readRuntimeEnv
};
