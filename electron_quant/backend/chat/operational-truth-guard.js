const OPERATIONAL_TERMS = /\b(sl|tp|stop|take\s*profit|orden|order|trade|operacion|posicion|setup|senal|signal|binance|mt5|xauusd|oro|gold|compr|vend|abrir|cerrar|modificar|monitorear|observar|vigilar)\b/i;
const PROMISE_TERMS = /\b(voy a|vamos a|procedo a|procedere|hare|pondre|abrire|cerrare|modificare|observare|monitoreare|vigilare|enviare|comprare|vendere|ejecutare|colocare|lo hare|lo ejecutare|lo abrire|lo cerrare)(?=\s|$|[.,;:!?])/i;
const IMPERATIVE_PLAN_TERMS = /^(cerrar|abrir|activar|iniciar|programar|colocar|poner|modificar|ejecutar|enviar|comprar|vender|monitorear|observar|vigilar)\b/i;
const EVIDENCE_TERMS = /\b(ticket|orderId|commandId|deal|retcode|orden\s*#|order\s*#|auditado|auditada|entrada auditada)\s*[:=#-]?\s*[\w.-]*/i;

function normalizeText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function isOperationalPromiseSentence(sentence) {
  const text = normalizeText(sentence);
  return (PROMISE_TERMS.test(text) || IMPERATIVE_PLAN_TERMS.test(text)) && OPERATIONAL_TERMS.test(text);
}

function hasOperationalPromise(text) {
  return splitSentences(text).some(isOperationalPromiseSentence);
}

function hasOperationalEvidence(text) {
  return EVIDENCE_TERMS.test(normalizeText(text));
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
