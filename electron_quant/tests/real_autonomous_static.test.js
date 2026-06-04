const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const router = fs.readFileSync(path.join(root, 'backend/routes/api-router.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src/renderer.js'), 'utf8');
const scheduler = fs.readFileSync(path.join(root, 'backend/execution/real-autonomous-scheduler.js'), 'utf8');

assert.ok(main.includes("require('./backend/execution/real-autonomous-scheduler')"), 'main debe importar el scheduler real autonomo.');
assert.ok(main.includes('const realAutonomousScheduler = createRealAutonomousSchedulerController()'), 'main debe crear un controller persistente.');
assert.ok(main.includes('REAL_AUTONOMOUS_SCHEDULER_ENABLED'), 'main debe permitir configurar REAL_AUTONOMOUS_SCHEDULER_ENABLED.');
assert.ok(main.includes('real.autonomous.autostart'), 'main debe registrar autostart del scheduler real.');
assert.ok(main.includes('createRealAutonomousRuntimeContext(realEnv)'), 'autostart debe usar contexto runtime real.');
assert.ok(main.includes('effectiveEnvForUser(WEB_AUTH_EMAIL)'), 'autostart debe usar las APIs guardadas del usuario admin.');

for (const route of [
  '/api/real-autonomous/status',
  '/api/real-autonomous/tick',
  '/api/real-autonomous/start',
  '/api/real-autonomous/stop'
]) {
  assert.ok(router.includes(route), `api-router debe exponer ${route}.`);
}

assert.ok(router.includes('discoverBinanceRealSpotUniverse'), 'router debe construir universo real Binance desde el servicio existente.');
assert.ok(router.includes('auditBinanceRealOrder(deps'), 'tick autonomo debe auditar las ordenes Binance reales.');
assert.ok(preload.includes("realAutonomousStatus: () => ipcRenderer.invoke('real-autonomous-status')"), 'preload debe exponer status autonomo.');
assert.ok(preload.includes("realAutonomousTick: () => ipcRenderer.invoke('real-autonomous-tick')"), 'preload debe exponer tick autonomo.');
assert.ok(renderer.includes("realAutonomousStatus:  ()"), 'renderer web debe exponer status via HTTP.');
assert.ok(renderer.includes("apiPost('real-autonomous/tick'"), 'renderer web debe exponer tick via HTTP.');

assert.ok(scheduler.includes('getRealAutonomousOrdersToday'), 'scheduler debe respetar cap diario inyectado.');
assert.ok(scheduler.includes('already_open_real_position'), 'scheduler debe evitar duplicar pares ya abiertos.');
assert.ok(scheduler.includes('REAL_AUTONOMOUS_MT5_ENABLED'), 'MT5 real debe requerir flag explicito.');
assert.ok(!/blockRealExecution/.test(scheduler), 'scheduler real no debe depender del flag de training blockRealExecution.');
assert.ok(!/BTCUSDT['"]/.test(scheduler), 'scheduler real no debe hardcodear BTCUSDT.');

console.log('real_autonomous_static OK');
