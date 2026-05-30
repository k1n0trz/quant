/**
 * QUANT-CORE API client — defensive, read-only, browser-safe.
 *
 * Wraps the three /api/training/core/* endpoints. Treats every field as
 * potentially missing. Never throws; always returns { ok, ... } envelopes.
 *
 * Exposed as window.QuantCore.api.
 *
 * Endpoints (per Quant-Core v1.x, observed live shape):
 *   GET /api/training/core/metrics
 *   GET /api/training/core/strategies
 *   GET /api/training/core/edge
 *
 * Each backend response carries:
 *   { ok, mode, <kind>: { ... }, safety: { readOnly, schedulerActive,
 *                                          writesPerformed, realTradingTouched } }
 *
 * This module deliberately does NOT compute CEI, does NOT fabricate equity
 * curves, and does NOT promote zero values to "0%" metrics when sampleStatus
 * says insufficient. It is the consumer's job to render those as empty states.
 */

(function () {
  if (window.QuantCore && window.QuantCore.api) return;

  var DEFAULT_TIMEOUT_MS = 6000;
  var baseUrl = '';
  var credentialsMode = 'same-origin';

  function setBaseUrl(url) {
    baseUrl = typeof url === 'string' ? url.replace(/\/$/, '') : '';
  }
  function getBaseUrl() { return baseUrl; }

  function setCredentialsMode(mode) {
    if (mode === 'omit' || mode === 'same-origin' || mode === 'include') {
      credentialsMode = mode;
    }
  }

  function fetchJson(path, opts) {
    opts = opts || {};
    var url = (baseUrl || '') + path;
    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    var timeoutHandle = null;
    if (ctrl) {
      timeoutHandle = setTimeout(function () { ctrl.abort(); },
        typeof opts.timeoutMs === 'number' ? opts.timeoutMs : DEFAULT_TIMEOUT_MS);
    }
    return fetch(url, {
      method: 'GET',
      credentials: credentialsMode,
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (resp) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (!resp.ok) {
        return { ok: false, error: 'http_' + resp.status, status: resp.status };
      }
      return resp.json().then(function (body) {
        return { ok: true, body: body };
      }).catch(function (err) {
        return { ok: false, error: 'json_parse', detail: String(err && err.message || err) };
      });
    }).catch(function (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      var aborted = err && err.name === 'AbortError';
      return { ok: false, error: aborted ? 'timeout' : 'network', detail: String(err && err.message || err) };
    });
  }

  function getMetrics()    { return fetchJson('/api/training/core/metrics'); }
  function getStrategies() { return fetchJson('/api/training/core/strategies'); }
  function getEdge()       { return fetchJson('/api/training/core/edge'); }

  function getAll() {
    return Promise.all([getMetrics(), getStrategies(), getEdge()])
      .then(function (results) {
        return {
          metrics:    results[0],
          strategies: results[1],
          edge:       results[2]
        };
      });
  }

  // Pure helpers. No DOM. No throws.

  function safe(obj, path, fallback) {
    if (!obj || typeof obj !== 'object') return fallback;
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return fallback;
      cur = cur[parts[i]];
    }
    return cur === undefined ? fallback : cur;
  }

  /**
   * Fold {metrics, strategies, edge} responses into one canonical state object.
   * Same shape regardless of which sub-fetches succeeded or failed.
   */
  function interpretSystemState(triplet) {
    triplet = triplet || {};
    var metricsBody    = safe(triplet, 'metrics.body', null);
    var strategiesBody = safe(triplet, 'strategies.body', null);
    var edgeBody       = safe(triplet, 'edge.body', null);

    var anyOk = !!(metricsBody || strategiesBody || edgeBody);

    var mode = safe(metricsBody, 'mode',
      safe(edgeBody, 'mode',
        safe(strategiesBody, 'mode', null)));

    // safety block is replicated across endpoints; pick first available.
    var readOnly = safe(metricsBody, 'safety.readOnly',
      safe(edgeBody, 'safety.readOnly',
        safe(strategiesBody, 'safety.readOnly', null)));

    // schedulerActive lives both in `safety` and in `edge.edge`. Prefer edge
    // since it is the authoritative scheduler state field for shadow systems.
    var schedulerActive = safe(edgeBody, 'edge.schedulerActive',
      safe(metricsBody, 'safety.schedulerActive', null));

    var backendEnabled     = safe(edgeBody, 'edge.backendEnabled', null);
    var realTradingTouched = safe(metricsBody, 'safety.realTradingTouched',
      safe(edgeBody, 'safety.realTradingTouched', null));

    var sampleSize = safe(metricsBody, 'metrics.sampleSize',
      safe(edgeBody, 'edge.sampleSize', null));
    var sampleStatus = safe(metricsBody, 'metrics.sampleStatus',
      safe(edgeBody, 'edge.sampleStatus', null));
    var sampleSufficient = (sampleStatus === 'sufficient')
      || (typeof sampleSize === 'number' && sampleSize >= 30);

    var confidenceScore = safe(metricsBody, 'metrics.confidenceScore',
      safe(edgeBody, 'edge.confidenceScore', null));
    var stabilityScore = safe(metricsBody, 'metrics.stabilityScore',
      safe(edgeBody, 'edge.stabilityScore', null));

    return {
      anyOk: anyOk,
      mode: mode,
      readOnly: readOnly,
      schedulerActive: schedulerActive,
      backendEnabled: backendEnabled,
      realTradingTouched: realTradingTouched,
      sampleSize: sampleSize,
      sampleStatus: sampleStatus,
      sampleSufficient: sampleSufficient,
      confidenceScore: confidenceScore,
      stabilityScore: stabilityScore,
      raw: {
        metrics:    metricsBody,
        strategies: strategiesBody,
        edge:       edgeBody
      },
      errors: {
        metrics:    safe(triplet, 'metrics.error',    null),
        strategies: safe(triplet, 'strategies.error', null),
        edge:       safe(triplet, 'edge.error',       null)
      }
    };
  }

  /**
   * Build a human-readable descriptor for the system-state banner.
   * Uses the empty-states vocabulary when available.
   * Returns { severity, primary, parts: [...] }.
   */
  function describeSystemState(state) {
    state = state || {};
    var es = (window.QuantUI && window.QuantUI.emptyStates) ? window.QuantUI.emptyStates : null;
    var parts = [];

    if (state.mode === 'shadow' || state.mode === 'shadow_mode') {
      parts.push(es ? es.label('shadow_mode') : 'modo shadow');
    } else if (state.mode) {
      parts.push('modo ' + state.mode);
    }

    if (state.backendEnabled === false) parts.push('motor automatico en observacion');
    if (state.schedulerActive === false) parts.push('motor automatico inactivo');
    if (state.readOnly === true) parts.push('read-only');

    if (state.sampleStatus === 'insufficient' || state.sampleSufficient === false) {
      parts.push(es ? es.label('insufficient_sample') : 'sample insuficiente');
    }

    var anyError = state.errors && (state.errors.metrics || state.errors.strategies || state.errors.edge);
    var severity = 'info';
    if (state.mode === 'shadow') severity = 'info';
    if (anyError) severity = 'warning';
    if (!state.anyOk) severity = 'error';

    return {
      severity: severity,
      primary: parts.length ? parts.join(' · ') : (es ? es.label('loading') : 'cargando'),
      parts: parts
    };
  }

  /**
   * Decide whether a given metric value should be rendered as a number,
   * or replaced with an empty-state label.
   *
   * Quant-Core convention: when sampleStatus is "insufficient", every
   * numeric field is 0 by definition (no trades to compute over). Showing
   * "0.00" or "0%" would misrepresent emptiness as a result. Treat them
   * as missing data and let the consumer render an empty-state copy.
   *
   * Returns { ready: boolean, value: number|null, reason: string|null }.
   */
  function metricReadiness(state, kind) {
    state = state || {};
    if (state.sampleStatus === 'insufficient' || state.sampleSufficient === false) {
      return { ready: false, value: null, reason: 'insufficient_sample' };
    }
    if (kind === 'equity_curve') {
      var curve = safe(state, 'raw.metrics.metrics.equityCurve', []);
      if (!Array.isArray(curve) || curve.length < 2) {
        return { ready: false, value: curve, reason: 'insufficient_sample' };
      }
      return { ready: true, value: curve, reason: null };
    }
    if (kind === 'edge_degradation') {
      var deg = safe(state, 'raw.metrics.metrics.edgeDegradation', null);
      if (!deg || deg.status === 'insufficient_sample') {
        return { ready: false, value: deg, reason: 'insufficient_sample' };
      }
      return { ready: true, value: deg, reason: null };
    }
    return { ready: true, value: null, reason: null };
  }

  window.QuantCore = window.QuantCore || {};
  window.QuantCore.api = {
    setBaseUrl: setBaseUrl,
    getBaseUrl: getBaseUrl,
    setCredentialsMode: setCredentialsMode,
    getMetrics: getMetrics,
    getStrategies: getStrategies,
    getEdge: getEdge,
    getAll: getAll,
    interpretSystemState: interpretSystemState,
    describeSystemState: describeSystemState,
    metricReadiness: metricReadiness
  };
})();
