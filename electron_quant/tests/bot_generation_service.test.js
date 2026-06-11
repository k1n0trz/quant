const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  deriveBotSource,
  deriveMagicNumber,
  buildSymbolGate,
  isSupportedSymbol,
  generateDerivedBot
} = require('../backend/training/bot-generation-service');
const { buildTrainingBotsStatus, readBotTemplates } = require('../backend/training/bot-registry-service');

const SEED_DIR = path.join(__dirname, '..', 'bots', 'templates', 'EdiLearningBot_XAUUSD');
const SEED_SOURCE = fs.readFileSync(path.join(SEED_DIR, 'EdiTrainingBot_XAUUSD.mq5'), 'utf8');

test('seed source still contains the gold gate and magic input the generator rewrites', () => {
  assert.match(SEED_SOURCE, /if\(StringFind\(_Symbol, "XAUUSD"\) < 0 && StringFind\(_Symbol, "GOLD"\) < 0\)/);
  assert.match(SEED_SOURCE, /input\s+long\s+MAGIC_NUMBER\s*=\s*\d+\s*;/);
});

test('derived source swaps the symbol gate and assigns a distinct magic', () => {
  const derived = deriveBotSource(SEED_SOURCE, { symbol: 'EURUSD' });
  assert.equal(derived.symbol, 'EURUSD');
  // Gold gate gone, EURUSD gate present
  assert.doesNotMatch(derived.source, /StringFind\(_Symbol, "XAUUSD"\) < 0 && StringFind\(_Symbol, "GOLD"\)/);
  assert.match(derived.source, /if\(StringFind\(_Symbol, "EURUSD"\) < 0\)/);
  // Magic rewritten to the derived value
  assert.match(derived.source, new RegExp(`input\\s+long\\s+MAGIC_NUMBER\\s*=\\s*${derived.magic}\\s*;`));
  assert.notEqual(derived.magic, 2026052801);
});

test('gold variants keep a GOLD alias in the gate', () => {
  const gate = buildSymbolGate('XAUUSD');
  assert.match(gate, /StringFind\(_Symbol, "XAUUSD"\) < 0/);
  assert.match(gate, /StringFind\(_Symbol, "GOLD"\) < 0/);
});

test('magic numbers are deterministic and symbol-specific', () => {
  assert.equal(deriveMagicNumber('EURUSD'), deriveMagicNumber('EURUSD'));
  assert.notEqual(deriveMagicNumber('EURUSD'), deriveMagicNumber('GBPUSD'));
});

test('unsupported symbols are rejected before any write', () => {
  assert.equal(isSupportedSymbol('EURUSD'), true);
  assert.equal(isSupportedSymbol('..'), false);
  assert.equal(isSupportedSymbol(''), false);
  assert.throws(() => deriveBotSource(SEED_SOURCE, { symbol: '..' }), /unsupported_symbol/);
});

test('generateDerivedBot writes a real, picked-up, not-yet-compiled bot', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-bots-gen-'));
  const result = generateDerivedBot({ symbol: 'EURUSD', seedDir: SEED_DIR, outputRoot });
  assert.equal(result.ok, true);
  assert.equal(result.symbol, 'EURUSD');
  assert.equal(result.needsCompilation, true);
  assert.equal(result.botId, 'QuantAutoBot_EURUSD');

  // Files actually exist
  assert.equal(fs.existsSync(path.join(result.outputDir, 'QuantAutoBot_EURUSD.mq5')), true);
  assert.equal(fs.existsSync(path.join(result.outputDir, 'manifest.json')), true);

  // Registry picks it up and reports it as generated-needs-compile (no .ex5)
  const status = buildTrainingBotsStatus({ state: {}, templatesRoot: outputRoot });
  const bot = status.trainingBots.find((b) => b.id === 'QuantAutoBot_EURUSD');
  assert.ok(bot, 'generated bot must appear in registry');
  assert.equal(bot.status, 'generated_needs_compile');
  assert.equal(status.totals.generated, 1);
  assert.equal(status.totals.compiledReady, 0);
});

test('generateDerivedBot does not silently overwrite an existing bot', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-bots-gen-dup-'));
  const first = generateDerivedBot({ symbol: 'GBPUSD', seedDir: SEED_DIR, outputRoot });
  assert.equal(first.ok, true);
  const second = generateDerivedBot({ symbol: 'GBPUSD', seedDir: SEED_DIR, outputRoot });
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'bot_already_exists');
  const overwrite = generateDerivedBot({ symbol: 'GBPUSD', seedDir: SEED_DIR, outputRoot, overwrite: true });
  assert.equal(overwrite.ok, true);
});

test('registry merges seed templates and generated bots, generated winning by id', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-bots-merge-'));
  generateDerivedBot({ symbol: 'AUDUSD', seedDir: SEED_DIR, outputRoot });
  const merged = readBotTemplates(path.join(SEED_DIR, '..'), [outputRoot]);
  assert.ok(merged.some((t) => t.id === 'EdiLearningBot_XAUUSD'), 'seed template present');
  assert.ok(merged.some((t) => t.id === 'QuantAutoBot_AUDUSD'), 'generated bot present');
});
