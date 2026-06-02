const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');
const apiRouter = fs.readFileSync(path.join(root, 'backend', 'routes', 'api-router.js'), 'utf8');

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
assert.ok(renderer.includes('applyBackendTrainingStateRefresh(saved)'), 'loadTrainingState debe hidratar activePairs/targets desde disco backend.');
assert.ok(renderer.includes('renderTrainingInsights'), 'Renderer debe renderizar insights temporales.');
assert.ok(renderer.includes('Date.now() - Date.parse'), 'Insights deben expirar por edad.');
assert.ok(renderer.includes('10 * 60 * 1000'), 'Insights deben borrarse despues de 10 minutos.');
assert.ok(renderer.includes('trainingBotsStatus'), 'Renderer debe consultar estado de bots.');
assert.ok(html.includes('seed XAUUSD + Quant Auto'), 'UI de bots debe explicar que XAUUSD es seed y Quant Auto genera por par.');
assert.ok(renderer.includes('candidatos real'), 'UI de bots debe distinguir candidatos reales separados.');
assert.ok(renderer.includes('sourceTrainingBot') || renderer.includes('templateSource'), 'UI de bots debe mostrar de que seed/bot training viene cada candidato.');
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
