const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

assert.match(renderer, /binanceRealOrderPreflight:\s*\([^)]*\)\s*=>\s*apiPost\('binance-real-order-preflight'/, 'renderer debe exponer binanceRealOrderPreflight.');
assert.match(renderer, /binanceRealOrderAudit:\s*\([^)]*\)\s*=>\s*apiGet\(`binance-real-order-audit\?limit=\$\{/, 'renderer debe exponer binanceRealOrderAudit.');
assert.ok(preload.includes("binanceRealOrderPreflight: (payload) => ipcRenderer.invoke('binance-real-order-preflight', payload)"), 'preload debe exponer preflight Binance real.');
assert.ok(preload.includes("binanceRealOrderAudit: (limit) => ipcRenderer.invoke('binance-real-order-audit', limit)"), 'preload debe exponer audit Binance real.');
assert.ok(main.includes("ipcMain.handle('binance-real-order-preflight'"), 'main debe registrar IPC de preflight.');
assert.ok(main.includes("ipcMain.handle('binance-real-order-audit'"), 'main debe registrar IPC de audit.');

const submitBody = renderer.match(/async function submitOrder\(side\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nfunction updateClock/)?.[1] || '';
assert.ok(submitBody.includes('window.quant.binanceRealOrderPreflight'), 'submitOrder debe ejecutar preflight real Binance.');
assert.ok(submitBody.indexOf('window.quant.binanceRealOrderPreflight') < submitBody.indexOf('window.quant.placeOrder'), 'preflight debe ocurrir antes de placeOrder.');
assert.match(submitBody, /if\s*\(!preflight\.ok\)/, 'submitOrder debe bloquear cuando preflight no esta ready.');
assert.match(submitBody, /Preflight Binance/i, 'submitOrder debe mostrar feedback de preflight.');
assert.match(submitBody, /Faltante Spot/i, 'submitOrder debe mostrar faltante Spot.');
assert.match(submitBody, /Earn Flexible detectado/i, 'submitOrder debe mostrar saldo Earn detectado.');
assert.match(main, /getBinanceEarnBalance/, 'main debe leer saldo Simple Earn para preflight.');

const loadOrdersBody = renderer.match(/async function loadOrders\(\) \{([\s\S]*?)\r?\n\}\r?\n\r?\nfunction renderRealOrderAuditRows/)?.[1] || '';
assert.ok(loadOrdersBody.includes('window.quant.binanceRealOrderAudit'), 'loadOrders debe leer audit real Binance.');
assert.match(renderer, /function renderRealOrderAuditRows/, 'renderer debe tener render dedicado para audit real.');

assert.ok(html.includes('AUDIT REAL BINANCE'), 'Vista Ordenes debe nombrar el audit real Binance.');
assert.ok(html.includes('realOrderAuditMeta'), 'Vista Ordenes debe exponer metadata del audit real.');
assert.ok(css.includes('.real-order-row'), 'CSS debe incluir filas de audit real.');
assert.ok(css.includes('.real-order-row.error'), 'CSS debe resaltar errores reales.');
assert.equal(/placeOrderBinance|signedBinance/.test(html), false, 'HTML no debe referenciar ejecutores reales.');

console.log('binance_real_order_ui_static.test.js OK');
