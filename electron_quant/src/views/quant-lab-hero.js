/**
 * QUANT-LAB HERO controller.
 *
 * Wires the Quant Lab hero (KPIs, deltas, equity curve, health strip,
 * top-bar pills) to live data via window.QuantLab.api.
 *
 * Lifecycle:
 *   - Idle while #view-lab is NOT .active. No fetch, no polling.
 *   - On activation: render skeleton → fetch snapshot → render once.
 *   - While active: poll on staggered intervals.
 *   - On deactivation: stop all timers immediately.
 *
 * Visual states (every metric / panel handles all four):
 *   loading      — initial render, no data yet
 *   available    — data rendered with values
 *   unavailable  — endpoint reached but available:false
 *   error        — network/timeout/http
 *
 * Insufficient sample (edge.sampleStatus === 'insufficient'):
 *   Win rate / profit factor / expectancy / max drawdown are rendered
 *   as empty-state ("—") with a "sample insuficiente" sub. Showing 0%
 *   would misrepresent emptiness as a result.
 *
 * Pure rendering — no state mutation, no backend writes, no scheduler
 * control. Read-only consumer of read-only endpoints.
 *
 * Exposed as window.QuantLab.views.hero.
 */
(function () {
  if (window.QuantLab && window.QuantLab.views && window.QuantLab.views.hero) return;

  // Polling cadence (ms). Only run while #view-lab is .active.
  var INTERVAL_LOOP        = 5000;   // scheduler ticks change fastest
  var INTERVAL_PERFORMANCE = 15000;
  var INTERVAL_EQUITY      = 30000;
  var INTERVAL_EDGE        = 30000;

  // Internal state
  var labRoot       = null;
  var equityCanvas  = null;
  var lastInterpreted = null;
  var lastEquityCurve = null;
  var equityRedrawPending = false;
  var timers = { loop: null, perf: null, eq: null, edge: null };
  var rawSnapshot = { performance: null, equity: null, edge: null, loop: null };
  var observerAttached = false;
  var resizeAttached = false;
  var booted = false;

  // ──────────────────────────────────────────────────────
  // DOM helpers
  // ──────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function setText(id, text) { var el = $(id); if (el) el.textContent = text; }
  function setHtml(id, html) { var el = $(id); if (el) el.innerHTML = html; }
  function setClass(id, cls, on) {
    var el = $(id); if (!el) return;
    if (on) el.classList.add(cls); else el.classList.remove(cls);
  }
  function api() {
    return (window.QuantLab && window.QuantLab.api) ? window.QuantLab.api : null;
  }

  function emptyDash() { return '—'; }

  // ──────────────────────────────────────────────────────
  // Render: KPIs, deltas, balance
  // ──────────────────────────────────────────────────────
  function renderHero(view) {
    var fmt = api() && api().fmt;
    if (!fmt) return;

    // Balance
    if (view.balance !== null) {
      var balanceEl = $('labHeroBalance');
      if (balanceEl) {
        balanceEl.innerHTML = fmt.currency(view.balance, { digits: 2 })
          + '<small>USDT</small>';
      }
    } else {
      setHtml('labHeroBalance', emptyDash() + '<small>USDT</small>');
    }

    // P&L hoy: balance - balanceStart (only when both known + sample sufficient)
    var balanceStart = null;
    var raw = view.raw && view.raw.equity && view.raw.equity.body && view.raw.equity.body.equity;
    if (raw && typeof raw.balanceStart === 'number') balanceStart = raw.balanceStart;

    if (view.balance !== null && balanceStart !== null) {
      var diff = view.balance - balanceStart;
      var pct = balanceStart !== 0 ? (diff / balanceStart) : null;
      var label = fmt.currency(diff, { signed: true, digits: 2 });
      if (pct !== null) {
        var pctSigned = (diff >= 0 ? '+' : '') + (pct * 100).toFixed(2) + '%';
        label += ' · ' + pctSigned;
      }
      var pnlEl = $('labPnlToday');
      if (pnlEl) {
        pnlEl.textContent = label;
        pnlEl.classList.toggle('up', diff >= 0);
        pnlEl.classList.toggle('down', diff < 0);
      }
      // P&L 7d — without history, mirror total session for now
      var pnl7 = $('labPnl7d');
      if (pnl7) {
        pnl7.textContent = label;
        pnl7.classList.toggle('up', diff >= 0);
        pnl7.classList.toggle('down', diff < 0);
      }
    } else {
      setText('labPnlToday', emptyDash());
      setText('labPnl7d', emptyDash());
    }

    // Drawdown
    var ddEl = $('labMaxDd');
    if (ddEl) {
      if (view.equityMaxDrawdown !== null) {
        var ddText = fmt.currency(-Math.abs(view.equityMaxDrawdown), { digits: 2 });
        if (view.equityMaxDrawdownPct !== null) {
          ddText += ' · ' + (-Math.abs(view.equityMaxDrawdownPct) * 100).toFixed(2) + '%';
        }
        ddEl.textContent = ddText;
        ddEl.classList.add('down'); ddEl.classList.remove('up');
      } else {
        ddEl.textContent = emptyDash();
        ddEl.classList.remove('up', 'down');
      }
    }

    // KPI: Win rate
    var wrEl = $('labKpiWinRate');
    var wrSub = $('labKpiWinRateSub');
    if (view.winRate !== null) {
      if (wrEl) {
        wrEl.innerHTML = (view.winRate * 100).toFixed(1)
          + '<small style="color:var(--lab-text-mute);font-size:11px">%</small>';
      }
      if (wrSub) {
        var closed = view.closedTrades !== null ? view.closedTrades : '—';
        wrSub.textContent = closed + ' trades';
      }
    } else {
      if (wrEl) wrEl.textContent = emptyDash();
      if (wrSub) {
        wrSub.textContent = view.sampleStatus === 'insufficient'
          ? 'sample insuficiente'
          : 'sin datos';
      }
    }

    // KPI: Profit factor
    setText('labKpiPf', view.profitFactor !== null ? view.profitFactor.toFixed(2) : emptyDash());

    // KPI: Expectancy
    setText('labKpiExpectancy',
      view.expectancy !== null ? api().fmt.currency(view.expectancy, { digits: 2 }) : emptyDash());

    // KPI: Sample
    var sampleEl = $('labKpiSample');
    var sampleSub = $('labKpiSampleStatus');
    if (sampleEl) {
      if (view.sampleSize !== null) {
        sampleEl.textContent = String(view.sampleSize);
        sampleEl.style.color = view.sampleSufficient ? 'var(--lab-green)' : 'var(--lab-amber)';
      } else {
        sampleEl.textContent = emptyDash();
        sampleEl.style.color = '';
      }
    }
    if (sampleSub) {
      sampleSub.textContent = view.sampleStatus
        ? view.sampleStatus
        : 'sin datos';
    }

    // KPI: Confidence + stability
    setText('labKpiConfidence',
      view.confidenceScore !== null ? view.confidenceScore.toFixed(2) : emptyDash());
    var stabSub = $('labKpiStability');
    if (stabSub) {
      stabSub.textContent = view.stabilityScore !== null
        ? ('stability ' + view.stabilityScore.toFixed(2))
        : 'stability —';
    }

    // KPI: Open / Closed
    var openEl = $('labKpiOpenClosed');
    if (openEl) {
      var open = view.openPositions !== null ? view.openPositions : '—';
      var closedC = view.closedTrades !== null ? view.closedTrades : '—';
      openEl.textContent = open + ' / ' + closedC;
    }
  }

  // ──────────────────────────────────────────────────────
  // Render: top-bar pills
  // ──────────────────────────────────────────────────────
  function renderPills(view) {
    var schedPill = $('labPillScheduler');
    if (schedPill) {
      var s = view.scheduler;
      schedPill.classList.remove('is-on', 'is-off', 'is-warn', 'is-armed');
      if (s.state === 'available' && s.active) {
        schedPill.classList.add('is-on');
        var label = 'Scheduler';
        if (s.intervalMs) label += ' · ' + Math.round(s.intervalMs / 1000) + 's';
        schedPill.lastChild.textContent = ' ' + label;
      } else if (s.state === 'unavailable' || (s.state === 'available' && !s.active)) {
        schedPill.classList.add('is-off');
        schedPill.lastChild.textContent = ' Scheduler OFF';
      } else if (s.state === 'error') {
        schedPill.classList.add('is-warn');
        schedPill.lastChild.textContent = ' Scheduler · sin conexión';
      } else {
        schedPill.classList.add('is-off');
        schedPill.lastChild.textContent = ' Scheduler · …';
      }
    }

    // Real trading pill — always OFF in shadow. Becomes danger if backend
    // ever reports realTradingTouched=true (should be impossible in shadow).
    var realPill = $('labPillTradingReal');
    if (realPill) {
      realPill.classList.remove('is-on', 'is-off', 'is-warn', 'is-armed');
      if (view.scheduler.realTradingTouched) {
        realPill.classList.add('is-armed');
        realPill.lastChild.textContent = ' Trading Real · TOUCHED';
      } else {
        realPill.classList.add('is-off');
        realPill.lastChild.textContent = ' Trading Real OFF';
      }
    }
  }

  // ──────────────────────────────────────────────────────
  // Render: health strip
  // ──────────────────────────────────────────────────────
  function renderHealth(view) {
    var fmt = api() && api().fmt;
    var s = view.scheduler;

    // Loop scheduler cell
    var schedFlag = $('labHealthScheduler');
    if (schedFlag) {
      schedFlag.innerHTML = '';
      var dot = document.createElement('span');
      dot.className = 'dot ' + (s.active ? 'purple' : 'off');
      var lbl = document.createElement('span');
      if (s.state === 'error') {
        lbl.style.color = 'var(--lab-amber)';
        lbl.textContent = 'Sin conexión';
      } else if (s.active) {
        lbl.style.color = '#DDD6FE';
        lbl.textContent = 'Active';
      } else if (s.state === 'unavailable') {
        lbl.style.color = 'var(--lab-text-mute)';
        lbl.textContent = 'Unavailable';
      } else {
        lbl.style.color = 'var(--lab-text-mute)';
        lbl.textContent = 'Idle';
      }
      schedFlag.appendChild(dot);
      schedFlag.appendChild(lbl);
    }
    setText('labHealthSchedulerSub', s.intervalMs
      ? ('interval ' + s.intervalMs.toLocaleString('en-US') + ' ms')
      : 'interval —');

    // Ticks run
    setText('labHealthTicks', s.ticksRun !== null ? s.ticksRun.toLocaleString('en-US') : emptyDash());
    var tSub = 'skipped ' + (s.ticksSkipped !== null ? s.ticksSkipped : '—');
    var lastTickStr = fmt && fmt.time(s.lastTickAt);
    tSub += ' · last ' + (lastTickStr || '—');
    setText('labHealthTicksSub', tSub);

    // Sample status
    var sampleEl = $('labHealthSample');
    var sampleSub = $('labHealthSampleSub');
    if (sampleEl) {
      if (view.sampleStatus === 'sufficient') {
        sampleEl.textContent = 'Sufficient';
        sampleEl.style.color = 'var(--lab-green)';
      } else if (view.sampleStatus === 'insufficient') {
        sampleEl.textContent = 'Insufficient';
        sampleEl.style.color = 'var(--lab-amber)';
      } else {
        sampleEl.textContent = emptyDash();
        sampleEl.style.color = '';
      }
    }
    if (sampleSub) {
      var size = view.sampleSize !== null ? view.sampleSize : '—';
      sampleSub.textContent = size + ' trades · ≥30 ' + (view.sampleSufficient ? '✓' : '·');
    }

    // Real trading
    var realEl = $('labHealthRealTrading');
    if (realEl) {
      realEl.innerHTML = '';
      var rdot = document.createElement('span');
      rdot.className = 'dot ' + (s.realTradingTouched ? 'on' : 'off');
      var rlbl = document.createElement('span');
      if (s.realTradingTouched) {
        rlbl.style.color = '#FCA5A5';
        rlbl.textContent = 'TOUCHED';
      } else {
        rlbl.style.color = 'var(--lab-text-mute)';
        rlbl.textContent = 'Untouched';
      }
      realEl.appendChild(rdot);
      realEl.appendChild(rlbl);
    }

    // Context source — not provided by these 4 endpoints; mark as N/A
    setText('labHealthContext', s.state === 'error' ? 'sin conexión' : 'shadow');
    setText('labHealthContextSub', 'real-trading verified read-only');
  }

  // ──────────────────────────────────────────────────────
  // Render: equity curve
  // ──────────────────────────────────────────────────────
  function scheduleEquityRedraw() {
    if (equityRedrawPending) return;
    equityRedrawPending = true;
    requestAnimationFrame(function () {
      equityRedrawPending = false;
      drawEquity();
    });
  }

  function drawEquity() {
    var cv = $('labEquityCanvas');
    if (!cv) return;
    if (cv.offsetParent === null) return; // hidden — skip

    var dpr = window.devicePixelRatio || 1;
    var rect = cv.getBoundingClientRect();
    cv.width  = Math.max(2, Math.floor(rect.width  * dpr));
    cv.height = Math.max(2, Math.floor(rect.height * dpr));
    var ctx = cv.getContext('2d');
    var w = cv.width, h = cv.height;
    ctx.clearRect(0, 0, w, h);

    var curve = lastEquityCurve || [];
    // Normalize {t,v} | number | {balance,timestamp} into pure number array
    var values = curve.map(function (p) {
      if (typeof p === 'number') return p;
      if (p && typeof p === 'object') {
        if (typeof p.balance === 'number') return p.balance;
        if (typeof p.equity === 'number')  return p.equity;
        if (typeof p.value === 'number')   return p.value;
        if (typeof p.v === 'number')       return p.v;
      }
      return null;
    }).filter(function (n) { return typeof n === 'number' && isFinite(n); });

    if (values.length < 2) {
      drawEquityEmpty(ctx, w, h, dpr);
      return;
    }

    var padX = 8 * dpr, padY = 16 * dpr;
    var innerW = w - padX * 2, innerH = h - padY * 2;
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var range = (max - min) || 1;
    function pt(i) {
      return [
        padX + (innerW * i) / (values.length - 1),
        padY + innerH - ((values[i] - min) / range) * innerH
      ];
    }

    // grid
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.06)'; ctx.lineWidth = 1;
    for (var k = 1; k < 4; k++) {
      var y = padY + (innerH / 4) * k;
      ctx.beginPath(); ctx.moveTo(padX, y); ctx.lineTo(w - padX, y); ctx.stroke();
    }

    // area
    var grad = ctx.createLinearGradient(0, padY, 0, h - padY);
    grad.addColorStop(0,   'rgba(168, 85, 247, 0.42)');
    grad.addColorStop(0.6, 'rgba(139, 92, 246, 0.18)');
    grad.addColorStop(1,   'rgba(139, 92, 246, 0.00)');
    ctx.beginPath();
    var p0 = pt(0); ctx.moveTo(p0[0], p0[1]);
    for (var j = 1; j < values.length; j++) { var p = pt(j); ctx.lineTo(p[0], p[1]); }
    ctx.lineTo(w - padX, h - padY); ctx.lineTo(padX, h - padY); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    // glow under-line
    ctx.beginPath(); var pa0 = pt(0); ctx.moveTo(pa0[0], pa0[1]);
    for (var jj = 1; jj < values.length; jj++) { var pp = pt(jj); ctx.lineTo(pp[0], pp[1]); }
    ctx.lineWidth = 6 * dpr;
    ctx.strokeStyle = 'rgba(168, 85, 247, 0.22)';
    ctx.shadowColor = 'rgba(168, 85, 247, 0.7)';
    ctx.shadowBlur  = 16 * dpr;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // crisp line
    var stroke = ctx.createLinearGradient(0, 0, w, 0);
    stroke.addColorStop(0, '#A855F7'); stroke.addColorStop(1, '#8B5CF6');
    ctx.beginPath(); var pb0 = pt(0); ctx.moveTo(pb0[0], pb0[1]);
    for (var ll = 1; ll < values.length; ll++) { var pc = pt(ll); ctx.lineTo(pc[0], pc[1]); }
    ctx.lineWidth = 1.8 * dpr; ctx.strokeStyle = stroke; ctx.stroke();

    // last point
    var lp = pt(values.length - 1);
    ctx.beginPath(); ctx.arc(lp[0], lp[1], 8 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(168, 85, 247, 0.30)'; ctx.fill();
    ctx.beginPath(); ctx.arc(lp[0], lp[1], 4 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = '#A855F7';
    ctx.shadowColor = 'rgba(168, 85, 247, 0.9)'; ctx.shadowBlur = 12 * dpr;
    ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(5,8,22,1)'; ctx.lineWidth = 2 * dpr; ctx.stroke();
  }

  function drawEquityEmpty(ctx, w, h, dpr) {
    // Subtle baseline + centered "esperando datos" copy
    ctx.strokeStyle = 'rgba(139, 92, 246, 0.10)';
    ctx.setLineDash([4 * dpr, 6 * dpr]);
    ctx.lineWidth = 1;
    var y = h / 2;
    ctx.beginPath(); ctx.moveTo(8 * dpr, y); ctx.lineTo(w - 8 * dpr, y); ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.font = (11 * dpr) + 'px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var msg = lastInterpreted && lastInterpreted.equityState === 'error'
      ? 'sin conexión'
      : (lastInterpreted && lastInterpreted.equityState === 'unavailable'
          ? 'training state unavailable'
          : (lastInterpreted && lastInterpreted.sampleStatus === 'insufficient'
              ? 'sample insuficiente · esperando ≥ 30 trades cerrados'
              : 'esperando datos de equity'));
    ctx.fillText(msg, w / 2, y - 14 * dpr);
  }

  // ──────────────────────────────────────────────────────
  // Hero-level banner: loading / unavailable / error
  // ──────────────────────────────────────────────────────
  function renderEyebrow(view) {
    var lab = labRoot;
    if (!lab) return;
    var eyebrow = lab.querySelector('.lab-eyebrow .tag');
    if (!eyebrow) return;
    if (view.state === 'loading') {
      eyebrow.textContent = 'Cargando';
      eyebrow.style.color = 'var(--lab-text-mute)';
      eyebrow.style.borderColor = 'var(--lab-border)';
      eyebrow.style.background = 'transparent';
      eyebrow.style.boxShadow = 'none';
    } else if (view.state === 'error') {
      eyebrow.textContent = 'Sin conexión';
      eyebrow.style.color = 'var(--lab-amber)';
      eyebrow.style.borderColor = 'rgba(245,158,11,0.36)';
      eyebrow.style.background = 'var(--lab-amber-soft)';
      eyebrow.style.boxShadow = '0 0 12px -4px var(--lab-amber-glow)';
    } else if (view.state === 'unavailable') {
      eyebrow.textContent = 'Unavailable';
      eyebrow.style.color = 'var(--lab-text-mute)';
      eyebrow.style.borderColor = 'var(--lab-border)';
      eyebrow.style.background = 'transparent';
      eyebrow.style.boxShadow = 'none';
    } else {
      eyebrow.textContent = 'Shadow';
      eyebrow.style.color = '';
      eyebrow.style.borderColor = '';
      eyebrow.style.background = '';
      eyebrow.style.boxShadow = '';
    }
  }

  // ──────────────────────────────────────────────────────
  // Fetch / refresh
  // ──────────────────────────────────────────────────────
  function refreshAll() {
    var a = api(); if (!a) return;
    a.getLabHeroSnapshot().then(function (snapshot) {
      rawSnapshot = snapshot;
      applyInterpreted();
    });
  }

  function refreshLoop() {
    var a = api(); if (!a) return;
    a.getLabLoopStatus().then(function (env) {
      rawSnapshot.loop = env;
      applyInterpreted();
    });
  }

  function refreshPerformance() {
    var a = api(); if (!a) return;
    a.getLabPerformanceSummary().then(function (env) {
      rawSnapshot.performance = env;
      applyInterpreted();
    });
  }

  function refreshEquity() {
    var a = api(); if (!a) return;
    a.getLabEquity().then(function (env) {
      rawSnapshot.equity = env;
      applyInterpreted();
    });
  }

  function refreshEdge() {
    var a = api(); if (!a) return;
    a.getLabEdge().then(function (env) {
      rawSnapshot.edge = env;
      applyInterpreted();
    });
  }

  function applyInterpreted() {
    var a = api(); if (!a) return;
    var view = a.interpretHero(rawSnapshot);
    lastInterpreted = view;
    lastEquityCurve = view.equityCurve;
    renderEyebrow(view);
    renderHero(view);
    renderPills(view);
    renderHealth(view);
    scheduleEquityRedraw();
  }

  // ──────────────────────────────────────────────────────
  // Activation lifecycle
  // ──────────────────────────────────────────────────────
  function isActive() {
    return labRoot && labRoot.classList.contains('active');
  }

  function start() {
    if (timers.loop || timers.perf || timers.eq || timers.edge) return;
    refreshAll();
    timers.loop = setInterval(refreshLoop, INTERVAL_LOOP);
    timers.perf = setInterval(refreshPerformance, INTERVAL_PERFORMANCE);
    timers.eq   = setInterval(refreshEquity, INTERVAL_EQUITY);
    timers.edge = setInterval(refreshEdge, INTERVAL_EDGE);
  }

  function stop() {
    Object.keys(timers).forEach(function (k) {
      if (timers[k]) { clearInterval(timers[k]); timers[k] = null; }
    });
  }

  function renderInitialSkeleton() {
    var view = {
      state: 'loading',
      anyAvailable: false,
      sampleStatus: null, sampleSize: null, sampleSufficient: false,
      balance: null, equity: null, openPositions: null, closedTrades: null,
      winRate: null, profitFactor: null, expectancy: null, maxDrawdown: null,
      confidenceScore: null, stabilityScore: null,
      equityCurve: [], equityCurvePoints: null, equityMaxDrawdown: null, equityMaxDrawdownPct: null,
      equityState: 'loading',
      scheduler: { state: 'loading', active: false, enabled: false, loopEnabled: false,
                   ticksRun: null, ticksSkipped: null, lastTickAt: null,
                   intervalMs: null, realTradingTouched: false },
      raw: {}, states: {}, errors: {}
    };
    lastInterpreted = view;
    lastEquityCurve = [];
    renderEyebrow(view);
    renderHero(view);
    renderPills(view);
    renderHealth(view);
    scheduleEquityRedraw();
  }

  function boot() {
    if (booted) return;
    labRoot = document.getElementById('view-lab');
    equityCanvas = document.getElementById('labEquityCanvas');
    if (!labRoot || !api()) return;
    booted = true;

    if (!observerAttached) {
      new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          if (mutations[i].attributeName === 'class') {
            if (isActive()) start();
            else stop();
            break;
          }
        }
      }).observe(labRoot, { attributes: true });
      observerAttached = true;
    }

    if (!resizeAttached) {
      window.addEventListener('resize', scheduleEquityRedraw);
      resizeAttached = true;
    }

    renderInitialSkeleton();
    if (isActive()) start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.QuantLab = window.QuantLab || {};
  window.QuantLab.views = window.QuantLab.views || {};
  window.QuantLab.views.hero = {
    boot: boot,
    refresh: refreshAll,
    start: start,
    stop: stop,
    isActive: isActive
  };
})();
