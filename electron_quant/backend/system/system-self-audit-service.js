const fs = require('node:fs');
const path = require('node:path');

const SYSTEM_SELF_AUDIT_ALLOWED_SERVICES = Object.freeze([
  'quant.service',
  'quant-mt5-xvfb.service',
  'quant-mt5-terminal.service'
]);

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 200;
const TAIL_READ_BYTES = 64 * 1024;

function boolFlag(value) {
  return String(value || 'false').trim().toLowerCase() === 'true';
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampLimit(limit) {
  const number = Number(limit);
  if (!Number.isFinite(number)) return DEFAULT_HISTORY_LIMIT;
  return Math.max(1, Math.min(MAX_HISTORY_LIMIT, Math.floor(number)));
}

function sanitizeText(value) {
  return String(value || '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/sk-[A-Za-z0-9_-]{8,}/gi, 'sk-[REDACTED]')
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*[^,\s]+/gi, '$1=[REDACTED]')
    .slice(0, 240);
}

function connectorSummary(env = {}) {
  return {
    binance: { configured: Boolean(env.BINANCE_API_KEY && env.BINANCE_SECRET), required: true },
    deepseek: { configured: Boolean(env.DEEPSEEK_API_KEY || env.DEEPINFRA_API_KEY), required: true },
    finnhub: { configured: Boolean(env.FINNHUB_API_KEY), required: false },
    alphaVantage: { configured: Boolean(env.ALPHA_VANTAGE_API_KEY), required: false },
    mt5: {
      configured: boolFlag(env.MT5_CONNECTOR_ENABLED),
      required: false,
      demoTrading: boolFlag(env.MT5_DEMO_TRADING_ENABLED),
      realConfigured: Boolean(env.MT5_ACCOUNT_LOGIN && env.MT5_ACCOUNT_PASSWORD && env.MT5_ACCOUNT_SERVER),
      demoConfigured: Boolean(env.MT5_ACCOUNT2_LOGIN && env.MT5_ACCOUNT2_PASSWORD && env.MT5_ACCOUNT2_SERVER)
    }
  };
}

function summarizeTraining(snapshot, schedulerStatus, env = {}) {
  const state = snapshot?.state || {};
  const positions = Array.isArray(state.positions) ? state.positions : [];
  const openPositions = positions.filter((position) => !position.exit_price);
  return {
    stateAvailable: snapshot?.available === true,
    stateReason: snapshot?.available === true ? null : sanitizeText(snapshot?.reason || 'training_state_unavailable'),
    loopEnabled: boolFlag(env.TRAINING_BACKEND_LOOP_ENABLED) || schedulerStatus?.loopEnabled === true,
    schedulerEnabled: boolFlag(env.TRAINING_BACKEND_LOOP_SCHEDULER_ENABLED) || schedulerStatus?.enabled === true,
    schedulerActive: schedulerStatus?.active === true,
    ticksRun: finiteNumber(schedulerStatus?.ticksRun, 0),
    ticksSkipped: finiteNumber(schedulerStatus?.ticksSkipped, 0),
    lastTickAt: schedulerStatus?.lastTickAt || null,
    lastError: schedulerStatus?.lastError ? sanitizeText(schedulerStatus.lastError.message || schedulerStatus.lastError) : null,
    openPositions: openPositions.length,
    activePairs: Array.isArray(state.activePairs) ? state.activePairs.length : 0,
    closedTrades: Array.isArray(state.closedTrades) ? state.closedTrades.length : 0,
    lessons: Array.isArray(state.lessons) ? state.lessons.length : 0
  };
}

async function collectServiceStatuses(deps = {}) {
  const statuses = [];
  if (typeof deps.testServiceStatus !== 'function') {
    return SYSTEM_SELF_AUDIT_ALLOWED_SERVICES.map((service) => ({
      ok: false,
      service,
      active: false,
      reason: 'service_probe_unavailable'
    }));
  }

  for (const service of SYSTEM_SELF_AUDIT_ALLOWED_SERVICES) {
    try {
      const result = await deps.testServiceStatus(service);
      statuses.push({
        ok: result?.ok === true || result?.active === true,
        service,
        active: result?.active === true || result?.ok === true,
        reason: result?.reason ? sanitizeText(result.reason) : null
      });
    } catch (error) {
      statuses.push({
        ok: false,
        service,
        active: false,
        reason: sanitizeText(error?.message || error)
      });
    }
  }
  return statuses;
}

function buildFindings({ connectors, training, services, botState = {}, riskValidation = {} }) {
  const findings = [];
  const add = (severity, area, code, message, action) => findings.push({
    severity,
    area,
    code,
    message: sanitizeText(message),
    action: sanitizeText(action)
  });

  if (!connectors.binance.configured) add('warning', 'connector', 'binance_missing_keys', 'Binance no tiene claves configuradas.', 'Configurar API key y secret del usuario.');
  if (!connectors.deepseek.configured) add('warning', 'connector', 'ai_missing_key', 'Proveedor IA sin clave disponible.', 'Configurar DeepSeek o DeepInfra.');
  if (!connectors.mt5.configured) add('info', 'connector', 'mt5_disabled', 'MT5 connector deshabilitado.', 'Habilitar MT5 cuando Wine/terminal esten listos.');
  if (!training.stateAvailable) add('warning', 'training', 'training_state_unavailable', training.stateReason || 'Training state no disponible.', 'Revisar persistencia quant_data.');
  if (training.loopEnabled && training.schedulerEnabled && !training.schedulerActive) add('warning', 'training', 'training_scheduler_inactive', 'Scheduler de training configurado pero no activo.', 'Arrancar scheduler backend.');
  if (training.lastError) add('warning', 'training', 'training_scheduler_error', training.lastError, 'Revisar ultimo tick del scheduler.');
  for (const service of services) {
    if (!service.active) add('warning', 'vps', 'vps_service_inactive', `${service.service} no esta activo.`, 'Reiniciar servicio allowlist si remediation esta habilitada.');
  }
  if (botState.killSwitch) add('critical', 'execution', 'kill_switch_on', 'Kill switch esta activo.', 'Mantener trading real bloqueado hasta desactivacion manual.');
  if (riskValidation.ok === false) add('warning', 'risk', 'risk_config_invalid', 'Risk config invalida.', 'Corregir configuracion de riesgo.');

  return findings;
}

function severityRank(severity) {
  return severity === 'critical' ? 3 : severity === 'warning' ? 2 : severity === 'info' ? 1 : 0;
}

function summarizeSeverity(findings) {
  const max = findings.reduce((rank, finding) => Math.max(rank, severityRank(finding.severity)), 0);
  if (max >= 3) return 'critical';
  if (max >= 2) return 'warning';
  if (max >= 1) return 'info';
  return 'ok';
}

async function remediateServices(services, deps = {}, enabled = false) {
  const actions = [];
  if (!enabled || typeof deps.restartAllowedService !== 'function') return actions;
  for (const service of services) {
    if (service.active) continue;
    if (!SYSTEM_SELF_AUDIT_ALLOWED_SERVICES.includes(service.service)) continue;
    try {
      const result = await deps.restartAllowedService(service.service);
      actions.push({
        ok: result?.ok === true,
        service: service.service,
        action: 'restart',
        reason: result?.reason ? sanitizeText(result.reason) : null
      });
    } catch (error) {
      actions.push({
        ok: false,
        service: service.service,
        action: 'restart',
        reason: sanitizeText(error?.message || error)
      });
    }
  }
  return actions;
}

async function runSystemSelfAudit(options = {}) {
  const env = options.env || {};
  const deps = options.deps || {};
  const now = typeof options.now === 'function' ? options.now : () => new Date();
  const ts = new Date(now()).toISOString();
  const connectors = connectorSummary(env);
  const schedulerStatus = typeof deps.getTrainingLoopStatus === 'function'
    ? deps.getTrainingLoopStatus()
    : null;
  const trainingSnapshot = typeof deps.readTrainingStateSnapshot === 'function'
    ? deps.readTrainingStateSnapshot()
    : null;
  const training = summarizeTraining(trainingSnapshot, schedulerStatus, env);
  const services = await collectServiceStatuses(deps);
  const findings = buildFindings({
    connectors,
    training,
    services,
    botState: options.botState || {},
    riskValidation: options.riskValidation || {}
  });
  const remediationEnabled = boolFlag(env.SYSTEM_SELF_AUDIT_REMEDIATION_ENABLED);
  const actions = await remediateServices(services, deps, remediationEnabled);
  const severity = summarizeSeverity(findings);

  return {
    ok: true,
    ts,
    summary: {
      severity,
      findingsCount: findings.length,
      criticalCount: findings.filter((finding) => finding.severity === 'critical').length,
      warningCount: findings.filter((finding) => finding.severity === 'warning').length,
      infoCount: findings.filter((finding) => finding.severity === 'info').length
    },
    connectors,
    training,
    bot: {
      tradingRealEnabled: options.botState?.tradingRealEnabled === true,
      trainingEnabled: options.botState?.trainingEnabled !== false,
      killSwitch: options.botState?.killSwitch === true,
      paperMode: options.botState?.paperMode !== false
    },
    risk: {
      ok: options.riskValidation?.ok !== false,
      issues: Array.isArray(options.riskValidation?.issues) ? options.riskValidation.issues.map(sanitizeText).slice(0, 8) : []
    },
    vps: {
      services
    },
    findings,
    remediation: {
      enabled: remediationEnabled,
      allowlist: SYSTEM_SELF_AUDIT_ALLOWED_SERVICES.slice(),
      actions
    },
    safety: {
      realTradingTouched: false,
      arbitraryShell: false,
      secretsPersisted: false,
      allowedServicesOnly: true
    }
  };
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeSystemSelfAuditStatus(filePath, audit) {
  if (!filePath) return { ok: false, reason: 'status_file_missing' };
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  return { ok: true, file: filePath };
}

function readSystemSelfAuditStatus(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: true, available: false, audit: null };
  }
  try {
    return { ok: true, available: true, audit: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
  } catch (error) {
    return { ok: false, available: false, error: sanitizeText(error?.message || error), audit: null };
  }
}

function appendSystemSelfAuditHistory(filePath, entry) {
  if (!filePath) return { ok: false, reason: 'history_file_missing' };
  ensureDir(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  return { ok: true, file: filePath };
}

function readSystemSelfAuditHistory(filePath, limit = DEFAULT_HISTORY_LIMIT) {
  const resolvedLimit = clampLimit(limit);
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: true, exists: false, file: filePath || null, sizeBytes: 0, limit: resolvedLimit, entries: [] };
  }
  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, 'r');
  try {
    const bytesToRead = Math.min(stat.size, TAIL_READ_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    fs.readSync(fd, buffer, 0, bytesToRead, Math.max(0, stat.size - bytesToRead));
    let lines = buffer.toString('utf8').split(/\r?\n/).filter(Boolean);
    if (stat.size > TAIL_READ_BYTES && lines.length) lines = lines.slice(1);
    const entries = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // Ignore partial/corrupt history lines.
      }
    }
    return {
      ok: true,
      exists: true,
      file: filePath,
      sizeBytes: stat.size,
      limit: resolvedLimit,
      entries: entries.slice(-resolvedLimit)
    };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = {
  SYSTEM_SELF_AUDIT_ALLOWED_SERVICES,
  runSystemSelfAudit,
  writeSystemSelfAuditStatus,
  readSystemSelfAuditStatus,
  appendSystemSelfAuditHistory,
  readSystemSelfAuditHistory
};
