const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'ops', 'mt5', 'QuantBridge.mq5'), 'utf8');

assert.ok(preload.includes('mt5RealOrderPreflight'), 'preload debe exponer mt5RealOrderPreflight.');
assert.ok(preload.includes('mt5RealOrder'), 'preload debe exponer mt5RealOrder.');
assert.ok(renderer.includes("apiPost('mt5-real/preflight'"), 'web renderer debe llamar /api/mt5-real/preflight.');
assert.ok(renderer.includes("apiPost('mt5-real/order'"), 'web renderer debe llamar /api/mt5-real/order.');
assert.ok(renderer.includes("venue === 'MT5'"), 'submitOrder debe tener rama MT5.');
assert.ok(!renderer.includes('Ejecución real actualmente solo disponible en BINANCE'), 'submitOrder no debe bloquear MT5 por venue.');
assert.ok(main.includes("ipcMain.handle('mt5-real-order-preflight'"), 'main debe registrar IPC mt5-real-order-preflight.');
assert.ok(main.includes("ipcMain.handle('mt5-real-order'"), 'main debe registrar IPC mt5-real-order.');
assert.ok(bridge.includes('AllowRealOrderSend'), 'QuantBridge debe tener flag AllowRealOrderSend.');
assert.ok(bridge.includes('action != "ORDER" && action != "CLOSE" && action != "CHECK"'), 'QuantBridge debe aceptar CHECK.');
assert.ok(bridge.includes('OrderCheck'), 'QuantBridge debe ejecutar order_check/check antes de real.');
assert.ok(bridge.includes('real_order_not_allowed'), 'QuantBridge debe bloquear real si AllowRealOrderSend=false.');

console.log('mt5_real_order_ui_static.test.js OK');
