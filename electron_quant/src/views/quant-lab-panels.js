/**
 * QUANT-LAB PANELS controllers.
 *
 * Six independent panel controllers for the Quant Lab body, all wired
 * to read-only endpoints. Each controller owns its own fetch, render,
 * empty/error states and polling cadence. They share a single
 * MutationObserver on #view-lab.class to start/stop together — no
 * duplicate observers, no background work when the Lab is hidden.
 *
 * Panels and their endpoints (audited in H0):
 *   1. Open Positions       /api/training/demo/positions/open
 *   2. Recent Trades        /api/training/demo/trades/recent
 *   3. Recent Lessons       /api/training/demo/lessons/recent
 *   4. Strategy Ranking     /api/training/core/strategies
 *   5. Signal Candidates    /api/training/demo/signals/candidates
 *   6. Training Health      /api/training/demo/context/status   (enriches
 *      the Context source cell already rendered by the hero controller).
 *
 * Pure consumer of read-only endpoints. No backend writes, no scheduler
 * control, no real-trading touch. Backend, OpenAPI and quant_data are
 * untouched by this module.
 *
 * Exposed as window.QuantLab.views.panels.
 */
(function () {
  if (window.QuantLab && window.QuantLab.views && window.QuantLab.views.panels) return;

  // ─── Polling cadence (ms, only while #view-lab is active) ───
  var INTERVAL_POSITIONS  = 5000;   // open trades change tick-by-tick
  var INTERVAL_CANDIDATES = 10000;
  var INTERVAL_CONTEXT    = 15000;
  var INTERVAL_TRADES     = 20000;
  var INTERVAL_LESSONS    = 30000;
  var INTERVAL_STRATEGIES = 45000;

  var labRoot = null;
  var booted = false;
  var observerAttached = false;
  var timers = {};
  var lastFetchedAt = {};

  // ─────────────────────────────────────────────────────────
  // Tiny helpers
  // ─────────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function api() { return (window.QuantLab && window.QuantLab.api) ? window.QuantLab.api : null; }
  function fmt() { var a = api(); return a ? a.fmt : null; }
  function emptyDash() { return '—'; }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Pick the first defined field from a candidate list. */
  function pick(obj /*, ...names */) {
    if (!obj || typeof obj !== 'object') return undefined;
    for (var i = 1; i < arguments.length; i++) {
      var v = obj[arguments[i]];
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  }

  /** "BTCUSDT" → "BTC" for the symbol icon. */
  function symbolIcon(symbol) {
    if (!symbol) return '?';
    var s = String(symbol).toUpperCase();
    var stripped = s.replace(/USDT$|USDC$|BUSD$|USD$/, '');
    return stripped.slice(0, 3) || s.slice(0, 3);
  }

  /** Normalize side: backend may send LONG/SHORT, BUY/SELL, 1/-1, "long"/"short". */
  function normalizeSide(raw) {
    if (raw == null) return null;
    var s = String(raw).trim().toUpperCase();
    if (s === 'LONG' || s === 'BUY' || s === 'L' || s === '1') return 'LONG';
    if (s === 'SHORT' || s === 'SELL' || s === 'S' || s === '-1') return 'SHORT';
    return null;
  }

  /** ms since openedAt → "14m", "1h 02m", "3d 04h". */
  function relativeAge(openedAt) {
    if (!openedAt) return null;
    var t = new Date(openedAt);
    if (isNaN(t.getTime())) return null;
    var ms = Date.now() - t.getTime();
    if (ms < 0) ms = 0;
    var s  = Math.floor(ms / 1000);
    var m  = Math.floor(s  / 60);
    var h  = Math.floor(m  / 60);
    var d  = Math.floor(h  / 24);
    if (d >= 1) return d + 'd ' + String(h % 24).padStart(2, '0') + 'h';
    if (h >= 1) return h + 'h ' + String(m % 60).padStart(2, '0') + 'm';
    if (m >= 1) return m + 'm';
    return s + 's';
  }

  /** Number → trader-style price string with thin spaces every 3 digits in the integer part. */
  function fmtPrice(n) {
    if (typeof n !== 'number' || !isFinite(n)) return null;
    var abs = Math.abs(n);
    var digits = abs >= 1000 ? 2 : (abs >= 1 ? 4 : 6);
    var [intPart, decPart] = n.toFixed(digits).split('.');
    intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return decPart ? (intPart + '.' + decPart) : intPart;
  }

  /** SVG icon used in empty/error/unavailable cells. */
  function emptyIconSvg(kind) {
    if (kind === 'error') {
      return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1 L15 14 L1 14 Z"/><path d="M8 6 V9"/><circle cx="8" cy="11.5" r="0.6" fill="currentColor"/></svg>';
    }
    if (kind === 'loading') {
      return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 2 a6 6 0 0 1 6 6"/></svg>';
    }
    return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M5.5 8 L8 10 L11 6"/></svg>';
  }

  /** Skeleton row HTML for a table tbody (returns <tr>... markup). */
  function tableSkeletonRows(rowCount, colWidths) {
    var rows = '';
    for (var i = 0; i < rowCount; i++) {
      var cells = colWidths.map(function (w) {
        return '<td><span class="lab-skel" style="width:' + w + '%"></span></td>';
      }).join('');
      rows += '<tr class="lab-skel-row" aria-hidden="true">' + cells + '</tr>';
    }
    return rows;
  }

  /** Render a generic envelope-aware empty/error message inside a tbody/list. */
  function renderEmptyRow(host, colspan, viewState, opts) {
    opts = opts || {};

    // Loading → emit skeleton rows / cards instead of plain text
    if (viewState === 'loading') {
      if (host.tagName === 'TBODY' && Array.isArray(opts.skeletonCols)) {
        host.innerHTML = tableSkeletonRows(opts.skeletonRows || 4, opts.skeletonCols);
        return;
      }
      if (opts.skeletonHtml) {
        host.innerHTML = opts.skeletonHtml;
        return;
      }
      // fallback
    }

    var kind = viewState === 'error' ? 'error' : (viewState === 'loading' ? 'loading' : 'empty');
    var msg;
    var hint = '';
    if (viewState === 'loading') msg = opts.loading || 'cargando…';
    else if (viewState === 'error') { msg = opts.error || 'sin conexión'; hint = 'reintentando'; }
    else if (viewState === 'unavailable') { msg = opts.unavailable || 'training state unavailable'; hint = 'sin datos persistidos'; }
    else { msg = opts.empty || 'sin datos'; hint = opts.hint || ''; }

    var cellHtml = ''
      + '<div class="lab-empty-cell ' + (kind === 'error' ? 'is-error' : '') + '" role="status" aria-live="polite">'
      +   '<span class="lab-empty-icon">' + emptyIconSvg(kind) + '</span>'
      +   '<span>' + escHtml(msg) + '</span>'
      +   (hint ? '<span class="lab-empty-hint">' + escHtml(hint) + '</span>' : '')
      + '</div>';

    if (host.tagName === 'TBODY') {
      host.innerHTML = '<tr><td colspan="' + colspan + '" style="padding:0">' + cellHtml + '</td></tr>';
    } else {
      host.innerHTML = cellHtml;
    }
  }

  /** Mark host as "fresh" for one frame so children fade in via CSS. */
  function markFresh(host) {
    if (!host) return;
    host.classList.remove('lab-fresh');
    // force reflow so the animation re-triggers if applied repeatedly
    void host.offsetWidth;
    host.classList.add('lab-fresh');
  }

  function envelopeState(envelope) {
    var a = api(); if (!a) return 'loading';
    return a.envelopeState(envelope);
  }

  // ─────────────────────────────────────────────────────────
  // Panel 1 — Open Positions
  // ─────────────────────────────────────────────────────────
  var openPositionsCtrl = (function () {
    function render(envelope) {
      var table = $('labOpenTable'); if (!table) return;
      var tbody = table.querySelector('tbody'); if (!tbody) return;
      var state = envelopeState(envelope);

      if (state !== 'available') {
        renderEmptyRow(tbody, 7, state, {
          unavailable: 'training state unavailable',
          empty: 'sin posiciones abiertas',
          skeletonRows: 3, skeletonCols: [60, 28, 50, 50, 40, 30, 70]
        });
        var cE = $('labOpenCount'); if (cE) cE.textContent = state === 'loading' ? '…' : '—';
        return;
      }

      var body = envelope.body || {};
      var positions = Array.isArray(body.positions) ? body.positions : [];
      var c = $('labOpenCount'); if (c) c.textContent = String(body.total != null ? body.total : positions.length);

      if (positions.length === 0) {
        renderEmptyRow(tbody, 7, 'available', { empty: 'sin posiciones abiertas', hint: 'el scheduler aún no ha abierto demo trades' });
        return;
      }

      var rows = positions.map(function (p) {
        var symbol  = pick(p, 'symbol', 'pair', 'instrument') || '';
        var side    = normalizeSide(pick(p, 'side', 'direction', 'bias'));
        var entry   = pick(p, 'entry_price', 'entryPrice', 'entry', 'open_price', 'openPrice');
        var mark    = pick(p, 'mark_price', 'markPrice', 'last_price', 'lastPrice', 'current_price', 'price');
        var pnl     = pick(p, 'pnl', 'unrealized_pnl', 'unrealizedPnl', 'profit', 'pnlUsd');
        var opened  = pick(p, 'opened_at', 'openedAt', 'entry_time', 'entryTime', 'timestamp');
        var strat   = pick(p, 'strategy_name', 'strategyName', 'strategy', 'strategy_id', 'strategyId') || '—';
        var horizon = pick(p, 'horizon');

        var f = fmt();
        var entryTxt = (typeof entry === 'number') ? fmtPrice(entry) : emptyDash();
        var markTxt  = (typeof mark  === 'number') ? fmtPrice(mark)  : emptyDash();
        var pnlTxt = (typeof pnl === 'number' && f) ? f.currency(pnl, { signed: true, digits: 2 }) : emptyDash();
        var pnlClass = (typeof pnl === 'number') ? (pnl >= 0 ? 'up' : 'down') : '';
        var ageTxt = relativeAge(opened) || emptyDash();
        var stratTxt = horizon ? (strat + ' · ' + horizon) : strat;

        var sideHtml = side
          ? '<span class="lab-side ' + (side === 'LONG' ? 'long' : 'short') + '">' + side + '</span>'
          : '<span style="color:var(--lab-text-faint)">—</span>';

        return ''
          + '<tr>'
          +   '<td><span class="lab-sym"><span class="ic">' + escHtml(symbolIcon(symbol)) + '</span> ' + escHtml(symbol) + '</span></td>'
          +   '<td>' + sideHtml + '</td>'
          +   '<td class="num">' + escHtml(entryTxt) + '</td>'
          +   '<td class="num">' + escHtml(markTxt)  + '</td>'
          +   '<td class="num pnl ' + pnlClass + '">' + escHtml(pnlTxt) + '</td>'
          +   '<td class="mono" style="color:var(--lab-text-mute)">' + escHtml(ageTxt) + '</td>'
          +   '<td class="mono">' + escHtml(stratTxt) + '</td>'
          + '</tr>';
      }).join('');
      tbody.innerHTML = rows;
      markFresh(tbody);
    }
    return { render: render };
  })();

  // ─────────────────────────────────────────────────────────
  // Panel 2 — Recent Trades
  // ─────────────────────────────────────────────────────────
  var recentTradesCtrl = (function () {
    function render(envelope) {
      var table = $('labTradesTable'); if (!table) return;
      var tbody = table.querySelector('tbody'); if (!tbody) return;
      var state = envelopeState(envelope);

      if (state !== 'available') {
        renderEmptyRow(tbody, 7, state, {
          unavailable: 'training state unavailable',
          empty: 'sin trades cerrados',
          skeletonRows: 5, skeletonCols: [40, 50, 28, 70, 40, 30, 60]
        });
        var cE = $('labTradesCount'); if (cE) cE.textContent = state === 'loading' ? '…' : '—';
        return;
      }

      var body = envelope.body || {};
      var trades = Array.isArray(body.trades) ? body.trades : [];
      var totalShown = trades.length;
      var c = $('labTradesCount'); if (c) c.textContent = totalShown + (body.total != null && body.total !== totalShown ? ' / ' + body.total : '');

      if (trades.length === 0) {
        renderEmptyRow(tbody, 7, 'available', { empty: 'sin trades cerrados todavía', hint: 'esperando primer cierre' });
        return;
      }

      var f = fmt();
      var rows = trades.map(function (t) {
        var symbol = pick(t, 'symbol', 'pair') || '';
        var side   = normalizeSide(pick(t, 'side', 'direction', 'bias'));
        var entry  = pick(t, 'entry_price', 'entryPrice', 'entry');
        var exit   = pick(t, 'exit_price', 'exitPrice', 'exit', 'close_price', 'closePrice');
        var pnl    = pick(t, 'pnl', 'realized_pnl', 'realizedPnl', 'profit');
        var rr     = pick(t, 'r_multiple', 'rMultiple', 'rr', 'r');
        var closed = pick(t, 'closed_timestamp', 'closedAt', 'closed_at', 'closeTime', 'closeTimestamp', 'timestamp');
        var strat  = pick(t, 'strategy_name', 'strategyName', 'strategy', 'strategy_id') || '—';

        var entryTxt = (typeof entry === 'number') ? fmtPrice(entry) : '—';
        var exitTxt  = (typeof exit  === 'number') ? fmtPrice(exit)  : '—';
        var pnlTxt = (typeof pnl === 'number' && f) ? f.currency(pnl, { signed: true, digits: 2 }) : '—';
        var pnlClass = (typeof pnl === 'number') ? (pnl >= 0 ? 'up' : 'down') : '';
        var rrTxt = (typeof rr === 'number') ? (rr >= 0 ? '+' : '') + rr.toFixed(1) + 'R' : '—';
        var closedTxt = (f && f.time(closed)) || '—';

        var sideHtml = side
          ? '<span class="lab-side ' + (side === 'LONG' ? 'long' : 'short') + '">' + (side === 'LONG' ? 'L' : 'S') + '</span>'
          : '<span style="color:var(--lab-text-faint)">—</span>';

        return ''
          + '<tr>'
          +   '<td class="mono" style="color:var(--lab-text-mute)">' + escHtml(closedTxt) + '</td>'
          +   '<td><span class="lab-sym"><span class="ic">' + escHtml(symbolIcon(symbol)) + '</span> ' + escHtml((symbol || '').replace(/USDT$/,'')) + '</span></td>'
          +   '<td>' + sideHtml + '</td>'
          +   '<td class="num">' + escHtml(entryTxt) + ' → ' + escHtml(exitTxt) + '</td>'
          +   '<td class="num pnl ' + pnlClass + '">' + escHtml(pnlTxt) + '</td>'
          +   '<td class="num">' + escHtml(rrTxt) + '</td>'
          +   '<td class="mono">' + escHtml(strat) + '</td>'
          + '</tr>';
      }).join('');
      tbody.innerHTML = rows;
      markFresh(tbody);
    }
    return { render: render };
  })();

  // ─────────────────────────────────────────────────────────
  // Panel 3 — Recent Lessons
  // ─────────────────────────────────────────────────────────
  var lessonsCtrl = (function () {
    function render(envelope) {
      var host = $('labLessonsList'); if (!host) return;
      var state = envelopeState(envelope);

      if (state !== 'available') {
        var lessonSkel = '';
        if (state === 'loading') {
          for (var lk = 0; lk < 4; lk++) {
            lessonSkel += '<div class="lab-lesson" aria-hidden="true">'
              + '<div class="tl"><div class="d" style="background:rgba(139,92,246,0.18);box-shadow:none"></div></div>'
              + '<div class="body" style="gap:6px">'
              +   '<div><span class="lab-skel" style="width:60%"></span></div>'
              +   '<div><span class="lab-skel" style="width:88%"></span></div>'
              + '</div></div>';
          }
        }
        renderEmptyRow(host, 1, state, {
          unavailable: 'training state unavailable',
          empty: 'sin lecciones registradas',
          skeletonHtml: lessonSkel
        });
        var cE = $('labLessonsCount'); if (cE) cE.textContent = state === 'loading' ? '…' : '—';
        return;
      }

      var body = envelope.body || {};
      var lessons = Array.isArray(body.lessons) ? body.lessons : [];
      var c = $('labLessonsCount'); if (c) c.textContent = String(body.total != null ? body.total : lessons.length);

      if (lessons.length === 0) {
        renderEmptyRow(host, 1, 'available', { empty: 'aún no hay lecciones registradas', hint: 'cada cierre genera una entrada' });
        return;
      }

      var f = fmt();
      var html = lessons.map(function (l) {
        var symbol = pick(l, 'symbol', 'pair') || '';
        var side   = normalizeSide(pick(l, 'side', 'direction'));
        var strat  = pick(l, 'strategy_name', 'strategyName', 'strategy') || '';
        var when   = pick(l, 'recorded_at', 'recordedAt', 'created_at', 'createdAt', 'timestamp');
        var rr     = pick(l, 'r_multiple', 'rMultiple', 'rr', 'r');
        var pnl    = pick(l, 'pnl', 'realized_pnl');
        var text   = pick(l, 'text', 'lesson', 'note', 'message', 'summary') || '';
        var outcomeRaw = pick(l, 'outcome', 'result');

        var outcome;
        if (typeof outcomeRaw === 'string') outcome = outcomeRaw.toLowerCase();
        else if (typeof rr === 'number') outcome = rr >= 0 ? 'win' : 'loss';
        else if (typeof pnl === 'number') outcome = pnl >= 0 ? 'win' : 'loss';
        else outcome = '';

        var rrTxt = (typeof rr === 'number')
          ? '<span style="color:var(--' + (rr >= 0 ? 'lab-green' : 'lab-red') + ')">'
            + (rr >= 0 ? '+' : '') + rr.toFixed(1) + 'R</span>'
          : ((typeof pnl === 'number' && f)
            ? '<span style="color:var(--' + (pnl >= 0 ? 'lab-green' : 'lab-red') + ')">'
              + f.currency(pnl, { signed: true, digits: 2 }) + '</span>'
            : '');

        var meta = [];
        if (symbol || side) meta.push('<b>' + escHtml((symbol || '').replace(/USDT$/, '')) + (side ? ' · ' + side : '') + '</b>');
        var whenTxt = f && f.time(when);
        if (whenTxt) meta.push(escHtml(whenTxt));
        if (strat) meta.push(escHtml(strat));
        if (rrTxt) meta.push(rrTxt);

        return ''
          + '<div class="lab-lesson ' + escHtml(outcome) + '">'
          +   '<div class="tl"><div class="d"></div></div>'
          +   '<div class="body">'
          +     '<div class="meta">' + meta.join(' · ') + '</div>'
          +     (text ? '<p>' + escHtml(text) + '</p>' : '<p style="color:var(--lab-text-faint)">sin nota</p>')
          +   '</div>'
          + '</div>';
      }).join('');
      host.innerHTML = html;
      markFresh(host);
    }
    return { render: render };
  })();

  // ─────────────────────────────────────────────────────────
  // Panel 4 — Strategy Ranking
  // ─────────────────────────────────────────────────────────
  var strategiesCtrl = (function () {
    function render(envelope) {
      var host = $('labStratList'); if (!host) return;
      var state = envelopeState(envelope);

      if (state !== 'available') {
        var stratSkel = '';
        if (state === 'loading') {
          for (var si = 0; si < 4; si++) {
            stratSkel += '<div class="lab-strat-row" aria-hidden="true">'
              +   '<div class="lab-strat-rank"><span class="lab-skel" style="width:60%;height:10px"></span></div>'
              +   '<div class="lab-strat-name"><span class="lab-skel" style="width:60%"></span><span class="lab-skel" style="width:40%;margin-top:4px"></span></div>'
              +   '<div class="lab-strat-stat"><span class="lab-skel" style="width:60px"></span></div>'
              +   '<div class="lab-strat-stat"><span class="lab-skel" style="width:36px"></span></div>'
              +   '<div class="lab-strat-bar"><span style="width:' + (40 + si * 10) + '%"></span></div>'
              + '</div>';
          }
        }
        renderEmptyRow(host, 1, state, {
          unavailable: 'training state unavailable',
          empty: 'aún no hay estrategias clasificadas',
          skeletonHtml: stratSkel
        });
        var cE = $('labStratCount'); if (cE) cE.textContent = state === 'loading' ? '…' : '—';
        return;
      }

      var body = envelope.body || {};
      var ranking = Array.isArray(body.strategyRanking) ? body.strategyRanking : [];
      var c = $('labStratCount'); if (c) c.textContent = String(ranking.length);

      if (ranking.length === 0) {
        renderEmptyRow(host, 1, 'available', {
          empty: 'aún no hay estrategias con muestra',
          hint: 'esperando trades cerrados'
        });
        return;
      }

      // Normalize for max bar
      var maxScore = ranking.reduce(function (m, r) {
        var s = (typeof r.score === 'number') ? Math.abs(r.score) : 0;
        return s > m ? s : m;
      }, 0) || 1;

      var f = fmt();
      var html = ranking.map(function (r, idx) {
        var rank = idx + 1;
        var rankCls = rank === 1 ? 'gold' : (rank === 2 ? 'silver' : '');
        var name  = r.name || r.id || '—';
        var sample = (typeof r.sampleSize === 'number') ? r.sampleSize : 0;
        var winRate = (typeof r.winRate === 'number') ? r.winRate : null;
        var net = (typeof r.netProfit === 'number') ? r.netProfit : null;
        var score = (typeof r.score === 'number') ? r.score : 0;

        var winSub = sample
          ? sample + ' trades' + (winRate !== null ? ' · ' + (winRate * 100).toFixed(1) + '% wins' : '')
          : 'sin muestra';
        var netClass = net === null ? '' : (net >= 0 ? 'up' : 'down');
        var netTxt = (net !== null && f) ? f.currency(net, { signed: true, digits: 2 }) : emptyDash();
        var pf = pick(r, 'profitFactor', 'pf');
        var pfTxt = (typeof pf === 'number') ? pf.toFixed(2) : score.toFixed(2);

        var widthPct = Math.max(4, Math.min(100, (Math.abs(score) / maxScore) * 100));
        var barClass = (net !== null && net < 0) ? 'warn' : '';

        return ''
          + '<div class="lab-strat-row">'
          +   '<div class="lab-strat-rank ' + rankCls + '">' + rank + '</div>'
          +   '<div class="lab-strat-name"><b>' + escHtml(name) + '</b><span>' + escHtml(winSub) + '</span></div>'
          +   '<div class="lab-strat-stat"><span class="v" style="color:var(--lab-' + (net === null ? 'text-mute' : (net >= 0 ? 'green' : 'red')) + ')">' + escHtml(netTxt) + '</span><span class="l">net P&amp;L</span></div>'
          +   '<div class="lab-strat-stat"><span class="v">' + escHtml(pfTxt) + '</span><span class="l">' + (typeof pf === 'number' ? 'PF' : 'score') + '</span></div>'
          +   '<div class="lab-strat-bar"><span class="' + barClass + '" style="width:' + widthPct.toFixed(1) + '%"></span></div>'
          + '</div>';
      }).join('');
      host.innerHTML = html;
      markFresh(host);
    }
    return { render: render };
  })();

  // ─────────────────────────────────────────────────────────
  // Panel 5 — Signal Candidates
  // ─────────────────────────────────────────────────────────
  var candidatesCtrl = (function () {
    function render(envelope) {
      var host = $('labCandGrid'); if (!host) return;
      var state = envelopeState(envelope);

      if (state !== 'available') {
        var unavailableMsg = (envelope && envelope.body && envelope.body.reason === 'training_state_unavailable')
          ? 'training state unavailable'
          : 'candidatos deshabilitados o sin conexión';
        var candSkel = '';
        if (state === 'loading') {
          for (var ci = 0; ci < 4; ci++) {
            candSkel += '<div class="lab-cand lab-skel-card" aria-hidden="true">'
              +   '<div class="lab-cand-head"><span class="lab-skel" style="width:90px"></span><span class="lab-skel lab-skel-pill" style="width:50px"></span></div>'
              +   '<div><span class="lab-skel" style="width:60%;height:18px"></span></div>'
              +   '<div><span class="lab-skel" style="width:50%"></span></div>'
              +   '<div class="lab-cand-meter">'
              +     '<div class="m"><span class="lab-skel" style="width:70%"></span></div>'
              +     '<div class="m"><span class="lab-skel" style="width:60%"></span></div>'
              +     '<div class="m"><span class="lab-skel" style="width:65%"></span></div>'
              +     '<div class="m"><span class="lab-skel" style="width:55%"></span></div>'
              +   '</div>'
              + '</div>';
          }
        }
        renderEmptyRow(host, 1, state, {
          unavailable: unavailableMsg,
          empty: 'sin candidatos en este momento',
          skeletonHtml: candSkel
        });
        var cE = $('labCandCount'); if (cE) cE.textContent = state === 'loading' ? '…' : '—';
        return;
      }

      var body = envelope.body || {};
      var candidates = Array.isArray(body.candidates) ? body.candidates : [];
      var c = $('labCandCount'); if (c) c.textContent = String(candidates.length);

      if (candidates.length === 0) {
        renderEmptyRow(host, 1, 'available', {
          empty: 'sin candidatos en este momento',
          hint: 'el motor evalúa cada minuto'
        });
        return;
      }

      var html = candidates.map(function (cand) {
        var symbol = cand.symbol || '';
        var bias = normalizeSide(cand.bias);
        var conf = (typeof cand.confidence === 'number') ? cand.confidence : null;
        var stratLine = (cand.strategy_name || cand.strategy_id || '—')
          + (cand.horizon ? ' · ' + cand.horizon : '');
        var biasHtml = bias
          ? '<span class="lab-cand-bias ' + (bias === 'LONG' ? 'long' : 'short') + '">' + bias + '</span>'
          : '<span class="lab-cand-bias" style="color:var(--lab-text-faint);background:transparent">—</span>';

        function scoreTxt(v, suffix) {
          return (typeof v === 'number') ? v.toFixed(2) + (suffix || '') : emptyDash();
        }
        function ratioTxt(v) {
          return (typeof v === 'number') ? v.toFixed(2) + '×' : emptyDash();
        }

        return ''
          + '<div class="lab-cand">'
          +   '<div class="lab-cand-head">'
          +     '<span class="lab-sym"><span class="ic">' + escHtml(symbolIcon(symbol)) + '</span> ' + escHtml(symbol) + '</span>'
          +     biasHtml
          +   '</div>'
          +   '<div class="lab-cand-conf">' + (conf !== null ? Math.round(conf) : emptyDash()) + '<span class="pct">% conf</span></div>'
          +   '<div class="lab-cand-strat">' + escHtml(stratLine) + '</div>'
          +   '<div class="lab-cand-meter">'
          +     '<div class="m"><span>HTF align</span><b>' + escHtml(scoreTxt(cand.htfAlignmentScore)) + '</b></div>'
          +     '<div class="m"><span>Pattern</span><b>' + escHtml(scoreTxt(cand.patternScore)) + '</b></div>'
          +     '<div class="m"><span>Vol ratio</span><b>' + escHtml(ratioTxt(cand.volumeRatio)) + '</b></div>'
          +     '<div class="m"><span>Pair score</span><b>' + escHtml(scoreTxt(cand.pairScore)) + '</b></div>'
          +   '</div>'
          + '</div>';
      }).join('');
      host.innerHTML = html;
      markFresh(host);
    }
    return { render: render };
  })();

  // ─────────────────────────────────────────────────────────
  // Panel 6 — Training Health (context source enrichment)
  //   The hero controller already fills schedule/ticks/sample/realTrading.
  //   This controller adds the "Context source" cell with the breakdown
  //   of price-source providers from /demo/context/status.
  // ─────────────────────────────────────────────────────────
  var contextHealthCtrl = (function () {
    function render(envelope) {
      var valEl = $('labHealthContext');
      var subEl = $('labHealthContextSub');
      if (!valEl || !subEl) return;
      var state = envelopeState(envelope);

      if (state === 'error') {
        valEl.textContent = 'sin conexión';
        valEl.style.color = 'var(--lab-amber)';
        subEl.textContent = '—';
        return;
      }
      if (state === 'loading') {
        valEl.textContent = 'cargando…';
        valEl.style.color = 'var(--lab-text-mute)';
        subEl.textContent = '—';
        return;
      }
      if (state === 'unavailable') {
        valEl.textContent = 'unavailable';
        valEl.style.color = 'var(--lab-text-mute)';
        subEl.textContent = 'training state unavailable';
        return;
      }

      var body = envelope.body || {};
      var diag = Array.isArray(body.positions) ? body.positions : [];

      if (diag.length === 0) {
        valEl.textContent = 'shadow';
        valEl.style.color = '';
        subEl.textContent = 'sin posiciones abiertas';
        return;
      }

      // Tally market.source values: ticker / mt5_snapshot / training_state_last_known
      var counts = { ticker: 0, mt5_snapshot: 0, last_known: 0, missing: 0, other: 0 };
      var stale = 0;
      for (var i = 0; i < diag.length; i++) {
        var m = (diag[i] && diag[i].market) || {};
        if (m.available === false) { counts.missing++; continue; }
        if (m.stale) stale++;
        var src = m.source || 'other';
        if (src === 'ticker') counts.ticker++;
        else if (src === 'mt5_snapshot') counts.mt5_snapshot++;
        else if (src === 'training_state_last_known') counts.last_known++;
        else counts.other++;
      }
      var total = diag.length || 1;
      var primary = 'ticker';
      var primaryCount = counts.ticker;
      ['mt5_snapshot', 'last_known', 'other', 'missing'].forEach(function (k) {
        if (counts[k] > primaryCount) { primary = k; primaryCount = counts[k]; }
      });
      var primaryLabel = primary === 'mt5_snapshot' ? 'mt5'
        : (primary === 'last_known' ? 'last known' : (primary === 'missing' ? 'missing' : primary));
      valEl.textContent = primaryLabel + ' · ' + Math.round((primaryCount / total) * 100) + '%';
      valEl.style.color = primary === 'missing' ? 'var(--lab-amber)' : 'var(--lab-text)';

      var subParts = [];
      subParts.push('mt5 fallback ' + counts.mt5_snapshot);
      subParts.push('last-known ' + counts.last_known);
      subParts.push('stale ' + stale);
      if (counts.missing) subParts.push('missing ' + counts.missing);
      subEl.textContent = subParts.join(' · ');
    }
    return { render: render };
  })();

  // ─────────────────────────────────────────────────────────
  // Refresh orchestration
  // ─────────────────────────────────────────────────────────
  function refresh(name) {
    var a = api(); if (!a) return;
    var fn, ctrl;
    switch (name) {
      case 'positions':  fn = a.getLabOpenPositions;    ctrl = openPositionsCtrl; break;
      case 'trades':     fn = a.getLabRecentTrades;     ctrl = recentTradesCtrl;  break;
      case 'lessons':    fn = a.getLabRecentLessons;    ctrl = lessonsCtrl;       break;
      case 'strategies': fn = a.getLabStrategies;       ctrl = strategiesCtrl;    break;
      case 'candidates': fn = a.getLabSignalCandidates; ctrl = candidatesCtrl;    break;
      case 'context':    fn = a.getLabContextStatus;    ctrl = contextHealthCtrl; break;
      default: return;
    }
    fn().then(function (env) {
      lastFetchedAt[name] = Date.now();
      try { ctrl.render(env); } catch (e) {
        // Defensive: a render bug should never break the whole Lab.
        try { console.error('[lab.panels.' + name + '] render error', e); } catch (_) {}
      }
    });
  }

  function refreshAll() {
    refresh('positions');
    refresh('trades');
    refresh('lessons');
    refresh('strategies');
    refresh('candidates');
    refresh('context');
  }

  function start() {
    if (timers.positions) return; // already running
    refreshAll();
    timers.positions  = setInterval(function () { refresh('positions'); },  INTERVAL_POSITIONS);
    timers.candidates = setInterval(function () { refresh('candidates'); }, INTERVAL_CANDIDATES);
    timers.context    = setInterval(function () { refresh('context'); },    INTERVAL_CONTEXT);
    timers.trades     = setInterval(function () { refresh('trades'); },     INTERVAL_TRADES);
    timers.lessons    = setInterval(function () { refresh('lessons'); },    INTERVAL_LESSONS);
    timers.strategies = setInterval(function () { refresh('strategies'); }, INTERVAL_STRATEGIES);
  }

  function stop() {
    Object.keys(timers).forEach(function (k) {
      if (timers[k]) { clearInterval(timers[k]); timers[k] = null; }
    });
  }

  function isActive() { return labRoot && labRoot.classList.contains('active'); }

  function renderInitialSkeleton() {
    // Each panel renders its loading state via an "envelope" shaped as null-equivalent.
    openPositionsCtrl.render(null);
    recentTradesCtrl.render(null);
    lessonsCtrl.render(null);
    strategiesCtrl.render(null);
    candidatesCtrl.render(null);
    contextHealthCtrl.render(null);
  }

  function boot() {
    if (booted) return;
    labRoot = document.getElementById('view-lab');
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
  window.QuantLab.views.panels = {
    boot: boot,
    refreshAll: refreshAll,
    refresh: refresh,
    start: start,
    stop: stop,
    isActive: isActive
  };
})();
