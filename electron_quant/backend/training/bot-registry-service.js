const fs = require('node:fs');
const path = require('node:path');

function safeString(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function sourceSummary(dir, sourceFiles = []) {
  const files = Array.isArray(sourceFiles) ? sourceFiles : [];
  const hasSource = files.some((file) => /\.mq5$/i.test(file) && fs.existsSync(path.join(dir, file)));
  const hasCompiled = files.some((file) => /\.ex5$/i.test(file) && fs.existsSync(path.join(dir, file)));
  return { hasSource, hasCompiled };
}

function readBotTemplates(templatesRoot = path.join(process.cwd(), 'bots', 'templates')) {
  if (!fs.existsSync(templatesRoot)) return [];
  return fs.readdirSync(templatesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(templatesRoot, entry.name);
      const manifest = readJson(path.join(dir, 'manifest.json'));
      if (!manifest || typeof manifest !== 'object') return null;
      const files = Array.isArray(manifest.sourceFiles) ? manifest.sourceFiles.filter((file) => typeof file === 'string') : [];
      const summary = sourceSummary(dir, files);
      return {
        id: safeString(manifest.id, entry.name),
        name: safeString(manifest.name, entry.name),
        symbol: safeString(manifest.symbol, 'XAUUSD'),
        venue: safeString(manifest.venue, 'MT5'),
        mode: safeString(manifest.mode, 'training'),
        templateRole: safeString(manifest.templateRole, 'seed'),
        description: safeString(manifest.description, ''),
        sourceFiles: files,
        relativePath: path.relative(process.cwd(), dir).replace(/\\/g, '/'),
        hasSource: summary.hasSource,
        hasCompiled: summary.hasCompiled,
        importedAt: safeString(manifest.importedAt, null)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

function sameSymbol(left = {}, right = {}) {
  return String(left.symbol || '').toUpperCase() === String(right.symbol || '').toUpperCase()
    && String(left.venue || '').toUpperCase() === String(right.venue || '').toUpperCase();
}

function botFinancials(bot, state = {}) {
  const closed = Array.isArray(state.closedTrades) ? state.closedTrades.filter((trade) => sameSymbol(bot, trade)) : [];
  const open = Array.isArray(state.positions) ? state.positions.filter((position) => !position.exit_price && sameSymbol(bot, position)) : [];
  const realizedPnl = closed.reduce((sum, trade) => sum + numberOrZero(trade.pnl_demo), 0);
  const wins = closed.filter((trade) => numberOrZero(trade.pnl_demo) >= 0).length;
  return {
    openPositions: open.length,
    closedTrades: closed.length,
    realizedPnl: Number(realizedPnl.toFixed(2)),
    winRate: closed.length ? Number((wins / closed.length).toFixed(4)) : null
  };
}

function buildTrainingBotFromTemplate(template, state = {}) {
  return {
    ...template,
    mode: 'training',
    status: template.hasSource ? 'template_ready' : 'template_missing_source',
    scope: 'demo_training',
    ...botFinancials(template, state)
  };
}

function buildQueuedBot(pair, template = null, state = {}) {
  const bot = {
    id: `QuantAuto_${safeString(pair.venue, 'BINANCE')}_${safeString(pair.symbol, 'UNKNOWN')}`,
    name: `Quant Auto ${safeString(pair.symbol, 'UNKNOWN')}`,
    symbol: safeString(pair.symbol, 'UNKNOWN'),
    venue: safeString(pair.venue, 'BINANCE'),
    mode: 'training',
    status: 'queued_for_generation',
    scope: 'demo_training',
    templateSource: template?.id || null,
    hasSource: false,
    hasCompiled: false,
    description: 'Pendiente de generacion automatica desde la plantilla aprobada.'
  };
  return { ...bot, ...botFinancials(bot, state) };
}

function activePairsFromState(state = {}) {
  const explicit = Array.isArray(state.activePairs) ? state.activePairs.filter((pair) => pair?.venue && pair?.symbol) : [];
  if (explicit.length) return explicit;
  const seen = new Set();
  return (Array.isArray(state.positions) ? state.positions : [])
    .filter((position) => position?.venue && position?.symbol && !position.exit_price)
    .filter((position) => {
      const key = `${position.venue}:${position.symbol}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((position) => ({ venue: position.venue, symbol: position.symbol }));
}

function buildTrainingBotsStatus(options = {}) {
  const state = options.state || {};
  const templates = Array.isArray(options.templates) ? options.templates : readBotTemplates(options.templatesRoot);
  const seed = templates[0] || null;
  const trainingBots = templates.map((template) => buildTrainingBotFromTemplate(template, state));
  const activePairs = activePairsFromState(state);
  for (const pair of activePairs) {
    if (!pair || !pair.symbol || trainingBots.some((bot) => sameSymbol(bot, pair))) continue;
    trainingBots.push(buildQueuedBot(pair, seed, state));
  }
  const realBots = templates.map((template) => ({
    ...template,
    mode: 'real',
    status: 'not_deployed',
    scope: 'real_separated',
    openPositions: 0,
    closedTrades: 0,
    realizedPnl: 0,
    winRate: null,
    sourceTrainingTemplate: template.id
  }));
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    templatesCount: templates.length,
    trainingBots,
    realBots,
    totals: {
      training: trainingBots.length,
      real: realBots.length,
      realizedPnl: Number(trainingBots.reduce((sum, bot) => sum + numberOrZero(bot.realizedPnl), 0).toFixed(2))
    },
    safety: {
      readOnly: true,
      realTradingTouched: false,
      writesPerformed: false
    }
  };
}

module.exports = {
  readBotTemplates,
  buildTrainingBotsStatus
};
