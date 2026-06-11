// Derives per-symbol MT5 Expert Advisors from an approved seed template.
//
// The seed EA (EdiTrainingBot_XAUUSD) is symbol-agnostic in its body -- it
// trades whatever chart `_Symbol` it is attached to -- except for a hard gate
// that refuses any non-gold symbol and a fixed magic number. Generating a bot
// for a new pair is therefore a deterministic source transformation: rewrite
// the symbol gate, assign a distinct magic, retitle the header. The result is
// real, valid MQL5 source. Compilation (.mq5 -> .ex5 via MetaEditor) and chart
// attachment still happen on the Wine MT5 host; this service never claims a bot
// is compiled or deployed.

const fs = require('node:fs');
const path = require('node:path');

const GOLD_GATE_PATTERN = /if\(StringFind\(_Symbol, "XAUUSD"\) < 0 && StringFind\(_Symbol, "GOLD"\) < 0\)/;
const MAGIC_INPUT_PATTERN = /(input\s+long\s+MAGIC_NUMBER\s*=\s*)(\d+)(\s*;)/;

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function isSupportedSymbol(symbol) {
  return /^[A-Z0-9._]{3,24}$/.test(normalizeSymbol(symbol));
}

function symbolGateTokens(symbol) {
  const normalized = normalizeSymbol(symbol);
  // Accept both the broker-suffixed and bare forms (e.g. EURUSD, EURUSD.r),
  // and keep GOLD as an alias for gold symbols so existing charts still match.
  const tokens = new Set([normalized]);
  const core = normalized.replace(/[^A-Z]/g, '');
  if (core && core !== normalized) tokens.add(core);
  if (/^XAU/.test(normalized)) tokens.add('GOLD');
  return Array.from(tokens);
}

function buildSymbolGate(symbol) {
  const tokens = symbolGateTokens(symbol);
  const condition = tokens.map((token) => `StringFind(_Symbol, "${token}") < 0`).join(' && ');
  return `if(${condition})`;
}

// Deterministic distinct magic per symbol so positions/deals never collide
// across generated bots. Stays inside MT5's long range.
function deriveMagicNumber(symbol, baseMagic = 2026052801) {
  const normalized = normalizeSymbol(symbol);
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) % 100000;
  }
  return Number(baseMagic) * 100 + hash;
}

function deriveBotSource(seedSource, options = {}) {
  const source = String(seedSource || '');
  const symbol = normalizeSymbol(options.symbol);
  if (!isSupportedSymbol(symbol)) {
    throw new Error(`unsupported_symbol:${options.symbol}`);
  }
  if (!GOLD_GATE_PATTERN.test(source)) {
    throw new Error('seed_symbol_gate_not_found');
  }
  if (!MAGIC_INPUT_PATTERN.test(source)) {
    throw new Error('seed_magic_input_not_found');
  }
  const magic = Number.isFinite(Number(options.magicNumber))
    ? Number(options.magicNumber)
    : deriveMagicNumber(symbol, options.baseMagic);

  let next = source.replace(GOLD_GATE_PATTERN, buildSymbolGate(symbol));
  next = next.replace(MAGIC_INPUT_PATTERN, `$1${magic}$3`);
  // Retitle the header comment lines so the file self-identifies.
  next = next.replace(/EdiTrainingBot_XAUUSD\.mq5/g, `QuantAutoBot_${symbol}.mq5`);
  next = next.replace(
    /Expert Advisor especializado para XAUUSD \/ Gold MT5/,
    `Expert Advisor derivado por Quant para ${symbol} (MT5)`
  );
  return { source: next, magic, symbol, gateTokens: symbolGateTokens(symbol) };
}

function buildDerivedManifest(options = {}) {
  const symbol = normalizeSymbol(options.symbol);
  return {
    id: options.id || `QuantAutoBot_${symbol}`,
    name: options.name || `Quant Auto Bot ${symbol}`,
    symbol,
    venue: options.venue || 'MT5',
    mode: 'training',
    templateRole: 'generated',
    generatedFrom: options.seedId || 'EdiLearningBot_XAUUSD',
    magicNumber: options.magicNumber,
    description: `Bot derivado automaticamente por Quant desde la plantilla aprobada para operar ${symbol}.`,
    sourceFiles: [`QuantAutoBot_${symbol}.mq5`],
    generatedAt: options.generatedAt || new Date().toISOString(),
    needsCompilation: true,
    notes: [
      'Fuente generada y valida; aun NO compilada (.ex5) ni adjuntada a un grafico.',
      'Compilar con MetaEditor en el host Wine antes de cualquier uso en demo o real.',
      'Separar derivados de training y real antes de cualquier ejecucion real.'
    ]
  };
}

function readSeedTemplate(seedDir, fileSystem = fs) {
  const manifestPath = path.join(seedDir, 'manifest.json');
  const manifest = JSON.parse(fileSystem.readFileSync(manifestPath, 'utf8'));
  const seedSourceFile = (manifest.sourceFiles || []).find((file) => /\.mq5$/i.test(file));
  if (!seedSourceFile) throw new Error('seed_source_file_missing');
  const source = fileSystem.readFileSync(path.join(seedDir, seedSourceFile), 'utf8');
  return { manifest, source };
}

function generateDerivedBot(options = {}) {
  const fileSystem = options.fileSystem || fs;
  const symbol = normalizeSymbol(options.symbol);
  if (!isSupportedSymbol(symbol)) {
    return { ok: false, reason: 'unsupported_symbol', symbol: options.symbol || null };
  }
  const seedDir = options.seedDir;
  const outputRoot = options.outputRoot;
  if (!seedDir || !outputRoot) {
    return { ok: false, reason: 'seed_or_output_missing' };
  }

  let seed;
  try {
    seed = readSeedTemplate(seedDir, fileSystem);
  } catch (err) {
    return { ok: false, reason: 'seed_read_failed', error: err.message };
  }

  const outputDir = path.join(outputRoot, `QuantAutoBot_${symbol}`);
  if (fileSystem.existsSync(outputDir) && !options.overwrite) {
    return { ok: false, reason: 'bot_already_exists', symbol, outputDir };
  }

  let derived;
  try {
    derived = deriveBotSource(seed.source, {
      symbol,
      magicNumber: options.magicNumber,
      baseMagic: seed.manifest.magicNumber
    });
  } catch (err) {
    return { ok: false, reason: 'derive_failed', error: err.message, symbol };
  }

  const manifest = buildDerivedManifest({
    symbol,
    venue: options.venue,
    seedId: seed.manifest.id,
    magicNumber: derived.magic,
    generatedAt: options.generatedAt
  });

  try {
    fileSystem.mkdirSync(outputDir, { recursive: true });
    fileSystem.writeFileSync(path.join(outputDir, `QuantAutoBot_${symbol}.mq5`), derived.source, 'utf8');
    fileSystem.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fileSystem.writeFileSync(
      path.join(outputDir, 'README.md'),
      [
        `# ${manifest.name}`,
        '',
        `Bot derivado por Quant desde \`${manifest.generatedFrom}\` para operar ${symbol}.`,
        '',
        'Estado: fuente generada, pendiente de compilacion (.ex5) en el host Wine de MT5.',
        `Magic number asignado: ${derived.magic}.`,
        ''
      ].join('\n'),
      'utf8'
    );
  } catch (err) {
    return { ok: false, reason: 'write_failed', error: err.message, symbol };
  }

  return {
    ok: true,
    symbol,
    botId: manifest.id,
    magic: derived.magic,
    outputDir,
    needsCompilation: true,
    manifest
  };
}

module.exports = {
  deriveBotSource,
  buildDerivedManifest,
  deriveMagicNumber,
  buildSymbolGate,
  isSupportedSymbol,
  generateDerivedBot
};
