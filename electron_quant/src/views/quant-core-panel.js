/**
 * QUANT-CORE PANEL — laboratorio observable.
 *
 * Renders the visible footprint of Quant-Core inside the Training Lab view.
 * Honest about state: shows that Quant-Core exists but is in shadow / waiting
 * for sample, instead of faking maturity.
 *
 * Mounts into a host element (default id "quantCorePanel"). Calls
 * window.QuantCore.api.getAll on refresh and renders:
 *
 *   1. system-state banner (mode shadow · scheduler inactivo · ...)
 *   2. calibración inicial (confidence/stability/sample)
 *   3. strategy registry (5 strategies, marked backendExecutable:false)
 *   4. cierre operativo (edge · equity curve · last update)
 *
 * Pure rendering. No business logic. No side effects on legacy training
 * engine (KPIs, equity canvas, tabs are owned by renderer.js — not touched).
 *
 * Exposed as window.QuantCore.views.coreLabPanel.
 */

(function () {
  if (window.QuantCore && window.QuantCore.views && window.QuantCore.views.coreLabPanel) return;

  var hostId = 'quantCorePanel';
  var hostEl = null;
  var lastRefreshAt = null;

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function emptyStates() {
    return (window.QuantUI && window.QuantUI.emptyStates) ? window.QuantUI.emptyStates : null;
  }

  function api() {
    return (window.QuantCore && window.QuantCore.api) ? window.QuantCore.api : null;
  }

  function renderSkeleton(el) {
    el.innerHTML = ''
      + '<section class="panel quant-core-panel" data-quant-core-panel="true">'
      +   '<div class="panel-head">'
      +     '<h2>QUANT-CORE · LABORATORIO</h2>'
      +     '<span class="quant-core-banner" data-role="banner">cargando</span>'
      +   '</div>'
      +   '<div class="quant-core-calibration" data-role="calibration"></div>'
      +   '<div class="quant-core-registry" data-role="registry"></div>'
      +   '<div class="quant-core-footer" data-role="footer"></div>'
      + '</section>';
  }

  function renderBanner(el, descriptor) {
    if (!el) return;
    var sev = descriptor && descriptor.severity ? descriptor.severity : 'info';
    el.setAttribute('data-severity', sev);
    el.textContent = descriptor && descriptor.primary ? descriptor.primary : '';
  }

  // confidence/stability/sample shown as "calibración inicial" — never as
  // mature metrics. when sampleStatus is insufficient, we show the score
  // value but qualify it with copy that prevents misreading.
  function renderCalibration(el, state) {
    if (!el) return;
    var es = emptyStates();
    var mature = !!state.sampleSufficient;

    // Reuse the existing .kpi-card visual language so calibration cards
    // sit consistently next to the legacy Training Lab KPIs above.
    function cardScore(label, score, qualifier) {
      var num = (typeof score === 'number') ? score : null;
      var display = (num === null)
        ? (es ? es.label('no_data') : '—')
        : String(num) + '<span class="qc-score-scale">/100</span>';
      return ''
        + '<div class="kpi-card qc-cal-card">'
        +   '<div class="label">' + escHtml(label) + '</div>'
        +   '<div class="kpi-value">' + display + '</div>'
        +   '<div class="sub">' + escHtml(qualifier) + '</div>'
        + '</div>';
    }

    var sampleVal = (typeof state.sampleSize === 'number') ? state.sampleSize : null;
    var sampleDisplay = (sampleVal === null)
      ? (es ? es.label('no_data') : '—')
      : sampleVal + '<span class="qc-score-scale"> trades</span>';
    var sampleQualifier = state.sampleStatus === 'insufficient'
      ? (es ? es.label('insufficient_sample') : 'sample insuficiente')
      : (mature ? 'sample suficiente' : (es ? es.label('learning') : 'aprendiendo'));

    var qualifier = mature
      ? 'calibración activa'
      : (es ? es.label('calibrating') : 'calibrando') + ' · inicial';

    el.innerHTML = ''
      + cardScore('CONFIDENCE', state.confidenceScore, qualifier)
      + cardScore('STABILITY',  state.stabilityScore,  qualifier)
      + ''
      + '<div class="kpi-card qc-cal-card">'
      +   '<div class="label">SAMPLE</div>'
      +   '<div class="kpi-value">' + sampleDisplay + '</div>'
      +   '<div class="sub">' + escHtml(sampleQualifier) + '</div>'
      + '</div>';
  }

  function renderRegistry(el, strategiesBody) {
    if (!el) return;
    var es = emptyStates();
    var strategies = (strategiesBody && Array.isArray(strategiesBody.strategies))
      ? strategiesBody.strategies : null;

    if (!strategies || strategies.length === 0) {
      el.innerHTML = ''
        + '<div class="qc-section-head">STRATEGY REGISTRY</div>'
        + '<div class="qc-empty">' + escHtml(es ? es.label('pending_backend') : 'pendiente backend') + '</div>';
      return;
    }

    var rows = strategies.map(function (s) {
      var executable = (s && s.backendExecutable === true);
      var phaseTxt = s && s.phase ? String(s.phase) : 'shadow';
      var minScore = (typeof (s && s.minScore) === 'number') ? s.minScore : '—';
      var rrMin    = (typeof (s && s.rrMin)    === 'number') ? s.rrMin    : '—';
      var rules = Array.isArray(s && s.rules) ? s.rules : [];
      var rulesHtml = rules.length
        ? '<ul class="qc-rules">' + rules.map(function (r) {
            return '<li>' + escHtml(r) + '</li>';
          }).join('') + '</ul>'
        : '';

      return ''
        + '<article class="qc-strategy" data-executable="' + (executable ? 'true' : 'false') + '">'
        +   '<div class="qc-strategy-head">'
        +     '<div class="qc-strategy-id">' + escHtml(s && s.id ? s.id : '?') + '</div>'
        +     '<div class="qc-strategy-name">' + escHtml(s && s.name ? s.name : 'sin nombre') + '</div>'
        +   '</div>'
        +   '<div class="qc-strategy-meta">'
        +     '<span>phase <b>' + escHtml(phaseTxt) + '</b></span>'
        +     '<span>minScore <b>' + escHtml(minScore) + '</b></span>'
        +     '<span>RR <b>' + escHtml(rrMin) + '</b></span>'
        +     '<span class="qc-exec ' + (executable ? 'is-on' : 'is-off') + '">'
        +       'backendExecutable=' + (executable ? 'true' : 'false')
        +     '</span>'
        +   '</div>'
        +   rulesHtml
        + '</article>';
    }).join('');

    el.innerHTML = ''
      + '<div class="qc-section-head">'
      +   'STRATEGY REGISTRY · ' + strategies.length + ' estrategias'
      + '</div>'
      + '<div class="qc-strategy-list">' + rows + '</div>';
  }

  function renderFooter(el, state) {
    if (!el) return;
    var es = emptyStates();

    var equityCurveLen = 0;
    var degStatus = null;
    var rawMetrics = state.raw && state.raw.metrics ? state.raw.metrics.metrics : null;
    if (rawMetrics) {
      if (Array.isArray(rawMetrics.equityCurve)) equityCurveLen = rawMetrics.equityCurve.length;
      if (rawMetrics.edgeDegradation && rawMetrics.edgeDegradation.status) {
        degStatus = rawMetrics.edgeDegradation.status;
      }
    }

    var edgeCopy = (degStatus === 'insufficient_sample' || !degStatus)
      ? 'edge: sin sample suficiente'
      : 'edge: ' + degStatus;

    var equityCopy = (equityCurveLen < 2)
      ? 'equity: sin curva suficiente todavía'
      : 'equity: ' + equityCurveLen + ' puntos';

    var schedulerCopy = state.schedulerActive === false
      ? 'scheduler inactivo'
      : (state.schedulerActive === true ? 'scheduler activo' : 'scheduler ?');

    var ts = lastRefreshAt
      ? new Date(lastRefreshAt).toLocaleTimeString('es-CO', { hour12: false })
      : (es ? es.label('loading') : 'cargando');

    el.innerHTML = ''
      + '<span>' + escHtml(edgeCopy) + '</span>'
      + '<span>·</span>'
      + '<span>' + escHtml(equityCopy) + '</span>'
      + '<span>·</span>'
      + '<span>' + escHtml(schedulerCopy) + '</span>'
      + '<span class="qc-spacer"></span>'
      + '<span class="qc-ts">last update ' + escHtml(ts) + '</span>';
  }

  function applyTriplet(triplet) {
    if (!hostEl) return;
    var c = api();
    if (!c) return;

    var state = c.interpretSystemState(triplet);
    var descriptor = c.describeSystemState(state);

    var bannerEl      = hostEl.querySelector('[data-role="banner"]');
    var calibrationEl = hostEl.querySelector('[data-role="calibration"]');
    var registryEl    = hostEl.querySelector('[data-role="registry"]');
    var footerEl      = hostEl.querySelector('[data-role="footer"]');

    renderBanner(bannerEl, descriptor);
    renderCalibration(calibrationEl, state);
    renderRegistry(registryEl, state.raw.strategies);
    renderFooter(footerEl, state);
  }

  function renderError(message) {
    if (!hostEl) return;
    var bannerEl = hostEl.querySelector('[data-role="banner"]');
    if (bannerEl) {
      bannerEl.setAttribute('data-severity', 'error');
      bannerEl.textContent = message || 'error de lectura';
    }
  }

  function mount(id) {
    if (id) hostId = id;
    hostEl = document.getElementById(hostId);
    if (!hostEl) return false;
    renderSkeleton(hostEl);
    return true;
  }

  function refresh() {
    if (!hostEl) hostEl = document.getElementById(hostId);
    if (!hostEl) return Promise.resolve(false);
    var c = api();
    if (!c) {
      renderError('cliente Quant-Core no disponible');
      return Promise.resolve(false);
    }
    return c.getAll().then(function (triplet) {
      lastRefreshAt = Date.now();
      applyTriplet(triplet);
      return true;
    }).catch(function (err) {
      renderError('error de lectura · ' + (err && err.message ? err.message : 'desconocido'));
      return false;
    });
  }

  window.QuantCore = window.QuantCore || {};
  window.QuantCore.views = window.QuantCore.views || {};
  window.QuantCore.views.coreLabPanel = {
    mount: mount,
    refresh: refresh
  };
})();
