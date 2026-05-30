const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

const renderStart = renderer.indexOf('function renderNewsFromState(source)');
assert(renderStart >= 0, 'renderer debe definir renderNewsFromState.');
const renderEnd = renderer.indexOf('function macroContext', renderStart);
assert(renderEnd > renderStart, 'Debe poder acotarse renderNewsFromState.');
const body = renderer.slice(renderStart, renderEnd);

const sourceBranch = body.indexOf("if (source === 'alpha')");
const alphaPageWrite = body.indexOf("newsAlphaPage')", body.indexOf('alphaHtml'));
assert(sourceBranch > 0, 'renderNewsFromState debe conservar la seleccion de fuente activa.');
assert(alphaPageWrite > 0, 'renderNewsFromState debe escribir siempre la columna Alpha Vantage dedicada.');
assert(
  alphaPageWrite < sourceBranch,
  'La columna Alpha Vantage dedicada debe renderizarse aunque la fuente activa sea Finnhub o Crypto.'
);

assert(body.includes('formatAlphaNewsTime'), 'Alpha Vantage debe formatear time_published de forma legible.');

console.log('news_macro_static.test.js OK');
