const OPERATIONAL_TERMS = /\b(sl|tp|stop|take\s*profit|orden|order|trade|operaci[oó]n|posici[oó]n|binance|mt5|xauusd|oro|gold|compr|vend|abrir|cerrar|modificar|monitorear|observar|vigilar)\b/i;
const PROMISE_TERMS = /\b(voy a|vamos a|procedo a|procedere|har[eé]|pondre|pondr[eé]|abrir[eé]|cerrar[eé]|modificar[eé]|observare|observar[eé]|monitoreare|monitorear[eé]|vigilar[eé]|enviar[eé]|comprar[eé]|vender[eé]|ejecutar[eé]|colocar[eé]|lo hare)(?=\s|$|[.,;:!?])/i;
const EVIDENCE_TERMS = /\b(ticket|orderId|commandId|deal|retcode|orden\s*#|order\s*#|auditad[ao]s?|entrada auditada)\s*[:=#-]?\s*[\w.-]*/i;

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isOperationalPromiseSentence(sentence) {
  const text = String(sentence || '');
  return PROMISE_TERMS.test(text) && OPERATIONAL_TERMS.test(text);
}

function hasOperationalPromise(text) {
  return splitSentences(text).some(isOperationalPromiseSentence);
}

function hasOperationalEvidence(text) {
  return EVIDENCE_TERMS.test(String(text || ''));
}

function stripUnauditedPromises(text) {
  const kept = splitSentences(text).filter((sentence) => !isOperationalPromiseSentence(sentence));
  return kept.join('\n\n').trim();
}

function applyOperationalTruthGuard(text) {
  const original = String(text || '');
  if (!hasOperationalPromise(original) || hasOperationalEvidence(original)) {
    return { changed: false, text: original, reason: null };
  }
  const stripped = stripUnauditedPromises(original);
  const correction = [
    'Correccion operativa: no ejecute ninguna accion real ni programe una accion auditada en esta respuesta.',
    'Puedo recomendar, evaluar o preparar un diagnostico, pero solo debo afirmar ejecucion cuando exista ticket, orderId, commandId o entrada auditada.'
  ].join(' ');
  return {
    changed: true,
    reason: 'unaudited_operational_promise',
    text: stripped ? `${correction}\n\n${stripped}` : correction
  };
}

module.exports = {
  applyOperationalTruthGuard,
  hasOperationalPromise,
  hasOperationalEvidence
};
