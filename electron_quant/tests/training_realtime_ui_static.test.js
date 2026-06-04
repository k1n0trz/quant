const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const apiRouter = fs.readFileSync(path.join(root, 'backend', 'routes', 'api-router.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const monitoring = fs.readFileSync(path.join(root, 'backend', 'training', 'training-monitoring-service.js'), 'utf8');

for (const id of [
  'trainingOpenGauge',
  'trainingHorizonSplit',
  'trainingEvolutionBar',
  'trainingInsightFeed',
  'trainingBotsTable',
  'trainingRealtimeStamp'
]) {
  assert.ok(html.includes(`id="${id}"`), `Training debe exponer ${id}.`);
}

assert.ok(renderer.includes('loadTrainingLiveSnapshot'), 'Renderer debe tener polling live del snapshot de training.');
assert.ok(renderer.includes('setInterval(() => loadTrainingLiveSnapshot(false), 5000)'), 'Training debe refrescar en vivo cada 5s sin actualizar la pagina.');
assert.ok(renderer.includes('trainingLiveSnapshot'), 'Training live debe usar snapshot compacto antes de leer el estado completo.');
assert.ok(preload.includes('trainingLiveSnapshot'), 'Preload debe exponer trainingLiveSnapshot para Electron.');
assert.ok(apiRouter.includes('/api/training/demo/live-snapshot'), 'Backend debe exponer snapshot compacto de training.');
assert.ok(monitoring.includes('function getTrainingDemoLiveSnapshot'), 'Monitoring debe construir snapshot compacto.');
assert.ok(monitoring.includes('function compactOpenPosition'), 'Snapshot compacto debe reducir posiciones abiertas a campos UI.');
assert.ok(monitoring.includes('function compactClosedTrade'), 'Snapshot compacto debe reducir trades cerrados recientes.');
assert.ok(monitoring.includes('function compactLesson'), 'Snapshot compacto debe reducir lecciones recientes.');
assert.ok(monitoring.includes('closedTrades: allTrades.length'), 'Snapshot compacto debe preservar total de trades cerrados.');
assert.ok(monitoring.includes('lessons: allLessons.length'), 'Snapshot compacto debe preservar total de lecciones.');
assert.ok(renderer.includes('applyBackendTrainingStateRefresh(saved)'), 'loadTrainingState debe hidratar activePairs/targets desde disco backend.');
assert.ok(renderer.includes('renderTrainingInsights'), 'Renderer debe renderizar insights temporales.');
assert.ok(renderer.includes('trainingSignalCandidates'), 'Renderer debe consultar candidatos backend para poblar insights vivos.');
assert.ok(preload.includes('trainingSignalCandidates'), 'Preload debe exponer trainingSignalCandidates para Electron.');
assert.ok(apiRouter.includes('/api/training/demo/signals/candidates'), 'Backend debe exponer candidatos de senal para insights.');
assert.ok(renderer.includes('Date.now() - Date.parse'), 'Insights deben expirar por edad.');
assert.ok(renderer.includes('10 * 60 * 1000'), 'Insights deben borrarse despues de 10 minutos.');
assert.ok(renderer.includes('trainingBotsStatus'), 'Renderer debe consultar estado de bots.');
assert.ok(html.includes('Quant Auto por par'), 'UI de bots debe presentar Quant Auto por par, no una plantilla XAUUSD visible.');
assert.equal(/seed XAUUSD|plantilla XAUUSD/i.test(html), false, 'La plantilla XAUUSD no debe mencionarse en la UI.');
assert.ok(renderer.includes('candidatos real'), 'UI de bots debe distinguir candidatos reales separados.');
assert.equal(/seed \\$\\{escapeHtml\\(source\\)\\}|seed XAUUSD/i.test(renderer), false, 'La UI no debe imprimir el seed de plantilla por fila.');
assert.ok(apiRouter.includes('/api/training/bots/status'), 'Backend debe exponer estado de bots para la pestana Training.');

for (const klass of [
  '.training-live-grid',
  '.training-evolution',
  '.training-insight-feed',
  '.training-bots-table'
]) {
  assert.ok(css.includes(klass), `CSS debe incluir ${klass}.`);
}

assert.equal(/data-tab="bots"/.test(html), true, 'Training debe tener subseccion Bots.');
assert.equal(/data-tab="trainingToggle"|id="trainingToggle"/.test(html), false, 'Training sigue sin toggle de apagado.');

console.log('training_realtime_ui_static.test.js OK');
