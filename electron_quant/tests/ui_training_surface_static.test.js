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
for (const retired of [
  path.join(root, 'src', 'views', 'quant-lab-hero.js'),
  path.join(root, 'src', 'views', 'quant-lab-panels.js'),
  path.join(root, 'src', 'services', 'quant-lab-api.js'),
  path.join(root, 'src', 'ui', 'lab.css'),
  path.join(root, 'src', 'ui', 'tokens.css')
]) {
  assert.equal(fs.existsSync(retired), false, `Artefacto retirado de Quant Lab no debe existir: ${path.basename(retired)}`);
}
assert.ok(html.includes('ENTRENAMIENTO DE QUANT'), 'Training debe ser la superficie principal visible.');
assert.ok(html.includes('trainingRuntimeStrip') && html.includes('trainingRuntimePill'), 'Training debe exponer estado real del scheduler.');
assert.ok(renderer.includes('trainingLoopStatus'), 'Renderer debe leer /api/training/demo/loop/status.');
assert.ok(renderer.includes('refreshTrainingRuntimeStatus'), 'Renderer debe refrescar el estado runtime de training.');
assert.ok(renderer.indexOf('state.env = await window.quant.envStatus();') < renderer.indexOf('await loadLastConversationIfAny();'), 'El estado de APIs/training debe cargar antes que conversaciones u otros modulos no criticos.');
assert.ok(renderer.indexOf('renderStatus();') < renderer.indexOf('await loadLastConversationIfAny();'), 'El sidebar de APIs no debe depender de que cargue el chat.');
assert.ok(renderer.includes("event.target.id === 'apiConfigForm'"), 'El submit de APIs debe estar delegado y prevenir navegacion nativa.');
assert.ok(renderer.includes("conversationLoad:      (id)                        => apiPost('conversation-load', { id })"), 'Web debe restaurar conversaciones via POST para no perder el chat al refrescar.');
assert.ok(renderer.includes('APIs activas:'), 'Configuracion debe mostrar estado visible de APIs guardadas.');
assert.ok(renderer.includes('apiConfigActiveLabels'), 'Configuracion debe resumir APIs activas por integracion, no por clave cruda duplicada.');
assert.ok(renderer.includes("'Binance Spot'"), 'Resumen de APIs debe mostrar Binance una sola vez cuando key y secret existen.');
assert.ok(renderer.includes('state.env.apiConfigStatus = cfg'), 'Leer configuracion de APIs debe refrescar el estado lateral aunque el boot haya quedado atrasado.');
assert.ok(renderer.includes("'IP Binance whitelist'"), 'Ajustes debe mostrar la IP que se debe autorizar en Binance.');
assert.ok(main.includes('binanceWhitelistIp'), 'env-status debe exponer la IP de whitelist Binance para Cloud/VPS.');
assert.ok(renderer.includes("setConnectorStatus('stBinance', state.env.binance"), 'Sidebar debe confirmar Binance activa o sin claves sin puntos suspensivos.');
assert.equal(/id="stBinance">\.\.\./.test(html), false, 'Sidebar no debe mostrar puntos suspensivos ambiguos para Binance.');
assert.equal(/id="stBinance">Cargando/.test(html), false, 'Sidebar no debe quedar visualmente en Cargando como estado por defecto.');
assert.equal(/>Verificando</.test(html), false, 'Sidebar no debe iniciar en Verificando; debe mostrar Sin lectura hasta cargar la configuracion real.');
assert.ok(renderer.indexOf('await loadApiConfig();') < renderer.indexOf('await loadLastConversationIfAny();'), 'El boot debe aplicar la configuracion de APIs persistida antes de cargar chat u otros modulos.');
assert.ok(renderer.includes('connectorSourceLabel'), 'Sidebar debe indicar si una API activa viene de usuario, .env o fuente mixta.');
assert.ok(renderer.includes("Activa (${connectorSourceLabel(['BINANCE_API_KEY', 'BINANCE_SECRET'])})"), 'Binance debe mostrar fuente real de las claves, no solo un estado generico.');
assert.ok(renderer.includes('state.connectorHealth.mt5'), 'MT5 debe reflejar salud runtime verificada, no solo el flag MT5_CONNECTOR_ENABLED.');
assert.ok(renderer.includes('Sin terminal'), 'MT5 debe mostrar explicitamente cuando el conector esta configurado pero no responde.');
assert.ok(html.includes('stMt5Demo') && html.includes('stMt5Real'), 'Sidebar debe separar MT5 Demo de MT5 Real.');
assert.ok(renderer.includes('renderMt5AccountStatuses'), 'Renderer debe renderizar MT5 Demo y MT5 Real por separado.');
assert.ok(renderer.includes('state.env.mt5Demo') && renderer.includes('state.env.mt5Real'), 'Renderer debe leer el estado separado de MT5 desde env-status.');
assert.equal(/stMt5'\)\.textContent\s*=/.test(renderer), false, 'Wallet no debe sobrescribir el estado MT5 calculado por renderStatus.');
assert.ok(css.includes('status-error'), 'CSS debe diferenciar errores reales de conectores.');
for (const id of ['platformSelect', 'assetSearch', 'assetDropBtn', 'assetMenu', 'priceNow', 'tradeChart']) {
  const count = (html.match(new RegExp(`id="${id}"`, 'g')) || []).length;
  assert.equal(count, 1, `El dashboard no debe duplicar el id ${id}.`);
}
assert.ok(css.includes('#view-lab') && css.includes('.nav-item[data-view="lab"]'), 'CSS debe bloquear cualquier resto accidental de Lab.');
assert.ok(css.includes('status-missing'), 'CSS debe diferenciar conectores sin clave.');
assert.ok(css.includes('overflow-x: hidden'), 'La vista activa debe cortar overflow horizontal.');
assert.ok(/#view-training\s*\{[\s\S]*overflow-y:\s*auto/.test(css), 'Training debe permitir scroll vertical dentro de la vista activa.');
assert.ok(/#view-training\.view\.active\s*\{[\s\S]*overflow-y:\s*scroll/.test(css), 'Training debe forzar scroll vertical aunque el body del shell este bloqueado.');
assert.ok(/#view-training\.view\.active\s*\{[\s\S]*padding-bottom:\s*max\(120px/.test(css), 'Training debe dejar margen inferior suficiente para llegar al final del panel.');
assert.ok(/#view-training\.view\.active\s*\{[\s\S]*overscroll-behavior-y:\s*contain/.test(css), 'Training debe contener el wheel scroll dentro de su propia vista.');
assert.ok(/#view-training \.training-tabs-container\s*\{[\s\S]*margin-bottom:\s*96px/.test(css), 'Los tabs inferiores de Training deben quedar alcanzables al scrollear.');
assert.ok(/\.chat-dock\s*\{[\s\S]*max-height:\s*100%/.test(css), 'El copiloto no debe estirar el layout ni bloquear el scroll de Training.');
assert.ok(main.includes("'TRAINING_BACKEND_LOOP_ENABLED'"), 'Cloud/VPS deben leer flags de loop desde process.env.');
assert.ok(main.includes('trainingStateReader.readSnapshot()'), 'Autostart debe usar el lector correcto del training state.');
assert.ok(main.includes('getBinanceSymbols: () => binanceSymbols()'), 'Loop backend debe poder sembrar universo Binance persistente.');
assert.ok(renderer.includes('targetOpenPositions: 40'), 'Training perpetuo debe apuntar a 40 posiciones maximas: 20 rapidas + 20 swing.');
assert.equal(/id="trainingToggle"|data-toggle="training"/.test(html), false, 'Training perpetuo no debe tener boton para apagar/encender.');
assert.ok(html.includes('trainingPerpetualBadge') && html.includes('PERPETUO'), 'Training debe mostrarse como perpetuo, no como toggle opcional.');
assert.ok(renderer.includes('Training perpetuo: no se puede desactivar desde la UI'), 'Renderer debe bloquear intentos heredados de apagar training.');
assert.ok(renderer.includes("'Sin lectura'"), 'Si env-status falla, el sidebar debe mostrar un estado explicito y no quedarse ambiguo.');
assert.ok(renderer.includes("const marketSearch = $('marketSearch')"), 'Boot debe tolerar la ausencia de marketSearch para no bloquear env-status.');
assert.ok(renderer.includes('if (!search || !table) return;'), 'renderMarketTable debe ser defensivo si el dashboard no tiene tabla legacy.');
assert.ok(html.includes('trainDemoExecutionState') && html.includes('trainDemoExecutionDetail'), 'Lecciones debe mostrar si MT5 demo es paper interno o ejecucion real.');
assert.ok(renderer.includes("setText('trainDemoExecutionState'") && renderer.includes("setText('trainDemoExecutionDetail'"), 'Training debe refrescar el estado de ejecucion demo MT5 en vivo.');
assert.ok(renderer.includes('sin order_send'), 'El panel de contexto del chat debe recordar que MT5 demo aun no envia ordenes.');
assert.ok(renderer.includes('order_send ON'), 'El panel de contexto del chat debe indicar cuando MT5 demo order_send esta armado.');
assert.ok(renderer.includes('demo order_send #'), 'Las posiciones MT5 deben mostrar ticket de orden demo cuando existe.');
assert.ok(css.includes('#trainDemoExecutionDetail'), 'CSS debe proteger el texto largo de ejecucion demo MT5.');
assert.ok(/\.training-memory-grid\s*\{[\s\S]*grid-template-columns:[\s\S]*minmax\(118px/.test(css), 'La memoria de aprendizaje debe tener una grilla legible de cinco paneles.');
const binanceFallback = main.match(/const fallback = \[([\s\S]*?)\];\s*const info = await withMarketFallback/);
assert.ok(binanceFallback, 'binanceSymbols debe tener fallback local cuando exchangeInfo no responde.');
assert.ok((binanceFallback[1].match(/USDT/g) || []).length >= 40, 'Fallback Binance debe tener al menos 40 pares USDT para training perpetuo en Cloud/VPS.');

console.log('ui_training_surface_static.test.js OK');
