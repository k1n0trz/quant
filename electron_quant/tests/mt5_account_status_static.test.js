const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

assert.ok(main.includes('function buildMt5AccountStatus'), 'main debe construir estado MT5 Demo/Real separado.');
assert.ok(main.includes('function publicMt5Config'), 'main debe publicar config MT5 sin passwords.');
assert.ok(main.includes('mt5Demo: mt5AccountStatus.demo'), 'env-status debe exponer mt5Demo.');
assert.ok(main.includes('mt5Real: mt5AccountStatus.real'), 'env-status debe exponer mt5Real.');
assert.ok(main.includes('MT5_ACCOUNT2_LOGIN') && main.includes('MT5_ACCOUNT1_LOGIN'), 'estado debe distinguir cuenta demo slot 2 y real slot 1.');
assert.equal(/Number\(bridge\.tradeMode\)\s*===\s*0\s*\|\|/.test(main), false, 'trade_mode=0 no debe clasificar MT5 como demo.');
assert.ok(/is_demo:\s*\/\\b(?:demo)\\b\/i\.test\(server\)/.test(main), 'demo debe clasificarse por servidor demo.');

assert.ok(html.includes('stMt5Demo') && html.includes('stMt5Real'), 'sidebar debe tener filas MT5 Demo y MT5 Real.');
assert.ok(renderer.includes('renderMt5AccountStatuses'), 'renderer debe renderizar MT5 Demo/Real separado.');
assert.ok(renderer.includes('state.env.mt5Demo') && renderer.includes('state.env.mt5Real'), 'renderer debe leer mt5Demo/mt5Real.');
assert.ok(renderer.includes('Demo conectada') && renderer.includes('Real conectado'), 'renderer debe usar textos claros para Demo y Real.');
assert.equal(/stMt5'\)\.textContent\s*=/.test(renderer), false, 'wallet no debe sobrescribir estado MT5 calculado.');

console.log('mt5_account_status_static.test.js OK');
