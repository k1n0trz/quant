// Compile a Quant-generated MT5 bot (.mq5 -> .ex5) with MetaEditor under Wine,
// from the backend process itself (which runs as the same user that owns the
// Wine prefix on the VPS). This turns the "generate -> compile" pipeline fully
// autonomous: no manual SSH step.
//
// Verified method (see ops/mt5/compile-generated-bot.sh): MetaEditor /compile is
// asynchronous and returns before the .ex5 is written, so we poll for the output
// file; a stray MetaEditor process can make the next compile silently produce
// nothing, so we kill it first. Execution is injected (deps.spawnProcess /
// deps.fileSystem) so the orchestration is unit-testable without Wine.

const nodeFs = require('node:fs');
const nodePath = require('node:path');
const { spawn } = require('node:child_process');

function safeSymbol(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  return /^[A-Z0-9._]{3,24}$/.test(normalized) ? normalized : null;
}

function resolveCompileConfig(env = {}) {
  const dataDir = env.QUANT_DATA_DIR || '/var/lib/quant';
  const prefix = env.MT5_WINE_PREFIX || '/var/lib/quant/mt5/kinotrance';
  return {
    wineBin: env.MT5_WINE_BIN || '/usr/bin/wine',
    winePrefix: prefix,
    display: env.MT5_WINE_DISPLAY || ':77',
    metaeditorWin: env.MT5_METAEDITOR_WIN_PATH || 'C:\\Program Files\\MetaTrader 5\\MetaEditor64.exe',
    expertsDirUnix: env.MT5_EXPERTS_DIR
      || nodePath.join(prefix, 'drive_c', 'Program Files', 'MetaTrader 5', 'MQL5', 'Experts', 'Quant'),
    expertsDirWin: env.MT5_EXPERTS_WIN_DIR || 'C:\\Program Files\\MetaTrader 5\\MQL5\\Experts\\Quant',
    generatedRoot: env.QUANT_BOTS_GENERATED_DIR || nodePath.join(dataDir, 'bots', 'generated'),
    timeoutMs: Math.max(20000, Math.min(180000, Number(env.MT5_COMPILE_TIMEOUT_MS) || 120000)),
    pollMs: 3000,
    maxPolls: 14
  };
}

// Pure: the exact wine argv + env + file paths for a symbol's compile.
function buildCompileCommand(config, symbol) {
  const srcWin = `${config.expertsDirWin}\\QuantAutoBot_${symbol}.mq5`;
  return {
    bin: config.wineBin,
    args: [config.metaeditorWin, `/compile:${srcWin}`],
    env: { WINEPREFIX: config.winePrefix, DISPLAY: config.display, WINEDEBUG: '-all' },
    botDir: nodePath.join(config.generatedRoot, `QuantAutoBot_${symbol}`),
    mq5Src: nodePath.join(config.generatedRoot, `QuantAutoBot_${symbol}`, `QuantAutoBot_${symbol}.mq5`),
    mq5Dest: nodePath.join(config.expertsDirUnix, `QuantAutoBot_${symbol}.mq5`),
    ex5Out: nodePath.join(config.expertsDirUnix, `QuantAutoBot_${symbol}.ex5`),
    ex5Dest: nodePath.join(config.generatedRoot, `QuantAutoBot_${symbol}`, `QuantAutoBot_${symbol}.ex5`)
  };
}

function defaultSpawnProcess(bin, args, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { env: { ...process.env, ...(options.env || {}) }, windowsHide: true });
    } catch (error) {
      resolve({ ok: false, error: error.message });
      return;
    }
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, options.timeoutMs || 120000);
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString().slice(0, 2000); });
    child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, error: error.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ ok: true, code, stderr }); });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function compileGeneratedBot(input = {}, options = {}) {
  const env = options.env || {};
  const fs = options.fileSystem || nodeFs;
  const spawnProcess = options.spawnProcess || defaultSpawnProcess;
  const killStray = options.killStray || (async () => {});
  const sleep = options.sleep || wait;

  const symbol = safeSymbol(input.symbol);
  if (!symbol) return { ok: false, reason: 'invalid_symbol', symbol: input.symbol || null };

  const config = resolveCompileConfig(env);
  const cmd = buildCompileCommand(config, symbol);

  if (!fs.existsSync(cmd.mq5Src)) {
    return { ok: false, reason: 'generated_source_missing', symbol, expected: cmd.mq5Src };
  }
  if (!fs.existsSync(config.wineBin) && !options.skipWineCheck) {
    return { ok: false, reason: 'wine_unavailable', symbol, wineBin: config.wineBin };
  }

  // Stage source into the terminal Experts folder.
  try {
    fs.mkdirSync(config.expertsDirUnix, { recursive: true });
    fs.copyFileSync(cmd.mq5Src, cmd.mq5Dest);
  } catch (error) {
    return { ok: false, reason: 'stage_failed', symbol, error: error.message };
  }

  // Remove a previous .ex5 so we can detect a fresh build, and clear stray editors.
  try { if (fs.existsSync(cmd.ex5Out)) fs.unlinkSync(cmd.ex5Out); } catch {}
  await killStray();

  const run = await spawnProcess(cmd.bin, cmd.args, { env: cmd.env, timeoutMs: config.timeoutMs });
  if (!run.ok) {
    return { ok: false, reason: 'compiler_spawn_failed', symbol, error: run.error };
  }

  // MetaEditor writes the .ex5 asynchronously; poll for it.
  let compiled = false;
  for (let i = 0; i < config.maxPolls; i++) {
    if (fs.existsSync(cmd.ex5Out)) { compiled = true; break; }
    await sleep(config.pollMs);
  }
  if (!compiled) {
    return { ok: false, reason: 'ex5_not_produced', symbol, exit: run.code ?? null };
  }

  // Copy the .ex5 back into the generated bot folder and mark the manifest compiled.
  let bytes = null;
  try {
    fs.copyFileSync(cmd.ex5Out, cmd.ex5Dest);
    bytes = fs.statSync(cmd.ex5Dest).size;
    const manifestPath = nodePath.join(cmd.botDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const ex5Name = `QuantAutoBot_${symbol}.ex5`;
      if (!Array.isArray(manifest.sourceFiles)) manifest.sourceFiles = [];
      if (!manifest.sourceFiles.includes(ex5Name)) manifest.sourceFiles.push(ex5Name);
      manifest.needsCompilation = false;
      manifest.compiledAt = new Date().toISOString();
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }
  } catch (error) {
    return { ok: false, reason: 'ex5_sync_failed', symbol, error: error.message };
  }

  return { ok: true, symbol, ex5: cmd.ex5Dest, expertsEx5: cmd.ex5Out, bytes, compiledAt: new Date().toISOString() };
}

module.exports = {
  safeSymbol,
  resolveCompileConfig,
  buildCompileCommand,
  compileGeneratedBot
};
