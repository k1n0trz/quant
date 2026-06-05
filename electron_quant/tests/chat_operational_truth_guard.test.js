const assert = require('node:assert');
const { test } = require('node:test');

const {
  applyOperationalTruthGuard,
  hasOperationalPromise,
  hasOperationalEvidence
} = require('../backend/chat/operational-truth-guard.js');

test('detects future operational promises without evidence', () => {
  const text = 'Voy a poner SL y TP en las posiciones abiertas y observaré el oro para comprar.';
  assert.equal(hasOperationalPromise(text), true);
  assert.equal(hasOperationalEvidence(text), false);
});

test('does not flag audited execution evidence', () => {
  const text = 'SL y TP aplicados. commandId=mt5-modify-123 ticket=5457704634.';
  assert.equal(hasOperationalPromise(text), false);
  assert.equal(hasOperationalEvidence(text), true);
  assert.equal(applyOperationalTruthGuard(text).changed, false);
});

test('rewrites unaudited action claims before returning chat answer', () => {
  const text = 'Voy a abrir una compra en XAUUSD. También pondré SL y TP.';
  const guarded = applyOperationalTruthGuard(text);
  assert.equal(guarded.changed, true);
  assert.match(guarded.text, /Correccion operativa/i);
  assert.doesNotMatch(guarded.text, /Voy a abrir/i);
  assert.doesNotMatch(guarded.text, /pondr[eé]/i);
  assert.match(guarded.text, /no ejecute ninguna accion real/i);
});

test('allows recommendations and conditional language', () => {
  const text = 'Recomendacion: si XAUUSD confirma ruptura, conviene evaluar compra con SL bajo el minimo.';
  const guarded = applyOperationalTruthGuard(text);
  assert.equal(guarded.changed, false);
  assert.equal(guarded.text, text);
});

test('rewrites unaudited infinitive task lists that sound like execution plans', () => {
  const text = [
    'Cerrar las 2 posiciones reales de USDCAD en el proximo ciclo de ejecucion.',
    'Activar un escaneo continuo en todos los simbolos visibles de MT5.',
    'Si encuentro un setup, lo ejecutare sin esperar confirmacion tuya.'
  ].join('\n');
  const guarded = applyOperationalTruthGuard(text);
  assert.equal(guarded.changed, true);
  assert.match(guarded.text, /Correccion operativa/i);
  assert.doesNotMatch(guarded.text, /Cerrar las 2 posiciones/i);
  assert.doesNotMatch(guarded.text, /Activar un escaneo/i);
  assert.doesNotMatch(guarded.text, /ejecutare/i);
});
