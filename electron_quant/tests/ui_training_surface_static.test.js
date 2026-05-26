const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

assert.equal(/data-view="lab"/.test(html), false, 'Quant Lab no debe aparecer en la navegacion.');
assert.equal(/quant-lab-api|quant-lab-hero|quant-lab-panels|ui\/lab\.css|ui\/tokens\.css/.test(html), false, 'La UI no debe cargar assets de Quant Lab.');
assert.equal(/id="view-lab"/.test(html), false, 'El markup de Quant Lab debe salir del shell principal.');
assert.ok(html.includes('ENTRENAMIENTO DE QUANT'), 'Training debe ser la superficie principal visible.');
assert.ok(html.includes('trainingRuntimeStrip') && html.includes('trainingRuntimePill'), 'Training debe exponer estado real del scheduler.');
assert.ok(renderer.includes('trainingLoopStatus'), 'Renderer debe leer /api/training/demo/loop/status.');
assert.ok(renderer.includes('refreshTrainingRuntimeStatus'), 'Renderer debe refrescar el estado runtime de training.');
assert.ok(renderer.includes("event.target.id === 'apiConfigForm'"), 'El submit de APIs debe estar delegado y prevenir navegacion nativa.');
assert.ok(renderer.includes("conversationLoad:      (id)                        => apiPost('conversation-load', { id })"), 'Web debe restaurar conversaciones via POST para no perder el chat al refrescar.');
assert.ok(renderer.includes('APIs activas:'), 'Configuracion debe mostrar estado visible de APIs guardadas.');
assert.ok(css.includes('#view-lab') && css.includes('.nav-item[data-view="lab"]'), 'CSS debe bloquear cualquier resto accidental de Lab.');
assert.ok(css.includes('overflow-x: hidden'), 'La vista activa debe cortar overflow horizontal.');
assert.ok(main.includes("'TRAINING_BACKEND_LOOP_ENABLED'"), 'Cloud/VPS deben leer flags de loop desde process.env.');
assert.ok(main.includes('trainingStateReader.readSnapshot()'), 'Autostart debe usar el lector correcto del training state.');
assert.ok(main.includes('getBinanceSymbols: () => binanceSymbols()'), 'Loop backend debe poder sembrar universo Binance persistente.');

console.log('ui_training_surface_static.test.js OK');
