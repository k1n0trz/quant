const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const router = fs.readFileSync(path.join(root, 'backend', 'routes', 'api-router.js'), 'utf8');
const scheduler = fs.readFileSync(path.join(root, 'backend', 'training', 'training-loop-scheduler.js'), 'utf8');

assert.ok(
  /const schedulerEnv = \{ \.\.\.effectiveEnvForUser\(WEB_AUTH_EMAIL\), \.\.\.process\.env \};/.test(main),
  'Autostart del scheduler debe usar el env efectivo del usuario, no solo ENV global.'
);
assert.ok(
  /env: schedulerEnv/.test(main),
  'Autostart debe pasar schedulerEnv al loop.'
);
for (const token of [
  'getMt5Symbols',
  'getMt5Ticker',
  'getSymbolFilters',
  'getBinanceSpotBalance',
  'getBinanceEarnBalance',
  'placeMt5DemoOrder',
  'closeMt5DemoPosition'
]) {
  assert.ok(main.includes(token), `Autostart debe cablear ${token}.`);
}
assert.ok(
  /placeMt5DemoOrder: \(input\) => placeMt5DemoOrder\(input, \{ env: schedulerEnv \}\)/.test(main),
  'Autostart debe invocar placeMt5DemoOrder con schedulerEnv.'
);
assert.ok(
  router.includes('Number(tickResult.mt5DemoOrdersAttempted || 0) > 0'),
  'POST /api/training/demo/tick debe persistir intentos MT5 demo aunque no haya cierre/apertura.'
);
for (const token of ['mt5DemoOrdersAttempted', 'mt5DemoOrdersSent', 'mt5DemoOrdersFailed']) {
  assert.ok(router.includes(`${token}: tickResult.${token}`), `API tick debe exponer ${token}.`);
  assert.ok(scheduler.includes(`${token}: tickResult.${token}`), `Scheduler debe exponer ${token}.`);
}
assert.ok(
  scheduler.includes('Number(tickResult.mt5DemoOrdersAttempted || 0) > 0'),
  'Scheduler debe persistir metadata de order_send MT5 demo.'
);

console.log('training_scheduler_mt5_demo_wiring_static.test.js OK');
