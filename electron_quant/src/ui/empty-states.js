/**
 * EMPTY STATES — vocabulario único de copy para estados sin datos firmes.
 *
 * Quant-Core nunca muestra null, undefined, NaN o JSON crudo en UI.
 * Toda métrica que no tenga sample suficiente, esté en shadow, o aún
 * no exista en backend, pasa por este módulo y se traduce a copy humano.
 *
 * Uso:
 *   const ui = window.QuantUI.emptyStates;
 *   ui.label('learning')                                // 'aprendiendo'
 *   ui.fromAvailable(payload)                           // string | null si firme
 *   ui.metric(value, { fallback: 'pending_backend',
 *                      format: 'percent', digits: 1 })  // string siempre seguro
 *
 * Pure functions, sin side effects, sin deps. Safe para tests aislados.
 */

(function () {
  if (window.QuantUI && window.QuantUI.emptyStates) return;

  // Vocabulario canónico. Cualquier copy nuevo de "no hay datos firmes" entra aquí.
  // Las claves coinciden con `reason` que pueda devolver Quant-Core.
  var STATES = {
    pending_backend:      'pendiente backend',
    awaiting_calibration: 'esperando calibración',
    insufficient_sample:  'sample insuficiente',
    learning:             'aprendiendo',
    shadow_mode:          'modo shadow',
    calibrating:          'calibrando',
    observing_regime:     'observando régimen',
    loading:              'cargando',
    unavailable:          'no disponible',
    error:                'error de lectura',
    no_data:              'sin datos aún'
  };

  function label(key) {
    if (typeof key !== 'string') return STATES.unavailable;
    return STATES[key] || STATES.unavailable;
  }

  /**
   * Convención Quant-Core: payloads pueden venir con `available:false` y `reason`.
   * Devuelve null si la data es firme; devuelve copy humano si no.
   */
  function fromAvailable(payload) {
    if (payload === null || payload === undefined) return label('no_data');
    if (typeof payload !== 'object') return null;
    if (payload.available === false) {
      return label(payload.reason || 'unavailable');
    }
    return null;
  }

  /**
   * Formateador defensivo. Nunca devuelve null, undefined, NaN ni 'NaN'.
   * value: any. opts: { fallback, format, suffix, digits }.
   *   fallback: clave de STATES a usar cuando value no es presentable. Default 'no_data'.
   *   format: 'percent' multiplica por 100 y agrega %. 'fixed' usa toFixed(digits).
   *   suffix: string opcional a concatenar (e.g. ' R', ' días').
   *   digits: cantidad de decimales. Default 2.
   */
  function metric(value, opts) {
    opts = opts || {};
    var fallback = opts.fallback || 'no_data';

    if (value === null || value === undefined) return label(fallback);
    if (typeof value === 'number' && !Number.isFinite(value)) return label(fallback);

    if (typeof value === 'number') {
      var digits = typeof opts.digits === 'number' ? opts.digits : 2;
      var formatted;
      if (opts.format === 'percent') formatted = (value * 100).toFixed(digits) + '%';
      else formatted = value.toFixed(digits);
      return opts.suffix ? formatted + opts.suffix : formatted;
    }

    if (typeof value === 'string') {
      var trimmed = value.trim();
      if (!trimmed) return label(fallback);
      return trimmed;
    }

    return String(value);
  }

  window.QuantUI = window.QuantUI || {};
  window.QuantUI.emptyStates = {
    label: label,
    fromAvailable: fromAvailable,
    metric: metric,
    STATES: STATES
  };
})();
