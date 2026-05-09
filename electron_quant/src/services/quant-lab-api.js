/**
 * QUANT-LAB API CLIENT — defensive, read-only, browser-safe.
 *
 * Wraps the four read-only endpoints used by the Quant Lab hero.
 * Treats every field as potentially missing. Never throws; always
 * returns { ok, ... } envelopes.
 *
 * Exposed as window.QuantLab.api.
 *
 * Endpoints (audited live in api-router.js, H0):
 *   GET /api/training/demo/performance/summary
 *   GET /api/training/core/equity
 *   GET /api/training/core/edge
 *   GET /api/training/demo/loop/status
 *
 * Each endpoint may carry `available: false` with a `reason` string
 * (e.g. "training_state_unavailable", "insufficient_sample"). That is
 * NOT an error — it is a valid empty state and consumers must handle
 * it via empty-state copy, not via "0%" rendered metrics.
 */
(function () {
  if (window.QuantLab && window.QuantLab.api) return;

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
        return { ok: false, status: 'error', error: 'http_' + resp.status, httpStatus: resp.status };
      }
      return resp.json().then(function (body) {
        return { ok: true, status: 'ok', body: body };
      }).catch(function (err) {
        return { ok: false, status: 'error', error: 'json_parse', detail: String(err && err.message || err) };
      });
    }).catch(function (err) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      var aborted = err && err.name === 'AbortError';
      return {
        ok: false,
        status: 'error',
        error: aborted ? 'timeout' : 'network',
        detail: String(err && err.message || err)
      };
    });
  }

  function getLabPerformanceSummary() { return fetchJson('/api/training/demo/performance/summary'); }
  function getLabEquity()             { return fetchJson('/api/training/core/equity'); }
  function getLabEdge()               { return fetchJson('/api/training/core/edge'); }
  function getLabLoopStatus()         { return fetchJson('/api/training/demo/loop/status'); }

  /**
   * Fetch all four endpoints in parallel and return a snapshot envelope.
   * Each sub-result keeps its own ok/error so the consumer can render
   * partial state when only some endpoints succeed.
   */
  function getLabHeroSnapshot() {
    return Promise.all([
      getLabPerformanceSummary(),
      getLabEquity(),
      getLabEdge(),
      getLabLoopStatus()
    ]).then(function (results) {
      return {
        fetchedAt: Date.now(),
        performance: results[0],
        equity:      results[1],
        edge:        results[2],
        loop:        results[3]
      };
    });
  }

  // ──────────────────────────────────────────────
  // Pure helpers — no DOM, no throws
  // ──────────────────────────────────────────────

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

  /** Decide a single visual state per endpoint envelope. */
  function envelopeState(envelope) {
    if (!envelope) return 'loading';
    if (envelope.ok === false) return 'error';
    var body = envelope.body || {};
    if (body.ok === false) return 'error';
    if (body.available === false) return 'unavailable';
    return 'available';
  }

  /**
   * Fold a hero snapshot into a single canonical view-model.
   * Always returns the same shape, regardless of which endpoints
   * succeeded — missing fields are null. Callers map nulls to
   * empty-state copy at render time.
   *
   * Sample-status awareness: when edge.sampleStatus === 'insufficient',
   * we deliberately mark winRate/profitFactor/expectancy/maxDrawdown
   * as not-ready. Otherwise zeros would be rendered as legit metrics.
   */
  function interpretHero(snapshot) {
    snapshot = snapshot || {};
    var perf  = snapshot.performance || {};
    var eq    = snapshot.equity      || {};
    var edge  = snapshot.edge        || {};
    var loop  = snapshot.loop        || {};

    var perfBody = perf.body || {};
    var eqBody   = eq.body   || {};
    var edgeBody = edge.body || {};
    var loopBody = loop.body || {};

    var perfState = envelopeState(perf);
    var eqState   = envelopeState(eq);
    var edgeState = envelopeState(edge);
    var loopState = envelopeState(loop);

    var summary = perfBody.summary || {};
    var edgeData = edgeBody.edge || {};
    var equityData = eqBody.equity || {};
    var scheduler = loopBody.scheduler || perfBody.schedulerStatus || {};

    var sampleStatus = edgeData.sampleStatus || null;
    var sampleSize   = (typeof edgeData.sampleSize === 'number')
      ? edgeData.sampleSize
      : (typeof safe(perfBody, 'summary.closedTrades', null) === 'number'
          ? perfBody.summary.closedTrades
          : null);
    var sampleSufficient = (sampleStatus === 'sufficient')
      || (typeof sampleSize === 'number' && sampleSize >= 30);

    function metric(value) {
      if (perfState !== 'available') return null;
      if (typeof value !== 'number' || !isFinite(value)) return null;
      if (!sampleSufficient) return null;
      return value;
    }

    return {
      // top-level state, used to drive the hero loading/empty banner
      state:         perfState,
      anyAvailable:  perfState === 'available' || eqState === 'available'
                     || edgeState === 'available' || loopState === 'available',
      sampleStatus:  sampleStatus,
      sampleSize:    sampleSize,
      sampleSufficient: sampleSufficient,

      // performance summary — null when not ready
      balance:       (perfState === 'available' && typeof summary.balance === 'number') ? summary.balance : null,
      equity:        (perfState === 'available' && typeof summary.equity === 'number')  ? summary.equity  : null,
      openPositions: (perfState === 'available' && typeof summary.openPositions === 'number') ? summary.openPositions : null,
      closedTrades:  (perfState === 'available' && typeof summary.closedTrades === 'number')  ? summary.closedTrades  : null,
      winRate:       metric(summary.winRate),
      profitFactor:  metric(summary.profitFactor),
      expectancy:    metric(summary.expectancy),
      maxDrawdown:   metric(summary.maxDrawdown),

      // edge calibration
      confidenceScore: (edgeState === 'available' && typeof edgeData.confidenceScore === 'number') ? edgeData.confidenceScore : null,
      stabilityScore:  (edgeState === 'available' && typeof edgeData.stabilityScore  === 'number') ? edgeData.stabilityScore  : null,

      // equity curve
      equityCurve:        Array.isArray(equityData.curve) ? equityData.curve : [],
      equityCurvePoints:  (typeof equityData.points === 'number') ? equityData.points : null,
      equityMaxDrawdown:  (typeof equityData.maxDrawdown === 'number') ? equityData.maxDrawdown : null,
      equityMaxDrawdownPct: (typeof equityData.maxDrawdownPct === 'number') ? equityData.maxDrawdownPct : null,
      equityState:        eqState,

      // scheduler / loop
      scheduler: {
        state:               loopState,
        active:              !!scheduler.active,
        enabled:             !!scheduler.enabled,
        loopEnabled:         !!scheduler.loopEnabled,
        ticksRun:            (typeof scheduler.ticksRun === 'number') ? scheduler.ticksRun : null,
        ticksSkipped:        (typeof scheduler.ticksSkipped === 'number') ? scheduler.ticksSkipped : null,
        lastTickAt:          scheduler.lastTickAt || null,
        intervalMs:          (typeof scheduler.intervalMs === 'number') ? scheduler.intervalMs : null,
        realTradingTouched:  scheduler.realTradingTouched === true
      },

      // raw envelopes for debugging
      raw: snapshot,
      states: { performance: perfState, equity: eqState, edge: edgeState, loop: loopState },
      errors: {
        performance: perf.ok === false ? perf.error : null,
        equity:      eq.ok === false   ? eq.error   : null,
        edge:        edge.ok === false ? edge.error : null,
        loop:        loop.ok === false ? loop.error : null
      }
    };
  }

  /** Pretty-format a numeric value as currency string. Returns null when not displayable. */
  function fmtCurrency(n, opts) {
    if (typeof n !== 'number' || !isFinite(n)) return null;
    opts = opts || {};
    var sign = n < 0 ? '-' : (opts.signed ? '+' : '');
    var abs = Math.abs(n);
    var digits = (typeof opts.digits === 'number') ? opts.digits : 2;
    return sign + '$' + abs.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  /** Pretty-format a 0..1 ratio as percentage. */
  function fmtPct(ratio, digits) {
    if (typeof ratio !== 'number' || !isFinite(ratio)) return null;
    digits = (typeof digits === 'number') ? digits : 1;
    return (ratio * 100).toFixed(digits) + '%';
  }

  /** ISO/Date → "HH:MM:SS" local. Returns null when input is unusable. */
  function fmtTime(iso) {
    if (!iso) return null;
    var t = new Date(iso);
    if (isNaN(t.getTime())) return null;
    var hh = String(t.getHours()).padStart(2, '0');
    var mm = String(t.getMinutes()).padStart(2, '0');
    var ss = String(t.getSeconds()).padStart(2, '0');
    return hh + ':' + mm + ':' + ss;
  }

  window.QuantLab = window.QuantLab || {};
  window.QuantLab.api = {
    setBaseUrl: setBaseUrl,
    getBaseUrl: getBaseUrl,
    setCredentialsMode: setCredentialsMode,

    getLabPerformanceSummary: getLabPerformanceSummary,
    getLabEquity:             getLabEquity,
    getLabEdge:               getLabEdge,
    getLabLoopStatus:         getLabLoopStatus,
    getLabHeroSnapshot:       getLabHeroSnapshot,

    interpretHero: interpretHero,
    envelopeState: envelopeState,

    fmt: { currency: fmtCurrency, pct: fmtPct, time: fmtTime }
  };
})();
