const test = require('node:test');
const assert = require('node:assert/strict');

const {
  safeSymbol,
  resolveCompileConfig,
  buildCompileCommand,
  compileGeneratedBot
} = require('../backend/training/bot-compile-service');

test('safeSymbol accepts FX/crypto symbols and rejects traversal', () => {
  assert.equal(safeSymbol('eurusd'), 'EURUSD');
  assert.equal(safeSymbol('XAUUSD'), 'XAUUSD');
  assert.equal(safeSymbol('../etc'), null);
  assert.equal(safeSymbol(''), null);
});

test('buildCompileCommand produces the verified wine invocation and paths', () => {
  const cfg = resolveCompileConfig({ QUANT_DATA_DIR: '/var/lib/quant' });
  const cmd = buildCompileCommand(cfg, 'EURUSD');
  assert.equal(cmd.bin, '/usr/bin/wine');
  assert.equal(cmd.args[0], 'C:\\Program Files\\MetaTrader 5\\MetaEditor64.exe');
  assert.equal(cmd.args[1], '/compile:C:\\Program Files\\MetaTrader 5\\MQL5\\Experts\\Quant\\QuantAutoBot_EURUSD.mq5');
  assert.equal(cmd.env.WINEPREFIX, '/var/lib/quant/mt5/kinotrance');
  assert.equal(cmd.env.DISPLAY, ':77');
  assert.match(cmd.mq5Src, /bots[\\/]generated[\\/]QuantAutoBot_EURUSD[\\/]QuantAutoBot_EURUSD\.mq5$/);
});

// In-memory fake fs covering only the calls the service makes.
function fakeFs(present = new Set(), files = {}) {
  return {
    _present: present,
    _files: files,
    existsSync: (p) => present.has(p),
    mkdirSync: () => {},
    copyFileSync: (src, dest) => { present.add(dest); files[dest] = files[src] || ''; },
    unlinkSync: (p) => { present.delete(p); },
    statSync: () => ({ size: 219626 }),
    readFileSync: (p) => files[p],
    writeFileSync: (p, data) => { present.add(p); files[p] = data; }
  };
}

test('compileGeneratedBot compiles, syncs ex5 and marks the manifest', async () => {
  const cfg = resolveCompileConfig({});
  const cmd = buildCompileCommand(cfg, 'GBPUSD');
  const present = new Set([cfg.wineBin, cmd.mq5Src]);
  const manifestPath = cmd.botDir + require('node:path').sep + 'manifest.json';
  const files = { [manifestPath]: JSON.stringify({ id: 'QuantAutoBot_GBPUSD', sourceFiles: ['QuantAutoBot_GBPUSD.mq5'], needsCompilation: true }) };
  present.add(manifestPath);
  const fs = fakeFs(present, files);

  let killed = false;
  const result = await compileGeneratedBot({ symbol: 'GBPUSD' }, {
    env: {},
    fileSystem: fs,
    killStray: async () => { killed = true; },
    sleep: async () => {},
    spawnProcess: async () => { present.add(cmd.ex5Out); return { ok: true, code: 0 }; }
  });

  assert.equal(result.ok, true);
  assert.equal(result.symbol, 'GBPUSD');
  assert.equal(killed, true, 'stray MetaEditor must be cleared first');
  assert.equal(fs.existsSync(cmd.ex5Dest), true, 'ex5 copied back to generated folder');
  const manifest = JSON.parse(files[manifestPath]);
  assert.equal(manifest.needsCompilation, false);
  assert.ok(manifest.sourceFiles.includes('QuantAutoBot_GBPUSD.ex5'));
});

test('compileGeneratedBot reports when MetaEditor produces no ex5', async () => {
  const cfg = resolveCompileConfig({});
  const cmd = buildCompileCommand(cfg, 'USDJPY');
  const fs = fakeFs(new Set([cfg.wineBin, cmd.mq5Src]));
  const result = await compileGeneratedBot({ symbol: 'USDJPY' }, {
    env: {}, fileSystem: fs, sleep: async () => {},
    spawnProcess: async () => ({ ok: true, code: 0 }) // never creates ex5
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ex5_not_produced');
});

test('compileGeneratedBot refuses an unknown / unsanitized symbol', async () => {
  const r = await compileGeneratedBot({ symbol: '../x' }, { env: {}, skipWineCheck: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'invalid_symbol');
});

test('compileGeneratedBot blocks when the generated source is missing', async () => {
  const cfg = resolveCompileConfig({});
  const fs = fakeFs(new Set([cfg.wineBin]));
  const r = await compileGeneratedBot({ symbol: 'AUDUSD' }, { env: {}, fileSystem: fs });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'generated_source_missing');
});
