const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const corePanel = fs.readFileSync(path.join(root, 'src', 'views', 'quant-core-panel.js'), 'utf8');
const coreApi = fs.readFileSync(path.join(root, 'src', 'services', 'quant-core-api.js'), 'utf8');

for (const view of ['orders', 'backtest', 'alerts']) {
  assert.equal(new RegExp(`class="nav-item"[^>]+data-view="${view}"`).test(html), false, `${view} no debe estar en la navegacion principal.`);
}

assert.equal(/id="killSwitchBtn"/.test(html), false, 'El boton rojo grande de kill switch no debe estar visible en el shell principal.');
assert.equal(/id="killSwitchConfirm"/.test(html), false, 'El modal de kill switch no debe cargarse en el dashboard.');

assert.ok(html.includes('id="chartRefreshBtn"'), 'El dashboard debe tener boton de refresco de grafica sin recargar pagina.');
assert.ok(renderer.includes("$('chartRefreshBtn').addEventListener('click', () => refreshMarket(true))"), 'El refresco de chart debe llamar refreshMarket(true).');
assert.ok(renderer.includes('chartRequestId'), 'El renderer debe aislar respuestas tardias de velas por request id.');
assert.ok(renderer.includes('state.candles = []') && renderer.includes('state.chartStatus'), 'Cambiar simbolo/timeframe debe limpiar velas viejas antes de cargar nuevas.');

assert.ok(html.includes('id="cryptoNewsBtn"') && html.includes('id="newsCryptoPage"'), 'Noticias debe exponer seccion crypto.');
assert.ok(renderer.includes("refreshNews('crypto')"), 'El tab crypto debe refrescar noticias crypto.');
assert.ok(renderer.includes('Alpha Vantage no entrego feed ahora'), 'Alpha Vantage debe mostrar razon si la API responde sin feed.');

assert.ok(renderer.includes('function drawTrainingEquityCurve'), 'Training debe dibujar curva de equity desde el aprendizaje actual.');
assert.ok(renderer.includes('drawTrainingEquityCurve();'), 'renderTraining debe actualizar la curva de equity.');
assert.ok(renderer.includes('fmtShortDateTime'), 'Operaciones de training deben mostrar fecha breve, no solo hora.');

assert.ok(corePanel.includes('QUANT CORE · MOTOR DE APRENDIZAJE'), 'Quant Core debe nombrarse como motor de aprendizaje, no laboratorio ambiguo.');
assert.ok(corePanel.includes('ejecucion real='), 'Quant Core debe explicar el estado de ejecucion real sin exponer backendExecutable.');
assert.equal(/backendExecutable=/.test(corePanel), false, 'La UI no debe mostrar backendExecutable al operador.');
assert.ok(coreApi.includes('motor automatico en observacion'), 'El descriptor no debe decir backend inactivo.');

assert.ok(html.includes('id="settingsAlertsMount"'), 'Alertas deben montarse dentro de Configuracion.');
assert.ok(renderer.includes('mountAlertsIntoSettings(); loadAlerts();'), 'Configuracion debe cargar el panel de alertas integrado.');

assert.ok(css.includes('.chat-dock') && css.includes('minmax(520px, 1.6fr)'), 'El chat debe tener mas altura util para conversacion.');
assert.ok(css.includes('max-height: clamp(120px, 24vh, 260px)'), 'El contexto activo debe ser compacto para no comerse la conversacion.');
assert.ok(css.includes('.quant-rich') && css.includes('overflow-wrap: anywhere'), 'Las respuestas largas de Quant deben fluir completas sin cortar texto.');
assert.ok(css.includes('.wallet-view-panel .wallet-grid') && css.includes('auto-fit'), 'Billeteras debe usar tarjetas responsivas y no layout de desarrollo.');

console.log('ui_real_prep_static.test.js OK');
