// ── Electron / headless detection ────────────────────────────────────────────
const IS_ELECTRON = Boolean(process.versions?.electron);
let app, BrowserWindow, ipcMain, dialog;
if (IS_ELECTRON) {
  ({ app, BrowserWindow, ipcMain, dialog } = require('electron'));
} else {
  // Stubs para modo web/cloud (node main.js)
  ipcMain = { handle: () => {} };
  dialog  = { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) };
  app     = {
    getAppPath: () => __dirname,
    whenReady: () => ({ then: () => {}, catch: () => {} }),
    on: () => {},
    quit: () => process.exit(0)
  };
  BrowserWindow = { getAllWindows: () => [], getFocusedWindow: () => null };
}
const path = require('node:path');
const fs = require('node:fs');
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createLogger } = require('./backend/logging/logger');
const { ENV_EXAMPLE } = require('./backend/config/env');
const { resolveListenHost } = require('./backend/config/runtime');
const { resolveUiEntry } = require('./backend/server/ui-entry');
const { createJsonStore } = require('./backend/memory/json-store');
const { createDefaultBotState, mergeBotState } = require('./backend/services/bot-state-service');
const { createDefaultRiskConfig, assertTradingRealCanBeEnabled, validateRiskConfig } = require('./backend/risk/risk-policy');
const { createApiRouter } = require('./backend/routes/api-router');
const { createReadOnlyTrainingStateReader } = require('./backend/training/training-state');
const { normalizeTrainingStateTraceability } = require('./backend/training/training-traceability');
const { autoStartTrainingDemoLoopScheduler } = require('./backend/training/training-loop-autostart');

const BINANCE_BASE = 'https://api.binance.com';
let timeOffsetMs = 0;
let trainingLoopAutoStartAttempted = false;
const logger = createLogger(IS_ELECTRON ? 'quant-desktop' : 'quant-backend');
const DEFAULT_VPS_PUBLIC_IP = '37.60.227.190';
const CLOUD_ENV_KEYS = [
  'BINANCE_API_KEY','BINANCE_SECRET','DEEPSEEK_API_KEY','DEEPINFRA_API_KEY',
  'FINNHUB_API_KEY','ALPHA_VANTAGE_API_KEY','REAL_TRADING','MT5_CONNECTOR_ENABLED',
  'MT5_ACCOUNT1_LOGIN','MT5_ACCOUNT1_PASSWORD','MT5_ACCOUNT1_SERVER',
  'MT5_ACCOUNT2_LOGIN','MT5_ACCOUNT2_PASSWORD','MT5_ACCOUNT2_SERVER',
  'WEB_AUTH_ENABLED','WEB_AUTH_EMAIL','WEB_AUTH_PASSWORD',
  'TRAINING_BACKEND_WRITER_ENABLED',
  'TRAINING_BACKEND_ENABLED','TRAINING_BACKEND_LOOP_ENABLED',
  'TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED','TRAINING_BACKEND_LOOP_INTERVAL_MS',
  'TRAINING_BACKEND_DEMO_ENTRY_ENABLED','TRAINING_BACKEND_SIGNAL_CANDIDATES_ENABLED',
  'QUANT_WEB_PORT','QUANT_WEB_HOST','QUANT_DATA_DIR','QUANT_SYNC_URL','QUANT_SYNC_KEY',
  'QUANT_VPS_PUBLIC_IP',
  'QUANT_DESKTOP_DOWNLOAD_URL','DEFAULT_PROVIDER','QUANT_PRIMARY_MODEL',
  'DEEPSEEK_MODEL','DEEPSEEK_BASE_URL','DEEPINFRA_MODEL','DEEPINFRA_BASE_URL',
  'MATEO_WEB_AUTH_PASSWORD'
];

function uniquePaths(paths) {
  return [...new Set(paths.filter(Boolean).map((candidate) => path.resolve(candidate)))];
}

function exeDir() {
  return path.dirname(process.execPath);
}

function appPath() {
  return app.getAppPath ? app.getAppPath() : __dirname;
}

// Sync config (desktop → cloud)

function envCandidates() {
  const executableDir = exeDir();
  const applicationPath = appPath();
  return uniquePaths([
    path.join(process.cwd(), '.env'),
    path.join(process.cwd(), '..', '.env'),
    path.join(applicationPath, '.env'),
    path.join(applicationPath, '..', '.env'),
    path.join(applicationPath, '..', '..', '.env'),
    path.join(applicationPath, '..', '..', '..', '.env'),
    path.join(executableDir, '.env'),
    path.join(executableDir, '..', '.env'),
    path.join(executableDir, '..', '..', '.env'),
    path.join(executableDir, '..', '..', '..', '.env')
  ]);
}

function readEnv() {
  const env = {};
  const file = envCandidates().find((candidate) => fs.existsSync(candidate));
  if (!file) {
    for (const k of CLOUD_ENV_KEYS) { if (process.env[k] !== undefined) env[k] = process.env[k]; }
    return env;
  }
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const [key, ...rest] = trimmed.split('=');
    env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
  env.__ENV_FILE = file;
  // Cloud Run / Docker: process.env can override .env when the platform injects secrets.
  for (const k of CLOUD_ENV_KEYS) {
    if (process.env[k] !== undefined) env[k] = process.env[k];
  }
  return env;
}

const ENV = readEnv();

function portableRoot() {
  if (ENV.__ENV_FILE) {
    const envDir = path.dirname(ENV.__ENV_FILE);
    if (path.basename(envDir).toLowerCase() === 'app' && path.basename(path.dirname(envDir)).toLowerCase() === 'resources') {
      return path.resolve(envDir, '..', '..');
    }
    return envDir;
  }
  return IS_ELECTRON ? exeDir() : process.cwd();
}

function resolveDataDir() {
  const configured = (ENV.QUANT_DATA_DIR || process.env.QUANT_DATA_DIR || '').trim();
  const root = portableRoot();
  if (configured) {
    if (IS_ELECTRON && process.platform === 'win32' && configured.replace(/\\/g, '/') === '/data') {
      return path.join(root, 'quant_data');
    }
    return path.isAbsolute(configured) ? configured : path.resolve(root, configured);
  }
  return path.join(root, 'quant_data');
}

const memoryDir = resolveDataDir();
const memoryFile = path.join(memoryDir, 'quant_memory.jsonl');
const trainingStateFile = path.join(memoryDir, 'quant_training_state.json');
const trainingStateReader = createReadOnlyTrainingStateReader(trainingStateFile);
const customInstructionsFile = path.join(memoryDir, 'custom_instructions.json');
const calibrationFile        = path.join(memoryDir, 'calibration.json');
const conversationsDir       = path.join(memoryDir, 'conversations');
const mt5SnapshotFile        = path.join(memoryDir, 'mt5_snapshot.json');
const backendStateFile       = path.join(memoryDir, 'backend_state.json');
const riskConfigFile         = path.join(memoryDir, 'risk_config.json');

// Sync config (desktop -> cloud)
const QUANT_SYNC_URL = (ENV.QUANT_SYNC_URL || process.env.QUANT_SYNC_URL || '').replace(/\/$/, '');
const QUANT_SYNC_KEY = ENV.QUANT_SYNC_KEY || process.env.QUANT_SYNC_KEY || '';

const WEB_AUTH_ENABLED  = String(ENV.WEB_AUTH_ENABLED  || 'false').toLowerCase() === 'true';
const WEB_AUTH_EMAIL    = (ENV.WEB_AUTH_EMAIL    || 'kinotrance@gmail.com').toLowerCase();
const WEB_AUTH_PASSWORD = ENV.WEB_AUTH_PASSWORD  || 'Qx7!K9mP#Barras2025';
const DEFAULT_MATEO_PASSWORD = ENV.MATEO_WEB_AUTH_PASSWORD || process.env.MATEO_WEB_AUTH_PASSWORD || 'QuantMateo2026!';

const userApiConfigFile = path.join(memoryDir, 'user_api_config.json');
const USER_API_FIELDS = [
  'BINANCE_API_KEY','BINANCE_SECRET','DEEPSEEK_API_KEY','DEEPINFRA_API_KEY',
  'DEFAULT_PROVIDER','QUANT_PRIMARY_MODEL','DEEPSEEK_MODEL','DEEPSEEK_BASE_URL',
  'DEEPINFRA_MODEL','DEEPINFRA_BASE_URL','FINNHUB_API_KEY','ALPHA_VANTAGE_API_KEY',
  'REAL_TRADING','MT5_CONNECTOR_ENABLED','MT5_ACCOUNT1_LOGIN','MT5_ACCOUNT1_PASSWORD',
  'MT5_ACCOUNT1_SERVER','MT5_ACCOUNT2_LOGIN','MT5_ACCOUNT2_PASSWORD','MT5_ACCOUNT2_SERVER',
  'QUANT_SYNC_URL','QUANT_SYNC_KEY'
];
const SENSITIVE_API_FIELDS = USER_API_FIELDS.filter((key) => /KEY|SECRET|PASSWORD|PASS/.test(key));
const botStateStore = createJsonStore(backendStateFile, () => createDefaultBotState());
const riskConfigStore = createJsonStore(riskConfigFile, () => createDefaultRiskConfig());

function ensureMemoryDir() {
  fs.mkdirSync(memoryDir, { recursive: true });
  if (!fs.existsSync(memoryFile)) fs.writeFileSync(memoryFile, '', 'utf8');
}

function ensureEnvExampleFile() {
  const file = path.join(portableRoot(), '.env.example');
  if (!fs.existsSync(file)) fs.writeFileSync(file, ENV_EXAMPLE, 'utf8');
}

function readBotState() {
  const current = mergeBotState(createDefaultBotState(), botStateStore.read());
  const trainingForcedOn = [
    ENV.TRAINING_BACKEND_ENABLED,
    ENV.TRAINING_BACKEND_LOOP_ENABLED,
    ENV.TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED
  ].some((value) => String(value || 'false').toLowerCase() === 'true');
  return trainingForcedOn ? mergeBotState(current, { trainingEnabled: true }) : current;
}

function writeBotState(nextState) {
  const next = mergeBotState(readBotState(), nextState);
  botStateStore.write(next);
  logger.info('bot-state.updated', {
    tradingRealEnabled: next.tradingRealEnabled,
    trainingEnabled: next.trainingEnabled,
    killSwitch: next.killSwitch,
    paperMode: next.paperMode
  });
  return next;
}

function readRiskConfig() {
  return {
    ...createDefaultRiskConfig(),
    ...riskConfigStore.read()
  };
}

function writeRiskConfig(nextConfig) {
  const next = {
    ...createDefaultRiskConfig(),
    ...readRiskConfig(),
    ...nextConfig,
    trainingCanChangeCriticalRules: false,
    updatedAt: new Date().toISOString()
  };
  riskConfigStore.write(next);
  logger.info('risk-config.updated', {
    maxRiskPerTradePct: next.maxRiskPerTradePct,
    maxDailyLossPct: next.maxDailyLossPct,
    maxOpenPositions: next.maxOpenPositions,
    requireStopLoss: next.requireStopLoss
  });
  return next;
}

function backendRuntimePolicy(env = ENV) {
  const state = readBotState();
  const riskConfig = readRiskConfig();
  return {
    envRealTradingArmed: String(env.REAL_TRADING || 'false').toLowerCase() === 'true',
    state,
    riskConfig,
    riskValidation: validateRiskConfig(riskConfig)
  };
}

function assertRealTradingExecutionAllowed(env = ENV) {
  const policy = backendRuntimePolicy(env);
  if (!policy.envRealTradingArmed)
    throw new Error('REAL_TRADING no está armado en .env — orden bloqueada');
  if (!policy.state.tradingRealEnabled)
    throw new Error('Trading real deshabilitado en estado backend');
  assertTradingRealCanBeEnabled(policy.state, policy.riskConfig);
  return policy;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function readUserApiStore() {
  ensureMemoryDir();
  if (!fs.existsSync(userApiConfigFile)) return { users: {}, configs: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(userApiConfigFile, 'utf8'));
    return { users: parsed.users || {}, configs: parsed.configs || {} };
  } catch {
    return { users: {}, configs: {} };
  }
}

function writeUserApiStore(store) {
  ensureMemoryDir();
  fs.writeFileSync(userApiConfigFile, JSON.stringify({
    users: store.users || {},
    configs: store.configs || {},
    updatedAt: new Date().toISOString()
  }, null, 2), 'utf8');
}

function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(String(password || ''), salt, 120000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expected] = String(storedHash || '').split(':');
  if (!salt || !expected) return false;
  const actual = passwordHash(password, salt).split(':')[1];
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

function ensureUser(username, email, password, role = 'user', displayName = username) {
  const normalized = normalizeEmail(email);
  const store = readUserApiStore();
  if (!store.users[normalized]) {
    store.users[normalized] = {
      username,
      email: normalized,
      displayName,
      role,
      passwordHash: passwordHash(password),
      createdAt: new Date().toISOString()
    };
    writeUserApiStore(store);
  }
  return store.users[normalized];
}

function seedDefaultUsers() {
  // Always force-update passwords from env so Cloud Run env vars are authoritative
  const store = readUserApiStore();
  const adminKey = normalizeEmail(WEB_AUTH_EMAIL);
  store.users[adminKey] = {
    ...(store.users[adminKey] || {}),
    username: 'admin',
    email: adminKey,
    displayName: 'Quant Admin',
    role: 'admin',
    passwordHash: passwordHash(WEB_AUTH_PASSWORD),
    updatedAt: new Date().toISOString()
  };
  if (!store.users[adminKey].createdAt) store.users[adminKey].createdAt = new Date().toISOString();
  writeUserApiStore(store);
  ensureUser('mateo', 'teolv@hotmail.com', DEFAULT_MATEO_PASSWORD, 'tester', 'Mateo');
}

function findUserByCredentials(email, password) {
  const normEmail = normalizeEmail(email);
  // Primary fast-path: match directly against env vars (no file I/O, works when GCS isn't writable yet)
  if (normEmail === normalizeEmail(WEB_AUTH_EMAIL) && String(password || '') === String(WEB_AUTH_PASSWORD || '')) {
    return { email: normEmail, displayName: 'Quant Admin', role: 'admin', username: 'admin' };
  }
  if (normEmail === normalizeEmail('teolv@hotmail.com') && String(password || '') === String(DEFAULT_MATEO_PASSWORD || '')) {
    return { email: normEmail, displayName: 'Mateo', role: 'tester', username: 'mateo' };
  }
  // Secondary: check hashed store (desktop or custom-password users)
  try {
    seedDefaultUsers();
    const store = readUserApiStore();
    const user = store.users[normEmail];
    if (user && verifyPassword(password, user.passwordHash)) return user;
  } catch {}
  return null;
}

function effectiveEnvForUser(email) {
  const normalized = normalizeEmail(email || WEB_AUTH_EMAIL);
  const store = readUserApiStore();
  return { ...ENV, ...(store.configs[normalized] || {}) };
}

function apiConfigStatus(email, env = effectiveEnvForUser(email)) {
  const normalized = normalizeEmail(email || WEB_AUTH_EMAIL);
  const store = readUserApiStore();
  const cfg = store.configs[normalized] || {};
  const user = store.users[normalized] || { email: normalized, displayName: normalized, role: 'user' };
  const values = {};
  const has = {};
  const sources = {};
  for (const key of USER_API_FIELDS) {
    const sensitive = SENSITIVE_API_FIELDS.includes(key);
    values[key] = sensitive ? '' : String(cfg[key] ?? env[key] ?? '');
    has[key] = Boolean(env[key]);
    sources[key] = cfg[key] ? 'session' : ENV[key] ? 'env' : 'missing';
  }
  return {
    user: { email: user.email, displayName: user.displayName, role: user.role },
    values,
    has,
    sources,
    file: userApiConfigFile
  };
}

function writeApiConfigForUser(email, body = {}) {
  const normalized = normalizeEmail(email || WEB_AUTH_EMAIL);
  const store = readUserApiStore();
  const current = { ...(store.configs[normalized] || {}) };
  for (const key of USER_API_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const value = String(body[key] ?? '').trim();
    if (value === '__CLEAR__') delete current[key];
    else if (value !== '') current[key] = value;
  }
  store.configs[normalized] = current;
  writeUserApiStore(store);
  return { ok: true, ...apiConfigStatus(normalized) };
}

seedDefaultUsers();
ensureEnvExampleFile();
if (!fs.existsSync(backendStateFile)) writeBotState(createDefaultBotState());
if (!fs.existsSync(riskConfigFile)) writeRiskConfig(createDefaultRiskConfig());

function appendMemory(kind, payload) {
  ensureMemoryDir();
  const record = {
    ts: new Date().toISOString(),
    kind,
    payload
  };
  fs.appendFileSync(memoryFile, JSON.stringify(record) + '\n', 'utf8');
  return record;
}

function readMemory(limit = 80) {
  ensureMemoryDir();
  const lines = fs.readFileSync(memoryFile, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map((line) => {
    try { return JSON.parse(line); }
    catch { return null; }
  }).filter(Boolean);
}

function memoryStats() {
  ensureMemoryDir();
  let messages = 0, trades = 0, observations = 0;
  for (const item of readMemory(1000000)) {
    if (item.kind === 'message') messages += 1;
    else if (item.kind === 'trade') trades += 1;
    else observations += 1;
  }
  return { messages, trades, observations, file: memoryFile };
}

function clearMemory() {
  ensureMemoryDir();
  fs.writeFileSync(memoryFile, '', 'utf8');
  return memoryStats();
}

function readTrainingState() {
  ensureMemoryDir();
  if (!fs.existsSync(trainingStateFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(trainingStateFile, 'utf8'));
  } catch {
    return null;
  }
}

function readTrainingStateSnapshot() {
  return trainingStateReader.readSnapshot();
}

function writeTrainingState(payload) {
  ensureMemoryDir();
  const state = {
    ...normalizeTrainingStateTraceability(payload),
    persistedAt: new Date().toISOString(),
    file: trainingStateFile
  };
  fs.writeFileSync(trainingStateFile, JSON.stringify(state, null, 2), 'utf8');
  return { ok: true, file: trainingStateFile, persistedAt: state.persistedAt };
}

// ── Alertas ───────────────────────────────────────────────────────────────────

const alertConfigFile = path.join(memoryDir, 'alert_config.json');
const alertLogFile    = path.join(memoryDir, 'alert_log.jsonl');
const nodemailer      = require('nodemailer');

const DEFAULT_ALERT_CONFIG = {
  email: 'kinotrance@gmail.com',
  smtpUser: '',
  smtpPass: '',
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  enabled: true,
  triggers: {
    strongSignal:    { enabled: true,  label: 'Señal fuerte (conf > 82%)',       minConfidence: 82  },
    highSpread:      { enabled: true,  label: 'Spread excesivo (> 0.15%)',       maxSpreadPct: 0.0015 },
    connectionLost:  { enabled: true,  label: 'Conexión perdida con Binance/MT5'                    },
    tradeClosedDemo: { enabled: false, label: 'Operación demo cerrada'                              }
  }
};

function readAlertConfig() {
  ensureMemoryDir();
  if (!fs.existsSync(alertConfigFile)) return { ...DEFAULT_ALERT_CONFIG };
  try { return { ...DEFAULT_ALERT_CONFIG, ...JSON.parse(fs.readFileSync(alertConfigFile, 'utf8')) }; }
  catch { return { ...DEFAULT_ALERT_CONFIG }; }
}

function writeAlertConfig(cfg) {
  ensureMemoryDir();
  const payload = { ...readAlertConfig(), ...cfg, updatedAt: new Date().toISOString() };
  fs.writeFileSync(alertConfigFile, JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true, ...payload };
}

function appendAlertLog(subject, body) {
  ensureMemoryDir();
  const record = { ts: new Date().toISOString(), subject, body };
  fs.appendFileSync(alertLogFile, JSON.stringify(record) + '\n', 'utf8');
}

function readAlertLog(limit = 50) {
  ensureMemoryDir();
  if (!fs.existsSync(alertLogFile)) return [];
  const lines = fs.readFileSync(alertLogFile, 'utf8').split(/\r?\n/).filter(Boolean);
  return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
}

async function sendAlertEmail(subject, body, cfgOverride = null) {
  const cfg = cfgOverride || readAlertConfig();
  if (!cfg.enabled)  return { ok: false, reason: 'alerts_disabled' };
  if (!cfg.smtpUser) return { ok: false, reason: 'smtp_not_configured' };
  if (!cfg.smtpPass) return { ok: false, reason: 'smtp_password_missing' };
  const transporter = nodemailer.createTransport({
    host: cfg.smtpHost || 'smtp.gmail.com',
    port: Number(cfg.smtpPort || 587),
    secure: Number(cfg.smtpPort || 587) === 465,
    auth: { user: cfg.smtpUser, pass: cfg.smtpPass }
  });
  const html = `<div style="font-family:monospace;background:#0a0e17;color:#c5d3e8;padding:20px;border-radius:8px">
    <h2 style="color:#2979ff;margin:0 0 12px">🔔 QUANT — ${subject}</h2>
    <pre style="white-space:pre-wrap;color:#c5d3e8">${body}</pre>
    <hr style="border-color:#2e4268;margin:16px 0"/>
    <small style="color:#8fa3c0">Quant AI Trading · ${new Date().toLocaleString('es-CO')}</small>
  </div>`;
  await transporter.sendMail({
    from: `"Quant Trading" <${cfg.smtpUser}>`,
    to: cfg.email,
    subject: `[Quant] ${subject}`,
    html
  });
  appendAlertLog(subject, body);
  return { ok: true };
}

function readCustomInstructions() {
  ensureMemoryDir();
  if (!fs.existsSync(customInstructionsFile)) return { text: '', updatedAt: null };
  try {
    return JSON.parse(fs.readFileSync(customInstructionsFile, 'utf8'));
  } catch {
    return { text: '', updatedAt: null };
  }
}

function writeCustomInstructions(text) {
  ensureMemoryDir();
  const payload = { text: String(text || '').trim(), updatedAt: new Date().toISOString() };
  fs.writeFileSync(customInstructionsFile, JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true, ...payload };
}

// ── Conversaciones ────────────────────────────────────────────────────────────
function ensureConversationsDir() {
  fs.mkdirSync(conversationsDir, { recursive: true });
}

function convFile(id) {
  return path.join(conversationsDir, `${id}.json`);
}

function listConversations() {
  ensureConversationsDir();
  return fs.readdirSync(conversationsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(conversationsDir, f), 'utf8'));
        return {
          id:           data.id,
          name:         data.name || 'Sin nombre',
          createdAt:    data.createdAt,
          updatedAt:    data.updatedAt,
          messageCount: Array.isArray(data.messages) ? data.messages.length : 0
        };
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function loadConversation(id) {
  ensureConversationsDir();
  const file = convFile(id);
  if (!fs.existsSync(file)) return { ok: false, error: 'Conversación no encontrada' };
  try {
    return { ok: true, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function saveConversation(id, name, messages) {
  ensureConversationsDir();
  const file = convFile(id);
  const existing = fs.existsSync(file)
    ? (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; } })()
    : {};
  const payload = {
    id,
    name: name || existing.name || `Conversación ${new Date().toLocaleDateString('es-CO')}`,
    messages,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true, id, name: payload.name, updatedAt: payload.updatedAt };
}

function renameConversation(id, name) {
  ensureConversationsDir();
  const file = convFile(id);
  if (!fs.existsSync(file)) return { ok: false, error: 'Conversación no encontrada' };
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.name = String(name || '').trim() || data.name;
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, id, name: data.name };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function deleteConversation(id) {
  ensureConversationsDir();
  const file = convFile(id);
  if (!fs.existsSync(file)) return { ok: false, error: 'Conversación no encontrada' };
  fs.unlinkSync(file);
  return { ok: true, id };
}

// ── Calibración nocturna (Mejora 7) ──────────────────────────────────────────
// Lee el JSONL de memoria, extrae trades, calcula live_wr y hist_wr (primeros
// 30 días vs últimos 30 días), persiste ratios en calibration.json.
function readCalibration() {
  ensureMemoryDir();
  if (!fs.existsSync(calibrationFile)) return { ok: false, ratios: {}, computedAt: null };
  try { return JSON.parse(fs.readFileSync(calibrationFile, 'utf8')); }
  catch { return { ok: false, ratios: {}, computedAt: null }; }
}

function computeCalibration() {
  ensureMemoryDir();
  const records = readMemory(100000).filter((r) => r.kind === 'trade' || r.kind === 'training_lesson');
  const trades  = records.filter((r) => r.kind === 'trade' && r.payload?.pnl_demo !== undefined);
  if (trades.length < 10) {
    const result = { ok: false, reason: `Insuficientes trades (${trades.length}/10)`, ratios: {}, trades: trades.length, computedAt: new Date().toISOString() };
    fs.writeFileSync(calibrationFile, JSON.stringify(result, null, 2), 'utf8');
    return result;
  }

  // Split cronológico: primeros 70% = histórico (IS), últimos 30% = reciente (OOS / live)
  const sorted   = trades.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const splitIdx = Math.floor(sorted.length * 0.7);
  const hist     = sorted.slice(0, splitIdx);
  const live     = sorted.slice(splitIdx);

  const winRate = (arr) => arr.length === 0 ? null : arr.filter((r) => Number(r.payload?.pnl_demo || 0) >= 0).length / arr.length;
  const histWr  = winRate(hist);
  const liveWr  = winRate(live);

  // Ratio: live / hist (capped 0.5 – 1.5)
  const raw   = histWr > 0 ? liveWr / histWr : 1;
  const ratio = Math.max(0.5, Math.min(1.5, raw));

  // Desglose por símbolo (top 10 más operados)
  const bySymbol = {};
  for (const r of sorted) {
    const sym = r.payload?.symbol || 'UNKNOWN';
    if (!bySymbol[sym]) bySymbol[sym] = { hist: [], live: [] };
    const idx = sorted.indexOf(r);
    if (idx < splitIdx) bySymbol[sym].hist.push(r); else bySymbol[sym].live.push(r);
  }
  const symbolRatios = {};
  for (const [sym, { hist: h, live: l }] of Object.entries(bySymbol)) {
    if (h.length + l.length < 3) continue;
    const hWr = winRate(h); const lWr = winRate(l);
    const r   = hWr > 0 ? Math.max(0.5, Math.min(1.5, lWr / hWr)) : 1;
    symbolRatios[sym] = { histWr: hWr, liveWr: lWr, ratio: r, n: h.length + l.length };
  }

  const result = {
    ok: true,
    histWr,
    liveWr,
    ratio,
    trades: sorted.length,
    symbolRatios,
    label: `LiveWR ${(liveWr * 100).toFixed(1)}% / HistWR ${(histWr * 100).toFixed(1)}% → ratio ×${ratio.toFixed(2)}`,
    computedAt: new Date().toISOString()
  };
  fs.writeFileSync(calibrationFile, JSON.stringify(result, null, 2), 'utf8');
  return result;
}

function requestJson(method, url, headers = {}, payload = null) {
  return new Promise((resolve, reject) => {
    const body = payload ? Buffer.from(JSON.stringify(payload)) : null;
    const req = https.request(url, { method, headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          return;
        }
        try { resolve(data ? JSON.parse(data) : {}); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Fetches raw text (for RSS/XML feeds)
function requestRaw(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'QuantBot/1.0' } }, (res) => {
      // Follow one redirect
      if (res.statusCode >= 301 && res.statusCode <= 302 && res.headers.location) {
        return requestRaw(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('RSS timeout')); });
  });
}

const COINBASE_BASE = 'https://api.exchange.coinbase.com';
const COINBASE_GRANULARITY = {
  '1m': 60, '3m': 60, '5m': 300, '15m': 900, '30m': 1800,
  '1h': 3600, '2h': 3600, '4h': 21600, '6h': 21600,
  '8h': 21600, '12h': 21600, '1d': 86400, '1w': 86400
};

function coinbaseProductCandidates(symbol) {
  const raw = String(symbol || '').toUpperCase().replace(/[-_/]/g, '');
  const quotes = ['USDT', 'FDUSD', 'USDC', 'USD', 'BTC', 'ETH'];
  const quote = quotes.find((q) => raw.endsWith(q));
  if (!quote) return [];
  const base = raw.slice(0, -quote.length);
  const preferredQuotes = quote === 'USDT' || quote === 'FDUSD' ? ['USD', 'USDC', 'USDT'] : [quote, 'USD', 'USDC', 'USDT'];
  return [...new Set(preferredQuotes.map((q) => `${base}-${q}`))];
}

async function firstCoinbaseProduct(symbol) {
  const candidates = coinbaseProductCandidates(symbol);
  let lastError = null;
  for (const product of candidates) {
    try {
      await requestJson('GET', `${COINBASE_BASE}/products/${product}`, { 'User-Agent': 'QuantBot/1.0' });
      return product;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error(`Sin producto Coinbase para ${symbol}`);
}

async function coinbaseTickerFallback(symbol) {
  const product = await firstCoinbaseProduct(symbol);
  const data = await requestJson('GET', `${COINBASE_BASE}/products/${product}/ticker`, { 'User-Agent': 'QuantBot/1.0' });
  const bid = Number(data.bid || 0);
  const ask = Number(data.ask || 0);
  const price = Number(data.price || 0) || (bid && ask ? (bid + ask) / 2 : 0);
  return {
    symbol,
    source: `coinbase:${product}`,
    bid,
    ask,
    price,
    spread: bid && ask ? Math.max(ask - bid, 0) : 0,
    change: 0,
    changePct: 0,
    volume: Number(data.volume || 0),
    quoteVolume: 0
  };
}

async function coinbaseKlinesFallback(symbol, interval, limit = 180) {
  const product = await firstCoinbaseProduct(symbol);
  const granularity = COINBASE_GRANULARITY[String(interval || '1m').toLowerCase()] || 60;
  const safeLimit = Math.max(1, Math.min(Number(limit || 180), 300));
  const end = Math.floor(Date.now() / 1000);
  const start = end - safeLimit * granularity;
  const rows = await requestJson(
    'GET',
    `${COINBASE_BASE}/products/${product}/candles?${query({ granularity, start: new Date(start * 1000).toISOString(), end: new Date(end * 1000).toISOString() })}`,
    { 'User-Agent': 'QuantBot/1.0' }
  );
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      openTime: Number(r[0]) * 1000,
      low: Number(r[1]),
      high: Number(r[2]),
      open: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
      closeTime: Number(r[0]) * 1000 + granularity * 1000,
      source: `coinbase:${product}`
    }))
    .sort((a, b) => a.openTime - b.openTime)
    .slice(-safeLimit);
}

async function withMarketFallback(label, primary, fallback) {
  try {
    return await primary();
  } catch (err) {
    const message = String(err?.message || err);
    if (/HTTP 451|restricted location|Service unavailable/i.test(message) || /api\.binance\.com/i.test(message)) {
      return fallback(err);
    }
    return fallback(err);
  }
}

// Simple RSS XML parser — extracts <item> blocks without external deps
function parseRss(xml, sourceName) {
  const items = [];
  const rx = /<item[^>]*>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = rx.exec(xml)) !== null) {
    const chunk = m[1];
    const get  = (tag) => {
      const r = new RegExp(`<${tag}[^>]*>(?:<\\!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
      return (r.exec(chunk) || [])[1]?.trim() || '';
    };
    const title   = get('title');
    const link    = get('link') || get('guid');
    const pubDate = get('pubDate') || get('dc:date') || '';
    const summary = get('description').replace(/<[^>]+>/g, '').slice(0, 200);
    if (title) items.push({ title, link, pubDate, summary, source: sourceName });
  }
  return items;
}

// Fetches crypto-specific news from RSS feeds (no API key needed)
async function fetchCryptoNews() {
  const feeds = [
    { url: 'https://cointelegraph.com/rss', name: 'CoinTelegraph' },
    { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', name: 'CoinDesk' }
  ];
  const results = await Promise.allSettled(
    feeds.map(({ url, name }) =>
      requestRaw(url).then((xml) => parseRss(xml, name))
    )
  );
  const all = results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .slice(0, 30);
  return all;
}

// Fetches Finnhub crypto-category news
async function fetchFinnhubCrypto(env = ENV) {
  if (!env.FINNHUB_API_KEY) return [];
  try {
    const data = await requestJson('GET', `https://finnhub.io/api/v1/news?${query({ category: 'crypto', token: env.FINNHUB_API_KEY })}`);
    return Array.isArray(data) ? data.slice(0, 20) : [];
  } catch { return []; }
}

function query(params) {
  return new URLSearchParams(params).toString();
}

async function syncBinanceTime() {
  const data = await requestJson('GET', `${BINANCE_BASE}/api/v3/time`);
  timeOffsetMs = Number(data.serverTime) - Date.now();
}

async function signedBinance(pathname, params = {}, method = 'GET', env = ENV) {
  if (!env.BINANCE_API_KEY || !env.BINANCE_SECRET) throw new Error('Binance API keys no configuradas');
  if (!timeOffsetMs) await syncBinanceTime();
  const signed = {
    ...params,
    timestamp: Date.now() + timeOffsetMs,
    recvWindow: 5000
  };
  const qs = query(signed);
  const signature = crypto.createHmac('sha256', env.BINANCE_SECRET).update(qs).digest('hex');
  return requestJson(method, `${BINANCE_BASE}${pathname}?${qs}&signature=${signature}`, { 'X-MBX-APIKEY': env.BINANCE_API_KEY });
}

async function binanceSymbols() {
  const fallback = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'LINKUSDT', 'LTCUSDT', 'AVAXUSDT'];
  const info = await withMarketFallback(
    'binance-symbols',
    () => requestJson('GET', `${BINANCE_BASE}/api/v3/exchangeInfo`),
    () => ({ symbols: fallback.map((symbol) => ({ symbol, status: 'TRADING', isSpotTradingAllowed: true, quoteAsset: 'USDT' })) })
  );
  const quotes = new Set(['USDT', 'FDUSD', 'USDC', 'BTC', 'ETH']);
  const all = info.symbols
    .filter((s) => s.status === 'TRADING' && s.isSpotTradingAllowed !== false && quotes.has(s.quoteAsset))
    .map((s) => s.symbol)
    .sort();
  const preferred = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT'];
  return [...preferred.filter((s) => all.includes(s)), ...all.filter((s) => !preferred.includes(s))];
}

async function ticker(symbol) {
  return withMarketFallback('ticker', async () => {
    const book = await requestJson('GET', `${BINANCE_BASE}/api/v3/ticker/bookTicker?${query({ symbol })}`);
    const price24 = await requestJson('GET', `${BINANCE_BASE}/api/v3/ticker/24hr?${query({ symbol })}`);
  const bid = Number(book.bidPrice || 0);
  const ask = Number(book.askPrice || 0);
  return {
    symbol,
    bid,
    ask,
    price: bid && ask ? (bid + ask) / 2 : Number(price24.lastPrice || 0),
    spread: bid && ask ? Math.max(ask - bid, 0) : 0,
    change: Number(price24.priceChange || 0),
    changePct: Number(price24.priceChangePercent || 0),
    volume: Number(price24.volume || 0),
    quoteVolume: Number(price24.quoteVolume || 0)
  };
  }, () => coinbaseTickerFallback(symbol));
}

async function priceUsd(asset) {
  if (!asset || asset === 'USDT' || asset === 'USDC' || asset === 'FDUSD') return 1;
  try {
    const t = await ticker(`${asset}USDT`);
    return t.price || 0;
  } catch {
    try {
      const t = await ticker(`${asset}USDC`);
      return t.price || 0;
    } catch {
      return 0;
    }
  }
}

async function usdCopRate() {
  try {
    const direct = await ticker('USDTBRL');
    void direct;
  } catch {}
  try {
    const data = await requestJson('GET', 'https://open.er-api.com/v6/latest/USD');
    return Number(data?.rates?.COP || 0);
  } catch {
    return 0;
  }
}

async function klines(symbol, interval, limit = 180) {
  return withMarketFallback('klines', async () => {
    const rows = await requestJson('GET', `${BINANCE_BASE}/api/v3/klines?${query({ symbol, interval, limit })}`);
    return rows.map((r) => ({
    openTime: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
    closeTime: Number(r[6])
    }));
  }, () => coinbaseKlinesFallback(symbol, interval, limit));
}

async function binanceWallet(env = ENV) {
  const account = await signedBinance('/api/v3/account', {}, 'GET', env);
  const spot = account.balances
    .map((b) => ({ asset: b.asset, free: Number(b.free), locked: Number(b.locked) }))
    .filter((b) => b.free || b.locked);
  const out = {
    ok: true,
    accountType: account.accountType,
    canTrade: account.canTrade,
    canWithdraw: account.canWithdraw,
    canDeposit: account.canDeposit,
    permissions: account.permissions || [],
    spot,
    funding: [],
    fundingError: '',
    earn: [],
    earnError: ''
  };
  try {
    out.funding = await signedBinance('/sapi/v1/asset/get-funding-asset', {}, 'POST', env);
  } catch (err) {
    out.fundingError = err.message;
  }
  try {
    const earn = await signedBinance('/sapi/v1/simple-earn/flexible/position', { size: 100 }, 'GET', env);
    out.earn = earn.rows || [];
  } catch (err) {
    out.earnError = err.message;
  }
  const usdCop = await usdCopRate();
  out.usdCop = usdCop;
  out.valuation = [];
  const addValue = async (source, asset, amount, meta = {}) => {
    const qty = Number(amount || 0);
    if (!asset || !qty) return;
    const px = await priceUsd(asset);
    out.valuation.push({ source, asset, amount: qty, priceUsd: px, valueUsd: qty * px, valueCop: usdCop ? qty * px * usdCop : 0, ...meta });
  };
  for (const b of out.spot) await addValue('Spot', b.asset, b.free + b.locked);
  for (const b of out.funding || []) await addValue('Funding', b.asset || b.coin, b.free || b.amount);
  for (const b of out.earn || []) {
    await addValue('Earn', b.asset, b.totalAmount || b.amount, {
      apr: Number(b.latestAnnualPercentageRate || 0),
      cumulativeRewards: Number(b.cumulativeTotalRewards || b.cumulativeRealTimeRewards || 0),
      productId: b.productId || ''
    });
  }
  out.totalUsd = out.valuation.reduce((sum, item) => sum + item.valueUsd, 0);
  out.totalCop = out.valuation.reduce((sum, item) => sum + item.valueCop, 0);
  return out;
}

function binanceWalletUnavailable(error, usdCop = 0) {
  return {
    ok: false,
    error: String(error?.message || error || 'Binance no disponible'),
    accountType: 'SPOT',
    canTrade: false,
    canWithdraw: false,
    canDeposit: false,
    permissions: [],
    spot: [],
    funding: [],
    fundingError: '',
    earn: [],
    earnError: '',
    valuation: [],
    totalUsd: 0,
    totalCop: 0,
    usdCop
  };
}

// ── MT5 cache/dedup ── prevents concurrent Python spawns that restart MT5 ───
// MT5_CACHE_MS: 5 minutes. Prevents repeated Python spawns that reconnect MT5 to broker.
const MT5_CACHE_MS = 300000;
const _mt5AccountsCache = { ts: 0, data: null, inFlight: null };

// passive=true → only reads the currently active account, NO mt5.login() switching.
// Use passive=true for all background/auto operations.
// Use passive=false only on explicit user action ("Actualizar datos").
async function mt5MultiAccounts(usdCop = 0, env = ENV, passive = false) {
  const now = Date.now();
  // Non-passive = manual user action → always get fresh data, bypass cache
  if (!passive) _mt5AccountsCache.ts = 0;
  if (now - _mt5AccountsCache.ts < MT5_CACHE_MS && _mt5AccountsCache.data) return _mt5AccountsCache.data;
  if (_mt5AccountsCache.inFlight) return _mt5AccountsCache.inFlight;
  _mt5AccountsCache.inFlight = _mt5MultiAccountsImpl(usdCop, env, passive).then(r => {
    _mt5AccountsCache.ts = Date.now(); _mt5AccountsCache.data = r; _mt5AccountsCache.inFlight = null; return r;
  }).catch(e => { _mt5AccountsCache.inFlight = null; throw e; });
  return _mt5AccountsCache.inFlight;
}

function _mt5MultiAccountsImpl(usdCop = 0, env = ENV, passive = false) {
  // Build accounts list from ENV (MT5_ACCOUNT1_LOGIN … MT5_ACCOUNT4_LOGIN)
  const cfgs = [];
  for (let i = 1; i <= 4; i++) {
    const login = env[`MT5_ACCOUNT${i}_LOGIN`];
    if (!login) continue;
    cfgs.push({
      login: parseInt(login, 10),
      password: env[`MT5_ACCOUNT${i}_PASSWORD`] || '',
      server: env[`MT5_ACCOUNT${i}_SERVER`] || ''
    });
  }

  // passive=true: never call mt5.login() – only read the currently active account.
  // This is critical: mt5.login() forces MT5 to reconnect to the broker, which
  // appears as a "server restart" to the user. Background syncs must be passive.
  const passiveN = passive ? 'True' : 'False';
  const cfgsJson = JSON.stringify(cfgs);
  const usdCopN = Number(usdCop) || 0;

  const code = `
import json
try:
    import MetaTrader5 as mt5
    if not mt5.initialize():
        print(json.dumps({"ok": False, "accounts": [], "error": str(mt5.last_error())}))
    else:
        passive = ${passiveN}
        accounts_cfg = ${cfgsJson}
        orig_info = mt5.account_info()
        original_login = orig_info.login if orig_info else None
        usd_cop = ${usdCopN}
        results = []

        def read_account():
            info = mt5.account_info()
            if not info:
                return None
            d = info._asdict()
            pos_list = []
            positions = mt5.positions_get()
            if positions:
                for p in positions:
                    pd = p._asdict()
                    pos_list.append({
                        "ticket": pd.get("ticket"),
                        "symbol": pd.get("symbol"),
                        "direction": "BUY" if pd.get("type", 0) == 0 else "SELL",
                        "volume": pd.get("volume"),
                        "price_open": pd.get("price_open"),
                        "price_current": pd.get("price_current"),
                        "profit": pd.get("profit"),
                        "swap": pd.get("swap"),
                        "sl": pd.get("sl"),
                        "tp": pd.get("tp"),
                        "comment": pd.get("comment", ""),
                        "time": pd.get("time")
                    })
            balance = d.get("balance") or 0
            equity  = d.get("equity")  or 0
            is_demo = d.get("trade_mode", 0) != 0
            return {
                "available": True,
                "login": d.get("login"),
                "server": d.get("server"),
                "currency": d.get("currency"),
                "balance": balance,
                "equity": equity,
                "margin": d.get("margin"),
                "margin_free": d.get("margin_free"),
                "profit": d.get("profit"),
                "trade_mode": d.get("trade_mode"),
                "is_demo": is_demo,
                "balanceCop": round(balance * usd_cop, 2) if usd_cop else 0,
                "equityCop":  round(equity  * usd_cop, 2) if usd_cop else 0,
                "positions": pos_list
            }

        if passive or not accounts_cfg:
            # Passive mode or no accounts configured: only read the active account.
            # NEVER call mt5.login() here – it forces broker reconnect and disrupts MT5.
            acc = read_account()
            if acc:
                results.append(acc)
        else:
            for cfg in accounts_cfg:
                login = int(cfg.get("login", 0))
                password = cfg.get("password", "")
                server   = cfg.get("server", "")
                if not login:
                    continue
                ok = mt5.login(login, password=password, server=server)
                if ok:
                    acc = read_account()
                    if acc:
                        results.append(acc)
                    else:
                        results.append({"available": False, "login": login, "server": server, "error": "account_info failed after login"})
                else:
                    results.append({"available": False, "login": login, "server": server, "error": str(mt5.last_error())})

            # Restore original account
            if original_login:
                orig_cfg = next((c for c in accounts_cfg if int(c.get("login", 0)) == original_login), None)
                if orig_cfg:
                    mt5.login(original_login, password=orig_cfg.get("password", ""), server=orig_cfg.get("server", ""))

        try: mt5.shutdown()
        except: pass
        print(json.dumps({"ok": True, "accounts": results}))
except Exception as e:
    try: mt5.shutdown()
    except: pass
    print(json.dumps({"ok": False, "accounts": [], "error": str(e)}))
`;
  return new Promise((resolve) => {
    const child = spawn('python', ['-c', code], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.on('close', () => {
      try { resolve(JSON.parse(out.trim())); }
      catch { resolve({ ok: false, accounts: [], error: out.trim() }); }
    });
    child.on('error', (err) => resolve({ ok: false, accounts: [], error: err.message }));
  });
}

function mt5Info() {
  const code = `
import json
try:
    import MetaTrader5 as mt5
    ok = mt5.initialize()
    if not ok:
        print(json.dumps({"available": False, "message": "MT5 no inicializó", "error": mt5.last_error()}))
    else:
        info = mt5.account_info()
        if info is None:
            try: mt5.shutdown()
            except: pass
            print(json.dumps({"available": False, "message": "MT5 abierto, pero sin cuenta activa", "error": mt5.last_error()}))
        else:
            d = info._asdict()
            try: mt5.shutdown()
            except: pass
            print(json.dumps({"available": True, "login": d.get("login"), "server": d.get("server"), "currency": d.get("currency"), "balance": d.get("balance"), "equity": d.get("equity"), "margin": d.get("margin"), "margin_free": d.get("margin_free"), "trade_allowed": d.get("trade_allowed")}))
except Exception as e:
    try: mt5.shutdown()
    except: pass
    print(json.dumps({"available": False, "message": "MT5 no disponible para Python", "error": str(e)}))
`;
  return new Promise((resolve) => {
    const child = spawn('python', ['-c', code], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.on('close', () => {
      try { resolve(JSON.parse(out.trim())); }
      catch { resolve({ available: false, message: 'No pude leer MT5', error: out.trim() }); }
    });
    child.on('error', (err) => resolve({ available: false, message: 'Python no disponible', error: err.message }));
  });
}

function mt5Positions() {
  const code = `
import json
try:
    import MetaTrader5 as mt5
    if not mt5.initialize():
        print(json.dumps({"ok": False, "positions": [], "account": None, "error": str(mt5.last_error())}))
    else:
        info = mt5.account_info()
        account = None
        if info:
            d = info._asdict()
            account = {
                "login": d.get("login"),
                "server": d.get("server"),
                "currency": d.get("currency"),
                "balance": d.get("balance"),
                "equity": d.get("equity"),
                "margin": d.get("margin"),
                "margin_free": d.get("margin_free"),
                "profit": d.get("profit"),
                "trade_mode": d.get("trade_mode"),
                "is_demo": d.get("trade_mode", 0) != 0
            }
        positions = mt5.positions_get()
        result = []
        if positions:
            for p in positions:
                d = p._asdict()
                ptype = d.get("type", 0)
                result.append({
                    "ticket": d.get("ticket"),
                    "symbol": d.get("symbol"),
                    "direction": "BUY" if ptype == 0 else "SELL",
                    "volume": d.get("volume"),
                    "price_open": d.get("price_open"),
                    "price_current": d.get("price_current"),
                    "profit": d.get("profit"),
                    "swap": d.get("swap"),
                    "sl": d.get("sl"),
                    "tp": d.get("tp"),
                    "comment": d.get("comment", ""),
                    "magic": d.get("magic"),
                    "time": d.get("time")
                })
        print(json.dumps({"ok": True, "positions": result, "account": account}))
except Exception as e:
    print(json.dumps({"ok": False, "positions": [], "account": None, "error": str(e)}))
`;
  return new Promise((resolve) => {
    const child = spawn('python', ['-c', code], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.on('close', () => {
      try { resolve(JSON.parse(out.trim())); }
      catch { resolve({ ok: false, positions: [], account: null, error: out.trim() }); }
    });
    child.on('error', (err) => resolve({ ok: false, positions: [], account: null, error: err.message }));
  });
}

async function binanceOpenOrders(env = ENV) {
  if (!env.BINANCE_API_KEY || !env.BINANCE_SECRET) return { ok: false, orders: [], error: 'Sin claves Binance' };
  try {
    const orders = await signedBinance('/api/v3/openOrders', {}, 'GET', env);
    return {
      ok: true,
      orders: (orders || []).map((o) => ({
        orderId: o.orderId,
        symbol: o.symbol,
        side: o.side,
        type: o.type,
        origQty: Number(o.origQty),
        executedQty: Number(o.executedQty),
        price: Number(o.price),
        stopPrice: Number(o.stopPrice),
        status: o.status,
        time: o.time,
        timeInForce: o.timeInForce
      }))
    };
  } catch (err) {
    return { ok: false, orders: [], error: err.message };
  }
}

// ── Ejecución real Binance ────────────────────────────────────────────────────

// Obtiene los filtros de precisión del exchange para un símbolo (LOT_SIZE, PRICE_FILTER)
const _exchangeInfoCache = {};
async function getSymbolFilters(symbol) {
  if (_exchangeInfoCache[symbol]) return _exchangeInfoCache[symbol];
  const info = await requestJson('GET', `${BINANCE_BASE}/api/v3/exchangeInfo?${query({ symbol })}`);
  const sym = (info.symbols || []).find((s) => s.symbol === symbol);
  if (!sym) throw new Error(`Símbolo ${symbol} no encontrado en exchangeInfo`);
  const lot  = sym.filters.find((f) => f.filterType === 'LOT_SIZE')    || {};
  const price = sym.filters.find((f) => f.filterType === 'PRICE_FILTER') || {};
  const notional = sym.filters.find((f) => f.filterType === 'MIN_NOTIONAL' || f.filterType === 'NOTIONAL') || {};
  const result = {
    stepSize:    parseFloat(lot.stepSize    || '0.001'),
    minQty:      parseFloat(lot.minQty      || '0.0001'),
    maxQty:      parseFloat(lot.maxQty      || '999999'),
    tickSize:    parseFloat(price.tickSize  || '0.01'),
    minNotional: parseFloat(notional.minNotional || notional.notional || '5'),
    quoteAsset:  sym.quoteAsset,
    baseAsset:   sym.baseAsset,
    status:      sym.status
  };
  _exchangeInfoCache[symbol] = result;
  return result;
}

// Redondea qty al step size del exchange (ej. 0.001 → 3 decimales)
function roundStep(value, step) {
  if (!step || step <= 0) return value;
  const precision = Math.round(-Math.log10(step));
  return parseFloat((Math.floor(value / step) * step).toFixed(Math.max(0, precision)));
}

// Redondea precio al tick size del exchange
function roundTick(value, tick) {
  if (!tick || tick <= 0) return value;
  const precision = Math.round(-Math.log10(tick));
  return parseFloat((Math.round(value / tick) * tick).toFixed(Math.max(0, precision)));
}

// Calcula el tamaño de posición dado el capital disponible, el riesgo % y el
// precio de stop. Devuelve qty ya redondeada y validada contra filtros del exchange.
async function calcPositionSize(symbol, riskPct, entryPrice, stopPrice, env = ENV) {
  const filters = await getSymbolFilters(symbol);
  const account = await signedBinance('/api/v3/account', {}, 'GET', env);
  const quote   = filters.quoteAsset;                              // ej. USDT
  const bal     = (account.balances || []).find((b) => b.asset === quote);
  const capital = parseFloat(bal?.free || '0');
  if (capital <= 0) throw new Error(`Sin saldo ${quote} disponible`);

  const riskAmount = capital * (Math.min(riskPct, 5) / 100);     // máximo 5% hardcap
  const priceDelta = Math.abs(entryPrice - stopPrice);
  if (priceDelta <= 0) throw new Error('Stop-loss debe ser distinto del precio de entrada');

  let qty = riskAmount / priceDelta;
  qty = roundStep(qty, filters.stepSize);

  // Validaciones
  if (qty < filters.minQty)
    throw new Error(`Qty ${qty} < mínimo ${filters.minQty} para ${symbol}`);
  if (qty * entryPrice < filters.minNotional)
    throw new Error(`Notional ${(qty * entryPrice).toFixed(2)} ${quote} < mínimo ${filters.minNotional}`);

  return { qty, capital, riskAmount, riskPct, priceDelta, filters };
}

// Envía una orden real a Binance. Requiere REAL_TRADING=true en .env.
// side: 'BUY' | 'SELL'
// type: 'MARKET' | 'LIMIT'
// qty:  cantidad base ya validada
// price: solo para LIMIT
// stopPrice: solo informativo / para OCO futuro
async function placeOrderBinance(side, symbol, qty, type = 'MARKET', price = null, env = ENV) {
  assertRealTradingExecutionAllowed(env);
  if (!env.BINANCE_API_KEY || !env.BINANCE_SECRET)
    throw new Error('Faltan BINANCE_API_KEY / BINANCE_SECRET en .env');

  const filters = await getSymbolFilters(symbol);
  if (filters.status !== 'TRADING')
    throw new Error(`${symbol} no está en estado TRADING en Binance`);

  const params = { symbol, side, type, quantity: qty };
  if (type === 'LIMIT') {
    if (!price) throw new Error('Se requiere precio para orden LIMIT');
    params.price       = roundTick(price, filters.tickSize);
    params.timeInForce = 'GTC';
  }

  const res = await signedBinance('/api/v3/order', params, 'POST', env);
  if (res.code && res.code < 0)
    throw new Error(`Binance error ${res.code}: ${res.msg}`);

  const avgPrice  = res.fills?.length
    ? res.fills.reduce((s, f) => s + parseFloat(f.price) * parseFloat(f.qty), 0) /
      res.fills.reduce((s, f) => s + parseFloat(f.qty), 0)
    : parseFloat(res.price || price || 0);
  const filledQty = parseFloat(res.executedQty || 0);
  const notional  = parseFloat(res.cummulativeQuoteQty || 0);

  return {
    ok:        true,
    orderId:   res.orderId,
    clientOrderId: res.clientOrderId,
    symbol,
    side,
    type,
    status:    res.status,
    qty:       filledQty,
    price:     avgPrice,
    notional,
    fills:     res.fills || [],
    transactTime: res.transactTime
  };
}

// Cancela una orden abierta en Binance
async function cancelOrderBinance(symbol, orderId, env = ENV) {
  if (!env.BINANCE_API_KEY || !env.BINANCE_SECRET)
    throw new Error('Faltan BINANCE_API_KEY / BINANCE_SECRET en .env');
  const res = await signedBinance('/api/v3/order', { symbol, orderId }, 'DELETE', env);
  if (res.code && res.code < 0)
    throw new Error(`Binance cancel error ${res.code}: ${res.msg}`);
  return { ok: true, orderId: res.orderId, symbol, status: res.status };
}

async function livePositions(env = ENV, passive = true) {
  const mt5Enabled = String(env.MT5_CONNECTOR_ENABLED || 'false').toLowerCase() === 'true';
  const hasMt5Creds = Boolean(env.MT5_ACCOUNT1_LOGIN);
  const [mt5Multi, binanceResult] = await Promise.all([
    (mt5Enabled || hasMt5Creds) ? mt5MultiAccounts(0, env, passive).catch(() => ({ ok: false, accounts: [] })) : Promise.resolve({ ok: false, accounts: [] }),
    binanceOpenOrders(env)
  ]);
  let mt5Accounts = mt5Multi.accounts || [];
  // Fallback: usa snapshot si no hay datos MT5 en vivo
  if (!mt5Accounts.length) {
    const snap = readMt5Snapshot();
    if (snap?.positions?.mt5?.length) {
      mt5Accounts = [{ fromSnapshot: true, syncedAt: snap.syncedAt, positions: snap.positions.mt5 }];
    }
  }
  return { mt5Accounts, binance: binanceResult };
}

function mt5Symbols() {
  const code = `
import json
try:
    import MetaTrader5 as mt5
    if not mt5.initialize():
        print(json.dumps({"ok": False, "symbols": [], "error": str(mt5.last_error())}))
    else:
        symbols = mt5.symbols_get()
        names = [s.name for s in symbols if getattr(s, "visible", False) or getattr(s, "select", False)]
        preferred = [s.name for s in symbols if s.name in ("XAUUSD","EURUSD","GBPUSD","USDJPY","AUDCAD","USDCAD","BTCUSD","ETHUSD")]
        merged = []
        for x in preferred + names[:800]:
            if x not in merged:
                merged.append(x)
        print(json.dumps({"ok": True, "symbols": merged[:900]}))
except Exception as e:
    print(json.dumps({"ok": False, "symbols": [], "error": str(e)}))
`;
  return new Promise((resolve) => {
    const child = spawn('python', ['-c', code], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.on('close', () => {
      try { resolve(JSON.parse(out.trim())); }
      catch { resolve({ ok: false, symbols: [], error: out.trim() }); }
    });
    child.on('error', (err) => resolve({ ok: false, symbols: [], error: err.message }));
  });
}

function mt5Rates(symbol, timeframe = 'M1', count = 180) {
  const tfMap = { M1: 'TIMEFRAME_M1', M5: 'TIMEFRAME_M5', M15: 'TIMEFRAME_M15', H1: 'TIMEFRAME_H1', H4: 'TIMEFRAME_H4', D1: 'TIMEFRAME_D1', W1: 'TIMEFRAME_W1' };
  const tf = tfMap[timeframe] || 'TIMEFRAME_M1';
  const code = `
import json, time
try:
    import MetaTrader5 as mt5
    if not mt5.initialize():
        print(json.dumps({"ok": False, "error": str(mt5.last_error()), "candles": []}))
    else:
        symbol = ${JSON.stringify(symbol)}
        mt5.symbol_select(symbol, True)
        tf = getattr(mt5, ${JSON.stringify(tf)})
        rates = mt5.copy_rates_from_pos(symbol, tf, 0, ${Number(count)})
        tick = mt5.symbol_info_tick(symbol)
        info = mt5.symbol_info(symbol)
        candles = []
        if rates is not None:
            for r in rates:
                candles.append({"openTime": int(r["time"]) * 1000, "open": float(r["open"]), "high": float(r["high"]), "low": float(r["low"]), "close": float(r["close"]), "volume": float(r["tick_volume"]), "closeTime": int(r["time"]) * 1000})
        bid = float(tick.bid) if tick else 0
        ask = float(tick.ask) if tick else 0
        point = float(info.point) if info else 0
        print(json.dumps({"ok": True, "symbol": symbol, "candles": candles, "ticker": {"symbol": symbol, "bid": bid, "ask": ask, "price": (bid + ask) / 2 if bid and ask else bid or ask, "spread": max(ask - bid, 0), "point": point}}))
except Exception as e:
    print(json.dumps({"ok": False, "error": str(e), "candles": []}))
`;
  return new Promise((resolve) => {
    const child = spawn('python', ['-c', code], { windowsHide: true });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.on('close', () => {
      try { resolve(JSON.parse(out.trim())); }
      catch { resolve({ ok: false, error: out.trim(), candles: [] }); }
    });
    child.on('error', (err) => resolve({ ok: false, error: err.message, candles: [] }));
  });
}

async function chat(messages, context = '', env = ENV) {
  const route = modelRoute(env);
  if (!route.apiKey) return 'Estoy en modo local: puedo operar el dashboard, pero falta una API key de modelo para razonar con proveedor remoto.';
  const memory = readMemory(120)
    .map((m) => `${m.ts} ${m.kind}: ${JSON.stringify(m.payload).slice(0, 500)}`)
    .join('\n');
  const system = `Eres Quant, una IA de escritorio para un sistema de trading. Tienes memoria permanente local guardada en disco; no digas que tu memoria solo dura la sesión. Puedes recordar mensajes, observaciones, señales, errores y trades de sesiones anteriores usando el contexto de memoria que recibes. Respondes como asistente general, elocuente y prudente. No haces análisis de trading salvo que el usuario lo pida. Si hay riesgo real, adviertes y validas.

Conciencia de sistema obligatoria:
Tienes contexto de feeds de mercado, wallet, Training Mode, Finnhub, Alpha Vantage, calendario macro si esta disponible, senales, posiciones demo y memoria. Si el contexto incluye Macro/news, nunca digas que no tienes acceso a noticias o macro; explica que datos recibiste y sus limites.

Motor de estrategias activo:
Training compara varias hipotesis, no una sola. Usa ICT + CRT institucional, Trend Momentum/EMA-MACD, Breakout + Retest, Mean Reversion/RSI-ATR y Volume Pullback Continuation. Debes hablar de estrategia dominante, score, sesgo, razon, riesgo, aprendizaje observado y condiciones invalidantes. ICT/CRT sigue siendo importante, pero no debe bloquear el aprendizaje de otros modelos. Si una estrategia tiene poco historial, dilo como muestra insuficiente.

Estrategia institucional activa para Training y analisis solicitado:
Usas un modelo hibrido ICT + CRT + momentum/volatilidad + comportamiento institucional. La logica base es: sesgo semanal CRT por sweep del minimo/maximo anterior con cierre dentro del rango; alineacion semanal, diario/H4 y H1/M15; lectura de liquidez, maximos/minimos iguales, barridos y falsos rompimientos; entrada solo si hay sweep de liquidez, desplazamiento, ruptura de estructura y zona FVG u order block probable; preferir aperturas de Londres/Nueva York; puntuar HTF, liquidez, desplazamiento, estructura y timing hasta 100; operar demo fuerte solo con score alto, RR minimo 1:2 y riesgo simulado 0.5%-1%. Precision sobre frecuencia, pero Training debe mantener aprendizaje continuo con paper trading cuando el modo sea training.

Formato de salida para analisis cuantitativo (OBLIGATORIO cuando el usuario pide un analisis de mercado, señal, setup o recomendacion de operacion):
Estructura tu respuesta EXACTAMENTE con estas cuatro secciones separadas por linea en blanco. No omitas ninguna. No uses Markdown extra dentro de ellas.

SETUP
Una descripcion concisa del contexto de precio: tendencia HTF, rango o ruptura, nivel clave mas cercano y regimen ADX14 actual si esta disponible.

EDGE
Por que este momento tiene ventaja estadistica: confluencias ICT/CRT encontradas (sweep de liquidez, FVG, OB, BOS/ChoCH), alineacion temporal (sesion, apertura), y score numerico estimado /100.

CONDICIONES
Los requisitos que deben cumplirse para activar la entrada: precio especifico o zona, confirmacion de vela/estructura, spread y volatilidad aceptables, macro sin evento de alto impacto activo.

VEREDICTO
Una linea de decision final: OPERAR LARGO, OPERAR CORTO, ESPERAR o NO OPERAR, seguida del RR objetivo, SL y TP aproximados, y nivel de confianza (ALTA / MEDIA / BAJA).

Cuando el usuario pregunte por Training, responde con diagnostico de laboratorio: estrategia dominante, estrategias con peor rendimiento, que datos faltan, que filtros conviene endurecer, que hipotesis conviene seguir testeando y que NO se debe pasar a real todavia.

Para conversacion general, preguntas tecnicas o diagnostico del sistema, responde en prosa normal sin estas secciones.

Comunicacion:
Evita respuestas con asteriscos Markdown como separadores. Usa titulos cortos, parrafos claros y listas limpias solo cuando ayuden. Si algo falla, explica causa probable, evidencia disponible y siguiente accion concreta.

Auto-auditoria:
Debes tratarte como un agente de IAs de trading: revisa vulnerabilidades operativas, estado de adapters, memoria, macro/news, training y riesgo. Puedes auto-corregir guardas runtime y configuraciones internas que el contexto indique; si una correccion requiere cambio de codigo, dilo como accion tecnica concreta.

Contexto operativo:
${context}

Memoria permanente reciente:
${memory || 'Aún no hay memoria registrada.'}`;
  const customText = readCustomInstructions().text;
  const finalSystem = customText
    ? `${system}\n\nInstrucciones personalizadas del usuario:\n${customText}`
    : system;
  const payload = {
    model: route.model,
    messages: [{ role: 'system', content: finalSystem }, ...messages],
    temperature: 0.55,
    max_tokens: 900
  };
  const data = await requestJson('POST', `${route.base}/chat/completions`, { Authorization: `Bearer ${route.apiKey}` }, payload);
  return data.choices?.[0]?.message?.content || 'No recibí contenido del modelo.';
}

function modelRoute(env = ENV) {
  const provider = String(env.DEFAULT_PROVIDER || 'deepseek').toLowerCase();
  if (provider.includes('deepinfra') && env.DEEPINFRA_API_KEY) {
    return {
      provider: 'deepinfra',
      base: (env.DEEPINFRA_BASE_URL || 'https://api.deepinfra.com/v1/openai').replace(/\/$/, ''),
      model: env.DEEPINFRA_MODEL || 'Qwen/Qwen2.5-72B-Instruct',
      apiKey: env.DEEPINFRA_API_KEY
    };
  }
  const requested = env.QUANT_PRIMARY_MODEL || env.DEEPSEEK_MODEL || '';
  const model = requested && !/v4\s*pro|deepseek-chat/i.test(requested) ? requested : 'deepseek-reasoner';
  return {
    provider: 'deepseek',
    base: (env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, ''),
    model,
    apiKey: env.DEEPSEEK_API_KEY
  };
}

let webServer = null;
let activeWebPort = Number(ENV.QUANT_WEB_PORT || 47829);
function sendJson(res, value, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk.toString(); });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
  });
}

function serveStatic(req, res, urlLike) {
  const mimeFor = (p) => {
    const e = path.extname(p);
    if (e === '.css')  return 'text/css';
    if (e === '.js')   return 'text/javascript';
    if (e === '.png')  return 'image/png';
    if (e === '.svg')  return 'image/svg+xml';
    if (e === '.ico')  return 'image/x-icon';
    if (e === '.json') return 'application/json';
    return 'text/html';
  };
  const sendFile = (full, contentType) => {
    res.writeHead(200, { 'Content-Type': `${contentType}; charset=utf-8` });
    fs.createReadStream(full).pipe(res);
  };

  const pathname = String(urlLike?.pathname || '/');
  const resolvedUiEntry = resolveUiEntry(urlLike);

  if (resolvedUiEntry.mode === 'login') {
    const loginFile = path.join(__dirname, 'public', resolvedUiEntry.file);
    if (fs.existsSync(loginFile)) { sendFile(loginFile, 'text/html'); return; }
  }

  const file = resolvedUiEntry.file;
  const publicRoot = path.join(__dirname, 'public');
  const srcRoot = path.join(__dirname, 'src');

  if (resolvedUiEntry.root === 'public') {
    const publicFile = path.join(publicRoot, file);
    if (publicFile.startsWith(publicRoot) && fs.existsSync(publicFile)) {
      sendFile(publicFile, mimeFor(publicFile)); return;
    }
    res.writeHead(404); res.end('Not found'); return;
  }

  if (resolvedUiEntry.root === 'src') {
    const srcFile = path.join(srcRoot, file);
    if (srcFile.startsWith(srcRoot) && fs.existsSync(srcFile)) {
      sendFile(srcFile, mimeFor(srcFile)); return;
    }
    res.writeHead(404); res.end('Not found'); return;
  }

  const pubFull = path.join(publicRoot, file);
  if (pubFull.startsWith(publicRoot) && fs.existsSync(pubFull)) {
    sendFile(pubFull, mimeFor(pubFull)); return;
  }

  const srcFull = path.join(srcRoot, file);
  if (srcFull.startsWith(srcRoot) && fs.existsSync(srcFull)) {
    sendFile(srcFull, mimeFor(srcFull)); return;
  }

  res.writeHead(404); res.end('Not found');
}

async function handleApi(req, res, url) {
  try {
    const q = Object.fromEntries(url.searchParams.entries());
    const body = req.method === 'POST' ? await readBody(req) : {};
    const currentUser = currentUserFromRequest(req) || WEB_AUTH_EMAIL;
    const userEnv = effectiveEnvForUser(currentUser);
    const cfgStatus = apiConfigStatus(currentUser, userEnv);
    const modularRouter = createApiRouter({
      env: userEnv,
      logger,
      deps: {
        readMemory,
        readTrainingState,
        readTrainingStateSnapshot,
        writeTrainingState,
        getBinanceSymbols: () => binanceSymbols(),
        getTicker: (symbol) => ticker(symbol),
        readMt5Snapshot,
        syncBinanceTime: () => syncBinanceTime(),
        mt5AccountInfo: (envArg) => mt5Info(envArg)
      },
      getBotState: () => readBotState(),
      setBotState: (next) => writeBotState(next),
      getRiskConfig: () => readRiskConfig(),
      setRiskConfig: (next) => writeRiskConfig(next)
    });
    const modularResult = await modularRouter.dispatch({
      method: req.method,
      pathname: url.pathname,
      body
    });
    if (modularResult) return sendJson(res, modularResult.body, modularResult.status);
    if (url.pathname === '/api/api-config-read') return sendJson(res, cfgStatus);
    if (url.pathname === '/api/api-config-write' && req.method === 'POST') return sendJson(res, writeApiConfigForUser(currentUser, body));
    const runtimePolicy = backendRuntimePolicy(userEnv);
    if (url.pathname === '/api/env-status') return sendJson(res, {
      user: cfgStatus.user,
      userEmail: currentUser,
      apiConfigStatus: cfgStatus,
      envFile: ENV.__ENV_FILE || '',
      portableRoot: portableRoot(),
      dataDir: memoryDir,
      binance: Boolean(userEnv.BINANCE_API_KEY && userEnv.BINANCE_SECRET),
      deepseek: Boolean(userEnv.DEEPSEEK_API_KEY),
      deepinfra: Boolean(userEnv.DEEPINFRA_API_KEY),
      modelProvider: modelRoute(userEnv).provider,
      model: modelRoute(userEnv).model,
      finnhub: Boolean(userEnv.FINNHUB_API_KEY),
      alpha: Boolean(userEnv.ALPHA_VANTAGE_API_KEY),
      mt5Connector: String(userEnv.MT5_CONNECTOR_ENABLED || 'false').toLowerCase() === 'true',
      webUrl: `http://127.0.0.1:${activeWebPort}`,
      binanceWhitelistIp: userEnv.QUANT_VPS_PUBLIC_IP || DEFAULT_VPS_PUBLIC_IP,
      realTrading: runtimePolicy.state.tradingRealEnabled,
      realTradingArmedByEnv: runtimePolicy.envRealTradingArmed,
      trainingEnabled: runtimePolicy.state.trainingEnabled,
      killSwitch: runtimePolicy.state.killSwitch,
      paperMode: runtimePolicy.state.paperMode,
      riskValidation: runtimePolicy.riskValidation,
      desktopDownloadUrl: ENV.QUANT_DESKTOP_DOWNLOAD_URL || '',
      syncConfigured: Boolean((userEnv.QUANT_SYNC_URL || QUANT_SYNC_URL) && (userEnv.QUANT_SYNC_KEY || QUANT_SYNC_KEY))
    });
    if (url.pathname === '/api/binance-symbols') return sendJson(res, await binanceSymbols());
    if (url.pathname === '/api/mt5-symbols') return sendJson(res, String(userEnv.MT5_CONNECTOR_ENABLED || 'false').toLowerCase() === 'true' ? await mt5Symbols() : { ok: false, symbols: [], error: 'MT5 adapter disabled' });
    if (url.pathname === '/api/mt5-rates') return sendJson(res, String(userEnv.MT5_CONNECTOR_ENABLED || 'false').toLowerCase() === 'true' ? await mt5Rates(q.symbol, q.timeframe, Number(q.count || 180)) : { ok: false, candles: [], error: 'MT5 adapter disabled' });
    if (url.pathname === '/api/ticker') return sendJson(res, await ticker(q.symbol));
    if (url.pathname === '/api/klines') return sendJson(res, await klines(q.symbol, q.interval, Number(q.limit || 180)));
    if (url.pathname === '/api/wallet') return sendJson(res, await fullWallet(userEnv));
    if (url.pathname === '/api/chat') return sendJson(res, await chat(body.messages || [], body.context || '', userEnv));
    if (url.pathname === '/api/memory-write') return sendJson(res, appendMemory(body.kind, body.payload));
    if (url.pathname === '/api/memory-read') return sendJson(res, readMemory(Number(q.limit || 80)));
    if (url.pathname === '/api/memory-stats') return sendJson(res, memoryStats());
    if (url.pathname === '/api/memory-clear') return sendJson(res, clearMemory());
    if (url.pathname === '/api/training-state-read') return sendJson(res, readTrainingState());
    if (url.pathname === '/api/training-state-write') return sendJson(res, writeTrainingState(body));
    if (url.pathname === '/api/custom-instructions-read') return sendJson(res, readCustomInstructions());
    if (url.pathname === '/api/custom-instructions-write') return sendJson(res, writeCustomInstructions(body.text || ''));
    if (url.pathname === '/api/alert-config-read')  return sendJson(res, readAlertConfig());
    if (url.pathname === '/api/alert-config-write') return sendJson(res, writeAlertConfig(body));
    if (url.pathname === '/api/alert-log')          return sendJson(res, readAlertLog(Number(url.searchParams.get('limit') || 50)));
    if (url.pathname === '/api/send-test-email')    return sendJson(res, await sendAlertEmail('Test de configuración', 'Si recibes este correo, las alertas de Quant están funcionando correctamente.\n\nPlataforma: QUANT AI Trading System', body.cfg || null));
    if (url.pathname === '/api/send-alert')         return sendJson(res, await sendAlertEmail(body.subject || 'Alerta', body.body || '', body.cfg || null));
    if (url.pathname === '/api/positions') return sendJson(res, await livePositions(userEnv));
    if (url.pathname === '/api/news-finnhub') return sendJson(res, userEnv.FINNHUB_API_KEY ? await requestJson('GET', `https://finnhub.io/api/v1/news?${query({ category: 'general', token: userEnv.FINNHUB_API_KEY })}`) : []);
    if (url.pathname === '/api/calendar-finnhub-economic') {
      if (!userEnv.FINNHUB_API_KEY) return sendJson(res, []);
      const today = new Date();
      const from = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const to = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return sendJson(res, await requestJson('GET', `https://finnhub.io/api/v1/calendar/economic?${query({ from, to, token: userEnv.FINNHUB_API_KEY })}`));
    }
    if (url.pathname === '/api/news-alpha') return sendJson(res, userEnv.ALPHA_VANTAGE_API_KEY ? await requestJson('GET', `https://www.alphavantage.co/query?${query({ function: 'NEWS_SENTIMENT', apikey: userEnv.ALPHA_VANTAGE_API_KEY })}`) : {});
    if (url.pathname === '/api/news-finnhub-crypto') return sendJson(res, await fetchFinnhubCrypto(userEnv));
    if (url.pathname === '/api/news-crypto-rss')     return sendJson(res, await fetchCryptoNews());

    // ── Conversation endpoints (web) ──────────────────────────────────────────
    if (url.pathname === '/api/conversations-list')  return sendJson(res, listConversations());
    if (url.pathname === '/api/conversation-load' && (req.method === 'POST' || req.method === 'GET'))
      return sendJson(res, loadConversation(body.id || q.id));
    if (url.pathname === '/api/conversation-save' && req.method === 'POST')
      return sendJson(res, saveConversation(body.id, body.name, body.messages));
    if (url.pathname === '/api/conversation-rename' && req.method === 'POST')
      return sendJson(res, renameConversation(body.id, body.name));
    if (url.pathname === '/api/conversation-delete' && req.method === 'POST')
      return sendJson(res, deleteConversation(body.id));

    // ── MT5 sync endpoints ────────────────────────────────────────────────────
    // Recibe snapshot del desktop (solo cloud lo necesita, pero no hace daño en desktop)
    if (url.pathname === '/api/mt5-push' && req.method === 'POST') {
      const syncKey = req.headers['x-sync-key'] || '';
      if (!QUANT_SYNC_KEY || syncKey !== QUANT_SYNC_KEY)
        return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      writeMt5Snapshot(body);
      return sendJson(res, { ok: true, syncedAt: new Date().toISOString() });
    }
    // Devuelve el último snapshot MT5 (la web lo lee)
    if (url.pathname === '/api/mt5-snapshot') {
      const snap = readMt5Snapshot();
      return sendJson(res, snap || { ok: false, reason: 'Sin snapshot MT5 disponible' });
    }
    // ── Full data sync endpoints ───────────────────────���──────────────────────
    // Desktop → Cloud: recibe y guarda training, memoria, conversaciones
    if (url.pathname === '/api/data-push' && req.method === 'POST') {
      const syncKey = req.headers['x-sync-key'] || '';
      if (!QUANT_SYNC_KEY || syncKey !== QUANT_SYNC_KEY)
        return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      const results = {};
      try {
        if (body.trainingState)        { writeTrainingState(body.trainingState);                    results.trainingState = true; }
        if (body.calibration)          { ensureMemoryDir(); fs.writeFileSync(calibrationFile, JSON.stringify(body.calibration, null, 2), 'utf8'); results.calibration = true; }
        if (body.memories?.length)     { const r = mergeMemoryEntries(body.memories);               results.memories = r.merged; }
        if (body.conversations?.length){ const r = syncConversationsFromCloud(body.conversations);  results.conversations = r.saved; }
        if (body.customInstructions?.text) writeCustomInstructions(body.customInstructions.text);
        return sendJson(res, { ok: true, results, receivedAt: new Date().toISOString() });
      } catch (err) { return sendJson(res, { ok: false, error: err.message }, 500); }
    }

    // Cloud → Desktop: exporta todo para configurar un desktop nuevo
    if (url.pathname === '/api/data-export') {
      const syncKey = req.headers['x-sync-key'] || '';
      if (!QUANT_SYNC_KEY || syncKey !== QUANT_SYNC_KEY)
        return sendJson(res, { ok: false, error: 'Unauthorized' }, 401);
      return sendJson(res, {
        ok: true,
        trainingState:      readTrainingState(),
        calibration:        readCalibration(),
        memories:           readAllMemoryEntries().slice(-600),
        conversations:      listConversationsWithMessages(),
        customInstructions: readCustomInstructions(),
        exportedAt:         new Date().toISOString()
      });
    }

    // El desktop llama a este endpoint para sincronizar ahora mismo
    // body.manual=true → hace mt5.login() completo (solo al presionar "Actualizar datos")
    if (url.pathname === '/api/sync-mt5' && req.method === 'POST') {
      const result = await syncMt5Snapshot(userEnv, Boolean(body.manual));
      return sendJson(res, result);
    }

    return sendJson(res, { error: 'Unknown API route' }, 404);
  } catch (err) {
    logger.error('api.error', { path: url.pathname, message: err.message });
    return sendJson(res, { error: err.message }, 500);
  }
}

// ── Backtesting ───────────────────────────────────────────────────────────────

function parseCsvLine(line) {
  const cells = [];
  let cur = '';
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === ',' && !inQuote) { cells.push(cur.trim()); cur = ''; continue; }
    if (ch === ';' && !inQuote) { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function detectAndParseCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  // Find header row (first row with recognizable column names)
  let headerIdx = 0;
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const low = lines[i].toLowerCase();
    if (low.includes('profit') || low.includes('symbol') || low.includes('pair') || low.includes('type')) {
      headerIdx = i;
      break;
    }
  }

  const headers = parseCsvLine(lines[headerIdx]).map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, '_'));
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (!cells.length || !cells.some(Boolean)) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = cells[idx] || ''; });
    rows.push(row);
  }

  // Normalize to trade objects
  const trades = [];
  for (const r of rows) {
    const keys = Object.keys(r);
    // MT5 history export: symbol, type, profit, volume, open_price, close_price, open_time / close_time
    const symbolKey = keys.find((k) => k.includes('symbol') || k.includes('pair'));
    const typeKey   = keys.find((k) => k === 'type' || k === 'order_type' || k === 'side');
    const profitKey = keys.find((k) => k.includes('profit') || k.includes('pnl') || k.includes('realized'));
    const volKey    = keys.find((k) => k.includes('volume') || k.includes('amount') || k.includes('qty') || k.includes('size'));
    const openPxKey = keys.find((k) => k.includes('open_price') || k.includes('entry') || k.includes('avg_trading') || k.includes('price'));
    const closePxKey = keys.find((k) => k.includes('close_price') || k.includes('exit'));
    const openTsKey  = keys.find((k) => k.includes('open_time') || k.includes('date') || k.includes('time') || k.includes('open'));
    const closeTsKey = keys.find((k) => k.includes('close_time') || k.includes('close'));

    const symbol  = symbolKey ? r[symbolKey] : '';
    const rawType = typeKey   ? r[typeKey].toLowerCase()  : '';
    const profit  = profitKey ? parseFloat(r[profitKey].replace(/[^0-9.\-]/g, '')) : NaN;
    const volume  = volKey    ? parseFloat(r[volKey].replace(/[^0-9.]/g, ''))       : NaN;
    const openPx  = openPxKey  ? parseFloat(r[openPxKey].replace(/[^0-9.]/g, ''))  : NaN;
    const closePx = closePxKey ? parseFloat(r[closePxKey].replace(/[^0-9.]/g, '')) : NaN;
    const openTs  = openTsKey  ? r[openTsKey]  : '';
    const closeTs = closeTsKey ? r[closeTsKey] : '';

    // Skip non-trade rows (balance, credit, deposit lines in MT5)
    if (!symbol && isNaN(profit)) continue;
    const typeNorm = rawType.includes('buy') || rawType === 'long' ? 'BUY'
      : rawType.includes('sell') || rawType === 'short' ? 'SELL' : rawType.toUpperCase() || 'UNK';

    trades.push({ symbol, type: typeNorm, profit, volume, openPx, closePx, openTs, closeTs });
  }
  return trades.filter((t) => !isNaN(t.profit));
}

function computeBacktestStats(trades) {
  if (!trades.length) return null;

  const wins  = trades.filter((t) => t.profit > 0);
  const losses = trades.filter((t) => t.profit < 0);
  const grossProfit = wins.reduce((s, t) => s + t.profit, 0);
  const grossLoss   = Math.abs(losses.reduce((s, t) => s + t.profit, 0));
  const netProfit   = trades.reduce((s, t) => s + t.profit, 0);
  const winRate     = trades.length ? wins.length / trades.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const avgWin  = wins.length   ? grossProfit / wins.length   : 0;
  const avgLoss = losses.length ? grossLoss   / losses.length : 0;
  const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;
  const best  = trades.reduce((a, b) => b.profit > a.profit ? b : a, trades[0]);
  const worst = trades.reduce((a, b) => b.profit < a.profit ? b : a, trades[0]);

  // Max drawdown
  let peak = 0, equity = 0, maxDD = 0;
  for (const t of trades) {
    equity += t.profit;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  // Walk-forward OOS 70/30
  const splitIdx = Math.floor(trades.length * 0.7);
  const isTrades = trades.slice(0, splitIdx);
  const oosTrades = trades.slice(splitIdx);
  const isWr  = isTrades.length  ? isTrades.filter((t)  => t.profit > 0).length / isTrades.length  : 0;
  const oosWr = oosTrades.length ? oosTrades.filter((t) => t.profit > 0).length / oosTrades.length : 0;
  const oosNetProfit = oosTrades.reduce((s, t) => s + t.profit, 0);

  // Per-symbol breakdown
  const bySymbol = {};
  for (const t of trades) {
    const s = t.symbol || 'Unknown';
    if (!bySymbol[s]) bySymbol[s] = { symbol: s, trades: 0, wins: 0, netProfit: 0 };
    bySymbol[s].trades++;
    if (t.profit > 0) bySymbol[s].wins++;
    bySymbol[s].netProfit += t.profit;
  }
  const symbolStats = Object.values(bySymbol)
    .map((s) => ({ ...s, winRate: s.trades ? s.wins / s.trades : 0, netProfit: Number(s.netProfit.toFixed(2)) }))
    .sort((a, b) => b.netProfit - a.netProfit);

  // Equity curve (up to 200 points)
  let eq = 0;
  const step = Math.max(1, Math.floor(trades.length / 200));
  const equityCurve = trades.filter((_, i) => i % step === 0).map((t) => { eq += t.profit; return Number(eq.toFixed(2)); });

  return {
    total: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: Number((winRate * 100).toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    grossProfit: Number(grossProfit.toFixed(2)),
    grossLoss: Number(grossLoss.toFixed(2)),
    profitFactor: isFinite(profitFactor) ? Number(profitFactor.toFixed(3)) : 999,
    expectancy: Number(expectancy.toFixed(4)),
    avgWin: Number(avgWin.toFixed(2)),
    avgLoss: Number(avgLoss.toFixed(2)),
    maxDrawdownPct: Number((maxDD * 100).toFixed(2)),
    best:  { symbol: best.symbol,  profit: Number(best.profit.toFixed(2)),  type: best.type,  openTs: best.openTs },
    worst: { symbol: worst.symbol, profit: Number(worst.profit.toFixed(2)), type: worst.type, openTs: worst.openTs },
    walkForward: { splitAt: splitIdx, isWinRate: Number((isWr * 100).toFixed(2)), oosWinRate: Number((oosWr * 100).toFixed(2)), oosNetProfit: Number(oosNetProfit.toFixed(2)) },
    symbolStats,
    equityCurve
  };
}

function analyzeBacktestFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { ok: false, error: 'Archivo no encontrado' };
    const trades = detectAndParseCsv(filePath);
    if (!trades.length) return { ok: false, error: 'No se encontraron operaciones válidas. Verifica que el CSV tenga columnas de symbol/pair, type/side y profit/pnl.' };
    const stats = computeBacktestStats(trades);
    return { ok: true, file: path.basename(filePath), tradeCount: trades.length, stats };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ── MT5 Snapshot (sincronización desktop → cloud) ─────────────────────────────

function readMt5Snapshot() {
  ensureMemoryDir();
  if (!fs.existsSync(mt5SnapshotFile)) return null;
  try { return JSON.parse(fs.readFileSync(mt5SnapshotFile, 'utf8')); }
  catch { return null; }
}

function writeMt5Snapshot(data) {
  ensureMemoryDir();
  fs.writeFileSync(mt5SnapshotFile, JSON.stringify({ ...data, syncedAt: new Date().toISOString() }, null, 2), 'utf8');
}

// Empuja el snapshot MT5 al servidor cloud (llamado desde el desktop)
async function pushMt5ToCloud(snapshotData, env = ENV) {
  const syncUrl = (env.QUANT_SYNC_URL || QUANT_SYNC_URL || '').replace(/\/$/, '');
  const syncKey = env.QUANT_SYNC_KEY || QUANT_SYNC_KEY || '';
  if (!syncUrl || !syncKey) return { ok: false, reason: 'QUANT_SYNC_URL o QUANT_SYNC_KEY no configurados' };
  const body   = Buffer.from(JSON.stringify(snapshotData));
  const target = `${syncUrl}/api/mt5-push`;
  return new Promise((resolve) => {
    const mod = target.startsWith('https') ? https : http;
    const urlObj = new URL(target);
    const req = mod.request({
      hostname: urlObj.hostname,
      port:     urlObj.port || (target.startsWith('https') ? 443 : 80),
      path:     urlObj.pathname,
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Content-Length': body.length,
        'X-Sync-Key':    syncKey
      }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: res.statusCode < 300 }); } });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

// ── Generic cloud helpers ─────────────────────────────────────────────────────
async function httpPostCloud(endpoint, payload, env = ENV) {
  const syncUrl = (env.QUANT_SYNC_URL || QUANT_SYNC_URL || '').replace(/\/$/, '');
  const syncKey = env.QUANT_SYNC_KEY || QUANT_SYNC_KEY || '';
  if (!syncUrl || !syncKey) return { ok: false, reason: 'Sync not configured' };
  const body = Buffer.from(JSON.stringify(payload));
  const target = `${syncUrl}${endpoint}`;
  return new Promise((resolve) => {
    const mod = target.startsWith('https') ? https : http;
    const urlObj = new URL(target);
    const req = mod.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (target.startsWith('https') ? 443 : 80),
      path: urlObj.pathname + (urlObj.search || ''),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length, 'X-Sync-Key': syncKey }
    }, (res) => {
      let d = ''; res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ ok: res.statusCode < 300 }); } });
    });
    req.on('error', err => resolve({ ok: false, error: err.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(body); req.end();
  });
}

async function httpGetCloud(endpoint, env = ENV) {
  const syncUrl = (env.QUANT_SYNC_URL || QUANT_SYNC_URL || '').replace(/\/$/, '');
  const syncKey = env.QUANT_SYNC_KEY || QUANT_SYNC_KEY || '';
  if (!syncUrl || !syncKey) return null;
  const target = `${syncUrl}${endpoint}`;
  return new Promise((resolve) => {
    const mod = target.startsWith('https') ? https : http;
    const urlObj = new URL(target);
    const req = mod.request({
      hostname: urlObj.hostname,
      port: urlObj.port || (target.startsWith('https') ? 443 : 80),
      path: urlObj.pathname + (urlObj.search || ''),
      method: 'GET',
      headers: { 'X-Sync-Key': syncKey }
    }, (res) => {
      let d = ''; res.on('data', c => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ── Full data sync functions ───────────────────────────────────────────────────
function readAllMemoryEntries() {
  ensureMemoryDir();
  if (!fs.existsSync(memoryFile)) return [];
  return fs.readFileSync(memoryFile, 'utf8')
    .split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function mergeMemoryEntries(incoming) {
  ensureMemoryDir();
  const existing = readAllMemoryEntries();
  const keys = new Set(existing.map(e => e.ts || JSON.stringify(e).slice(0, 80)));
  const fresh = (incoming || []).filter(e => {
    const k = e.ts || JSON.stringify(e).slice(0, 80);
    return !keys.has(k);
  });
  if (fresh.length) fs.appendFileSync(memoryFile, fresh.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf8');
  return { ok: true, merged: fresh.length, total: existing.length + fresh.length };
}

function listConversationsWithMessages() {
  ensureConversationsDir();
  return fs.readdirSync(conversationsDir)
    .filter(f => f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(conversationsDir, f), 'utf8')); } catch { return null; } })
    .filter(Boolean);
}

function syncConversationsFromCloud(convList) {
  ensureConversationsDir();
  let saved = 0;
  for (const conv of (convList || [])) {
    if (!conv.id || !conv.messages) continue;
    try {
      const existing = fs.existsSync(convFile(conv.id))
        ? JSON.parse(fs.readFileSync(convFile(conv.id), 'utf8')) : null;
      if (!existing || new Date(conv.updatedAt || 0) >= new Date(existing.updatedAt || 0)) {
        saveConversation(conv.id, conv.name, conv.messages);
        saved++;
      }
    } catch {}
  }
  return { ok: true, saved };
}

async function pushAllDataToCloud(env = ENV) {
  try {
    const payload = {
      trainingState:      readTrainingState(),
      calibration:        readCalibration(),
      memories:           readAllMemoryEntries().slice(-600),
      conversations:      listConversationsWithMessages(),
      customInstructions: readCustomInstructions(),
      pushedAt:           new Date().toISOString(),
      source:             'desktop'
    };
    return await httpPostCloud('/api/data-push', payload, env);
  } catch (err) { return { ok: false, error: err.message }; }
}

async function pullDataFromCloud(env = ENV) {
  try {
    const data = await httpGetCloud('/api/data-export', env);
    if (!data || data.error) return { ok: false, error: data?.error || 'No data from cloud' };
    const applied = {};
    if (data.trainingState)        { writeTrainingState(data.trainingState);                   applied.trainingState = true; }
    if (data.memories?.length)     { const r = mergeMemoryEntries(data.memories);              applied.memories = r.merged; }
    if (data.conversations?.length){ const r = syncConversationsFromCloud(data.conversations); applied.conversations = r.saved; }
    if (data.customInstructions?.text) writeCustomInstructions(data.customInstructions.text);
    return { ok: true, applied };
  } catch (err) { return { ok: false, error: err.message }; }
}

// Captura el snapshot MT5 actual y lo guarda localmente + empuja al cloud si está configurado
// manual=true → usa mt5.login() para leer todas las cuentas configuradas (solo al hacer clic manual)
// manual=false → modo pasivo, solo lee la cuenta activa, sin reconexión al broker
async function syncMt5Snapshot(env = ENV, manual = false) {
  const mt5Enabled = String(env.MT5_CONNECTOR_ENABLED || 'false').toLowerCase() === 'true';
  if (!mt5Enabled && !(env.MT5_ACCOUNT1_LOGIN)) return { ok: false, reason: 'MT5 no configurado' };
  const passive = !manual;
  try {
    const [walletResult, posResult] = await Promise.allSettled([fullWallet(env, passive), livePositions(env, passive)]);
    const snapshot = {
      wallet:    walletResult.status  === 'fulfilled' ? { mt5: walletResult.value.mt5, mt5Accounts: walletResult.value.mt5Accounts } : null,
      positions: posResult.status     === 'fulfilled' ? { mt5: posResult.value.mt5 }                                                 : null,
      source:    'desktop',
      desktopVersion: '0.2.0'
    };
    writeMt5Snapshot(snapshot);
    const pushResult = (env.QUANT_SYNC_URL || QUANT_SYNC_URL) ? await pushMt5ToCloud(snapshot, env) : { ok: true, local: true };
    return { ok: true, syncedAt: new Date().toISOString(), pushed: pushResult.ok };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function fullWallet(env = ENV, passive = true) {
  const mt5Enabled = String(env.MT5_CONNECTOR_ENABLED || 'false').toLowerCase() === 'true';
  const hasMt5Creds = Boolean(env.MT5_ACCOUNT1_LOGIN);
  let bw;
  try {
    bw = await binanceWallet(env);
  } catch (err) {
    let usdCopFallback = 0;
    try { usdCopFallback = await usdCopRate(); } catch {}
    bw = binanceWalletUnavailable(err, usdCopFallback);
  }
  const usdCop = Number(bw.usdCop || 0);
  let mt5Accounts = [];

  if (mt5Enabled || hasMt5Creds) {
    // passive=true: only reads active account, no mt5.login() → broker stays stable
    try {
      const multi = await mt5MultiAccounts(usdCop, env, passive);
      mt5Accounts = multi.accounts || [];
    } catch {}
  }

  // Si no hay MT5 en vivo, usa el snapshot sincronizado desde el desktop
  if (!mt5Accounts.length) {
    const snap = readMt5Snapshot();
    if (snap?.wallet?.mt5Accounts?.length) {
      mt5Accounts = snap.wallet.mt5Accounts.map((a) => ({ ...a, fromSnapshot: true, syncedAt: snap.syncedAt }));
    }
  }

  const mt5Legacy = mt5Accounts.find((a) => a.available) || {
    available: false,
    message: (mt5Enabled || hasMt5Creds) ? 'Sin cuentas MT5 accesibles' : 'MT5 no configurado — usa sync desde desktop'
  };
  return { binance: bw, mt5: mt5Legacy, mt5Accounts };
}

// ── Auth (solo activa cuando WEB_AUTH_ENABLED=true en .env) ──────────────────
// Usamos tokens HMAC firmados (stateless) para que funcionen en Cloud Run
// donde cada request puede ir a una instancia diferente sin estado compartido.
const SESSION_TTL = 7 * 24 * 3600 * 1000;  // 7 días
const SESSION_SECRET = WEB_AUTH_PASSWORD + 'quant_session_v1';

function signToken(email, expiresAt) {
  const payload = `${email}|${expiresAt}`;
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const lastPipe = decoded.lastIndexOf('|');
    const payload  = decoded.slice(0, lastPipe);
    const sig      = decoded.slice(lastPipe + 1);
    const pipeSplit = payload.indexOf('|');
    const email     = payload.slice(0, pipeSplit);
    const expiresAt = parseInt(payload.slice(pipeSplit + 1), 10);
    if (Date.now() > expiresAt) return null;
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return email;
  } catch { return null; }
}

// Keep _sessions for backward compat (Electron IPC context)
const _sessions = new Map();
function genToken() { return crypto.randomBytes(32).toString('hex'); }

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map((c) => {
    const [k, ...v] = c.trim().split('=');
    return [k.trim(), v.join('=').trim()];
  }));
}

function currentUserFromRequest(req) {
  if (!WEB_AUTH_ENABLED) return WEB_AUTH_EMAIL;
  const cookies = parseCookies(req);
  const token = cookies.quant_session || '';
  const email = verifyToken(token);
  return email ? normalizeEmail(email) : null;
}

function isAuthenticated(req) {
  if (!WEB_AUTH_ENABLED) return true;
  return Boolean(currentUserFromRequest(req));
}

function startLocalWebServer() {
  if (webServer) return;
  // Cloud Run injects PORT; also accept QUANT_WEB_PORT for self-hosting
  const basePort = Number(process.env.PORT || ENV.QUANT_WEB_PORT || 47829);
  const listenHost = resolveListenHost({ isElectron: IS_ELECTRON, env: { ...ENV, ...process.env } });
  const tryListen = (port, attemptsLeft) => {
    activeWebPort = port;
    webServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${activeWebPort}`);
      if (url.pathname === '/healthz') return handleApi(req, res, url);

      // ── Login endpoint ────────────────────────────────────────────────
      if (url.pathname === '/auth/login' && req.method === 'POST') {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          let body = {};
          try { body = JSON.parse(raw); } catch {}
          const user = findUserByCredentials(body.email, body.password);
          if (user) {
            const expiresAt = Date.now() + SESSION_TTL;
            const token = signToken(user.email, expiresAt);
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'Set-Cookie': `quant_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}`
            });
            res.end(JSON.stringify({ ok: true, user: { email: user.email, displayName: user.displayName, role: user.role } }));
          } else {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'Credenciales incorrectas' }));
          }
        });
        return;
      }

      // ── Logout ────────────────────────────────────────────────────────
      if (url.pathname === '/auth/logout') {
        const cookies = parseCookies(req);
        _sessions.delete(cookies.quant_session || '');
        res.writeHead(302, { 'Location': '/login', 'Set-Cookie': 'quant_session=; Path=/; Max-Age=0' });
        res.end(); return;
      }

      // ── Protección: redirige a login si no autenticado ─────────────────
      if (WEB_AUTH_ENABLED && !isAuthenticated(req)) {
        if (url.pathname.startsWith('/api/')) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No autenticado' })); return;
        }
        if (url.pathname !== '/login') {
          res.writeHead(302, { 'Location': '/login' }); res.end(); return;
        }
      }

      if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
      return serveStatic(req, res, url);
    });
    webServer.once('error', (err) => {
      webServer = null;
      if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        return tryListen(port + 1, attemptsLeft - 1);
      }
      logger.error('server.listen.error', { port, message: err.message });
    });
    webServer.listen(port, listenHost, () => {
      logger.info('server.listen.ready', { host: listenHost, port });
      if (!trainingLoopAutoStartAttempted) {
        trainingLoopAutoStartAttempted = true;
        autoStartTrainingDemoLoopScheduler({
          env: { ...ENV, ...process.env },
          deps: {
            readTrainingStateSnapshot: () => trainingStateReader.readSnapshot(),
            writeTrainingState: (nextState) => writeTrainingState(nextState),
            getBinanceSymbols: () => binanceSymbols(),
            getTicker: (symbol) => ticker(symbol),
            readMt5Snapshot: () => readMt5Snapshot(),
            readMemory: (limit) => readMemory(limit)
          },
          logger
        });
      }
    });
  };
  tryListen(basePort, 10);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1720,
    height: 980,
    minWidth: 1360,
    minHeight: 820,
    backgroundColor: '#0a0e17',
    title: 'QUANT · AI Trading System',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

if (IS_ELECTRON) {
  app.whenReady().then(() => {
    startLocalWebServer();
    createWindow();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
} else {
  // Modo headless / cloud — solo arranca el servidor HTTP
  startLocalWebServer();
  logger.info('server.headless.ready', { port: Number(process.env.QUANT_WEB_PORT || 47829) });
}

ipcMain.handle('env-status', () => {
  const runtimePolicy = backendRuntimePolicy(ENV);
  return {
    envFile: ENV.__ENV_FILE || '',
    portableRoot: portableRoot(),
    dataDir: memoryDir,
    binance: Boolean(ENV.BINANCE_API_KEY && ENV.BINANCE_SECRET),
    deepseek: Boolean(ENV.DEEPSEEK_API_KEY),
    deepinfra: Boolean(ENV.DEEPINFRA_API_KEY),
    modelProvider: modelRoute().provider,
    model: modelRoute().model,
    finnhub: Boolean(ENV.FINNHUB_API_KEY),
    alpha: Boolean(ENV.ALPHA_VANTAGE_API_KEY),
    mt5Connector: String(ENV.MT5_CONNECTOR_ENABLED || 'false').toLowerCase() === 'true',
    webUrl: `http://127.0.0.1:${activeWebPort}`,
    binanceWhitelistIp: ENV.QUANT_VPS_PUBLIC_IP || DEFAULT_VPS_PUBLIC_IP,
    realTrading: runtimePolicy.state.tradingRealEnabled,
    realTradingArmedByEnv: runtimePolicy.envRealTradingArmed,
    trainingEnabled: runtimePolicy.state.trainingEnabled,
    killSwitch: runtimePolicy.state.killSwitch,
    paperMode: runtimePolicy.state.paperMode,
    riskValidation: runtimePolicy.riskValidation,
    desktopDownloadUrl: ENV.QUANT_DESKTOP_DOWNLOAD_URL || '',
    syncConfigured: Boolean(QUANT_SYNC_URL && QUANT_SYNC_KEY)
  };
});
ipcMain.handle('api-config-read',  () => apiConfigStatus(WEB_AUTH_EMAIL, effectiveEnvForUser(WEB_AUTH_EMAIL)));
ipcMain.handle('api-config-write', (_e, cfg) => writeApiConfigForUser(WEB_AUTH_EMAIL, cfg));
ipcMain.handle('bot-state-read', () => readBotState());
ipcMain.handle('risk-config-read', () => readRiskConfig());
ipcMain.handle('binance-symbols', () => binanceSymbols());
ipcMain.handle('mt5-symbols', () => String(ENV.MT5_CONNECTOR_ENABLED || 'false').toLowerCase() === 'true' ? mt5Symbols() : { ok: false, symbols: [], error: 'MT5 adapter disabled' });
ipcMain.handle('mt5-rates', (_e, symbol, timeframe, count) => String(ENV.MT5_CONNECTOR_ENABLED || 'false').toLowerCase() === 'true' ? mt5Rates(symbol, timeframe, count) : { ok: false, candles: [], error: 'MT5 adapter disabled' });
ipcMain.handle('ticker', (_e, symbol) => ticker(symbol));
ipcMain.handle('klines', (_e, symbol, interval, limit) => klines(symbol, interval, limit));
ipcMain.handle('wallet', () => fullWallet());
ipcMain.handle('chat', (_e, messages, context) => chat(messages, context));
ipcMain.handle('memory-write', (_e, kind, payload) => appendMemory(kind, payload));
ipcMain.handle('memory-read', (_e, limit) => readMemory(limit));
ipcMain.handle('memory-stats', () => memoryStats());
ipcMain.handle('memory-clear', () => clearMemory());
ipcMain.handle('training-state-read', () => readTrainingState());
ipcMain.handle('training-state-write', (_e, payload) => writeTrainingState(payload));
ipcMain.handle('custom-instructions-read', () => readCustomInstructions());
ipcMain.handle('custom-instructions-write', (_e, text) => writeCustomInstructions(text));
ipcMain.handle('calibration-read',    () => readCalibration());
ipcMain.handle('calibration-compute', () => computeCalibration());
ipcMain.handle('sync-mt5',            (_e, manual = false) => syncMt5Snapshot(ENV, Boolean(manual)));
ipcMain.handle('push-cloud-data',     () => pushAllDataToCloud(ENV));
ipcMain.handle('pull-cloud-data',     () => pullDataFromCloud(ENV));
ipcMain.handle('mt5-snapshot',        () => readMt5Snapshot());
ipcMain.handle('conversations-list',              () => listConversations());
ipcMain.handle('conversation-load',   (_e, id)   => loadConversation(id));
ipcMain.handle('conversation-save',   (_e, id, name, messages) => saveConversation(id, name, messages));
ipcMain.handle('conversation-rename', (_e, id, name) => renameConversation(id, name));
ipcMain.handle('conversation-delete', (_e, id)   => deleteConversation(id));
ipcMain.handle('alert-config-read',  () => readAlertConfig());
ipcMain.handle('alert-config-write', (_e, cfg) => writeAlertConfig(cfg));
ipcMain.handle('alert-log',          (_e, limit) => readAlertLog(limit));
ipcMain.handle('send-test-email',    (_e, cfg) => sendAlertEmail('Test de configuración', 'Si recibes este correo, las alertas de Quant están funcionando correctamente.\n\nPlataforma: QUANT AI Trading System', cfg));
ipcMain.handle('send-alert',         (_e, subject, body) => sendAlertEmail(subject, body));
ipcMain.handle('positions', () => livePositions());
ipcMain.handle('calc-position-size', (_e, symbol, riskPct, entryPrice, stopPrice) =>
  calcPositionSize(symbol, riskPct, entryPrice, stopPrice).catch((err) => ({ ok: false, error: err.message }))
);
ipcMain.handle('place-order', (_e, side, symbol, qty, type, price) =>
  placeOrderBinance(side, symbol, qty, type, price).catch((err) => ({ ok: false, error: err.message }))
);
ipcMain.handle('cancel-order', (_e, symbol, orderId) =>
  cancelOrderBinance(symbol, orderId).catch((err) => ({ ok: false, error: err.message }))
);
ipcMain.handle('select-csv-file', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win || BrowserWindow.getAllWindows()[0], {
    title: 'Seleccionar historial de trades (CSV)',
    filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }, { name: 'Todos', extensions: ['*'] }],
    properties: ['openFile']
  });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle('backtest-analyze', (_e, filePath) => analyzeBacktestFile(filePath));
ipcMain.handle('news-finnhub', async () => {
  if (!ENV.FINNHUB_API_KEY) return [];
  return requestJson('GET', `https://finnhub.io/api/v1/news?${query({ category: 'general', token: ENV.FINNHUB_API_KEY })}`);
});
ipcMain.handle('news-finnhub-crypto', () => fetchFinnhubCrypto());
ipcMain.handle('news-crypto-rss',     () => fetchCryptoNews());
ipcMain.handle('calendar-finnhub-economic', async () => {
  if (!ENV.FINNHUB_API_KEY) return [];
  const today = new Date();
  const from = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return requestJson('GET', `https://finnhub.io/api/v1/calendar/economic?${query({ from, to, token: ENV.FINNHUB_API_KEY })}`);
});
ipcMain.handle('news-alpha', async () => {
  if (!ENV.ALPHA_VANTAGE_API_KEY) return {};
  return requestJson('GET', `https://www.alphavantage.co/query?${query({ function: 'NEWS_SENTIMENT', apikey: ENV.ALPHA_VANTAGE_API_KEY })}`);
});
