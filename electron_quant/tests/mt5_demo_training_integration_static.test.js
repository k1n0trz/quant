const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const router = fs.readFileSync(path.join(root, 'backend', 'routes', 'api-router.js'), 'utf8');
const entry = fs.readFileSync(path.join(root, 'backend', 'training', 'training-demo-entry-service.js'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const mt5DemoService = fs.readFileSync(path.join(root, 'backend', 'adapters', 'mt5', 'mt5-demo-order-service.js'), 'utf8');

assert.ok(fs.existsSync(path.join(root, 'backend', 'adapters', 'mt5', 'mt5-demo-order-service.js')), 'Debe existir servicio MT5 demo order.');
assert.ok(main.includes('MT5_DEMO_TRADING_ENABLED'), 'Main debe cargar el flag MT5_DEMO_TRADING_ENABLED.');
assert.ok(main.includes('placeMt5DemoOrder'), 'Main debe cablear el executor MT5 demo.');
assert.ok(router.includes('/api/mt5-demo/order') && router.includes('placeMt5DemoOrder'), 'API debe exponer endpoint MT5 demo order separado.');
assert.ok(preload.includes('mt5DemoOrder'), 'Preload debe exponer bridge MT5 demo separado.');
assert.ok(entry.includes('TRAINING_MT5_DEMO_ORDER_SEND_ENABLED'), 'Training debe requerir flag propio para enviar orden demo MT5.');
assert.ok(entry.includes('placeMt5DemoOrder'), 'Training debe invocar el bridge solo al abrir posiciones MT5.');
assert.ok(entry.includes('mt5_demo_execution'), 'Posiciones de training deben registrar metadata de ejecucion demo MT5.');
assert.ok(mt5DemoService.includes('return demoServerLooksSafe(server);'), 'Bridge demo MT5 solo debe enviar comandos a servidores demo.');
assert.ok(renderer.includes('MT5 demo order_send') && renderer.includes('TRAINING_MT5_DEMO_ORDER_SEND_ENABLED'), 'El contexto de Quant debe saber si demo MT5 order_send esta habilitado.');
assert.ok(renderer.includes('mt5DemoPositionExecutionLabel'), 'Training UI debe mostrar ticket/fallo de order_send MT5 demo por posicion.');
assert.ok(renderer.includes('order_send ON'), 'Panel de contexto debe indicar cuando MT5 demo order_send esta armado.');
assert.equal(mt5DemoService.includes('placeOrderBinance'), false, 'MT5 demo no debe depender del executor Binance real.');
assert.equal(mt5DemoService.includes('REAL_TRADING'), false, 'MT5 demo no debe depender del flag de trading real.');
for (const line of main.split(/\r?\n/).filter((row) => row.includes('mt5-demo') || row.includes('placeMt5DemoOrder'))) {
  assert.equal(line.includes('placeOrderBinance'), false, 'Main no debe mezclar placeMt5DemoOrder con placeOrderBinance en el mismo handler.');
}

console.log('mt5_demo_training_integration_static.test.js OK');
