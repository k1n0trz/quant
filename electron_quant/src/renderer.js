if (!window.quant) {
  const apiGet  = (path)         => fetch(`/api/${path}`).then((r) => r.json());
  const apiPost = (path, payload) => fetch(`/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) }).then((r) => r.json());
  window.quant = {
    envStatus:             ()                          => apiGet('env-status'),
    apiConfigRead:         ()                          => apiGet('api-config-read'),
    apiConfigWrite:        (cfg)                       => apiPost('api-config-write', cfg),
    symbols:               ()                          => apiGet('binance-symbols'),
    mt5Symbols:            ()                          => apiGet('mt5-symbols'),
    mt5Rates:              (symbol, tf, count)         => apiGet(`mt5-rates?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(tf)}&count=${count || 180}`),
    ticker:                (symbol)                    => apiGet(`ticker?symbol=${encodeURIComponent(symbol)}`),
    klines:                (symbol, interval, limit)   => apiGet(`klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&limit=${limit || 180}`),
    wallet:                ()                          => apiGet('wallet'),
    chat:                  (messages, context)         => apiPost('chat', { messages, context }),
    memoryWrite:           (kind, payload)             => apiPost('memory-write', { kind, payload }),
    memoryRead:            (limit)                     => apiGet(`memory-read?limit=${limit || 80}`),
    memoryStats:           ()                          => apiGet('memory-stats'),
    memoryClear:           ()                          => apiPost('memory-clear'),
    trainingStateRead:     ()                          => apiGet('training-state-read'),
    trainingStateWrite:    (payload)                   => apiPost('training-state-write', payload),
    finnhub:               ()                          => apiGet('news-finnhub'),
    finnhubEconomic:       ()                          => apiGet('calendar-finnhub-economic'),
    alpha:                 ()                          => apiGet('news-alpha'),
    finnhubCrypto:         ()                          => apiGet('news-finnhub-crypto'),
    cryptoRss:             ()                          => apiGet('news-crypto-rss'),
    customInstructionsRead:  ()                        => apiGet('custom-instructions-read'),
    customInstructionsWrite: (text)                    => apiPost('custom-instructions-write', { text }),
    positions:             ()                          => apiGet('positions'),
    selectCsvFile:         ()                          => Promise.resolve(null),   // not supported in web
    backtestAnalyze:       (filePath)                  => apiPost('backtest-analyze', { filePath }),
    alertConfigRead:       ()                          => apiGet('alert-config-read'),
    alertConfigWrite:      (cfg)                       => apiPost('alert-config-write', cfg),
    alertLog:              (limit)                     => apiGet(`alert-log?limit=${limit || 50}`),
    sendTestEmail:         (cfg)                       => apiPost('send-test-email', { cfg }),
    sendAlert:             (subject, body)             => apiPost('send-alert', { subject, body }),
    calibrationRead:       ()                          => apiGet('calibration-read'),
    calibrationCompute:    ()                          => apiPost('calibration-compute', {}),
    conversationsList:     ()                          => apiGet('conversations-list'),
    conversationLoad:      (id)                        => apiGet(`conversation-load?id=${encodeURIComponent(id)}`),
    conversationSave:      (id, name, messages)        => apiPost('conversation-save', { id, name, messages }),
    conversationRename:    (id, name)                  => apiPost('conversation-rename', { id, name }),
    conversationDelete:    (id)                        => apiPost('conversation-delete', { id }),
    calcPositionSize:      (sym, riskPct, entry, stop) => apiPost('calc-position-size', { symbol: sym, riskPct, entryPrice: entry, stopPrice: stop }),
    placeOrder:            (side, sym, qty, type, price) => apiPost('place-order', { side, symbol: sym, qty, type, price }),
    cancelOrder:           (sym, orderId)              => apiPost('cancel-order', { symbol: sym, orderId }),
    syncMt5:               (manual = false)            => apiPost('sync-mt5', { manual }),
    mt5Snapshot:           ()                          => apiGet('mt5-snapshot'),
    pushCloudData:         ()                          => apiPost('push-cloud-data', {}),
    pullCloudData:         ()                          => apiPost('pull-cloud-data', {})
  };
}

const $ = (id) => document.getElementById(id);
const setText = (id, value) => {
  const el = $(id);
  if (el) el.textContent = value;
};
const setValue = (id, value) => {
  const el = $(id);
  if (el) el.value = value;
};

const state = {
  symbol: 'BTCUSDT',
  platform: 'BINANCE',
  tf: 'M1',
  interval: '1m',
  symbols: [],
  binanceSymbols: [],
  mt5Symbols: [],
  candles: [],
  ticker: null,
  wallet: null,
  messages: [],
  pipeline: [],
  _ordersCache: null,
  env: {},
  sessionTrades: 0,
  newsSource: 'finnhub',
  lastNewsAutoLog: 0,
  macroNews: {
    finnhub: [],
    finnhubCrypto: [],
    cryptoRss: [],
    alphaFeed: [],
    alphaSentiment: {},
    economic: [],
    updatedAt: null,
    risk: 'normal'
  },
  chartZoom: 110,
  chartOffset: 0,
  training: {
    mode: 'training',
    balanceStart: 100000,
    balance: 100000,
    activePairs: [],
    positions: [],
    closedTrades: [],
    lessons: [],
    advice: [],
    strategyStats: {},
    systemSkills: ['market_feed', 'ohlcv_history', 'multi_timeframe', 'ssl_hybrid', 'rsi', 'macd', 'atr', 'news_context', 'memory_lessons', 'risk_gate', 'ict_liquidity', 'crt_weekly_bias', 'fvg_order_block', 'session_timing'],
    pairCooldowns: {},
    xp: 0,
    initialized: false,
    refreshing: false,
    blockRealExecution: true,
    maxPairs: 20,
    minMt5Pairs: 6,
    targetOpenPositions: 20,
    targetIntradayPositions: 10,
    targetSwingPositions: 10,
    minMt5OpenPositions: 6,
    lastPersistedAt: null
  },
  wfCalibration:    { isWr: null, oosWr: null, ratio: 1, n: 0, label: 'Sin datos' },
  nightCalibration: { ok: false, histWr: null, liveWr: null, ratio: 1, label: 'Sin datos', computedAt: null },
  conversationId:   null,   // ID de la sesión actual (se asigna al primer mensaje)
  syncStatus:       { lastSync: null, ok: null, pushed: false },
  strategies: {
    ictCrt: {
      name: 'ICT + CRT Institutional Model',
      minScore: 80,
      riskPerTrade: '0.5% - 1%',
      rrMin: 2,
      rules: [
        'Weekly CRT sweep and close back inside range defines directional bias.',
        'Reject trades without weekly, daily/H4 and H1/M15 alignment.',
        'Require liquidity sweep, displacement, structure confirmation and FVG/order block entry context.',
        'Prefer London and New York opens; avoid low-volatility Asia unless breakout is validated.',
        'Store context, outcome, session and improvement rule after every demo trade.'
      ]
    },
    trendMomentum: {
      name: 'Trend Momentum / EMA-MACD',
      minScore: 72,
      rrMin: 1.8,
      rules: [
        'Trade only with M15/H1 directional agreement.',
        'Use EMA21/EMA50 slope, MACD histogram and ATR expansion as confirmation.',
        'Avoid entries when RSI is exhausted beyond 78 or below 22.'
      ]
    },
    breakoutRetest: {
      name: 'Breakout + Retest',
      minScore: 70,
      rrMin: 2,
      rules: [
        'Detect 20-period range expansion and close outside the range.',
        'Prefer volume ratio above 1.25 and retest near the broken level.',
        'Reject breakouts into high macro risk or extreme spread.'
      ]
    },
    meanReversion: {
      name: 'Mean Reversion / RSI-ATR',
      minScore: 68,
      rrMin: 1.4,
      rules: [
        'Use range-bound or weak-trend regimes.',
        'Fade stretched moves when RSI is extreme and price is far from baseline.',
        'Keep tighter targets; this is a scalp hypothesis, not a swing thesis.'
      ]
    },
    volumePullback: {
      name: 'Volume Pullback Continuation',
      minScore: 70,
      rrMin: 1.8,
      rules: [
        'Trend must be intact on H1 or M15.',
        'Pullback into baseline with volume returning above average.',
        'Enter only when candle closes back in trend direction.'
      ]
    }
  },
  executionAdapters: {
    core: true,
    paper: true,
    binance: true,
    mt5: false,
    tradingViewWebhook: false,
    brokerApi: false
  },
  selfAudit: {
    lastRun: null,
    findings: []
  }
};

const intervalMap = { M1: '1m', M5: '5m', M15: '15m', H1: '1h', H4: '4h', D1: '1d' };

function fmtPrice(v) {
  if (!Number.isFinite(v)) return '-';
  if (v >= 1000) return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (v >= 1) return Number(v.toFixed(5)).toString();
  return Number(v.toFixed(8)).toString();
}

function nowTime() { return new Date().toTimeString().slice(0, 8); }

function logEvent(status, message) {
  const item = { time: nowTime(), status, message };
  state.pipeline.unshift(item);
  state.pipeline = state.pipeline.slice(0, 80);
  renderPipeline();
}

function renderPipeline() {
  const html = state.pipeline.slice(0, 18).map((e) => {
    const cls = e.status === 'OK' ? 'pipe-ok' : e.status === 'WARN' ? 'pipe-warn' : 'pipe-error';
    return `<div class="pipe-item"><span class="pipe-time">${e.time}</span><span class="${cls}">●</span><span class="${cls}">${e.status}</span><span>${escapeHtml(e.message)}</span></div>`;
  }).join('');
  if ($('pipelineList')) $('pipelineList').innerHTML = html;
  $('historyList').innerHTML = state.pipeline.map((e) => `<div class="pipe-item"><span class="pipe-time">${e.time}</span><span class="${e.status === 'OK' ? 'pipe-ok' : 'pipe-warn'}">●</span><span>${e.status}</span><span>${escapeHtml(e.message)}</span></div>`).join('');
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === name));
  const view = $(`view-${name}`);
  if (view) view.classList.add('active');
  if (name === 'settings')       { loadCustomInstructions(); loadCalibrationStatus(); loadApiConfig(); }
  if (name === 'conversations')  loadConversationsList();
  if (name === 'orders') loadOrders();
  if (name === 'positions') loadPositions();
  if (name === 'backtest') initBacktest();
  if (name === 'alerts')  loadAlerts();
}

function setTf(tf) {
  state.tf = tf;
  state.interval = intervalMap[tf] || '1m';
  document.querySelectorAll('.tf').forEach((b) => b.classList.toggle('active', b.dataset.tf === tf));
  $('chartTitle').textContent = `GRÁFICO EN TIEMPO REAL · ${state.symbol} · ${tf}`;
  setText('chartTitle', `GRAFICO EN TIEMPO REAL - ${state.symbol} - ${tf}`);
  refreshCandles();
}

async function boot() {
  // PHASE 1: Initialize new state management modules
  if (window.heroController) {
    window.heroController.init();
    console.log('[PHASE 1] Hero Controller initialized');
  }
  if (window.collapsablePanels) {
    window.collapsablePanels.init();
    window.collapsablePanels.restoreState();
    console.log('[PHASE 1] Collapsable Panels initialized');
  }

  bindUi();
  drawPerf();
  drawGauge(50);
  // Boot cognitivo: restaura última conversación si existe; si no, silencio honesto.
  // Sin mensajes teatrales. Los insights reales llegarán por el canal de Quant-Core
  // cuando los endpoints cognitivos estén consumidos (F2+).
  await loadLastConversationIfAny();

  // Quant-Core observatorio: monta el panel del laboratorio backend.
  // El refresh inicial corre en background; el setInterval debajo lo mantiene vivo.
  // Defensivo: si el módulo o el target DOM faltan, queda silencioso.
  if (window.QuantCore && window.QuantCore.views && window.QuantCore.views.coreLabPanel) {
    if (window.QuantCore.views.coreLabPanel.mount('quantCorePanel')) {
      window.QuantCore.views.coreLabPanel.refresh();
    }
  }
  logEvent('OK', 'Sistema iniciado correctamente');
  try {
    state.env = await window.quant.envStatus();
    renderStatus();
    logEvent('OK', `Configuración cargada desde ${state.env.envFile || '.env'}`);
  } catch (err) {
    logEvent('ERR', `No pude leer configuración: ${err.message}`);
  }
  await loadSymbols();
  await loadMemoryStats();
  window.quant.alertConfigRead().then((cfg) => { _alertConfig = cfg; }).catch(() => {});
  // Cargar calibración nocturna persistida
  window.quant.calibrationRead().then((cal) => { if (cal?.ok) state.nightCalibration = cal; }).catch(() => {});
  await Promise.allSettled([refreshMarket(true), refreshWallet(), refreshMacroContext(false)]);
  await loadTrainingState();
  await initTrainingMode(false);
  await runSelfAudit();

  // ── Al arrancar: si training local está vacío, intenta traer datos del cloud ──
  if (window.quant.pullCloudData && state.env?.syncConfigured) {
    const hasLocalTraining = state.training?.sessions > 0 || state.training?.totalTrades > 0;
    if (!hasLocalTraining) {
      window.quant.pullCloudData().then(r => {
        if (r?.ok && r.applied) {
          logEvent('OK', `Datos importados del cloud: training=${r.applied.trainingState ? 'sí' : 'no'}, memorias=${r.applied.memories || 0}, conv=${r.applied.conversations || 0}`);
          loadTrainingState();
        }
      }).catch(() => {});
    }
  }

  setInterval(updateClock, 1000);
  setInterval(() => refreshMarket(false), 2200);
  setInterval(() => refreshCandles(), 12000);
  setInterval(() => refreshMacroContext(true), 60000);
  setInterval(() => refreshWallet(), 120000);
  setInterval(() => refreshTrainingMode(), 15000);
  setInterval(() => renderChatContextPanel(), 5000);
  setInterval(() => runSelfAudit(), 300000);
  // PHASE 1: Update hero section every 3 seconds
  setInterval(() => updateHeroSection(), 3000);
  // Recalibración nocturna automática: una vez por hora
  setInterval(() => runNightCalibration(), 3600000);
  // Sync MT5 → cloud automático cada 5 min en modo pasivo (sin mt5.login → sin reconexión al broker)
  setInterval(() => syncMt5ToCloud(false), 300000);
  // Quant-Core panel refresh: cada 30s. Read-only, defensivo.
  setInterval(() => {
    if (window.QuantCore && window.QuantCore.views && window.QuantCore.views.coreLabPanel) {
      window.QuantCore.views.coreLabPanel.refresh();
    }
  }, 30000);
  // Push de datos (training, memoria, conversaciones) al cloud cada 10 min
  if (window.quant.pushCloudData) {
    setTimeout(() => pushCloudData(), 20000);                       // primera vez a los 20s
    setInterval(() => pushCloudData(), 600000);                     // luego cada 10 min
  }
}

function bindUi() {
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  document.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.jump)));
  document.querySelectorAll('.tf').forEach((b) => b.addEventListener('click', () => setTf(b.dataset.tf)));
  $('platformSelect').addEventListener('change', () => setPlatform($('platformSelect').value));
  $('refreshBtn').addEventListener('click', () => refreshAll());
  $('walletRefresh').addEventListener('click', () => refreshWallet());
  $('trainingReselectBtn').addEventListener('click', () => initTrainingMode(true));
  $('finnhubBtn').addEventListener('click', () => refreshNews('finnhub'));
  $('alphaBtn').addEventListener('click', () => refreshNews('alpha'));
  $('sendChat').addEventListener('click', sendChat);
  $('chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
  $('askAiBtn').addEventListener('click', askAiAnalysis);
  $('marketSearch').addEventListener('input', renderMarketTable);
  $('buyBtn').addEventListener('click',  () => submitOrder('BUY'));
  $('sellBtn').addEventListener('click', () => submitOrder('SELL'));
  $('cancelBtn').addEventListener('click', () => {
    $('qtyInput').value       = '0.001';
    $('confirmInput').value   = '';
    $('stopLossInput').value  = '';
    $('limitPriceInput').value = '';
    $('sizeCalcInfo').textContent = '';
    const rb = $('orderResultBox'); if (rb) { rb.style.display = 'none'; rb.textContent = ''; }
  });
  $('calcSizeBtn').addEventListener('click', calcSizeFromRisk);
  $('orderType').addEventListener('change', () => {
    const isLimit = $('orderType').value === 'LIMIT';
    $('limitPriceInput').closest('label').style.opacity = isLimit ? '1' : '0.35';
  });
  $('enableTradingBtn').addEventListener('click', () => alert('Trading real requiere REAL_TRADING=true, confirmación exacta, límites de riesgo y una prueba final. No lo voy a activar a ciegas con dinero real.'));
  $('saveCustomInstructionsBtn').addEventListener('click', saveCustomInstructions);
  $('apiConfigForm').addEventListener('submit', saveApiConfig);
  $('runCalibrationBtn').addEventListener('click', manualCalibration);
  $('newConvBtn').addEventListener('click', startNewConversation);
  $('ordersRefreshBtn').addEventListener('click', loadOrders);
  $('positionsRefreshBtn').addEventListener('click', loadPositions);
  $('backtestSelectBtn').addEventListener('click', backtestSelectFile);
  $('backtestRunBtn').addEventListener('click', backtestRun);
  $('alertSaveBtn').addEventListener('click', saveAlertConfig);
  $('alertTestBtn').addEventListener('click', sendTestEmail);
  $('alertLogRefreshBtn').addEventListener('click', loadAlertLog);
  document.querySelectorAll('[data-orders-filter]').forEach((b) => {
    b.addEventListener('click', () => {
      _ordersFilter = b.dataset.ordersFilter;
      document.querySelectorAll('[data-orders-filter]').forEach((x) => x.classList.toggle('active', x === b));
      if (state._ordersCache) renderOrdersTable(state._ordersCache);
    });
  });
  ['clearMemoryBtn', 'topClearMemoryBtn'].forEach((id) => {
    const btn = $(id);
    if (btn) btn.addEventListener('click', clearPersistentMemory);
  });
  $('tradeChart').addEventListener('wheel', onChartWheel, { passive: false });
  ['sslChannelToggle', 'sslHybridToggle', 'atrBandsToggle'].forEach((id) => $(id).addEventListener('change', drawChart));
  $('assetSearch').addEventListener('input', () => renderSymbolMenu(true));
  $('assetSearch').addEventListener('focus', () => renderSymbolMenu(true));
  $('assetDropBtn').addEventListener('click', () => renderSymbolMenu(!$('assetMenu').classList.contains('open')));
  $('assetSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = $('assetMenu').querySelector('.symbol-option');
      if (first) selectSymbolFromSearch(first.dataset.symbol);
    }
    if (e.key === 'Escape') $('assetMenu').classList.remove('open');
  });
  document.addEventListener('click', (e) => {
    if (!$('assetCombo').contains(e.target)) $('assetMenu').classList.remove('open');
  });

  // Training Lab Tabs
  document.querySelectorAll('.training-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      document.querySelectorAll('.training-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.training-tab-content').forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      const content = document.getElementById(`tab-${tabName}`);
      if (content) content.classList.add('active');
    });
  });

  // Position Sub-tabs (Intraday / Swing)
  document.querySelectorAll('.position-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.positionTab;
      document.querySelectorAll('.position-tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.position-tab-content').forEach((c) => c.classList.remove('active'));
      tab.classList.add('active');
      const contentId = tabName === 'intraday' ? 'positionsIntradayContent' : 'positionsSwingContent';
      const content = document.getElementById(contentId);
      if (content) content.classList.add('active');
    });
  });
}

function renderStatus() {
  $('stInternet').textContent = 'Conectado';
  $('stBinance').textContent = state.env.binance ? 'Conectado' : 'Sin claves';
  $('stDeepseek').textContent = state.env.deepseek ? 'Conectado' : 'Sin clave';
  $('stFinnhub').textContent = state.env.finnhub ? 'Conectado' : 'Sin clave';
  $('stAlpha').textContent = state.env.alpha ? 'Conectado' : 'Sin clave';
  $('stMt5').textContent = 'Verificando';
  state.executionAdapters.mt5 = Boolean(state.env.mt5Connector);
  $('modeText').textContent = state.env.realTrading ? 'Modo: Trading Real ACTIVO' : 'Modo: Trading Real (Bloqueado por defecto)';
  $('settingsBox').innerHTML = [
    ['Usuario', state.env.user ? `${state.env.user.displayName || state.env.user.email} (${state.env.user.email})` : 'Sesion local'],
    ['Archivo .env', state.env.envFile || 'No encontrado'],
    ['Raiz portable', state.env.portableRoot || 'No detectada'],
    ['Datos locales', state.env.dataDir || 'No detectados'],
    ['Config API usuario', state.env.apiConfigStatus?.file || 'No disponible'],
    ['Binance', state.env.binance ? 'Claves detectadas' : 'Faltan claves'],
    ['DeepSeek', state.env.deepseek ? 'Clave detectada' : 'Falta clave'],
    ['Modelo IA', `${state.env.modelProvider || 'local'} / ${state.env.model || 'sin modelo remoto'}`],
    ['Web local', state.env.webUrl || 'No iniciado'],
    ['Trading real', state.env.realTrading ? 'ACTIVO' : 'Bloqueado'],
    ['Seguridad', 'BUY/SELL reales siguen requiriendo risk gate'],
    ['MT5 Adapter', state.executionAdapters.mt5 ? 'Habilitado por conector' : 'Opcional / aislado'],
    ['Sync cloud MT5', state.env.syncConfigured ? 'Configurado ✓' : 'No configurado (QUANT_SYNC_URL + QUANT_SYNC_KEY en .env)']
  ].map(([k, v]) => `<div class="setting-card"><b>${k}</b><span>${escapeHtml(String(v))}</span></div>`).join('');

  // Botón de descarga del escritorio (visible solo desde la web)
  const dlBtn = $('desktopDownloadBtn');
  if (dlBtn && state.env.desktopDownloadUrl) {
    dlBtn.href = state.env.desktopDownloadUrl;
    dlBtn.style.display = 'inline-block';
    dlBtn.download = 'Quant-desktop.exe';
  }
}

async function loadSymbols() {
  try {
    state.binanceSymbols = await window.quant.symbols();
    state.symbols = state.binanceSymbols;
    fillSymbolSelects();
    renderMarketTable();
    logEvent('OK', `${state.symbols.length} símbolos cargados desde Binance`);
    if (!state.executionAdapters.mt5) {
      logEvent('OK', 'MT5 adapter aislado; Quant Core opera sin depender de MT5');
      return;
    }
    window.quant.mt5Symbols().then((res) => {
      if (res.ok && res.symbols?.length) {
        state.mt5Symbols = res.symbols;
        logEvent('OK', `${res.symbols.length} símbolos cargados desde MT5`);
      } else {
        logEvent('WARN', `MT5 símbolos: ${res.error || 'sin símbolos visibles'}`);
      }
    });
  } catch (err) {
    logEvent('ERR', `Binance symbols: ${err.message}`);
  }
}

function fillSymbolSelects() {
  $('assetSearch').value = state.symbol;
  renderSymbolMenu(false);
}

function setSymbol(symbol) {
  state.symbol = symbol;
  $('assetSearch').value = symbol;
  setValue('manualVenueDisplay', state.platform);
  setValue('manualSymbolDisplay', symbol);
  $('assetSub').textContent = `${state.platform} · símbolo principal`;
  $('chartTitle').textContent = `GRÁFICO EN TIEMPO REAL · ${symbol} · ${state.tf}`;
  setText('chartTitle', `GRAFICO EN TIEMPO REAL - ${symbol} - ${state.tf}`);
  logEvent('OK', `Activo principal cambiado a ${symbol}`);
  refreshMarket(true);
}

function setPlatform(platform) {
  state.platform = platform;
  if (platform === 'MT5') state.executionAdapters.mt5 = true;
  $('platformSelect').value = platform;
  state.symbols = platform === 'MT5' ? (state.mt5Symbols.length ? state.mt5Symbols : ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDCAD']) : state.binanceSymbols;
  state.symbol = state.symbols.includes(state.symbol) ? state.symbol : state.symbols[0];
  fillSymbolSelects();
  setSymbol(state.symbol);
  renderMarketTable();
  logEvent('OK', `Plataforma activa: ${platform}`);
}

function renderSymbolMenu(open = true) {
  const q = $('assetSearch').value.trim().toUpperCase();
  const matches = state.symbols
    .filter((s) => !q || s.includes(q))
    .slice(0, 80);
  $('assetMenu').innerHTML = matches.map((s) => {
    const quote = s.endsWith('USDT') ? 'USDT' : s.endsWith('USDC') ? 'USDC' : s.endsWith('FDUSD') ? 'FDUSD' : 'Spot';
    return `<div class="symbol-option ${s === state.symbol ? 'active' : ''}" data-symbol="${s}"><span>${s}</span><small>${quote}</small></div>`;
  }).join('') || '<div class="symbol-option"><span>Sin resultados</span><small>Prueba otro texto</small></div>';
  $('assetMenu').classList.toggle('open', open);
  document.querySelectorAll('.symbol-option[data-symbol]').forEach((item) => {
    item.addEventListener('click', () => selectSymbolFromSearch(item.dataset.symbol));
  });
}

function selectSymbolFromSearch(symbol) {
  if (!symbol) return;
  $('assetMenu').classList.remove('open');
  setSymbol(symbol);
}

async function refreshAll() {
  logEvent('OK', 'Actualización manual solicitada');
  await Promise.allSettled([refreshMarket(true), refreshWallet(), refreshMacroContext(false)]);
  syncMt5ToCloud(true);      // sync MT5 inmediato (con login completo)
  pushCloudData(false);      // push training + memoria + conversaciones al cloud
}

async function refreshCandles() {
  try {
    if (state.platform === 'MT5') {
      const data = await window.quant.mt5Rates(state.symbol, state.tf, 180);
      if (!data.ok) throw new Error(data.error || 'MT5 no devolvió velas');
      state.candles = data.candles || [];
      state.ticker = data.ticker || state.ticker;
      renderTicker();
    } else {
      state.candles = await window.quant.klines(state.symbol, state.interval, 180);
    }
    drawChart();
    updateSignal();
    logEvent('OK', `${state.symbol} ${state.tf}: ${state.candles.length} velas actualizadas`);
    await window.quant.memoryWrite('observation', { type: 'candles_refreshed', symbol: state.symbol, timeframe: state.tf, bars: state.candles.length, lastClose: state.candles.at(-1)?.close });
    await loadMemoryStats();
  } catch (err) {
    logEvent('WARN', `Velas: ${err.message}`);
  }
}

async function refreshMarket(forceCandles) {
  try {
    if (state.platform === 'MT5') {
      await refreshCandles();
      return;
    }
    state.ticker = await window.quant.ticker(state.symbol);
    renderTicker();
    if (forceCandles || !state.candles.length) await refreshCandles();
    else {
      const last = state.candles[state.candles.length - 1];
      if (last && state.ticker.price) {
        last.close = state.ticker.price;
        last.high = Math.max(last.high, state.ticker.price);
        last.low = Math.min(last.low, state.ticker.price);
      }
      drawChart();
      updateSignal();
    }
    $('lastUpdate').textContent = nowTime();
  } catch (err) {
    $('stInternet').textContent = 'Error';
    logEvent('WARN', `Ticker: ${err.message}`);
  }
}

function renderTicker() {
  const t = state.ticker;
  if (!t) {
    setText('priceNow', '-');
    setText('spreadNow', '-');
    setText('spreadSub', '0.00%');
    return;
  }
  setText('priceNow', fmtPrice(t.price));
  const spread = Number(t.spread || 0);
  setText('spreadNow', Number.isFinite(spread) && spread > 0 ? fmtPrice(spread) : '-');
  setText('spreadSub', Number.isFinite(spread) && t.price ? `${((spread / t.price) * 100).toFixed(4)}%` : '0.00%');
  const chCls = t.changePct >= 0 ? 'positive' : 'negative';
  const priceChange = $('priceChange');
  if (priceChange) {
    priceChange.className = chCls;
    priceChange.textContent = `${t.change >= 0 ? '+' : ''}${fmtPrice(t.change)} (${t.changePct >= 0 ? '+' : ''}${Number(t.changePct || 0).toFixed(2)}%)`;
  }
}

async function clearPersistentMemory() {
  if (!confirm('¿Limpiar toda la memoria persistente local de Quant? Esta acción vacía el archivo de memoria.')) return;
  try {
    state.messages = [];
    state.sessionTrades = 0;
    await window.quant.memoryClear();
    await loadMemoryStats();
    if ($('chatLog')) $('chatLog').innerHTML = '';
    logEvent('OK', 'Memoria persistente limpiada manualmente');
  } catch (err) {
    logEvent('WARN', `No pude limpiar memoria: ${err.message}`);
  }
}

function drawChart() {
  const canvas = $('tradeChart');
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#101927';
  ctx.fillRect(0, 0, w, h);
  const padL = 56, padR = 74, padT = 20, padB = 58;
  const plotW = w - padL - padR, plotH = h - padT - padB;
  ctx.strokeStyle = '#1b2a40'; ctx.lineWidth = 1;
  ctx.font = '11px Consolas';
  ctx.fillStyle = '#607d9e';
  for (let i = 0; i <= 6; i++) {
    const x = padL + plotW * i / 6;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
  }
  for (let i = 0; i <= 5; i++) {
    const y = padT + plotH * i / 5;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); ctx.stroke();
  }
  const visibleCount = Math.max(24, Math.min(180, state.chartZoom));
  const maxOffset = Math.max(0, state.candles.length - visibleCount);
  state.chartOffset = Math.max(0, Math.min(state.chartOffset, maxOffset));
  const end = state.candles.length - state.chartOffset;
  const start = Math.max(0, end - visibleCount);
  const data = state.candles.slice(start, end);
  if (!data.length) {
    ctx.fillStyle = '#8fa3be'; ctx.textAlign = 'center';
    ctx.fillText('Esperando velas reales de Binance...', w / 2, h / 2);
    return;
  }
  const maxP = Math.max(...data.map((c) => c.high));
  const minP = Math.min(...data.map((c) => c.low));
  const maxV = Math.max(...data.map((c) => c.volume));
  const span = Math.max(maxP - minP, 1e-12);
  const y = (p) => padT + (maxP - p) / span * plotH;
  const step = plotW / data.length;
  const fullIndicators = computeIndicators(state.candles);
  const ind = fullIndicators.slice(start, end);
  const ema = ind.map((x) => x.ema21);
  if ($('atrBandsToggle').checked) {
    drawAtrBands(ctx, ind, padL, step, y);
  }
  if ($('sslChannelToggle').checked || $('sslHybridToggle').checked) {
    drawTrendCloud(ctx, ind, padL, step, y, padT, plotH);
  }
  data.forEach((c, i) => {
    const x = padL + i * step + step / 2;
    const bull = c.close >= c.open;
    const color = bull ? '#00c853' : '#ff1744';
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.beginPath(); ctx.moveTo(x, y(c.high)); ctx.lineTo(x, y(c.low)); ctx.stroke();
    const half = Math.max(2, step * 0.32);
    const top = Math.min(y(c.open), y(c.close));
    const bottom = Math.max(y(c.open), y(c.close));
    ctx.fillRect(x - half, top, half * 2, Math.max(1, bottom - top));
    const vh = 5 + (c.volume / Math.max(maxV, 1)) * 42;
    ctx.globalAlpha = .35;
    ctx.fillRect(x - half, h - padB + 48 - vh, half * 2, vh);
    ctx.globalAlpha = 1;
  });
  if ($('sslHybridToggle').checked) {
    drawLine(ctx, ind.map((x) => x.hybridFast), padL, step, y, '#00e676', 2.6);
    drawLine(ctx, ind.map((x) => x.hybridSlow), padL, step, y, '#ff1744', 2.6);
  }
  if ($('sslChannelToggle').checked) {
    drawLine(ctx, ind.map((x) => x.sslUp), padL, step, y, '#23ff55', 1.7);
    drawLine(ctx, ind.map((x) => x.sslDown), padL, step, y, '#ff293d', 1.7);
  }
  drawLine(ctx, ema, padL, step, y, '#ffab00', 1.3);
  drawSignalMarkers(ctx, ind, padL, step, padT, plotH);
  const last = data[data.length - 1];
  const lastY = y(last.close);
  ctx.strokeStyle = '#00e5ff'; ctx.setLineDash([3, 4]);
  ctx.beginPath(); ctx.moveTo(padL, lastY); ctx.lineTo(padL + plotW, lastY); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#0b6a58';
  ctx.fillRect(padL + plotW + 8, lastY - 12, padR - 14, 24);
  ctx.fillStyle = '#e8edf5'; ctx.textAlign = 'left'; ctx.font = 'bold 11px Consolas';
  ctx.fillText(fmtPrice(last.close), padL + plotW + 12, lastY + 4);
  ctx.fillStyle = '#8fa3be'; ctx.font = '10px Consolas';
  for (let i = 0; i <= 5; i++) {
    const price = maxP - span * i / 5;
    ctx.fillText(fmtPrice(price), padL + plotW + 10, padT + plotH * i / 5 + 4);
  }
  ctx.fillStyle = '#607d9e'; ctx.textAlign = 'right'; ctx.font = '10px Consolas';
  ctx.fillText(`zoom ${visibleCount} velas`, w - 10, h - 10);
  $('ohlcLine').textContent = `O ${fmtPrice(last.open)}   H ${fmtPrice(last.high)}   L ${fmtPrice(last.low)}   C ${fmtPrice(last.close)}   Vol. ${last.volume.toFixed(3)}`;
}

function smaAt(values, idx, period) {
  const start = Math.max(0, idx - period + 1);
  let sum = 0;
  for (let i = start; i <= idx; i++) sum += values[i];
  return sum / (idx - start + 1);
}

function computeIndicators(candles) {
  const close = candles.map((c) => c.close);
  const high = candles.map((c) => c.high);
  const low = candles.map((c) => c.low);
  const ema21 = emaSeries(close, 21);
  const ema50 = emaSeries(close, 50);
  const atr = [];
  const out = [];
  let dir = 0;
  let prevSignal = 0;
  for (let i = 0; i < candles.length; i++) {
    const prevClose = i ? close[i - 1] : close[i];
    const tr = Math.max(high[i] - low[i], Math.abs(high[i] - prevClose), Math.abs(low[i] - prevClose));
    atr.push(tr);
    const maHigh = smaAt(high, i, 10);
    const maLow = smaAt(low, i, 10);
    if (close[i] > maHigh) dir = 1;
    else if (close[i] < maLow) dir = -1;
    const sslUp = dir >= 0 ? maHigh : maLow;
    const sslDown = dir >= 0 ? maLow : maHigh;
    const a = smaAt(atr, i, 14);
    const baseline = ema50[i];
    const signal = close[i] > baseline ? 1 : close[i] < baseline ? -1 : prevSignal;
    const marker = signal !== prevSignal && prevSignal !== 0 ? signal : 0;
    prevSignal = signal || prevSignal;
    out.push({
      close: close[i],
      ema21: ema21[i],
      baseline,
      atr: a,
      upperBand: baseline + a * 1.2,
      lowerBand: baseline - a * 1.2,
      sslUp,
      sslDown,
      hybridFast: signal >= 0 ? baseline + a * 0.28 : baseline - a * 0.28,
      hybridSlow: signal >= 0 ? baseline - a * 0.28 : baseline + a * 0.28,
      trend: signal,
      marker
    });
  }
  return out;
}

function drawLine(ctx, values, padL, step, y, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.shadowBlur = width > 2 ? 8 : 0;
  ctx.shadowColor = color;
  ctx.beginPath();
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    const x = padL + i * step + step / 2;
    const yy = y(v);
    if (i === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
  });
  ctx.stroke();
  ctx.shadowBlur = 0;
}

function drawAtrBands(ctx, ind, padL, step, y) {
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#8fa3be';
  ctx.beginPath();
  ind.forEach((v, i) => {
    const x = padL + i * step + step / 2;
    const yy = y(v.upperBand);
    if (i === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
  });
  for (let i = ind.length - 1; i >= 0; i--) {
    const x = padL + i * step + step / 2;
    ctx.lineTo(x, y(ind[i].lowerBand));
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  drawLine(ctx, ind.map((x) => x.upperBand), padL, step, y, 'rgba(143,163,190,.55)', 1);
  drawLine(ctx, ind.map((x) => x.lowerBand), padL, step, y, 'rgba(143,163,190,.55)', 1);
}

function drawTrendCloud(ctx, ind, padL, step, y, padT, plotH) {
  ctx.save();
  for (let i = 1; i < ind.length; i++) {
    const prev = ind[i - 1], cur = ind[i];
    const color = cur.trend >= 0 ? 'rgba(0,230,118,.13)' : 'rgba(255,23,68,.13)';
    ctx.fillStyle = color;
    const x1 = padL + (i - 1) * step + step / 2;
    const x2 = padL + i * step + step / 2;
    ctx.beginPath();
    ctx.moveTo(x1, y(prev.hybridFast));
    ctx.lineTo(x2, y(cur.hybridFast));
    ctx.lineTo(x2, y(cur.hybridSlow));
    ctx.lineTo(x1, y(prev.hybridSlow));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawSignalMarkers(ctx, ind, padL, step, padT, plotH) {
  ctx.save();
  ind.forEach((v, i) => {
    if (!v.marker) return;
    const x = padL + i * step + step / 2;
    const color = v.marker > 0 ? '#00e676' : '#ff1744';
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    ctx.font = '10px Consolas';
    ctx.textAlign = 'center';
    ctx.fillText(v.marker > 0 ? 'Comprar' : 'Vender', x, padT + plotH - 8);
  });
  ctx.restore();
}

function onChartWheel(event) {
  event.preventDefault();
  const oldZoom = state.chartZoom;
  const direction = event.deltaY < 0 ? -1 : 1;
  const step = oldZoom > 80 ? 12 : oldZoom > 45 ? 7 : 4;
  state.chartZoom = Math.max(24, Math.min(180, oldZoom + direction * step));
  if (event.shiftKey) {
    state.chartOffset = Math.max(0, state.chartOffset + (event.deltaY > 0 ? 5 : -5));
  }
  drawChart();
}

function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  values.forEach((v, i) => out.push(i ? v * k + out[i - 1] * (1 - k) : v));
  return out;
}

function calcADX(candles, period = 14) {
  if (candles.length < period * 2 + 1) return null;
  const trs = [], plusDMs = [], minusDMs = [];
  for (let i = 1; i < candles.length; i++) {
    const cur = candles[i], prev = candles[i - 1];
    const hl  = cur.high  - cur.low;
    const hpc = Math.abs(cur.high  - prev.close);
    const lpc = Math.abs(cur.low   - prev.close);
    trs.push(Math.max(hl, hpc, lpc));
    const upMove   = cur.high - prev.high;
    const downMove = prev.low - cur.low;
    plusDMs.push( upMove   > downMove && upMove   > 0 ? upMove   : 0);
    minusDMs.push(downMove > upMove   && downMove > 0 ? downMove : 0);
  }
  // Wilder smooth: first value = sum of first `period` elements
  const wilderSmooth = (arr) => {
    const out = [];
    let sum = arr.slice(0, period).reduce((a, b) => a + b, 0);
    out.push(sum);
    for (let i = period; i < arr.length; i++) {
      sum = sum - sum / period + arr[i];
      out.push(sum);
    }
    return out;
  };
  const atr14  = wilderSmooth(trs);
  const pDM14  = wilderSmooth(plusDMs);
  const mDM14  = wilderSmooth(minusDMs);
  const dxArr  = [];
  const pDI14  = [], mDI14 = [];
  for (let i = 0; i < atr14.length; i++) {
    const atr = atr14[i] || 1e-12;
    const pdi = 100 * pDM14[i] / atr;
    const mdi = 100 * mDM14[i] / atr;
    pDI14.push(pdi);
    mDI14.push(mdi);
    const diSum = pdi + mdi;
    dxArr.push(diSum > 0 ? 100 * Math.abs(pdi - mdi) / diSum : 0);
  }
  const adxArr = wilderSmooth(dxArr);
  const last = adxArr.length - 1;
  return {
    adx:     adxArr[last],
    plusDI:  pDI14[pDI14.length - 1],
    minusDI: mDI14[mDI14.length - 1]
  };
}

function detectRegime(candles) {
  const adxResult = calcADX(candles, 14);
  // ATR% = avg true range / current price (volatility proxy)
  const slice = candles.slice(-14);
  const price = candles[candles.length - 1]?.close || 1;
  const atrPct = slice.length > 1
    ? slice.slice(1).reduce((s, c, i) => {
        const prev = slice[i];
        return s + Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
      }, 0) / (slice.length - 1) / price
    : 0;

  if (!adxResult) return { type: 'NEUTRAL', label: 'NEUTRO', color: '#8fa3c0', adx: 0, plusDI: 0, minusDI: 0, atrPct, penalty: 0 };

  const { adx, plusDI, minusDI } = adxResult;

  // VOLATILE takes priority — ADX can be high or low during a spike
  if (atrPct > 0.012) {
    return { type: 'VOLATILE',      label: 'VOLATIL',    color: '#f0a500', adx, plusDI, minusDI, atrPct, penalty: -12 };
  }
  if (adx > 25 && plusDI > minusDI) {
    return { type: 'TRENDING_UP',   label: 'TENDENCIA↑', color: '#43d787', adx, plusDI, minusDI, atrPct, penalty: 0  };
  }
  if (adx > 25 && minusDI > plusDI) {
    return { type: 'TRENDING_DOWN', label: 'TENDENCIA↓', color: '#ff5252', adx, plusDI, minusDI, atrPct, penalty: 0  };
  }
  if (adx < 20) {
    return { type: 'RANGING',       label: 'LATERAL',    color: '#f0a500', adx, plusDI, minusDI, atrPct, penalty: -8 };
  }
  return   { type: 'NEUTRAL',       label: 'NEUTRO',     color: '#8fa3c0', adx, plusDI, minusDI, atrPct, penalty: 0  };
}

function updateSignal() {
  const data = state.candles.slice(-60);  // más velas para ADX14 estable
  if (data.length < 20) return;
  const closes  = data.map((c) => c.close);
  const ranges  = data.slice(-20).map((c) => c.high - c.low);
  const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  const momentum = closes[closes.length - 1] - closes[closes.length - 10];
  const volNow  = data[data.length - 1].volume;
  const volAvg  = data.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;

  // ── Dirección base por momentum ───────────────────────────
  let dir = 'NEUTRAL';
  if (momentum >  avgRange * 0.55) dir = 'LONG';
  if (momentum < -avgRange * 0.55) dir = 'SHORT';

  // ── Score base ────────────────────────────────────────────
  let score = 50 + Math.min(30, Math.abs(momentum) / Math.max(avgRange, 1e-12) * 8);
  if (volNow > volAvg * 1.35) score += 8;

  // ── Macro penalty ─────────────────────────────────────────
  const macro = macroRiskLevel(state.symbol);
  if (macro.risk === 'high')   score -= 12;
  else if (macro.risk === 'medium') score -= 6;

  // ── ADX14 Regime Detection ───────────────────────────────
  const regime = detectRegime(data);

  // Penalización base por régimen
  score += regime.penalty;

  // Bonus/penalización por alineación dirección ↔ régimen
  if (regime.type === 'TRENDING_UP') {
    if (dir === 'LONG')  score += 6;   // alineado: impulso + tendencia alcista
    if (dir === 'SHORT') score -= 10;  // contra-tendencia: peligroso
  } else if (regime.type === 'TRENDING_DOWN') {
    if (dir === 'SHORT') score += 6;   // alineado
    if (dir === 'LONG')  score -= 10;  // contra-tendencia
  }

  score = Math.round(Math.max(8, Math.min(95, score)));

  // ── Render UI ─────────────────────────────────────────────
  const badge = $('signalBadge');
  badge.textContent = dir;
  badge.className = `badge ${dir === 'LONG' ? 'long' : dir === 'SHORT' ? 'short' : 'neutral'}`;
  $('sigDir').textContent      = dir;
  $('sigStrength').textContent = score >= 70 ? 'ALTA' : score >= 50 ? 'MEDIA' : 'BAJA';
  $('sigVol').textContent      = volNow > volAvg * 1.4 ? 'ALTA' : 'BAJA';

  // Régimen con color dinámico
  const regEl = $('sigRegime');
  if (regEl) {
    regEl.textContent = `${regime.label} (ADX ${regime.adx.toFixed(1)})`;
    regEl.style.color = regime.color;
  }

  const strongSignal = score >= 62 && dir !== 'NEUTRAL';
  const caution = macro.risk === 'high' ? ' con cautela: riesgo macro alto' : '';
  const msg = strongSignal && dir === 'LONG'
    ? `Buen momento para comprar${caution}`
    : strongSignal && dir === 'SHORT'
    ? `Buen momento para vender${caution}`
    : dir === 'LONG' || dir === 'SHORT'
    ? 'Esperar confirmacion: senal aun debil'
    : 'Buen momento para no hacer nada';
  $('signalMessage').textContent = msg;
  $('signalMessage').className = `signal-message ${msg.includes('comprar') ? 'buy' : msg.includes('vender') ? 'sell' : 'wait'}`;

  const support    = Math.min(...data.slice(-20).map((c) => c.low));
  const resistance = Math.max(...data.slice(-20).map((c) => c.high));
  const pivot      = (support + resistance + closes[closes.length - 1]) / 3;
  const last       = data[data.length - 1];

  // Explicación del ajuste de régimen
  const regimeLine = regime.type === 'VOLATILE'
    ? `Régimen VOLÁTIL — ATR ${(regime.atrPct * 100).toFixed(3)}% — penalización -12 pts.`
    : regime.type === 'RANGING'
    ? `Régimen LATERAL — ADX ${regime.adx.toFixed(1)} < 20 — señales poco confiables, penalización -8 pts.`
    : regime.type === 'TRENDING_UP'
    ? `Régimen TENDENCIA↑ — ADX ${regime.adx.toFixed(1)}, +DI ${regime.plusDI.toFixed(1)} > -DI ${regime.minusDI.toFixed(1)}${dir === 'LONG' ? ' — señal alineada +6 pts.' : dir === 'SHORT' ? ' — señal contra-tendencia -10 pts.' : '.'}`
    : regime.type === 'TRENDING_DOWN'
    ? `Régimen TENDENCIA↓ — ADX ${regime.adx.toFixed(1)}, -DI ${regime.minusDI.toFixed(1)} > +DI ${regime.plusDI.toFixed(1)}${dir === 'SHORT' ? ' — señal alineada +6 pts.' : dir === 'LONG' ? ' — señal contra-tendencia -10 pts.' : '.'}`
    : `Régimen NEUTRO — ADX ${regime.adx.toFixed(1)}, sin penalización.`;

  const wfc = state.wfCalibration;
  const wfLine = wfc.n >= 10
    ? `Calibración WF-OOS: ${wfc.label}`
    : `Calibración WF-OOS: acumulando trades (${wfc.n}/10)`;
  const nc = state.nightCalibration;
  const nightLine = nc?.ok
    ? `Calibración nocturna: ${nc.label} (${new Date(nc.computedAt).toLocaleString('es-CO')})`
    : `Calibración nocturna: pendiente (ejecuta recalibrar en Configuración)`;

  $('signalSummary').textContent =
    `Resumen del análisis\n` +
    `Estructura: ${dir === 'LONG' ? 'impulso alcista' : dir === 'SHORT' ? 'presión bajista' : 'mercado lateral'}.\n` +
    `Decisión: ${msg}.\n` +
    `Confianza: ${score}/100.\n` +
    `Momentum 10 velas: ${fmtPrice(momentum)}.\n` +
    `Volumen actual/promedio: ${volNow.toFixed(4)} / ${volAvg.toFixed(4)}.\n\n` +
    `Régimen de mercado (ADX14)\n` +
    `${regimeLine}\n\n` +
    `${wfLine}\n` +
    `${nightLine}\n\n` +
    `Contexto macro/news\n` +
    `Riesgo: ${macro.risk.toUpperCase()} (${macro.reasons.join(', ') || 'sin alertas'}).\n` +
    `Finnhub: ${state.macroNews.finnhub[0]?.headline || 'sin titular reciente'}\n` +
    `Alpha: ${state.macroNews.alphaFeed[0]?.overall_sentiment_label || 'sin sentimiento reciente'} ${state.macroNews.alphaFeed[0]?.title || ''}\n\n` +
    `Niveles clave\n` +
    `Resistencia  ${fmtPrice(resistance)}\n` +
    `Soporte      ${fmtPrice(support)}\n` +
    `Punto Pivote ${fmtPrice(pivot)}\n` +
    `Último Close ${fmtPrice(last.close)}\n\n` +
    `Nota de riesgo\n` +
    `No es orden ejecutable. Requiere confirmación, tamaño, stop, spread aceptable y risk gate.`;

  drawGauge(score);

  // Disparar alertas si hay configuración activa
  if (_alertConfig?.enabled) {
    const activePair = { symbol: state.symbol, venue: state.platform, price: state.ticker?.price || 0, spreadPct: state.ticker ? (state.ticker.spread || 0) / Math.max(state.ticker.price, 1) : 0 };
    checkAndFireAlerts({ bias: dir, confidence: score, setup: dir !== 'NEUTRAL' ? `momentum_${regime.type}` : null, horizon: 'intraday', volumeRatio: volAvg > 0 ? volNow / volAvg : 1 }, activePair);
  }
}

function drawGauge(score) {
  const canvas = $('gaugeCanvas');
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, rect.width * dpr);
  canvas.height = Math.max(1, rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h * .86, r = Math.min(w * .34, h * .72);
  const arcs = [['#ff1744', Math.PI, Math.PI * 1.33], ['#ffab00', Math.PI * 1.33, Math.PI * 1.68], ['#00c853', Math.PI * 1.68, Math.PI * 2]];
  ctx.lineWidth = 14; ctx.lineCap = 'round';
  arcs.forEach(([color, a, b]) => { ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(cx, cy, r, a, b); ctx.stroke(); });
  const angle = Math.PI + (score / 100) * Math.PI;
  ctx.strokeStyle = '#e8edf5'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(angle) * (r - 10), cy + Math.sin(angle) * (r - 10)); ctx.stroke();
  ctx.fillStyle = '#e8edf5'; ctx.font = 'bold 22px Consolas'; ctx.textAlign = 'center';
  ctx.fillText(`${score}/100`, cx, h * .54);
  ctx.fillStyle = '#8fa3be'; ctx.font = '11px Consolas'; ctx.fillText('CONFIANZA', cx, h * .69);
}

async function refreshWallet() {
  try {
    const data = await window.quant.wallet();
    renderWallet(data);
    await window.quant.memoryWrite('observation', { type: 'wallet_refreshed', binanceAssets: data.binance?.length || 0, mt5: data.mt5 || {} });
    await loadMemoryStats();
    $('stMt5').textContent = data.mt5?.available ? 'Conectado' : 'Revisar';
    logEvent('OK', 'Wallet Binance/MT5 actualizada');
  } catch (err) {
    logEvent('WARN', `Wallet: ${err.message}`);
  }
}

function renderWallet(data) {
  state.wallet = data;
  const bw = data.binance || {};
  const spotRows = (bw.spot || []).slice(0, 12).map((b) => `<div class="balance-row"><span>${b.asset}</span><b>${b.free.toPrecision(8)}</b><span>locked ${b.locked.toPrecision(4)}</span></div>`).join('');
  const fundingRows = (bw.funding || []).slice(0, 10).map((b) => {
    const free = Number(b.free || b.amount || 0);
    return `<div class="balance-row"><span>${b.asset || b.coin}</span><b>${free.toPrecision(8)}</b><span>funding</span></div>`;
  }).join('');
  const earnRows = (bw.earn || []).slice(0, 10).map((b) => {
    const amount = Number(b.totalAmount || b.amount || 0);
    const apr = Number(b.latestAnnualPercentageRate || 0) * 100;
    const rewards = Number(b.cumulativeTotalRewards || b.cumulativeRealTimeRewards || 0);
    return `<div class="balance-row"><span>${b.asset}</span><b>${amount.toPrecision(8)}</b><span>APR ${apr.toFixed(3)}% · rewards ${rewards.toPrecision(5)}</span></div>`;
  }).join('');
  const valuationRows = (bw.valuation || []).slice(0, 16).map((v) => {
    const apr = v.apr ? ` · APR ${(v.apr * 100).toFixed(3)}%` : '';
    return `<div class="balance-row"><span>${v.source} ${v.asset}</span><b>$${v.valueUsd.toFixed(4)}</b><span>${v.valueCop ? `COP ${Math.round(v.valueCop).toLocaleString('es-CO')}` : 'COP n/a'}${apr}</span></div>`;
  }).join('');
  const diagnosticRows = [
    bw.error ? `<div class="balance-row"><span>Estado</span><b style="color:#f87171">${escapeHtml(bw.error.slice(0, 110))}</b></div>` : '',
    `<div class="balance-row"><span>Tipo</span><b>${bw.accountType || 'SPOT'}</b></div>`,
    `<div class="balance-row"><span>Trade</span><b>${bw.canTrade ? 'Sí' : 'No'}</b></div>`,
    `<div class="balance-row"><span>Deposit</span><b>${bw.canDeposit ? 'Sí' : 'No'}</b></div>`,
    `<div class="balance-row"><span>Withdraw</span><b>${bw.canWithdraw ? 'Sí' : 'No'}</b></div>`
  ].join('');
  // ── MT5 multi-account cards ────────────────────────────────
  const mt5Accounts = data.mt5Accounts || [];
  // Fallback: if backend still returns old-style single mt5 object
  if (!mt5Accounts.length && data.mt5?.available) mt5Accounts.push(data.mt5);
  const mt5Cards = mt5Accounts.length
    ? mt5Accounts.map((acc) => {
        const modeLabel = acc.is_demo ? 'DEMO' : 'REAL';
        const modeColor = acc.is_demo ? '#f0a500' : '#2979ff';
        const cur = escapeHtml(acc.currency || 'USD');
        const profit = Number(acc.profit || 0);
        const profitColor = profit >= 0 ? '#43d787' : '#ff5252';
        if (!acc.available) {
          return `<div class="wallet-card"><h3>MT5 · ${escapeHtml(String(acc.login || '--'))} <small style="color:#f87171">ERROR</small></h3>
            <div class="balance-row"><span>Servidor</span><b>${escapeHtml(acc.server || '--')}</b></div>
            <div class="balance-row"><span>Error</span><b style="color:#f87171">${escapeHtml((acc.error || 'No accesible').slice(0, 120))}</b></div></div>`;
        }
        return `<div class="wallet-card"><h3>MT5 · ${acc.login} <small style="background:${modeColor}22;color:${modeColor};padding:2px 7px;border-radius:3px;font-size:11px">${modeLabel}</small></h3>
          <div class="balance-row"><span>Servidor</span><b>${escapeHtml(acc.server || '--')}</b></div>
          <div class="balance-row"><span>Moneda</span><b>${cur}</b></div>
          <div class="balance-row"><span>Balance</span><b>${Number(acc.balance || 0).toFixed(2)} ${cur}</b><span>${acc.balanceCop ? `COP ${Math.round(acc.balanceCop).toLocaleString('es-CO')}` : ''}</span></div>
          <div class="balance-row"><span>Equity</span><b>${Number(acc.equity || 0).toFixed(2)} ${cur}</b><span>${acc.equityCop ? `COP ${Math.round(acc.equityCop).toLocaleString('es-CO')}` : ''}</span></div>
          <div class="balance-row"><span>Margen libre</span><b>${Number(acc.margin_free || 0).toFixed(2)} ${cur}</b></div>
          <div class="balance-row"><span>P&L flotante</span><b style="color:${profitColor}">${profit >= 0 ? '+' : ''}${profit.toFixed(2)} ${cur}</b></div>
          <div class="balance-row"><span>Posiciones</span><b>${(acc.positions || []).length}</b></div></div>`;
      }).join('')
    : `<div class="wallet-card"><h3>MT5</h3><div class="balance-row"><span>Estado</span><b>${escapeHtml(data.mt5?.message || 'Adapter desactivado o sin cuentas configuradas')}</b></div></div>`;

  $('walletGrid').innerHTML =
    `<div class="wallet-card"><h3>BINANCE · DIAGNÓSTICO</h3>${diagnosticRows}</div>` +
    `<div class="wallet-card"><h3>BINANCE · VALORACIÓN</h3><div class="balance-row"><span>Total aprox.</span><b>$${Number(bw.totalUsd || 0).toFixed(4)}</b><span>${bw.totalCop ? `COP ${Math.round(bw.totalCop).toLocaleString('es-CO')}` : 'COP n/a'}</span></div><div class="balance-row"><span>USD/COP</span><b>${bw.usdCop ? Number(bw.usdCop).toFixed(2) : 'n/a'}</b><span>referencial</span></div>${valuationRows}</div>` +
    `<div class="wallet-card"><h3>BINANCE SPOT</h3>${spotRows || '<div class="balance-row"><span>Sin saldos Spot visibles</span><b>0</b></div>'}</div>` +
    `<div class="wallet-card"><h3>BINANCE FUNDING</h3>${fundingRows || `<div class="balance-row"><span>${bw.fundingError ? 'Error' : 'Sin saldos Funding'}</span><b>${escapeHtml((bw.fundingError || '0').slice(0, 80))}</b></div>`}</div>` +
    `<div class="wallet-card"><h3>BINANCE EARN</h3>${earnRows || `<div class="balance-row"><span>${bw.earnError ? 'Error' : 'Sin posiciones Earn'}</span><b>${escapeHtml((bw.earnError || '0').slice(0, 80))}</b></div>`}</div>` +
    mt5Cards;
}

function walletContext() {
  const bw = state.wallet?.binance || {};
  const mt5 = state.wallet?.mt5 || {};
  const spot = (bw.spot || []).map((b) => `${b.asset}: free ${b.free}, locked ${b.locked}`).join('; ');
  const funding = (bw.funding || []).map((b) => `${b.asset || b.coin}: ${b.free || b.amount || 0}`).join('; ');
  const earn = (bw.earn || []).map((b) => {
    const apr = Number(b.latestAnnualPercentageRate || 0) * 100;
    const total = b.totalAmount || b.amount || 0;
    const rewards = b.cumulativeTotalRewards || b.cumulativeRealTimeRewards || 0;
    return `${b.asset}: total ${total}, APR ${apr.toFixed(4)}%, rewards ${rewards}, product ${b.productId || ''}`;
  }).join('; ');
  return [
    `Valoración Binance total aproximada: ${bw.totalUsd || 0} USD; ${bw.totalCop || 0} COP; USD/COP ${bw.usdCop || 'n/a'}`,
    `Valoración por activo: ${(bw.valuation || []).map((v) => `${v.source} ${v.asset}: ${v.amount} ≈ ${v.valueUsd} USD / ${v.valueCop} COP${v.apr ? ` APR ${v.apr * 100}%` : ''}`).join('; ')}`,
    `Binance accountType: ${bw.accountType || 'SPOT'}, canTrade: ${bw.canTrade}, canDeposit: ${bw.canDeposit}, canWithdraw: ${bw.canWithdraw}`,
    `Binance Spot: ${spot || 'sin saldos Spot visibles'}`,
    `Binance Funding: ${funding || 'sin saldos Funding visibles'}`,
    `Binance Earn: ${earn || 'sin posiciones Earn visibles'}`,
    `MT5 cuentas: ${(state.wallet?.mt5Accounts || []).map((a) => a.available ? `[${a.is_demo ? 'DEMO' : 'REAL'} ${a.login} ${a.server}: balance ${a.balance} ${a.currency}, equity ${a.equity}, P&L ${a.profit}, posiciones ${(a.positions || []).length}]` : `[${a.login} ERROR: ${a.error}]`).join(' | ') || (state.wallet?.mt5?.available ? `login ${state.wallet.mt5.login}, balance ${state.wallet.mt5.balance} ${state.wallet.mt5.currency}` : 'no disponible')}`
  ].join('\n');
}

function trainingContext() {
  const tr = state.training;
  const open = tr.positions.filter((p) => !p.exit_price);
  const mt5Open = open.filter((p) => p.venue === 'MT5').length;
  const realized = tr.balance - tr.balanceStart;
  updateTrainingStrategyStats();
  const strategyLines = Object.values(tr.strategyStats || {})
    .sort((a, b) => (b.open + b.liveCandidates) - (a.open + a.liveCandidates))
    .map((s) => `${s.name}: live=${s.liveCandidates}, open=${s.open}, closed=${s.closed}, WR=${s.closed ? Math.round(s.winrate * 100) + '%' : 'n/a'}, PnL=${s.pnl.toFixed(2)}, score=${s.avgScore ? s.avgScore.toFixed(0) : 'n/a'}`)
    .join(' | ');
  return [
    'Training Mode: ACTIVO. Mercado real observado + operaciones demo internas. Nunca ejecuta BUY/SELL reales.',
    `Guard: mode=training, simulated=true, blockRealExecution=${tr.blockRealExecution}, targetOpenPositions=${tr.targetOpenPositions} (${tr.targetIntradayPositions} intradia + ${tr.targetSwingPositions} swing), maxPairs=${tr.maxPairs}.`,
    `Execution adapters: Core=${state.executionAdapters.core}, Paper=${state.executionAdapters.paper}, Binance=${state.executionAdapters.binance}, MT5=${state.executionAdapters.mt5}, TradingViewWebhook=${state.executionAdapters.tradingViewWebhook}, BrokerAPI=${state.executionAdapters.brokerApi}.`,
    `Self-audit: lastRun=${state.selfAudit.lastRun || 'pendiente'}, findings=${state.selfAudit.findings.length}.`,
    `Estrategias activas y comparadas: ${Object.values(state.strategies).map((s) => `${s.name} minScore=${s.minScore || 'n/a'} RR=${s.rrMin || 'n/a'}`).join('; ')}.`,
    `Scoreboard estrategias: ${strategyLines || 'sin datos aun'}.`,
    `Pares activos reales: ${tr.activePairs.map((p) => `${p.venue}:${p.symbol}@${fmtPrice(p.price)} conf ${p.indicators?.confidence || 0} strategy=${p.indicators?.primaryStrategy?.id || 'n/a'}`).join('; ') || 'validando'}.`,
    `Posiciones demo abiertas: ${open.length}; MT5 abiertas: ${mt5Open}; P&L demo total: ${realized.toFixed(2)}; trades cerrados: ${tr.closedTrades.length}; lecciones: ${tr.lessons.length}.`,
    `Walk-Forward OOS (sesion): ${state.wfCalibration.label}; ratio x${state.wfCalibration.ratio.toFixed(2)}.`,
    `Calibracion nocturna (JSONL): ${state.nightCalibration.ok ? state.nightCalibration.label : 'pendiente'}; ratio nocturno x${(state.nightCalibration.ratio || 1).toFixed(2)}.`,
    `Macro/news aplicado al Training: risk=${state.macroNews.risk}; Finnhub=${state.macroNews.finnhub.length}; Alpha=${state.macroNews.alphaFeed.length}; Economic=${state.macroNews.economic.length}.`,
    `Ultima leccion: ${tr.lessons[0]?.lesson || 'Aun no hay leccion cerrada.'}`
  ].join('\n');
}

async function runSelfAudit() {
  const findings = [];
  const add = (severity, area, issue, fix) => findings.push({ ts: new Date().toISOString(), severity, area, issue, fix });
  if (state.env.realTrading) add('HIGH', 'execution', 'REAL_TRADING esta activo; se requiere auditoria manual antes de dinero real.', 'Mantener risk gate y confirmacion exacta.');
  if (!state.training.blockRealExecution) {
    state.training.blockRealExecution = true;
    add('HIGH', 'training', 'Training tenia blockRealExecution desactivado.', 'Auto-fix: blockRealExecution=true.');
  }
  if (state.training.targetOpenPositions !== 20) {
    state.training.targetOpenPositions = 20;
    state.training.targetIntradayPositions = 10;
    state.training.targetSwingPositions = 10;
    add('MEDIUM', 'training', 'Training no mantenia 20 posiciones objetivo.', 'Auto-fix: 10 intradia + 10 swing.');
  }
  if (!state.executionAdapters.paper) {
    state.executionAdapters.paper = true;
    add('HIGH', 'adapters', 'Paper adapter desactivado.', 'Auto-fix: Paper adapter habilitado.');
  }
  if (!state.macroNews.updatedAt) add('MEDIUM', 'macro', 'Macro/news aun no cargado.', 'Solicitar refreshMacroContext.');
  if (!state.env.binance) add('MEDIUM', 'market_data', 'Binance API sin credenciales.', 'Core puede usar datos publicos, pero wallet/trading requieren claves.');
  state.selfAudit.lastRun = new Date().toISOString();
  state.selfAudit.findings = findings.slice(0, 20);
  if (findings.length) {
    await window.quant.memoryWrite('self_audit', { type: 'self_audit', findings, adapters: state.executionAdapters, training: { targetOpenPositions: state.training.targetOpenPositions, blockRealExecution: state.training.blockRealExecution } });
    logEvent('WARN', `Self-audit: ${findings.length} hallazgos revisados/auto-corregidos`);
  } else {
    logEvent('OK', 'Self-audit: sin vulnerabilidades operativas nuevas');
  }
  await saveTrainingState();
}

async function refreshMacroContext(automatic = false) {
  const [finnhub, alpha, economic, finnhubCrypto, cryptoRss] = await Promise.allSettled([
    window.quant.finnhub(),
    window.quant.alpha(),
    window.quant.finnhubEconomic ? window.quant.finnhubEconomic() : Promise.resolve([]),
    window.quant.finnhubCrypto   ? window.quant.finnhubCrypto()   : Promise.resolve([]),
    window.quant.cryptoRss       ? window.quant.cryptoRss()       : Promise.resolve([])
  ]);
  if (finnhub.status === 'fulfilled')       state.macroNews.finnhub       = Array.isArray(finnhub.value)       ? finnhub.value.slice(0, 30)       : [];
  if (finnhubCrypto.status === 'fulfilled') state.macroNews.finnhubCrypto = Array.isArray(finnhubCrypto.value) ? finnhubCrypto.value.slice(0, 20) : [];
  if (cryptoRss.status === 'fulfilled')     state.macroNews.cryptoRss     = Array.isArray(cryptoRss.value)     ? cryptoRss.value.slice(0, 20)     : [];
  if (alpha.status === 'fulfilled') {
    state.macroNews.alphaSentiment = alpha.value || {};
    state.macroNews.alphaFeed = (alpha.value?.feed || []).slice(0, 30);
  }
  if (economic.status === 'fulfilled') state.macroNews.economic = normalizeEconomicEvents(economic.value).slice(0, 20);
  state.macroNews.updatedAt = new Date().toISOString();
  state.macroNews.risk = macroRiskLevel().risk;
  renderNewsFromState(state.newsSource);
  const now = Date.now();
  if (!automatic || now - state.lastNewsAutoLog > 240000) {
    logEvent('OK', `Macro/news: Finnhub ${state.macroNews.finnhub.length}, Crypto ${state.macroNews.finnhubCrypto.length + state.macroNews.cryptoRss.length}, Alpha ${state.macroNews.alphaFeed.length}, eventos ${state.macroNews.economic.length}`);
    state.lastNewsAutoLog = now;
  }
  updateSignal();
}

function normalizeEconomicEvents(payload) {
  const raw = Array.isArray(payload) ? payload : (payload?.economicCalendar || payload?.calendar || payload?.events || []);
  return raw.map((e) => ({
    time: e.time || e.datetime || e.date || e.releaseDate || '',
    country: e.country || e.region || e.currency || '',
    event: e.event || e.title || e.name || '',
    impact: e.impact || e.importance || e.priority || '',
    actual: e.actual,
    estimate: e.estimate || e.forecast,
    previous: e.prev || e.previous
  })).filter((e) => e.event);
}

function renderNewsFromState(source) {
  if (source === 'alpha') {
    $('alphaBtn').classList.add('active'); $('finnhubBtn').classList.remove('active');
    const html = state.macroNews.alphaFeed.slice(0, 10).map((n) => `<div class="news-item"><span class="news-time">${(n.time_published || '').slice(9, 13) || '--:--'}</span><span>${escapeHtml(n.title || '')}</span><span class="impact">${n.overall_sentiment_label || 'Info'}</span></div>`).join('');
    $('newsList').innerHTML = html || '<div class="empty-state">Sin noticias Alpha.</div>';
    $('newsAlphaPage').innerHTML = html;
  } else {
    $('finnhubBtn').classList.add('active'); $('alphaBtn').classList.remove('active');
    const html = state.macroNews.finnhub.slice(0, 12).map((n) => `<div class="news-item"><span class="news-time">${n.datetime ? new Date(n.datetime * 1000).toTimeString().slice(0,5) : '--:--'}</span><span>${escapeHtml(n.headline || n.summary || '')}</span><span class="impact">${n.source || 'News'}</span></div>`).join('');
    $('newsList').innerHTML = html || '<div class="empty-state">Sin noticias Finnhub.</div>';
    $('newsFinnhubPage').innerHTML = html;
  }
}

function macroContext() {
  const risk = macroRiskLevel();
  const finnhub      = state.macroNews.finnhub.slice(0, 6).map((n) => `${n.source || 'Finnhub'}: ${n.headline || n.summary || ''}`).join('\n');
  const cryptoFinnhub = state.macroNews.finnhubCrypto.slice(0, 6).map((n) => `FinnhubCrypto: ${n.headline || n.summary || ''}`).join('\n');
  const cryptoRss    = state.macroNews.cryptoRss.slice(0, 6).map((n) => `${n.source || 'RSS'}: ${n.title || ''}`).join('\n');
  const alpha        = state.macroNews.alphaFeed.slice(0, 6).map((n) => `${n.overall_sentiment_label || 'Sentiment'} ${Number(n.overall_sentiment_score || 0).toFixed(3)}: ${n.title || ''}`).join('\n');
  const events       = state.macroNews.economic.slice(0, 8).map((e) => `${e.time || ''} ${e.country || ''} ${e.event || ''} impact=${e.impact || 'n/a'} actual=${e.actual ?? 'n/a'} forecast=${e.estimate ?? 'n/a'}`).join('\n');
  return [
    `Macro/news context ACTIVO. UpdatedAt=${state.macroNews.updatedAt || 'no cargado'} Risk=${risk.risk} Score=${risk.score}.`,
    `Regla: toda decision real o training debe consultar todas las fuentes de noticias disponibles antes de actuar.`,
    `Finnhub noticias generales:\n${finnhub || 'Sin titulares Finnhub.'}`,
    `Finnhub noticias crypto:\n${cryptoFinnhub || 'Sin titulares crypto Finnhub.'}`,
    `RSS crypto (CoinTelegraph/CoinDesk):\n${cryptoRss || 'Sin noticias RSS crypto.'}`,
    `Alpha Vantage sentiment:\n${alpha || 'Sin sentimiento Alpha.'}`,
    `Calendario/eventos macro:\n${events || 'Sin calendario macro.'}`,
    `Macro flags: ${risk.reasons.join('; ') || 'sin flags relevantes'}`
  ].join('\n\n');
}

function macroRiskLevel(symbol = '') {
  const text = [
    symbol,
    ...state.macroNews.finnhub.slice(0, 12).map((n) => `${n.headline || ''} ${n.summary || ''}`),
    ...state.macroNews.finnhubCrypto.slice(0, 12).map((n) => `${n.headline || ''} ${n.summary || ''}`),
    ...state.macroNews.cryptoRss.slice(0, 12).map((n) => `${n.title || ''} ${n.summary || ''}`),
    ...state.macroNews.alphaFeed.slice(0, 12).map((n) => `${n.title || ''} ${n.summary || ''}`),
    ...state.macroNews.economic.slice(0, 12).map((e) => `${e.country || ''} ${e.event || ''} ${e.impact || ''}`)
  ].join(' ').toLowerCase();
  const highWords = ['fed', 'fomc', 'cpi', 'inflation', 'nfp', 'payroll', 'rate decision', 'interest rate', 'war', 'tariff', 'sec', 'etf', 'bankruptcy', 'default', 'oil inventories',
    'hack', 'exploit', 'exchange down', 'exchange collapse', 'rug pull', 'depegged', 'depeg', 'stablecoin', 'halving', 'hard fork', 'whale', 'liquidation', 'flash crash'];
  const medWords = ['gdp', 'pmi', 'retail sales', 'jobs', 'unemployment', 'treasury', 'yield', 'earnings', 'guidance', 'sentiment',
    'bitcoin', 'ethereum', 'crypto', 'blockchain', 'defi', 'nft', 'altcoin', 'memecoin', 'regulation', 'ban', 'airdrop'];
  let score = 0;
  const reasons = [];
  for (const w of highWords) if (text.includes(w)) { score += 3; reasons.push(w); }
  for (const w of medWords) if (text.includes(w)) { score += 1; reasons.push(w); }
  const alphaScore = state.macroNews.alphaFeed.slice(0, 8).reduce((s, n) => s + Math.abs(Number(n.overall_sentiment_score || 0)), 0);
  if (alphaScore > 1.8) { score += 2; reasons.push('alpha_sentiment_extreme'); }
  return { risk: score >= 6 ? 'high' : score >= 3 ? 'medium' : 'normal', score, reasons: [...new Set(reasons)].slice(0, 8) };
}

async function refreshNews(source, automatic = false) {
  try {
    state.newsSource = source;
    await refreshMacroContext(automatic);
    renderNewsFromState(source);
    const now = Date.now();
    if (!automatic || now - state.lastNewsAutoLog > 240000) {
      logEvent('OK', `Noticias actualizadas: ${source}${automatic ? ' · auto' : ''}`);
      state.lastNewsAutoLog = now;
    }
  } catch (err) {
    logEvent('WARN', `Noticias ${source}: ${err.message}`);
  }
}

function renderMarketTable() {
  const q = $('marketSearch').value?.toUpperCase() || '';
  const rows = state.symbols.filter((s) => s.includes(q)).slice(0, 250).map((s) => `<div class="market-row" data-symbol="${s}"><b>${s}</b><span>${state.platform}</span><span>${state.platform === 'BINANCE' ? (s.endsWith('USDT') ? 'USDT' : 'Multi quote') : 'MT5 symbol'}</span><button class="tiny-btn">Seleccionar</button></div>`).join('');
  $('marketTable').innerHTML = rows;
  document.querySelectorAll('.market-row').forEach((r) => r.addEventListener('click', () => { setSymbol(r.dataset.symbol); setView('dashboard'); }));
}

const trainingDemoWriterClient =
  window.QuantTrainingDemoWriter && typeof window.QuantTrainingDemoWriter.createTrainingDemoWriterClient === 'function'
    ? window.QuantTrainingDemoWriter.createTrainingDemoWriterClient()
    : null;

async function shadowWriteTrainingClosedTrade(openPosition, closedTrade, pair, signal) {
  if (!trainingDemoWriterClient) return { ok: false, fallback: true, reason: 'client_unavailable', mode: 'fallback_legacy', acceptAtomic: false };
  const exitContext = {
    price: pair.price,
    exit_price: closedTrade.exit_price,
    symbol: pair.symbol,
    venue: pair.venue,
    spreadPct: pair.spreadPct,
    volatilityPct: signal.volatilityPct
  };
  const result = await trainingDemoWriterClient.writeClosedTradeShadow({
    openPosition: openPosition,
    exitContext: exitContext,
    signal: signal,
    options: {
      closedAt: closedTrade.closed_timestamp,
      maxClosedTrades: 80
    }
  });
  if (result.ok) {
    logEvent('OK', result.acceptAtomic ? 'Training backend writer: atomic close aceptado' : 'Training backend writer: shadow write registrado');
    return result;
  }
  if (result.reason === 'disabled') {
    logEvent('OK', 'Training backend writer: backend desactivado, fallback local');
    return result;
  }
  if (result.warning) {
    logEvent('WARN', result.warning);
  }
  return result;
}

function removeTrainingPositionByBackendResponse(openPosition, backendBody) {
  const removedPositionId = backendBody?.removedPositionId;
  const removedSignalId = backendBody?.removedSignalId;
  state.training.positions = state.training.positions.filter((position) => {
    if (removedPositionId && position.id === removedPositionId) return false;
    if (removedSignalId && (position.signal_id === removedSignalId || position.signalId === removedSignalId)) return false;
    return position !== openPosition;
  });
}

async function acceptBackendAtomicTrainingClose(openPosition, pair, backendResult) {
  const backendBody = backendResult?.body || {};
  const backendClosedTrade = backendBody.closedTrade;
  if (!backendClosedTrade) return false;

  removeTrainingPositionByBackendResponse(openPosition, backendBody);
  state.training.closedTrades = [
    backendClosedTrade,
    ...state.training.closedTrades.filter((trade) => trade !== backendClosedTrade && trade?.closed_at !== backendClosedTrade.closed_at)
  ].slice(0, 80);
  computeWfCalibration();
  state.training.balance = Number(backendBody.balanceAfter || state.training.balance);
  state.training.xp += Math.max(4, Math.round(Math.abs(Number(backendClosedTrade.pnl_demo || 0)) / 4) + (Number(backendClosedTrade.pnl_demo || 0) >= 0 ? 14 : 8));
  state.training.pairCooldowns[`${pair.venue}:${pair.symbol}:${openPosition.horizon || 'intraday'}`] = Date.now() + 30 * 1000;

  if (backendBody.lessonPending !== true && backendClosedTrade.lesson_learned) {
    state.training.lessons.unshift(backendClosedTrade.lesson_learned);
    state.training.lessons = state.training.lessons.slice(0, 160);
    await window.quant.memoryWrite('training_lesson', backendClosedTrade.lesson_learned);
  } else if (backendBody.lessonPending === true && backendBody.lessonPendingReason) {
    logEvent('WARN', `Training backend writer: ${backendBody.lessonPendingReason}`);
  }

  if (backendResult.body?.persistence?.persistedAt) {
    state.training.lastPersistedAt = backendResult.body.persistence.persistedAt;
    setText('trainPersistence', `Persistencia backend atomic close - ${new Date(backendResult.body.persistence.persistedAt).toLocaleTimeString('es-CO')}`);
  }

  await window.quant.memoryWrite('trade', { ...backendClosedTrade, type: 'training_trade_closed', mode: 'training' });
  return true;
}

function applyBackendTrainingStateRefresh(refreshedState) {
  if (!refreshedState || typeof refreshedState !== 'object') return false;
  state.training.balance = Number(refreshedState.balance || state.training.balance);
  state.training.positions = Array.isArray(refreshedState.positions) ? refreshedState.positions : state.training.positions;
  state.training.closedTrades = Array.isArray(refreshedState.closedTrades) ? refreshedState.closedTrades : state.training.closedTrades;
  state.training.lessons = Array.isArray(refreshedState.lessons) ? refreshedState.lessons : state.training.lessons;
  state.training.strategyStats = refreshedState.strategyStats || state.training.strategyStats;
  state.training.pairCooldowns = refreshedState.pairCooldowns || state.training.pairCooldowns;
  state.training.xp = Number(refreshedState.xp || state.training.xp || 0);
  state.training.lastPersistedAt = refreshedState.persistedAt || state.training.lastPersistedAt;
  computeWfCalibration();
  if (refreshedState.persistedAt) {
    setText('trainPersistence', `Persistencia backend refrescada - ${new Date(refreshedState.persistedAt).toLocaleTimeString('es-CO')}`);
  }
  return true;
}

async function refreshTrainingStateAfterAtomicClose() {
  if (!trainingDemoWriterClient || typeof trainingDemoWriterClient.readTrainingDemoState !== 'function') {
    return { ok: false, reason: 'client_unavailable', warning: 'training-demo-state refresh unavailable' };
  }
  const refreshResult = await trainingDemoWriterClient.readTrainingDemoState();
  if (!refreshResult.ok) {
    if (refreshResult.warning) logEvent('WARN', refreshResult.warning);
    return refreshResult;
  }
  applyBackendTrainingStateRefresh(refreshResult.state);
  logEvent('OK', 'Training backend writer: estado refrescado desde backend');
  return refreshResult;
}

async function loadTrainingState() {
  try {
    const saved = await window.quant.trainingStateRead();
    if (!saved) return;
    state.training.balance = Number(saved.balance || state.training.balanceStart);
    state.training.positions = Array.isArray(saved.positions) ? saved.positions : [];
    state.training.closedTrades = Array.isArray(saved.closedTrades) ? saved.closedTrades : [];
    state.training.lessons = Array.isArray(saved.lessons) ? saved.lessons : [];
    state.training.strategyStats = saved.strategyStats || state.training.strategyStats || {};
    state.training.pairCooldowns = saved.pairCooldowns || {};
    state.training.xp = Number(saved.xp || 0);
    state.training.lastPersistedAt = saved.persistedAt || null;
    setText('trainPersistence', `Persistencia local activa${saved.persistedAt ? ` - restaurado ${new Date(saved.persistedAt).toLocaleString('es-CO')}` : ''}`);
    computeWfCalibration();  // recompute OOS walk-forward after loading trades
    logEvent('OK', 'Training: estado persistente restaurado');
  } catch (err) {
    logEvent('WARN', `Training persistencia: ${err.message}`);
  }
}

async function saveTrainingState() {
  try {
    const payload = {
      version: 2,
      mode: 'training',
      simulated: true,
      blockRealExecution: true,
      balanceStart: state.training.balanceStart,
      balance: state.training.balance,
      positions: state.training.positions,
      closedTrades: state.training.closedTrades.slice(0, 200),
      lessons: state.training.lessons.slice(0, 300),
      strategyStats: state.training.strategyStats,
      pairCooldowns: state.training.pairCooldowns,
      xp: state.training.xp,
      targets: {
        total: state.training.targetOpenPositions,
        intraday: state.training.targetIntradayPositions,
        swing: state.training.targetSwingPositions
      },
      strategies: state.strategies,
      activePairs: state.training.activePairs.map((p) => ({ venue: p.venue, symbol: p.symbol, score: p.score, price: p.price }))
    };
    const res = await window.quant.trainingStateWrite(payload);
    state.training.lastPersistedAt = res.persistedAt;
    setText('trainPersistence', `Persistencia local activa - ${new Date(res.persistedAt).toLocaleTimeString('es-CO')}`);
    // Push al cloud de forma silenciosa para mantener sincronizado
    pushCloudData(true);
  } catch (err) {
    logEvent('WARN', `Training no pudo persistir: ${err.message}`);
  }
}

function trainingCandidates() {
  const out = [];
  const add = (venue, symbol) => {
    if (!symbol || out.some((p) => p.venue === venue && p.symbol === symbol)) return;
    out.push({ venue, symbol });
  };
  if (state.executionAdapters.mt5) {
    const mt5Preferred = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'AUDCAD', 'USDCAD', 'GBPJPY', 'EURJPY', 'NAS100', 'US30', 'SPX500', 'BTCUSD', 'ETHUSD'];
    mt5Preferred.filter((s) => state.mt5Symbols.includes(s)).forEach((s) => add('MT5', s));
    state.mt5Symbols.slice(0, 40).forEach((s) => add('MT5', s));
  }
  const binancePreferred = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'LINKUSDT'];
  binancePreferred.filter((s) => state.binanceSymbols.includes(s)).forEach((s) => add('BINANCE', s));
  state.binanceSymbols.filter((s) => s.endsWith('USDT')).slice(0, 20).forEach((s) => add('BINANCE', s));
  return out.slice(0, 80);
}

async function initTrainingMode(force = false) {
  if (state.training.initialized && !force) return;
  state.training.initialized = true;
  state.training.activePairs = [];
  setText('trainFeedState', 'Validando');
  renderTraining();
  if (state.executionAdapters.mt5 && !state.mt5Symbols.length) {
    const mt5 = await window.quant.mt5Symbols().catch((err) => ({ ok: false, symbols: [], error: err.message }));
    if (mt5.ok && mt5.symbols?.length) state.mt5Symbols = mt5.symbols;
  }
  const validated = [];
  for (const pair of trainingCandidates()) {
    if (validated.length >= state.training.maxPairs) break;
    const market = await fetchTrainingMarket(pair).catch((err) => ({ ok: false, error: err.message }));
    if (!market.ok) continue;
    validated.push({ ...pair, ...market, position: null, demoPnl: 0, trades: 0, wins: 0, lastLesson: 'Sin leccion aun.' });
  }
  const mt5 = validated.filter((p) => p.venue === 'MT5').sort((a, b) => b.score - a.score).slice(0, state.training.minMt5Pairs);
  const rest = validated.filter((p) => !mt5.some((m) => m.venue === p.venue && m.symbol === p.symbol)).sort((a, b) => b.score - a.score);
  state.training.activePairs = [...mt5, ...rest].slice(0, state.training.maxPairs);
  setText('trainFeedState', state.training.activePairs.length ? 'Activo' : 'Sin pares validos');
  logEvent(state.training.activePairs.length ? 'OK' : 'WARN', `Training: ${state.training.activePairs.length}/${state.training.maxPairs} pares reales validados para 20 modelos demo`);
  await window.quant.memoryWrite('observation', {
    type: 'training_pairs_validated',
    mode: 'training',
    simulated: true,
    blockRealExecution: true,
    pairs: state.training.activePairs.map((p) => ({ venue: p.venue, symbol: p.symbol, score: p.score, price: p.price }))
  });
  buildTrainingAdvice();
  await maintainTrainingExposure(state.training.activePairs, true);
  await saveTrainingState();
  renderTraining();
}

async function fetchTrainingMarket(pair) {
  let tickerData = null;
  let candles = [];
  let candlesM15 = [];
  let candlesH1 = [];
  let candlesH4 = [];
  let candlesD1 = [];
  let candlesW1 = [];
  if (pair.venue === 'BINANCE') {
    if (!state.binanceSymbols.includes(pair.symbol)) throw new Error('Par no existe en Binance Spot');
    tickerData = await window.quant.ticker(pair.symbol);
    const packs = await Promise.all([
      window.quant.klines(pair.symbol, '1m', 500),
      window.quant.klines(pair.symbol, '15m', 220),
      window.quant.klines(pair.symbol, '1h', 160),
      window.quant.klines(pair.symbol, '4h', 120),
      window.quant.klines(pair.symbol, '1d', 90),
      window.quant.klines(pair.symbol, '1w', 30)
    ]);
    candles = packs[0];
    candlesM15 = packs[1];
    candlesH1 = packs[2];
    candlesH4 = packs[3];
    candlesD1 = packs[4];
    candlesW1 = packs[5];
  } else if (pair.venue === 'MT5') {
    if (!state.mt5Symbols.includes(pair.symbol)) throw new Error('Simbolo no existe en MT5 visible');
    const [data, m15, h1, h4, d1, w1] = await Promise.all([
      window.quant.mt5Rates(pair.symbol, 'M1', 500),
      window.quant.mt5Rates(pair.symbol, 'M15', 220),
      window.quant.mt5Rates(pair.symbol, 'H1', 160),
      window.quant.mt5Rates(pair.symbol, 'H4', 120),
      window.quant.mt5Rates(pair.symbol, 'D1', 90),
      window.quant.mt5Rates(pair.symbol, 'W1', 30)
    ]);
    if (!data.ok) throw new Error(data.error || 'MT5 no devolvio datos');
    tickerData = data.ticker;
    candles = data.candles || [];
    candlesM15 = m15.ok ? (m15.candles || []) : [];
    candlesH1 = h1.ok ? (h1.candles || []) : [];
    candlesH4 = h4.ok ? (h4.candles || []) : [];
    candlesD1 = d1.ok ? (d1.candles || []) : [];
    candlesW1 = w1.ok ? (w1.candles || []) : [];
  } else {
    throw new Error('Venue no soportado');
  }
  if (!tickerData || !Number.isFinite(tickerData.price) || tickerData.price <= 0 || candles.length < 30) throw new Error('Feed real insuficiente');
  const indicators = trainingIndicators(candles, candlesM15, candlesH1, candlesH4, candlesD1, candlesW1);
  const spreadPct = tickerData.price ? Number(tickerData.spread || 0) / tickerData.price : 0;
  const spreadQuality = pair.venue === 'MT5' ? Math.max(0, 1 - spreadPct * 900) : Math.max(0, 1 - spreadPct * 1800);
  const volumeScore = pair.venue === 'BINANCE'
    ? Math.min(1, Number(tickerData.quoteVolume || 0) / 50000000)
    : Math.min(1, indicators.volumeRatio / 2);
  const score = Math.round(100 * (
    volumeScore * .28 +
    spreadQuality * .22 +
    Math.min(1, indicators.atrPct / .01) * .16 +
    indicators.signalQuality * .24 +
    indicators.htfAlignmentScore * .06 +
    indicators.ictCrt.score / 100 * .08 +
    (indicators.primaryStrategy?.score || 0) / 100 * .12 +
    (state.training.lessons.some((l) => l.symbol === pair.symbol && l.outcome === 'win') ? .1 : .04)
  ));
  const macro = macroRiskLevel(pair.symbol);
  if (macro.risk === 'high') indicators.confidence = Math.max(20, indicators.confidence - 14);
  else if (macro.risk === 'medium') indicators.confidence = Math.max(20, indicators.confidence - 7);
  indicators.macroRisk = macro.risk;
  indicators.macroReasons = macro.reasons;
  indicators.macroContext = currentNewsContext(pair.symbol);
  return { ok: true, ticker: tickerData, candles, candlesM15, candlesH1, candlesH4, candlesD1, candlesW1, price: tickerData.price, spreadPct, indicators, score: macro.risk === 'high' ? Math.max(0, score - 12) : macro.risk === 'medium' ? Math.max(0, score - 6) : score };
}

function trainingIndicators(candles, candlesM15 = [], candlesH1 = [], candlesH4 = [], candlesD1 = [], candlesW1 = []) {
  const data = candles.slice(-60);
  const closes = data.map((c) => c.close);
  const last = data[data.length - 1];
  const prev = data[data.length - 10] || data[0];
  const ranges = data.slice(-20).map((c) => c.high - c.low);
  const avgRange = ranges.reduce((a, b) => a + b, 0) / Math.max(1, ranges.length);
  const volAvg = data.slice(-20).reduce((s, c) => s + Number(c.volume || 0), 0) / 20;
  const momentum = last.close - prev.close;
  const volatilityPct = avgRange / Math.max(last.close, 1e-12);
  const volumeRatio = Number(last.volume || 0) / Math.max(volAvg, 1e-12);
  const all = computeIndicators(candles);
  const current = all[all.length - 1] || {};
  const rsi = rsiLast(closes, 14);
  const macd = macdLast(closes);
  const m15 = timeframeBias(candlesM15);
  const h1 = timeframeBias(candlesH1);
  const h4 = timeframeBias(candlesH4);
  const d1 = timeframeBias(candlesD1);
  const atr = atrLast(candles, 14);
  const atrPct = atr / Math.max(last.close, 1e-12);
  const m1Bias = momentum > avgRange * .7 && last.close > current.baseline && macd.hist > 0 ? 'LONG' : momentum < -avgRange * .7 && last.close < current.baseline && macd.hist < 0 ? 'SHORT' : 'NEUTRAL';
  const alignedLong = m1Bias === 'LONG' && m15.bias !== 'SHORT' && h1.bias !== 'SHORT';
  const alignedShort = m1Bias === 'SHORT' && m15.bias !== 'LONG' && h1.bias !== 'LONG';
  const bias = alignedLong ? 'LONG' : alignedShort ? 'SHORT' : 'NEUTRAL';
  const htfAlignmentScore = bias === 'NEUTRAL' ? 0 : [m15.bias, h1.bias].filter((x) => x === bias).length / 2;
  const patternScore = detectTrainingPattern(candles, current, rsi, macd, bias);
  const ictCrt = ictCrtScore({ candles, candlesM15, candlesH1, candlesH4, candlesD1, candlesW1, bias, current, volumeRatio });
  const strategyScores = scoreStrategyPortfolio({ candles, candlesM15, candlesH1, candlesH4, candlesD1, candlesW1, current, rsi, macd, atr, atrPct, m15, h1, h4, d1, momentum, avgRange, volumeRatio, volatilityPct, baseline: current.baseline || last.close, ictCrt });
  const primaryStrategy = pickPrimaryStrategy(strategyScores, bias);
  const strategyBias = primaryStrategy.bias !== 'NEUTRAL' ? primaryStrategy.bias : bias;
  const finalBias = strategyBias !== 'NEUTRAL' ? strategyBias : bias;
  const signalQuality = Math.min(1, Math.abs(momentum) / Math.max(avgRange * 4, 1e-12) * .26 + (volumeRatio > 1.2 ? .14 : 0) + htfAlignmentScore * .2 + patternScore * .16 + primaryStrategy.score / 100 * .28);
  const confidence = Math.round(Math.max(25, Math.min(97, 38 + signalQuality * 34 + (volumeRatio > 1.5 ? 5 : 0) + ictCrt.score * .08 + primaryStrategy.score * .18)));
  const setup = finalBias === 'LONG'
    ? `SSL Hybrid bullish + ${m15.bias}/M15 + ${h1.bias}/H1 + ${patternScore > .55 ? 'pattern confirmation' : 'trend continuation'}`
    : finalBias === 'SHORT'
      ? `SSL Hybrid bearish + ${m15.bias}/M15 + ${h1.bias}/H1 + ${patternScore > .55 ? 'pattern confirmation' : 'trend continuation'}`
      : 'Range / no directional edge';
  const strategySuffix = ictCrt.score >= 80 ? ` + ICT/CRT ${ictCrt.score}` : ` + ICT/CRT watch ${ictCrt.score}`;
  const horizon = h1.bias === finalBias && m15.bias === finalBias && confidence >= 78 ? 'swing' : 'intraday';
  return { bias: finalBias, confidence, setup: `${primaryStrategy.name}: ${setup}${strategySuffix}`, momentum, volatilityPct, volumeRatio, baseline: current.baseline || last.close, rsi, macd, atr, atrPct, m15, h1, h4, d1, htfAlignmentScore, patternScore, ictCrt, strategyScores, primaryStrategy, horizon };
}

function scoreStrategyPortfolio(ctx) {
  const ict = {
    id: 'ictCrt',
    name: state.strategies.ictCrt.name,
    bias: ctx.ictCrt.weeklyBias && ctx.ictCrt.weeklyBias !== 'NEUTRAL' ? ctx.ictCrt.weeklyBias : directionalFromTimeframes(ctx),
    score: ctx.ictCrt.score,
    reason: `CRT ${ctx.ictCrt.weeklyBias}; liquidity=${ctx.ictCrt.liquidity?.swept ? 'sweep' : 'none'}; displacement=${ctx.ictCrt.displacement.toFixed(2)}`
  };
  const trend = scoreTrendMomentum(ctx);
  const breakout = scoreBreakoutRetest(ctx);
  const mean = scoreMeanReversion(ctx);
  const pullback = scoreVolumePullback(ctx);
  return [ict, trend, breakout, mean, pullback].map((s) => ({ ...s, score: Math.round(Math.max(0, Math.min(100, s.score || 0))) }));
}

function directionalFromTimeframes(ctx) {
  const votes = [ctx.m15?.bias, ctx.h1?.bias, ctx.h4?.bias].filter((x) => x && x !== 'NEUTRAL');
  const longs = votes.filter((x) => x === 'LONG').length;
  const shorts = votes.filter((x) => x === 'SHORT').length;
  return longs > shorts ? 'LONG' : shorts > longs ? 'SHORT' : 'NEUTRAL';
}

function pickPrimaryStrategy(scores, fallbackBias = 'NEUTRAL') {
  const ranked = [...scores].sort((a, b) => b.score - a.score);
  const bestDirectional = ranked.find((s) => s.bias !== 'NEUTRAL' && s.score >= 55) || ranked[0] || { id: 'none', name: 'Sin edge', bias: fallbackBias, score: 0, reason: 'Sin estrategia dominante' };
  return { ...bestDirectional, bias: bestDirectional.bias !== 'NEUTRAL' ? bestDirectional.bias : fallbackBias };
}

function scoreTrendMomentum(ctx) {
  const bias = directionalFromTimeframes(ctx);
  if (bias === 'NEUTRAL') return { id: 'trendMomentum', name: state.strategies.trendMomentum.name, bias, score: 25, reason: 'M15/H1/H4 sin acuerdo direccional' };
  const macdOk = bias === 'LONG' ? ctx.macd.hist > 0 : ctx.macd.hist < 0;
  const momentumOk = bias === 'LONG' ? ctx.momentum > 0 : ctx.momentum < 0;
  const rsiOk = bias === 'LONG' ? ctx.rsi > 48 && ctx.rsi < 78 : ctx.rsi < 52 && ctx.rsi > 22;
  const score = 34 + (ctx.m15.bias === bias ? 14 : 0) + (ctx.h1.bias === bias ? 18 : 0) + (ctx.h4.bias === bias ? 12 : 0) + (macdOk ? 12 : 0) + (momentumOk ? 8 : 0) + (rsiOk ? 8 : -8) + Math.min(10, ctx.atrPct * 1200);
  return { id: 'trendMomentum', name: state.strategies.trendMomentum.name, bias, score, reason: `EMA slope ${bias}; MACD ${macdOk ? 'aligned' : 'weak'}; RSI ${ctx.rsi.toFixed(1)}` };
}

function scoreBreakoutRetest(ctx) {
  const data = ctx.candles.slice(-32);
  if (data.length < 25) return { id: 'breakoutRetest', name: state.strategies.breakoutRetest.name, bias: 'NEUTRAL', score: 0, reason: 'Insufficient range data' };
  const last = data[data.length - 1];
  const range = data.slice(0, -1);
  const hi = Math.max(...range.map((c) => c.high));
  const lo = Math.min(...range.map((c) => c.low));
  const rangeSize = Math.max(hi - lo, 1e-12);
  const longBreak = last.close > hi && (last.close - hi) < rangeSize * .45;
  const shortBreak = last.close < lo && (lo - last.close) < rangeSize * .45;
  const bias = longBreak ? 'LONG' : shortBreak ? 'SHORT' : 'NEUTRAL';
  const volBonus = ctx.volumeRatio > 1.25 ? 20 : ctx.volumeRatio > 1 ? 10 : 0;
  const expansion = Math.min(20, Math.abs(last.close - last.open) / rangeSize * 60);
  const score = bias === 'NEUTRAL' ? 18 : 48 + volBonus + expansion + (ctx.h1.bias === bias ? 12 : 0);
  return { id: 'breakoutRetest', name: state.strategies.breakoutRetest.name, bias, score, reason: bias === 'NEUTRAL' ? 'No clean range break' : `Break ${bias} of ${bias === 'LONG' ? fmtPrice(hi) : fmtPrice(lo)} with volume x${ctx.volumeRatio.toFixed(2)}` };
}

function scoreMeanReversion(ctx) {
  const distance = (ctx.candles.at(-1).close - ctx.baseline) / Math.max(ctx.atr, 1e-12);
  const longStretch = ctx.rsi < 32 && distance < -1.2;
  const shortStretch = ctx.rsi > 68 && distance > 1.2;
  const bias = longStretch ? 'LONG' : shortStretch ? 'SHORT' : 'NEUTRAL';
  const weakTrend = [ctx.m15.bias, ctx.h1.bias].filter((x) => x !== 'NEUTRAL').length <= 1;
  const score = bias === 'NEUTRAL' ? 20 : 48 + Math.min(22, Math.abs(distance) * 8) + (weakTrend ? 18 : -10) + (ctx.volumeRatio < 1.8 ? 8 : 0);
  return { id: 'meanReversion', name: state.strategies.meanReversion.name, bias, score, reason: bias === 'NEUTRAL' ? 'No RSI/ATR stretch' : `RSI ${ctx.rsi.toFixed(1)}; distance ${distance.toFixed(2)} ATR; weakTrend=${weakTrend}` };
}

function scoreVolumePullback(ctx) {
  const bias = ctx.h1.bias !== 'NEUTRAL' ? ctx.h1.bias : ctx.m15.bias;
  if (bias === 'NEUTRAL') return { id: 'volumePullback', name: state.strategies.volumePullback.name, bias, score: 18, reason: 'No parent trend' };
  const last = ctx.candles.at(-1);
  const nearBaseline = Math.abs(last.close - ctx.baseline) <= Math.max(ctx.atr * .75, last.close * .002);
  const closeWithTrend = bias === 'LONG' ? last.close > last.open : last.close < last.open;
  const score = 35 + (nearBaseline ? 20 : 0) + (closeWithTrend ? 18 : 0) + (ctx.volumeRatio > 1.05 ? 14 : 0) + (ctx.m15.bias === bias ? 10 : 0) + (ctx.macd.hist * (bias === 'LONG' ? 1 : -1) > 0 ? 8 : 0);
  return { id: 'volumePullback', name: state.strategies.volumePullback.name, bias, score, reason: `Trend ${bias}; pullback=${nearBaseline}; volume x${ctx.volumeRatio.toFixed(2)}` };
}

function atrLast(candles, period = 14) {
  const data = candles.slice(-period - 1);
  if (data.length < 2) return 0;
  const trs = [];
  for (let i = 1; i < data.length; i++) {
    const prevClose = data[i - 1].close;
    trs.push(Math.max(data[i].high - data[i].low, Math.abs(data[i].high - prevClose), Math.abs(data[i].low - prevClose)));
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function rsiLast(values, period = 14) {
  if (values.length <= period) return 50;
  let gains = 0, losses = 0;
  const data = values.slice(-period - 1);
  for (let i = 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const rs = gains / Math.max(losses, 1e-12);
  return 100 - (100 / (1 + rs));
}

function macdLast(values) {
  if (values.length < 35) return { macd: 0, signal: 0, hist: 0 };
  const fast = emaSeries(values, 12);
  const slow = emaSeries(values, 26);
  const macd = fast.map((v, i) => v - slow[i]);
  const signal = emaSeries(macd, 9);
  const last = macd.length - 1;
  return { macd: macd[last], signal: signal[last], hist: macd[last] - signal[last] };
}

function timeframeBias(candles) {
  if (!candles || candles.length < 30) return { bias: 'NEUTRAL', slope: 0 };
  const closes = candles.map((c) => c.close);
  const ema21 = emaSeries(closes, 21);
  const ema50 = emaSeries(closes, 50);
  const last = closes.length - 1;
  const slope = ema21[last] - ema21[Math.max(0, last - 8)];
  const atr = atrLast(candles, 14);
  const bias = closes[last] > ema50[last] && slope > atr * .12 ? 'LONG' : closes[last] < ema50[last] && slope < -atr * .12 ? 'SHORT' : 'NEUTRAL';
  return { bias, slope, ema21: ema21[last], ema50: ema50[last] };
}

function detectTrainingPattern(candles, current, rsi, macd, bias) {
  const data = candles.slice(-5);
  if (data.length < 5 || bias === 'NEUTRAL') return 0;
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const body = Math.abs(last.close - last.open);
  const range = Math.max(last.high - last.low, 1e-12);
  const closeNearHigh = (last.high - last.close) / range < .25;
  const closeNearLow = (last.close - last.low) / range < .25;
  const engulfBull = last.close > last.open && prev.close < prev.open && last.close > prev.open && last.open < prev.close;
  const engulfBear = last.close < last.open && prev.close > prev.open && last.open > prev.close && last.close < prev.open;
  const strongBody = body / range > .55;
  let score = 0;
  if (bias === 'LONG') {
    if (last.close > current.baseline) score += .22;
    if (closeNearHigh && strongBody) score += .22;
    if (engulfBull) score += .18;
    if (rsi > 48 && rsi < 72) score += .18;
    if (macd.hist > 0) score += .2;
  } else {
    if (last.close < current.baseline) score += .22;
    if (closeNearLow && strongBody) score += .22;
    if (engulfBear) score += .18;
    if (rsi < 52 && rsi > 28) score += .18;
    if (macd.hist < 0) score += .2;
  }
  return Math.min(1, score);
}

// ── Full data push: training + memoria + conversaciones → cloud ───────────────
async function pushCloudData(silent = true) {
  if (!window.quant.pushCloudData) return;
  try {
    const res = await window.quant.pushCloudData();
    if (!silent) logEvent('OK', `Cloud sync: training=${res?.results?.trainingState ? '✓' : '-'}, mem=${res?.results?.memories ?? '-'}, conv=${res?.results?.conversations ?? '-'}`);
  } catch (err) {
    if (!silent) logEvent('WARN', `pushCloudData: ${err.message}`);
  }
}

// ── MT5 Sync desktop → cloud ──────────────────────────────────────────────────
// manual=true → pasa {manual:true} al backend para que use mt5.login() completo
// manual=false → modo pasivo: solo lee cuenta activa, NO reconecta al broker
async function syncMt5ToCloud(manual = false) {
  if (!window.quant.syncMt5) return;
  try {
    const res = await window.quant.syncMt5(manual);
    state.syncStatus = { lastSync: new Date().toISOString(), ok: res?.ok ?? false, pushed: res?.pushed ?? false };
    updateSyncIndicator();
    if (manual && res?.ok) logEvent('OK', `MT5 sincronizado con cloud${res.pushed ? ' ✓ push exitoso' : ' (local)'}`);
  } catch (err) {
    state.syncStatus = { lastSync: new Date().toISOString(), ok: false, pushed: false };
    updateSyncIndicator();
    if (manual) logEvent('WARN', `syncMt5: ${err.message}`);
  }
}

function updateSyncIndicator() {
  const el = $('syncStatusBadge');
  if (!el) return;
  const s = state.syncStatus;
  if (!s.lastSync) { el.textContent = ''; return; }
  const ago  = Math.round((Date.now() - new Date(s.lastSync)) / 1000);
  const time = ago < 60 ? `${ago}s` : `${Math.round(ago / 60)}m`;
  el.textContent  = s.ok && s.pushed ? `↑ MT5 cloud ${time}` : s.ok ? `↑ MT5 local ${time}` : `↑ MT5 error`;
  el.style.color  = s.ok && s.pushed ? '#4caf7d' : s.ok ? '#8fa3c0' : '#e09a3a';
  el.title = s.pushed ? `Datos MT5 enviados al cloud hace ${time}` : 'QUANT_SYNC_URL no configurado — sync solo local';
}

// ── Calibración nocturna (Mejora 7) ──────────────────────────────────────────
// Pide al backend que recalcule live_wr / hist_wr desde el JSONL completo y
// persista a calibration.json. Se aplica al score ICT/CRT como segundo factor.
async function runNightCalibration() {
  try {
    const cal = await window.quant.calibrationCompute();
    state.nightCalibration = cal;
    if (cal?.ok) logEvent('OK', `Calibración nocturna: ${cal.label}`);
    else logEvent('WARN', `Calibración nocturna: ${cal?.reason || 'sin datos suficientes'}`);
  } catch (err) {
    logEvent('WARN', `Calibración nocturna: ${err.message}`);
  }
}

// ── Walk-Forward OOS Calibration (Mejora 6) ─────────────────────────────────
// Splits closedTrades 70/30 (IS / OOS), computes win rates and stores a
// calibration ratio that scales the live ICT/CRT score up or down.
function computeWfCalibration() {
  const trades = state.training.closedTrades;
  const n = trades.length;
  if (n < 10) {
    state.wfCalibration = { isWr: null, oosWr: null, ratio: 1, n, label: `Insuficiente (${n}/10)` };
    return;
  }
  const splitIdx = Math.floor(n * 0.7);
  const isTrades  = trades.slice(0, splitIdx);
  const oosTrades = trades.slice(splitIdx);
  const winRate = (arr) => arr.length ? arr.filter((t) => Number(t.pnl_demo || 0) >= 0).length / arr.length : null;
  const isWr  = winRate(isTrades);
  const oosWr = winRate(oosTrades);
  // ratio: how well OOS matches IS; cap between 0.60 and 1.30 to avoid extremes
  const raw = (isWr > 0) ? oosWr / isWr : 1;
  const ratio = Math.max(0.60, Math.min(1.30, raw));
  const label = `OOS ${(oosWr * 100).toFixed(0)}% vs IS ${(isWr * 100).toFixed(0)}% → ×${ratio.toFixed(2)}`;
  state.wfCalibration = { isWr, oosWr, ratio, n, label };
}

function ictCrtScore(ctx) {
  const { candles, candlesM15, candlesH1, candlesH4, candlesD1, candlesW1, bias, volumeRatio } = ctx;
  const weekly = crtWeeklyBias(candlesW1);
  const htfAligned = bias !== 'NEUTRAL' && weekly.bias !== 'NEUTRAL' && [weekly.bias, timeframeBias(candlesD1).bias, timeframeBias(candlesH4).bias].filter((x) => x === bias).length >= 2;
  const liquidity = liquiditySweep(candlesH1.length ? candlesH1 : candles);
  const displacement = displacementScore(candlesM15.length ? candlesM15 : candles);
  const structure = structureConfirmation(candlesM15.length ? candlesM15 : candles, bias);
  const session = sessionTimingScore();
  const entryContext = fvgOrOrderBlockProxy(candles, bias);
  let score = 0;
  if (htfAligned) score += 20;
  if (liquidity.swept && (liquidity.bias === bias || bias === 'NEUTRAL')) score += 20;
  if (displacement >= .7 || volumeRatio > 1.25) score += 20;
  if (structure) score += 20;
  if (session >= .8) score += 20;
  if (entryContext) score = Math.min(100, score + 8);
  // Calibración combinada: WF-OOS (Mejora 6) × nocturna live/hist (Mejora 7)
  const wfRatio    = state.wfCalibration?.ratio ?? 1;
  const nightRatio = state.nightCalibration?.ratio ?? 1;
  const combinedRatio = Math.max(0.5, Math.min(1.3, wfRatio * nightRatio));
  const rawScore   = Math.round(Math.min(100, score));
  const calibScore = Math.round(Math.max(0, Math.min(100, rawScore * combinedRatio)));
  return {
    score: calibScore,
    rawScore,
    wfRatio,
    nightRatio,
    combinedRatio,
    wfLabel: state.wfCalibration?.label ?? '',
    nightLabel: state.nightCalibration?.label ?? '',
    weeklyBias: weekly.bias,
    htfAligned,
    liquidity,
    displacement,
    structure,
    session,
    entryContext,
    rules: state.strategies.ictCrt.rules
  };
}

function crtWeeklyBias(candlesW1) {
  if (!candlesW1 || candlesW1.length < 3) return { bias: 'NEUTRAL', reason: 'Sin velas semanales suficientes' };
  const prev = candlesW1[candlesW1.length - 2];
  const cur = candlesW1[candlesW1.length - 1];
  if (cur.low < prev.low && cur.close > prev.low && cur.close < prev.high) return { bias: 'LONG', reason: 'Barre minimo semanal previo y cierra dentro del rango' };
  if (cur.high > prev.high && cur.close < prev.high && cur.close > prev.low) return { bias: 'SHORT', reason: 'Barre maximo semanal previo y cierra dentro del rango' };
  return { bias: 'NEUTRAL', reason: 'Sin sweep CRT semanal' };
}

function liquiditySweep(candles) {
  const data = candles.slice(-24);
  if (data.length < 8) return { swept: false, bias: 'NEUTRAL' };
  const last = data[data.length - 1];
  const prior = data.slice(0, -1);
  const minLow = Math.min(...prior.map((c) => c.low));
  const maxHigh = Math.max(...prior.map((c) => c.high));
  if (last.low < minLow && last.close > minLow) return { swept: true, bias: 'LONG', level: minLow };
  if (last.high > maxHigh && last.close < maxHigh) return { swept: true, bias: 'SHORT', level: maxHigh };
  return { swept: false, bias: 'NEUTRAL' };
}

function displacementScore(candles) {
  const data = candles.slice(-20);
  if (data.length < 8) return 0;
  const last = data[data.length - 1];
  const avg = data.slice(0, -1).reduce((s, c) => s + Math.abs(c.close - c.open), 0) / Math.max(1, data.length - 1);
  return Math.min(1, Math.abs(last.close - last.open) / Math.max(avg * 2.2, 1e-12));
}

function structureConfirmation(candles, bias) {
  const data = candles.slice(-12);
  if (data.length < 6 || bias === 'NEUTRAL') return false;
  const prev = data.slice(0, -3);
  const recent = data.slice(-3);
  return bias === 'LONG'
    ? Math.max(...recent.map((c) => c.high)) > Math.max(...prev.map((c) => c.high))
    : Math.min(...recent.map((c) => c.low)) < Math.min(...prev.map((c) => c.low));
}

function fvgOrOrderBlockProxy(candles, bias) {
  const data = candles.slice(-5);
  if (data.length < 3 || bias === 'NEUTRAL') return false;
  const a = data[data.length - 3], c = data[data.length - 1];
  if (bias === 'LONG') return c.low > a.high;
  return c.high < a.low;
}

function sessionTimingScore() {
  const h = new Date().getHours();
  if ((h >= 2 && h <= 5) || (h >= 8 && h <= 11)) return 1;
  if (h >= 12 && h <= 14) return .6;
  return .25;
}

async function refreshTrainingMode() {
  if (!state.training.initialized || state.training.refreshing || !state.training.activePairs.length) return;
  state.training.refreshing = true;
  try {
    const refreshed = [];
    for (const pair of state.training.activePairs) {
      const market = await fetchTrainingMarket(pair).catch((err) => ({ ok: false, error: err.message }));
      if (!market.ok) {
        refreshed.push({ ...pair, feed: 'ERROR', error: market.error });
        continue;
      }
      const updated = { ...pair, ...market, feed: 'OK' };
      await evaluateTrainingPair(updated);
      refreshed.push(updated);
    }
    state.training.activePairs = refreshed.filter((p) => p.feed !== 'ERROR').slice(0, state.training.maxPairs);
    if (state.training.activePairs.length < state.training.maxPairs) await initTrainingMode(true);
    await maintainTrainingExposure(state.training.activePairs, false);
    buildTrainingAdvice();
    setText('trainingUpdated', nowTime());
    await saveTrainingState();
    renderTraining();
  } finally {
    state.training.refreshing = false;
  }
}

async function maintainTrainingExposure(pairs, initial = false) {
  const open = state.training.positions.filter((p) => !p.exit_price);
  const intradayNeeded = Math.max(0, state.training.targetIntradayPositions - open.filter((p) => p.horizon !== 'swing').length);
  const swingNeeded = Math.max(0, state.training.targetSwingPositions - open.filter((p) => p.horizon === 'swing').length);
  if (!intradayNeeded && !swingNeeded) return;
  const mt5Open = open.filter((p) => p.venue === 'MT5').length;
  const ranked = [...pairs]
    .filter((p) => Number(p.price) > 0 && p.feed !== 'ERROR')
    .sort((a, b) => {
      const mt5NeedA = a.venue === 'MT5' && mt5Open < state.training.minMt5OpenPositions ? 30 : 0;
      const mt5NeedB = b.venue === 'MT5' && mt5Open < state.training.minMt5OpenPositions ? 30 : 0;
      return (b.score + mt5NeedB) - (a.score + mt5NeedA);
    });
  let opened = 0;
  opened += await openTrainingBucket(ranked, 'intraday', intradayNeeded, initial);
  opened += await openTrainingBucket(ranked, 'swing', swingNeeded, initial);
  if (opened) {
    logEvent('OK', `Training: ${opened} operaciones demo abiertas para aprendizaje continuo`);
    await saveTrainingState();
  }
}

async function openTrainingBucket(ranked, horizon, needed, initial) {
  let opened = 0;
  for (const pair of ranked) {
    if (opened >= needed) break;
    if (state.training.positions.some((x) => x.venue === pair.venue && x.symbol === pair.symbol && x.horizon === horizon && !x.exit_price)) continue;
    const key = `${pair.venue}:${pair.symbol}:${horizon}`;
    const cooldownUntil = Number(state.training.pairCooldowns[key] || 0);
    const cooling = !initial && Date.now() < cooldownUntil;
    const signal = trainingHypothesisSignal(pair, horizon);
    if (!signal) continue;
    if (cooling) signal.motivo = `${signal.motivo}; reapertura inmediata por cupo objetivo de Training`;
    const trade = await executeSimulatedTrade('OPEN', pair, signal);
    state.training.positions.push(trade);
    opened += 1;
    await window.quant.memoryWrite('trade', { ...trade, type: 'training_trade_open', mode: 'training', exposure_engine: true });
  }
  return opened;
}

function stableTraceHash(input) {
  const text = String(input || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function trainingSignalId(pair = {}, signal = {}, createdAt = '') {
  const primary = signal.primaryStrategy || {};
  const strategyId = signal.strategy_id || primary.id || 'unknown';
  return `sig_${stableTraceHash([
    'training',
    pair.venue || 'unknown',
    pair.symbol || 'unknown',
    signal.bias || 'NEUTRAL',
    signal.horizon || 'intraday',
    strategyId,
    createdAt
  ].join('|'))}`;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildTrainingTraceMetadata(pair = {}, signal = {}, options = {}) {
  const createdAt = options.createdAt || signal.created_at || new Date().toISOString();
  const primary = signal.primaryStrategy || {};
  const strategyId = signal.strategy_id || primary.id || null;
  const strategyName = signal.strategy_name || primary.name || null;
  const learningMode = signal.learning_mode || null;
  const professional = learningMode === 'professional_setup';
  const entryReason = signal.entry_reason_code || (learningMode ? (professional ? 'professional_setup' : 'exploration_paper') : null);

  return {
    traceability_version: 1,
    signal_id: signal.signal_id || trainingSignalId(pair, { ...signal, strategy_id: strategyId }, createdAt),
    strategy_id: strategyId,
    strategy_name: strategyName,
    timeframe: signal.timeframe || signal.tf || null,
    horizon: signal.horizon || options.horizon || null,
    session: signal.session || null,
    entry_reason_code: entryReason,
    exit_reason_code: signal.exit_reason_code || null,
    risk_profile_id: signal.risk_profile_id || null,
    source: options.source || signal.source || 'renderer.training',
    confidence_at_entry: nullableNumber(signal.confidence),
    regime_at_entry: signal.regime_at_entry || signal.regime?.type || null,
    volatility_at_entry: nullableNumber(signal.volatilityPct),
    created_at: createdAt,
    opened_at: options.openedAt || createdAt
  };
}

function trainingHypothesisSignal(pair, forcedHorizon = null) {
  const signal = pair.indicators || {};
  const professional =
    signal.bias !== 'NEUTRAL' &&
    signal.confidence >= 70 &&
    signal.htfAlignmentScore >= .5 &&
    signal.patternScore >= .35;
  let bias = signal.bias;
  let reason = signal.setup || 'Hipotesis de mercado real';
  let confidence = Number(signal.confidence || 50);
  let horizon = forcedHorizon || signal.horizon || 'intraday';
  let learningMode = professional ? 'professional_setup' : 'exploration_paper';
  if (bias === 'NEUTRAL') {
    if (signal.h1?.bias && signal.h1.bias !== 'NEUTRAL') bias = signal.h1.bias;
    else if (signal.m15?.bias && signal.m15.bias !== 'NEUTRAL') bias = signal.m15.bias;
    else if (Number(signal.macd?.hist || 0) > 0) bias = 'LONG';
    else if (Number(signal.macd?.hist || 0) < 0) bias = 'SHORT';
    else bias = Number(signal.rsi || 50) <= 50 ? 'LONG' : 'SHORT';
    reason = `Exploracion paper con sesgo inferido (${bias}) usando M15 ${signal.m15?.bias || 'NA'}, H1 ${signal.h1?.bias || 'NA'}, RSI ${Number(signal.rsi || 50).toFixed(1)}, MACD ${Number(signal.macd?.hist || 0).toPrecision(3)}`;
    confidence = Math.max(52, Math.min(68, confidence));
    horizon = forcedHorizon || (signal.h1?.bias === bias || pair.venue === 'MT5' ? 'swing' : 'intraday');
  }
  if (pair.spreadPct > (pair.venue === 'MT5' ? .004 : .0025)) return null;
  const tracedSignal = {
    ...signal,
    bias,
    confidence,
    horizon,
    setup: professional ? reason : reason,
    learning_mode: learningMode,
    motivo: professional ? 'Setup tecnico validado' : 'Exploracion controlada para aprendizaje continuo'
  };
  return {
    ...tracedSignal,
    ...buildTrainingTraceMetadata(pair, tracedSignal, { source: 'renderer.training.signal' })
  };
}

function executeRealTrade() {
  if (state.training.mode === 'training') {
    throw new Error('Real execution blocked: Training Mode solo puede usar executeSimulatedTrade().');
  }
  throw new Error('executeRealTrade no esta habilitado en esta fase.');
}

async function executeSimulatedTrade(action, pair, signal, existing = null) {
  const mode = state.training.mode;
  let simulated = false;
  let blockRealExecution = false;
  if (mode === 'training') {
    simulated = true;
    blockRealExecution = true;
  }
  if (!simulated || !blockRealExecution) throw new Error('Training guard fallo: operacion simulada no confirmada.');
  const price = Number(pair.price);
  const horizon = signal.horizon || 'intraday';
  const learningMode = signal.learning_mode || 'professional_setup';
  const notionalBase = horizon === 'swing' ? (pair.venue === 'MT5' ? 1800 : 1400) : (pair.venue === 'MT5' ? 1200 : 950);
  const notional = learningMode === 'exploration_paper' ? notionalBase * 0.35 : notionalBase;
  const size = notional / Math.max(price, 1e-12);
  const fees = notional * 0.001;
  const spreadCost = notional * Math.max(pair.spreadPct || 0, 0);
  const slippage = notional * 0.00025;
  if (action === 'OPEN') {
    const openedAt = new Date().toISOString();
    const trace = buildTrainingTraceMetadata(pair, signal, { source: 'renderer.training.position', createdAt: signal.created_at || openedAt, openedAt });
    return {
      simulated,
      venue: pair.venue,
      symbol: pair.symbol,
      timestamp: openedAt,
      direction: signal.bias,
      entry_price: price,
      exit_price: null,
      size_demo: size,
      notional_demo: notional,
      pnl_demo: 0,
      fees_simuladas: fees,
      spread_estimado: spreadCost,
      slippage_estimado: slippage,
      confidence: signal.confidence,
      setup_tecnico_detectado: signal.setup,
      traceability_version: trace.traceability_version,
      signal_id: trace.signal_id,
      strategy_id: trace.strategy_id || signal.primaryStrategy?.id || signal.strategy_id || 'unknown',
      strategy_name: trace.strategy_name || signal.primaryStrategy?.name || signal.strategy_name || 'Estrategia no clasificada',
      strategy_score: Number(signal.primaryStrategy?.score || signal.strategy_score || 0),
      strategy_reason: signal.primaryStrategy?.reason || signal.strategy_reason || '',
      strategy_scores: signal.strategyScores || [],
      timeframe: trace.timeframe,
      session: trace.session,
      entry_reason_code: trace.entry_reason_code,
      risk_profile_id: trace.risk_profile_id,
      source: trace.source,
      opened_at: trace.opened_at,
      confidence_at_entry: trace.confidence_at_entry,
      regime_at_entry: trace.regime_at_entry,
      volatility_at_entry: trace.volatility_at_entry,
      learning_mode: learningMode,
      contexto_noticia_macro: currentNewsContext(pair.symbol),
      motivo_entrada: `${signal.motivo || 'Setup demo'}; ${signal.setup}; confianza ${signal.confidence}; volumen x${Number(signal.volumeRatio || 0).toFixed(2)}`,
      motivo_salida: null,
      lesson_learned: null,
      horizon,
      min_hold_ms: horizon === 'swing' ? 36 * 60 * 60000 : 90 * 60000,
      max_hold_ms: horizon === 'swing' ? 14 * 24 * 60 * 60000 : 12 * 60 * 60000,
      opened_tick: Date.now()
    };
  }
  if (!window.QuantTrainingClosure?.buildClosedTradeFromPosition) {
    throw new Error('Training closure service no esta disponible en renderer.');
  }
  return window.QuantTrainingClosure.buildClosedTradeFromPosition(existing, { price }, signal, {
    closedAt: new Date().toISOString(),
    lessonBuilder: (openPosition, exitContext, exitSignal, pnl) => buildTrainingLesson(openPosition, pair, exitSignal, pnl)
  });
}

async function evaluateTrainingPair(pair) {
  const signal = pair.indicators;
  const key = `${pair.venue}:${pair.symbol}:${signal.horizon || 'intraday'}`;
  const cooldownUntil = Number(state.training.pairCooldowns[key] || 0);
  const openForSignalHorizon = state.training.positions.find((p) => p.symbol === pair.symbol && p.venue === pair.venue && (p.horizon || 'intraday') === (signal.horizon || 'intraday') && !p.exit_price);
  const professionalGate =
    signal.bias !== 'NEUTRAL' &&
    signal.confidence >= 74 &&
    signal.htfAlignmentScore >= .5 &&
    signal.patternScore >= .45 &&
    signal.volumeRatio >= .85 &&
    pair.score >= 62 &&
    pair.spreadPct <= (pair.venue === 'MT5' ? .0022 : .0012);
  if (!openForSignalHorizon && Date.now() > cooldownUntil && professionalGate) {
    const trade = await executeSimulatedTrade('OPEN', pair, { ...signal, learning_mode: 'professional_setup', motivo: 'Setup tecnico validado por gate profesional' });
    state.training.positions.push(trade);
    await window.quant.memoryWrite('trade', { ...trade, type: 'training_trade_open', mode: 'training' });
    await saveTrainingState();
    return;
  }
  const openPositions = state.training.positions.filter((p) => p.symbol === pair.symbol && p.venue === pair.venue && !p.exit_price);
  for (const open of openPositions) {
    const directionFactor = open.direction === 'LONG' ? 1 : -1;
    const pnlPct = ((pair.price - open.entry_price) / open.entry_price) * directionFactor;
    const age = Date.now() - Number(open.opened_tick || Date.now());
    const minHold = Number(open.min_hold_ms || 4 * 60 * 60000);
    const maxHold = Number(open.max_hold_ms || 16 * 60 * 60000);
    const hardStop = pnlPct <= (open.horizon === 'swing' ? -0.018 : -0.009);
    const profitTarget = pnlPct >= (open.horizon === 'swing' ? 0.035 : 0.012);
    const signalExit = age >= minHold && (signal.bias !== open.direction || signal.confidence < 55);
    const timeExit = age >= maxHold;
    const protectContinuousTraining = state.training.positions.length <= Math.max(2, state.training.targetOpenPositions - 2);
    const shouldClose = hardStop || profitTarget || signalExit || timeExit;
    if (shouldClose && protectContinuousTraining && !hardStop) continue;
    if (!shouldClose) continue;
    const closed = await executeSimulatedTrade('CLOSE', pair, signal, open);
    const backendCloseResult = await shadowWriteTrainingClosedTrade(open, closed, pair, signal);
    if (backendCloseResult && backendCloseResult.acceptAtomic) {
      const accepted = await acceptBackendAtomicTrainingClose(open, pair, backendCloseResult);
      if (accepted) {
        await refreshTrainingStateAfterAtomicClose();
        continue;
      }
    }
    state.training.positions = state.training.positions.filter((p) => p !== open);
    state.training.closedTrades.unshift(closed);
    state.training.closedTrades = state.training.closedTrades.slice(0, 80);
    computeWfCalibration();   // recalibrate OOS ratio after each closed trade
    state.training.balance += closed.pnl_demo;
    state.training.xp += Math.max(4, Math.round(Math.abs(closed.pnl_demo) / 4) + (closed.pnl_demo >= 0 ? 14 : 8));
    state.training.pairCooldowns[`${pair.venue}:${pair.symbol}:${open.horizon || 'intraday'}`] = Date.now() + 30 * 1000;
    const lesson = closed.lesson_learned;
    state.training.lessons.unshift(lesson);
    state.training.lessons = state.training.lessons.slice(0, 160);
    await window.quant.memoryWrite('training_lesson', lesson);
    await window.quant.memoryWrite('trade', { ...closed, type: 'training_trade_closed', mode: 'training' });
    await saveTrainingState();
  }
}

function buildTrainingLesson(trade, pair, signal, pnl) {
  const pnlPercent = pnl / Math.max(trade.notional_demo, 1e-12) * 100;
  const outcome = pnl >= 0 ? 'win' : 'loss';
  const lesson = outcome === 'win'
    ? `El setup ${trade.setup_tecnico_detectado} en ${pair.symbol} funciono con volumen x${signal.volumeRatio.toFixed(2)} y spread ${(pair.spreadPct * 100).toFixed(4)}%.`
    : `El setup ${trade.setup_tecnico_detectado} en ${pair.symbol} fallo o perdio edge; conviene exigir alineacion multi-timeframe o mejor volumen.`;
  return {
    type: 'training_lesson',
    symbol: pair.symbol,
    venue: pair.venue,
    setup: trade.setup_tecnico_detectado,
    learning_mode: trade.learning_mode || 'professional_setup',
    strategy_id: trade.strategy_id || 'unknown',
    strategy_name: trade.strategy_name || 'Estrategia no clasificada',
    strategy_score: trade.strategy_score || 0,
    outcome,
    pnl_percent: Number(pnlPercent.toFixed(4)),
    trade_outcome: { entry: trade.entry_price, exit: pair.price, pnl_demo: pnl },
    condiciones_mercado: { spread_pct: pair.spreadPct, volatility_pct: signal.volatilityPct, volume_ratio: signal.volumeRatio },
    indicadores_entrada: { confidence: trade.confidence, setup: trade.setup_tecnico_detectado, strategy: trade.strategy_name, strategy_score: trade.strategy_score },
    indicadores_salida: { confidence: signal.confidence, bias: signal.bias, momentum: signal.momentum },
    noticia_evento_macro_relacionado: currentNewsContext(pair.symbol),
    patron_detectado: signal.setup,
    error: outcome === 'loss' ? 'Entrada demo con edge insuficiente o salida tardia.' : null,
    que_habria_mejorado: outcome === 'loss' ? 'Esperar confirmacion M15, menor spread o volumen superior al promedio.' : 'Mantener filtro de bajo spread y volumen relativo alto.',
    lesson,
    future_rule: `${outcome === 'win' ? 'Priorizar' : 'Filtrar'} ${trade.strategy_name || trade.direction} en ${pair.symbol} si M1 mantiene setup ${signal.setup} y volumen > promedio 20 velas.`,
    confidence_delta: outcome === 'win' ? 0.04 : -0.05
  };
}

function currentNewsContext(symbol) {
  const asset = symbol.replace(/USDT|USDC|USD|EUR|JPY|CAD|GBP|AUD|CHF|NZD/g, '');
  const macro = macroRiskLevel(symbol);
  const firstFinnhub = state.macroNews.finnhub.find((n) => JSON.stringify(n).toUpperCase().includes(asset.toUpperCase())) || state.macroNews.finnhub[0];
  const firstAlpha = state.macroNews.alphaFeed.find((n) => JSON.stringify(n).toUpperCase().includes(asset.toUpperCase())) || state.macroNews.alphaFeed[0];
  const firstEvent = state.macroNews.economic[0];
  return [
    `Macro risk ${macro.risk} (${macro.reasons.join(', ') || 'sin flags'}).`,
    firstFinnhub ? `Finnhub: ${(firstFinnhub.headline || firstFinnhub.summary || '').slice(0, 180)}` : 'Finnhub: sin titular cargado.',
    firstAlpha ? `Alpha: ${firstAlpha.overall_sentiment_label || 'sentiment'} ${Number(firstAlpha.overall_sentiment_score || 0).toFixed(3)} - ${(firstAlpha.title || '').slice(0, 160)}` : 'Alpha: sin sentimiento cargado.',
    firstEvent ? `Macro calendar: ${firstEvent.country || ''} ${firstEvent.event || ''} impact=${firstEvent.impact || 'n/a'}` : 'Macro calendar: sin evento cargado.'
  ].join(' ');
}

function buildTrainingAdvice() {
  updateTrainingStrategyStats();
  state.training.advice = state.training.activePairs.map((pair) => {
    const signal = pair.indicators || {};
    const pairTrades = state.training.closedTrades.filter((t) => t.symbol === pair.symbol && t.venue === pair.venue);
    const pnl = pairTrades.reduce((s, t) => s + Number(t.pnl_demo || 0), 0);
    const wins = pairTrades.filter((t) => Number(t.pnl_demo || 0) >= 0).length;
    const winrate = pairTrades.length ? wins / pairTrades.length : 0;
    const macro = macroRiskLevel(pair.symbol);
    const risk = macro.risk === 'high' ? 'alto por macro/news' : pair.spreadPct > .0015 ? 'alto por spread' : signal.volatilityPct > .008 ? 'alto por volatilidad' : macro.risk === 'medium' ? 'medio por macro/news' : 'controlado';
    const recommendation = signal.bias === 'NEUTRAL' || signal.confidence < 60
      ? 'observar'
      : macro.risk === 'high'
        ? 'evitar hasta que pase la noticia'
      : pairTrades.length >= 3 && winrate > .58 && pnl > 0
        ? 'considerar real en futuro'
        : signal.horizon === 'swing' ? 'probar demo mediano plazo' : 'probar demo intradia';
    return {
      symbol: pair.symbol,
      venue: pair.venue,
      bias: signal.bias || 'NEUTRAL',
      reason: signal.setup || 'Sin setup claro',
      evidence: `Estrategia ${signal.primaryStrategy?.name || 'n/a'} (${signal.primaryStrategy?.score || 0}/100). Precio real ${fmtPrice(pair.price)}; spread ${(pair.spreadPct * 100).toFixed(4)}%; volumen x${Number(signal.volumeRatio || 0).toFixed(2)}; M15 ${signal.m15?.bias}; H1 ${signal.h1?.bias}; macro ${macro.risk}; demo P&L ${pnl.toFixed(2)}.`,
      confidence: signal.confidence || 0,
      risk,
      recommendation,
      horizon: signal.horizon || 'observacion'
    };
  });
}

function updateTrainingStrategyStats() {
  const stats = {};
  for (const key of Object.keys(state.strategies)) {
    stats[key] = { id: key, name: state.strategies[key].name, open: 0, closed: 0, wins: 0, pnl: 0, avgScore: 0, liveCandidates: 0 };
  }
  for (const pair of state.training.activePairs) {
    const ps = pair.indicators?.primaryStrategy;
    if (!ps) continue;
    const row = stats[ps.id] || (stats[ps.id] = { id: ps.id, name: ps.name, open: 0, closed: 0, wins: 0, pnl: 0, avgScore: 0, liveCandidates: 0 });
    row.liveCandidates += 1;
    row.avgScore += Number(ps.score || 0);
  }
  for (const pos of state.training.positions.filter((p) => !p.exit_price)) {
    const id = pos.strategy_id || 'unknown';
    const row = stats[id] || (stats[id] = { id, name: pos.strategy_name || id, open: 0, closed: 0, wins: 0, pnl: 0, avgScore: 0, liveCandidates: 0 });
    row.open += 1;
  }
  for (const trade of state.training.closedTrades) {
    const id = trade.strategy_id || 'unknown';
    const row = stats[id] || (stats[id] = { id, name: trade.strategy_name || id, open: 0, closed: 0, wins: 0, pnl: 0, avgScore: 0, liveCandidates: 0 });
    row.closed += 1;
    row.wins += Number(trade.pnl_demo || 0) >= 0 ? 1 : 0;
    row.pnl += Number(trade.pnl_demo || 0);
  }
  for (const row of Object.values(stats)) {
    row.avgScore = row.liveCandidates ? row.avgScore / row.liveCandidates : 0;
    row.winrate = row.closed ? row.wins / row.closed : 0;
  }
  state.training.strategyStats = stats;
}

function markToMarketPnl(position, pair = null) {
  const livePair = pair || state.training.activePairs.find((x) => x.symbol === position.symbol && x.venue === position.venue);
  const mark = Number(livePair?.price || position.exit_price || position.entry_price);
  const factor = position.direction === 'LONG' ? 1 : -1;
  return (mark - position.entry_price) * factor * position.size_demo - position.fees_simuladas - position.spread_estimado - position.slippage_estimado;
}

function trainingUnrealizedPnl() {
  return state.training.positions
    .filter((p) => !p.exit_price)
    .reduce((sum, p) => sum + markToMarketPnl(p), 0);
}

function renderTraining() {
  const tr = state.training;
  const unrealized = trainingUnrealizedPnl();
  const equity = tr.balance + unrealized;
  const realized = tr.balance - tr.balanceStart;
  const totalPnl = equity - tr.balanceStart;
  const todayStart = new Date().toISOString().slice(0, 10);
  const todayClosed = tr.closedTrades
    .filter((t) => String(t.closed_timestamp || t.timestamp || '').slice(0, 10) === todayStart)
    .reduce((s, t) => s + Number(t.pnl_demo || 0), 0);
  const today = todayClosed + unrealized;
  const wins = tr.closedTrades.filter((t) => Number(t.pnl_demo || 0) >= 0).length;
  setText('trainBalance', `$${equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  setText('trainTotalPnl', `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`);
  setText('trainTotalPct', `${(totalPnl / tr.balanceStart * 100).toFixed(2)}% · realizado ${realized >= 0 ? '+' : ''}$${realized.toFixed(2)}`);
  setText('trainTodayPnl', `${today >= 0 ? '+' : ''}$${today.toFixed(2)}`);
  setText('trainOps', String(tr.closedTrades.length));
  setText('trainWinrate', `${tr.closedTrades.length ? Math.round(wins / tr.closedTrades.length * 100) : 0}% winrate`);
  setText('trainPairCount', `${tr.activePairs.length} / ${tr.maxPairs}`);
  setText('trainLessons', String(tr.lessons.length));
  setText('trainLastLesson', tr.lessons[0]?.lesson || 'Aun no hay trades cerrados.');
  renderTrainingStrategyLab();
  const level = trainingLevel();
  setText('trainLevel', level.name);
  setText('trainXp', `${tr.xp} XP - ${level.progress}%`);
  renderTrainingPairs();
  renderTrainingPositions();
  renderTrainingAdvice();
  renderTrainingTrades();
  renderTrainingLevelTable();
  renderChatContextPanel();
}

function trainingLevel() {
  const xp = state.training.xp + state.training.lessons.length * 8 + state.training.closedTrades.length * 3;
  const levels = trainingLevels();
  let current = levels[0];
  for (const level of levels) if (xp >= level.xp) current = level;
  const next = levels.find((l) => l.xp > current.xp);
  const progress = next ? Math.round((xp - current.xp) / Math.max(1, next.xp - current.xp) * 100) : 100;
  return { ...current, progress: Math.max(0, Math.min(100, progress)), xp };
}

function trainingLevels() {
  return [
    { name: 'Noob', xp: 0, label: 'Aprende feed y riesgo' },
    { name: 'Aprendiz', xp: 120, label: 'Filtra setups basicos' },
    { name: 'Analista', xp: 360, label: 'Lee patrones y contexto' },
    { name: 'Operador Demo', xp: 850, label: 'Gestiona horizontes' },
    { name: 'Estratega', xp: 1600, label: 'Optimiza por par' },
    { name: 'Pro Consistente', xp: 3000, label: 'Disciplina multi-mercado' },
    { name: 'Elite', xp: 5200, label: 'Listo para auditoria real' }
  ];
}

function renderTrainingPairs() {
  const rows = state.training.activePairs.map((p) => {
    const opens = state.training.positions.filter((x) => x.symbol === p.symbol && x.venue === p.venue && !x.exit_price);
    const pairTrades = state.training.closedTrades.filter((t) => t.symbol === p.symbol && t.venue === p.venue);
    const realized = pairTrades.reduce((s, t) => s + Number(t.pnl_demo || 0), 0);
    const floating = opens.reduce((s, pos) => s + markToMarketPnl(pos, p), 0);
    const positionLabel = opens.length ? opens.map((x) => `${x.horizon === 'swing' ? 'SW' : 'IN'} ${x.direction}`).join(' / ') : 'Sin posicion';
    return `<div class="train-row"><b>${p.symbol}<small>${p.venue}</small></b><span class="train-status">${p.feed || 'OK'}</span><span>${fmtPrice(p.price)}</span><span>${p.indicators?.confidence || 0}%</span><span>${p.indicators?.horizon || 'watch'}</span><span>${positionLabel}<small>Flot. ${floating.toFixed(2)} · Real. ${realized.toFixed(2)}</small></span></div>`;
  }).join('');
  const html = `<div class="train-pairs"><div class="train-head"><span>PAR</span><span>FEED</span><span>PRECIO REAL</span><span>CONF. IA</span><span>PLAN</span><span>POSICION DEMO</span></div>${rows || '<div class="empty-state">Validando pares reales disponibles...</div>'}</div>`;
  if ($('trainingPairsTable')) $('trainingPairsTable').innerHTML = html;
}

function renderTrainingStrategyLab() {
  const box = $('trainingStrategyTable');
  if (!box) return;
  updateTrainingStrategyStats();
  const rows = Object.values(state.training.strategyStats)
    .sort((a, b) => (b.open + b.liveCandidates + b.closed * .25) - (a.open + a.liveCandidates + a.closed * .25))
    .map((s) => `<div class="strategy-row"><b>${escapeHtml(s.name)}<small>${s.id}</small></b><span>${s.liveCandidates}</span><span>${s.open}</span><span>${s.closed ? Math.round(s.winrate * 100) + '%' : '--'}</span><span class="${s.pnl >= 0 ? 'train-status' : 'train-bad'}">${s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(2)}</span><span>${s.avgScore ? s.avgScore.toFixed(0) : '--'}</span></div>`)
    .join('');
  box.innerHTML = `<div class="strategy-head"><span>ESTRATEGIA</span><span>LIVE</span><span>OPEN</span><span>WR</span><span>P&L</span><span>SCORE</span></div>${rows}`;
}

function renderTrainingPositions() {
  const renderGroup = (items) => items.map((p) => {
    const pair = state.training.activePairs.find((x) => x.symbol === p.symbol && x.venue === p.venue);
    const mark = pair?.price || p.entry_price;
    const pnl = markToMarketPnl(p, pair);
    const ageH = ((Date.now() - Number(p.opened_tick || Date.now())) / 3600000).toFixed(1);
    return `<div class="train-row"><b>${p.symbol}<small>${ageH}h</small></b><span>${p.venue}</span><span class="${p.direction === 'LONG' ? 'train-status' : 'train-bad'}">${p.direction}</span><span>${p.size_demo.toFixed(5)}</span><span>${fmtPrice(p.entry_price)}</span><span class="${pnl >= 0 ? 'train-status' : 'train-bad'}">${pnl.toFixed(2)}</span><span>${p.confidence}%</span></div>`;
  }).join('');
  const head = '<div class="train-head"><span>PAR</span><span>VENUE</span><span>DIR</span><span>TAMANO</span><span>ENTRADA</span><span>P&L</span><span>CONF.</span></div>';
  const shortRows = renderGroup(state.training.positions.filter((p) => p.horizon !== 'swing'));
  const swingRows = renderGroup(state.training.positions.filter((p) => p.horizon === 'swing'));
  if ($('trainingPositionsShortTable')) $('trainingPositionsShortTable').innerHTML = `<div class="train-positions">${head}${shortRows || '<div class="empty-state">Sin intradia abierto.</div>'}</div>`;
  if ($('trainingPositionsSwingTable')) $('trainingPositionsSwingTable').innerHTML = `<div class="train-positions">${head}${swingRows || '<div class="empty-state">Sin mediano plazo abierto.</div>'}</div>`;
}

function renderTrainingAdvice() {
  const html = state.training.advice.map((a) => `<div class="advice-card"><div class="advice-icon">${a.bias === 'LONG' ? 'L' : a.bias === 'SHORT' ? 'S' : 'N'}</div><div><h3>${a.symbol} - ${a.bias}</h3><p><b>${a.recommendation}</b>: ${escapeHtml(a.reason)}. ${escapeHtml(a.evidence)}</p></div><div class="advice-meta">Venue: ${a.venue}<br>Horizonte: ${a.horizon}<br>Confianza: ${a.confidence}%<br>Riesgo: ${escapeHtml(a.risk)}</div></div>`).join('');
  if ($('trainingAdviceList')) $('trainingAdviceList').innerHTML = html || '<div class="empty-state">Quant generara consejos cuando tenga observaciones reales.</div>';
}

function renderTrainingTrades() {
  const rows = state.training.closedTrades.slice(0, 8).map((t) => `<div class="train-row"><span>${new Date(t.closed_timestamp || t.timestamp).toTimeString().slice(0,5)}</span><b>${t.symbol}</b><span class="${t.direction === 'LONG' ? 'train-status' : 'train-bad'}">${t.direction}</span><span>${t.size_demo.toFixed(5)}</span><span class="${t.pnl_demo >= 0 ? 'train-status' : 'train-bad'}">${t.pnl_demo.toFixed(2)}</span></div>`).join('');
  const html = `<div class="train-trades"><div class="train-head"><span>HORA</span><span>PAR</span><span>DIR</span><span>TAMANO</span><span>P&L</span></div>${rows || '<div class="empty-state">Aun no hay operaciones demo cerradas.</div>'}</div>`;
  if ($('trainingTradesTable')) $('trainingTradesTable').innerHTML = html;
}

function renderTrainingLevelTable() {
  const current = trainingLevel();
  const html = trainingLevels().map((level) => {
    const active = level.name === current.name;
    const pct = current.xp >= level.xp ? 100 : Math.max(0, Math.min(100, current.xp / Math.max(1, level.xp) * 100));
    return `<div class="level-row ${active ? 'active' : ''}"><span>${level.name}<small>${level.label}</small></span><b>${level.xp}</b><div class="level-bar"><span style="width:${pct}%"></span></div></div>`;
  }).join('');
  if ($('trainingLevelTable')) $('trainingLevelTable').innerHTML = html;
}

async function askAiAnalysis() {
  const prompt = `Analiza ${state.symbol} con precio ${fmtPrice(state.ticker?.price || 0)} y las últimas velas. Dame lectura operativa sin ejecutar órdenes.`;
  $('aiOutput').textContent = 'Quant está pensando...';
  await askQuant(prompt, true);
}

async function sendChat() {
  const input = $('chatInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  addChat('Tú', text);
  state.messages.push({ role: 'user', content: text });
  await askQuant(text, false);
}

async function askQuant(text, writeToAi) {
  try {
    logEvent('OK', 'PRIMARY_REASONING · consultando DeepSeek');
    const context = `Símbolo: ${state.symbol}\nTicker: ${JSON.stringify(state.ticker)}\nVelas: ${state.candles.length}\nSeñal: ${$('signalMessage').textContent}\nTrading real: ${state.env.realTrading ? 'activo' : 'bloqueado'}`;
    const fullContext = context + '\n\nWallet actual:\n' + walletContext() + '\n\nMacro/news actual:\n' + macroContext() + '\n\nTraining actual:\n' + trainingContext();
    const answer = await window.quant.chat(state.messages.slice(-14), fullContext || text);
    state.messages.push({ role: 'assistant', content: answer });
    addChat('Quant', answer);
    if (writeToAi) $('aiOutput').textContent = answer;
    logEvent('OK', 'MEMORY_WRITTEN · respuesta registrada en sesión');
    autoSaveConversation();
  } catch (err) {
    addChat('Quant', `No pude consultar el modelo ahora: ${err.message}`);
    logEvent('WARN', `DeepSeek: ${err.message}`);
  }
}

function renderChatContextPanel() {
  const el = $('chatContextPanel');
  if (!el) return;
  updateTrainingStrategyStats();
  const topStrategies = Object.values(state.training.strategyStats || {})
    .sort((a, b) => (b.open + b.liveCandidates) - (a.open + a.liveCandidates))
    .slice(0, 4)
    .map((s) => `<div class="pipe-item"><span>${s.id.slice(0, 10)}</span><b class="${s.pnl >= 0 ? 'pipe-ok' : 'pipe-error'}">${s.open}</b><span>${s.closed ? Math.round(s.winrate * 100) + '%' : '--'}</span><small>${s.avgScore ? s.avgScore.toFixed(0) : '--'} score</small></div>`)
    .join('');
  el.innerHTML =
    `<div class="pipe-item"><span>Modo</span><b class="pipe-ok">${state.training.mode}</b><span>${state.env.realTrading ? 'REAL' : 'SAFE'}</span><small>${state.symbol}</small></div>` +
    `<div class="pipe-item"><span>Train</span><b class="pipe-ok">${state.training.positions.filter((p) => !p.exit_price).length}</b><span>${state.training.closedTrades.length}</span><small>${state.training.lessons.length} lessons</small></div>` +
    `<div class="pipe-item"><span>Macro</span><b class="${state.macroNews.risk === 'high' ? 'pipe-error' : state.macroNews.risk === 'medium' ? 'pipe-warn' : 'pipe-ok'}">${state.macroNews.risk}</b><span>${state.macroNews.finnhub.length}</span><small>news</small></div>` +
    topStrategies;
}

// Render-only path: dibuja un mensaje en #chatLog sin persistirlo.
// Necesario para restaurar conversaciones guardadas sin re-escribirlas a memoria.
function renderChatMessage(role, text) {
  const div = document.createElement('div');
  const isQuant = role.toLowerCase().includes('quant');
  div.className = `chat-msg ${isQuant ? 'quant-msg' : 'user-msg'}`;
  div.innerHTML = isQuant
    ? `<b>${role}</b>${formatQuantText(text)}`
    : `<b>${role}:</b> ${escapeHtml(text)}`;
  $('chatLog').appendChild(div);
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
}

function addChat(role, text) {
  renderChatMessage(role, text);
  window.quant.memoryWrite('message', { role, text }).then(loadMemoryStats).catch(() => {
    $('memoryNow').textContent = `${state.messages.length} msg · ${state.sessionTrades} trades`;
  });
}

function formatQuantText(text) {
  const clean = String(text || '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/^\s*[-*]\s+/gm, '• ');
  const lines = clean.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const chunks = [];
  let list = [];
  const flushList = () => {
    if (!list.length) return;
    chunks.push(`<ul>${list.map((item) => `<li>${escapeHtml(item.replace(/^•\s*/, ''))}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const line of lines) {
    if (/^#{1,4}\s+/.test(line)) {
      flushList();
      chunks.push(`<h4>${escapeHtml(line.replace(/^#{1,4}\s+/, ''))}</h4>`);
    } else if (/^•\s+/.test(line) || /^\d+[\.)]\s+/.test(line)) {
      list.push(line.replace(/^\d+[\.)]\s+/, ''));
    } else if (/^[A-ZÁÉÍÓÚÑ][^:]{2,36}:$/.test(line)) {
      flushList();
      chunks.push(`<h4>${escapeHtml(line.replace(/:$/, ''))}</h4>`);
    } else {
      flushList();
      chunks.push(`<p>${escapeHtml(line)}</p>`);
    }
  }
  flushList();
  return `<div class="quant-rich">${chunks.join('')}</div>`;
}

async function loadMemoryStats() {
  try {
    const stats = await window.quant.memoryStats();
    $('memoryNow').textContent = `${stats.messages} msg · ${stats.trades} trades`;
    const box = $('settingsBox');
    if (box && state.env) {
      const existing = box.innerHTML;
      if (!existing.includes('Memoria permanente')) {
        box.innerHTML = existing + `<div class="setting-card"><b>Memoria permanente</b><span>${escapeHtml(stats.file)}</span></div>`;
      }
    }
  } catch {
    $('memoryNow').textContent = `${state.messages.length} msg · ${state.sessionTrades} trades`;
  }
}

function renderMt5PositionRow(p) {
  const pnl = Number(p.profit || 0);
  const pnlColor = pnl >= 0 ? '#43d787' : '#ff5252';
  const dirClass = p.direction === 'BUY' ? 'train-status' : 'train-bad';
  const slTp = `${p.sl ? Number(p.sl).toFixed(5) : '--'} / ${p.tp ? Number(p.tp).toFixed(5) : '--'}`;
  const ts = p.time ? new Date(Number(p.time) * 1000).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '--';
  return `<div style="display:grid;grid-template-columns:80px 100px 70px 80px 90px 90px 80px 80px 1fr;gap:6px;padding:9px 10px;border-bottom:1px solid #1a2535;font-size:13px;align-items:center" title="Abierta: ${ts} · Comentario: ${escapeHtml(p.comment || '')}">
    <span style="color:#8fa3c0">#${p.ticket}</span>
    <b>${escapeHtml(p.symbol)}</b>
    <span class="${dirClass}">${p.direction}</span>
    <span>${Number(p.volume).toFixed(2)}</span>
    <span>${Number(p.price_open).toFixed(5)}</span>
    <span>${Number(p.price_current).toFixed(5)}</span>
    <span style="color:${pnlColor};font-weight:600">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</span>
    <span style="color:#8fa3c0">${Number(p.swap || 0).toFixed(2)}</span>
    <span style="color:#8fa3c0;font-size:12px">${slTp}</span>
  </div>`;
}

async function loadPositions() {
  const mt5Table = $('mt5PositionsTable');
  const binTable = $('binanceOrdersTable');
  const badge = $('mt5AccountBadge');
  if (mt5Table) mt5Table.innerHTML = '<div style="padding:16px;color:#8fa3c0;font-size:13px">Consultando MT5...</div>';
  if (binTable) binTable.innerHTML = '<div style="padding:16px;color:#8fa3c0;font-size:13px">Consultando Binance...</div>';
  try {
    const data = await window.quant.positions();
    const mt5Accounts = data.mt5Accounts || [];

    // ── MT5: un bloque por cuenta ─────────────────────────────
    if (badge) badge.innerHTML = '';
    if (mt5Table) {
      if (!mt5Accounts.length) {
        mt5Table.innerHTML = '<div class="empty-state" style="padding:28px 0">MT5 adapter desactivado o sin cuentas configuradas.</div>';
      } else {
        mt5Table.innerHTML = mt5Accounts.map((acc) => {
          const modeLabel = acc.is_demo ? 'DEMO' : 'REAL';
          const modeColor = acc.is_demo ? '#f0a500' : '#2979ff';
          if (!acc.available) {
            return `<div style="padding:10px 12px;border-bottom:1px solid #1a2535;color:#f87171;font-size:13px">
              Cuenta ${acc.login} (${escapeHtml(acc.server || '--')}): ${escapeHtml((acc.error || 'no accesible').slice(0, 200))}
            </div>`;
          }
          const profit = Number(acc.profit || 0);
          const profitColor = profit >= 0 ? '#43d787' : '#ff5252';
          const cur = escapeHtml(acc.currency || 'USD');
          const positions = acc.positions || [];
          const header = `<div style="display:flex;gap:14px;flex-wrap:wrap;padding:10px 12px;background:#0d1520;border-radius:4px;margin-bottom:4px;font-size:13px;align-items:center">
            <b style="color:#c5d3e8">${acc.login}</b>
            <span style="background:${modeColor}22;color:${modeColor};padding:2px 8px;border-radius:3px;font-size:11px;font-weight:700">${modeLabel}</span>
            <span style="color:#8fa3c0">${escapeHtml(acc.server || '--')}</span>
            <span>Balance <b>${Number(acc.balance || 0).toFixed(2)} ${cur}</b></span>
            <span>Equity <b>${Number(acc.equity || 0).toFixed(2)} ${cur}</b></span>
            <span>Margen libre <b>${Number(acc.margin_free || 0).toFixed(2)} ${cur}</b></span>
            <span>P&L <b style="color:${profitColor}">${profit >= 0 ? '+' : ''}${profit.toFixed(2)} ${cur}</b></span>
            <span style="color:#8fa3c0">${positions.length} posicion${positions.length !== 1 ? 'es' : ''}</span>
          </div>`;
          const rows = positions.length
            ? positions.map(renderMt5PositionRow).join('')
            : '<div style="padding:10px 12px;color:#8fa3c0;font-size:13px">Sin posiciones abiertas en esta cuenta.</div>';
          return header + rows;
        }).join('<div style="height:12px"></div>');
      }
    }

    // ── Binance ───────────────────────────────────────────────
    const bin = data.binance || {};
    if (binTable) {
      if (!bin.ok) {
        binTable.innerHTML = `<div class="empty-state" style="padding:28px 0">${escapeHtml(bin.error || 'No se pudieron cargar ordenes de Binance.')}</div>`;
      } else if (!bin.orders || !bin.orders.length) {
        binTable.innerHTML = '<div class="empty-state" style="padding:28px 0">Sin ordenes pendientes en Binance.</div>';
      } else {
        binTable.innerHTML = bin.orders.map((o) => {
          const sideClass = o.side === 'BUY' ? 'train-status' : 'train-bad';
          const ts = o.time ? new Date(Number(o.time)).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '--';
          const filled = o.executedQty > 0 ? ` (${Number(o.executedQty).toFixed(4)} lleno)` : '';
          return `<div style="display:grid;grid-template-columns:120px 100px 70px 90px 100px 100px 1fr;gap:6px;padding:9px 10px;border-bottom:1px solid #1a2535;font-size:13px;align-items:center" title="Creada: ${ts}">
            <span style="color:#8fa3c0">${o.orderId}</span>
            <b>${escapeHtml(o.symbol)}</b>
            <span class="${sideClass}">${o.side}</span>
            <span style="color:#8fa3c0">${escapeHtml(o.type)}</span>
            <span>${Number(o.origQty).toFixed(4)}${filled}</span>
            <span>${o.price > 0 ? Number(o.price).toFixed(4) : 'mercado'}</span>
            <span style="color:#8fa3c0">${escapeHtml(o.status)}</span>
          </div>`;
        }).join('');
      }
    }
  } catch (err) {
    if (mt5Table) mt5Table.innerHTML = `<div class="empty-state" style="padding:28px 0">Error: ${escapeHtml(err.message)}</div>`;
    logEvent('WARN', `loadPositions: ${err.message}`);
  }
}

// ── Backtesting ───────────────────────────────────────────────────────────────

let _backtestFilePath = null;

function initBacktest() {
  $('backtestResults') && ($('backtestResults').style.display = 'none');
  $('backtestEmpty')   && ($('backtestEmpty').style.display   = '');
}

async function backtestSelectFile() {
  const filePath = await window.quant.selectCsvFile();
  if (!filePath) return;
  _backtestFilePath = filePath;
  const name = filePath.split(/[\\/]/).pop();
  setText('backtestFileName', name);
  $('backtestRunBtn').style.display = '';
}

async function backtestRun() {
  if (!_backtestFilePath) return;
  setText('backtestFileName', 'Analizando...');
  $('backtestRunBtn').disabled = true;
  try {
    const result = await window.quant.backtestAnalyze(_backtestFilePath);
    if (!result.ok) {
      setText('backtestFileName', `Error: ${result.error}`);
      return;
    }
    renderBacktestResults(result);
    setText('backtestFileName', `${result.file} — ${result.tradeCount} operaciones`);
  } catch (err) {
    setText('backtestFileName', `Error: ${err.message}`);
    logEvent('WARN', `backtest: ${err.message}`);
  } finally {
    $('backtestRunBtn').disabled = false;
  }
}

function renderBacktestResults(result) {
  const s = result.stats;
  $('backtestEmpty').style.display = 'none';
  $('backtestResults').style.display = '';

  // KPIs
  const rrColor = s.profitFactor >= 1.5 ? '#43d787' : s.profitFactor >= 1 ? '#f0a500' : '#ff5252';
  const wrColor = s.winRate >= 55 ? '#43d787' : s.winRate >= 45 ? '#f0a500' : '#ff5252';
  const pnlColor = s.netProfit >= 0 ? '#43d787' : '#ff5252';
  $('backtestKpis').innerHTML = [
    ['OPERACIONES', s.total, `${s.wins} gana / ${s.losses} pierde`],
    ['WIN RATE', `${s.winRate}%`, '', wrColor],
    ['NET PROFIT', `${s.netProfit >= 0 ? '+' : ''}${s.netProfit}`, '', pnlColor],
    ['PROFIT FACTOR', s.profitFactor, s.profitFactor >= 1.5 ? 'Bueno' : s.profitFactor >= 1 ? 'Marginal' : 'Negativo', rrColor],
    ['EXPECTATIVA', s.expectancy.toFixed(3), 'por operacion'],
    ['MAX DRAWDOWN', `${s.maxDrawdownPct}%`, s.maxDrawdownPct < 10 ? 'Controlado' : s.maxDrawdownPct < 20 ? 'Moderado' : 'Alto']
  ].map(([label, val, sub, color]) =>
    `<div class="kpi-card"><div class="label">${label}</div><div class="kpi-value" style="${color ? `color:${color}` : ''}">${val}</div><div class="sub">${sub || ''}</div></div>`
  ).join('');

  // Walk-forward
  const wf = s.walkForward;
  const oosOk = wf.oosWinRate >= wf.isWinRate * 0.8;
  $('backtestWF').innerHTML = `
    <div class="balance-row"><span>IS (70%) — ${wf.splitAt} ops</span><b>WR ${wf.isWinRate}%</b><span>muestra de entrenamiento</span></div>
    <div class="balance-row"><span>OOS (30%) — resto</span><b style="color:${oosOk ? '#43d787' : '#ff5252'}">WR ${wf.oosWinRate}%</b><span>${oosOk ? 'Edge validado fuera de muestra' : 'Posible overfitting'}</span></div>
    <div class="balance-row"><span>P&L OOS</span><b style="color:${wf.oosNetProfit >= 0 ? '#43d787' : '#ff5252'}">${wf.oosNetProfit >= 0 ? '+' : ''}${wf.oosNetProfit}</b></div>
    <div class="balance-row"><span>Veredicto</span><b style="color:${oosOk ? '#43d787' : '#f0a500'}">${oosOk ? 'EDGE REAL' : 'REVISAR ESTRATEGIA'}</b></div>`;

  // Best / worst
  $('backtestBestWorst').innerHTML = `
    <div class="balance-row"><span>Mejor trade</span><b style="color:#43d787">+${s.best.profit}</b><span>${escapeHtml(s.best.symbol)} ${s.best.type}</span></div>
    <div class="balance-row"><span>Peor trade</span><b style="color:#ff5252">${s.worst.profit}</b><span>${escapeHtml(s.worst.symbol)} ${s.worst.type}</span></div>
    <div class="balance-row"><span>Promedio win</span><b style="color:#43d787">+${s.avgWin}</b></div>
    <div class="balance-row"><span>Promedio loss</span><b style="color:#ff5252">-${s.avgLoss}</b></div>
    <div class="balance-row"><span>Ratio W/L</span><b>${s.avgLoss > 0 ? (s.avgWin / s.avgLoss).toFixed(2) : 'N/A'}</b></div>`;

  // Equity curve
  drawEquityCurve(s.equityCurve);

  // Symbol table
  const totalAbs = s.symbolStats.reduce((sum, ss) => sum + Math.abs(ss.netProfit), 0.01);
  $('backtestSymbolTable').innerHTML = s.symbolStats.map((ss) => {
    const contrib = ((Math.abs(ss.netProfit) / totalAbs) * 100).toFixed(1);
    const pnlColor2 = ss.netProfit >= 0 ? '#43d787' : '#ff5252';
    const wrColor2  = ss.winRate >= 0.55 ? '#43d787' : ss.winRate >= 0.45 ? '#f0a500' : '#ff5252';
    return `<div style="display:grid;grid-template-columns:120px 80px 60px 60px 100px 100px;gap:8px;padding:8px 10px;border-bottom:1px solid #1a2535;font-size:13px;align-items:center">
      <b>${escapeHtml(ss.symbol)}</b>
      <span>${ss.trades}</span>
      <span>${ss.wins}</span>
      <span style="color:${wrColor2}">${(ss.winRate * 100).toFixed(1)}%</span>
      <span style="color:${pnlColor2};font-weight:600">${ss.netProfit >= 0 ? '+' : ''}${ss.netProfit}</span>
      <div style="background:#1a2535;border-radius:3px;height:6px;overflow:hidden"><div style="background:${pnlColor2};width:${contrib}%;height:100%"></div></div>
    </div>`;
  }).join('') || '<div class="empty-state" style="padding:20px">Sin datos por símbolo.</div>';
}

function drawEquityCurve(curve) {
  const canvas = $('backtestEquityChart');
  if (!canvas || !curve.length) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.max(1, rect.width  * dpr);
  canvas.height = Math.max(1, rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  ctx.fillStyle = '#101927';
  ctx.fillRect(0, 0, W, H);

  const minV = Math.min(0, ...curve);
  const maxV = Math.max(0, ...curve);
  const range = maxV - minV || 1;
  const xScale = W / (curve.length - 1);
  const yToCanvas = (v) => H - 10 - ((v - minV) / range) * (H - 20);

  // Zero line
  ctx.strokeStyle = '#2e4268';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, yToCanvas(0));
  ctx.lineTo(W, yToCanvas(0));
  ctx.stroke();

  // Gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, 'rgba(41,121,255,0.25)');
  grad.addColorStop(1, 'rgba(41,121,255,0)');
  ctx.beginPath();
  curve.forEach((v, i) => i === 0 ? ctx.moveTo(0, yToCanvas(v)) : ctx.lineTo(i * xScale, yToCanvas(v)));
  ctx.lineTo((curve.length - 1) * xScale, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.strokeStyle = '#2979ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  curve.forEach((v, i) => i === 0 ? ctx.moveTo(0, yToCanvas(v)) : ctx.lineTo(i * xScale, yToCanvas(v)));
  ctx.stroke();
}

let _ordersFilter = 'all';

async function loadOrders() {
  try {
    const records = await window.quant.memoryRead(5000);
    const trades = records
      .filter((r) => r.kind === 'trade')
      .map((r) => ({ ...r.payload, _ts: r.ts }))
      .reverse();
    state._ordersCache = trades;
    renderOrdersTable(trades);
  } catch (err) {
    logEvent('WARN', `loadOrders: ${err.message}`);
  }
}

function renderOrdersTable(trades) {
  const filtered = _ordersFilter === 'all'
    ? trades
    : _ordersFilter === 'blocked'
      ? trades.filter((t) => t.status === 'blocked' || t.status === 'final_safety_lock' || t.reason)
      : trades.filter((t) => !t.status || t.status === 'executed' || t.status === 'opened' || t.status === 'closed');

  const count = $('ordersCount');
  if (count) count.textContent = `${filtered.length} orden${filtered.length !== 1 ? 'es' : ''}`;

  const REASON_LABELS = {
    'REAL_TRADING=false': 'Bloqueada: trading real desactivado',
    'confirmation_missing': 'Bloqueada: confirmacion incompleta',
    'final_safety_lock': 'Bloqueada: candado de seguridad final',
    'training': 'Operacion demo (Training)',
    'training_trade_open': 'Demo abierta',
    'training_trade_closed': 'Demo cerrada'
  };

  const rows = filtered.map((t) => {
    const ts = t._ts || t.timestamp || t.closed_timestamp || '';
    const dateStr = ts ? new Date(ts).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '--';
    const symbol = escapeHtml(t.symbol || '--');
    const side = t.side || t.direction || '--';
    const sideClass = side === 'BUY' || side === 'LONG' ? 'train-status' : side === 'SELL' || side === 'SHORT' ? 'train-bad' : '';
    const qty = t.qty || t.size_demo || t.quantity || '--';
    const rawReason = t.reason || t.type || t.status || '';
    const reason = escapeHtml(REASON_LABELS[rawReason] || rawReason || 'Sin detalle');
    const venue = escapeHtml(t.venue || 'BINANCE');
    return `<div style="display:grid;grid-template-columns:140px 90px 70px 90px 1fr 120px;gap:8px;padding:8px 10px;border-bottom:1px solid #1a2535;font-size:13px;align-items:center">
      <span style="color:#8fa3c0">${dateStr}</span>
      <b>${symbol}</b>
      <span class="${sideClass}">${escapeHtml(side)}</span>
      <span>${escapeHtml(String(qty))}</span>
      <span style="color:#8fa3c0">${reason}</span>
      <span style="color:#8fa3c0">${venue}</span>
    </div>`;
  }).join('');

  const table = $('ordersTable');
  if (table) table.innerHTML = rows || '<div class="empty-state" style="padding:32px 0">Sin ordenes registradas aun.</div>';
}

// ── Alertas ───────────────────────────────────────────────────────────────────

let _alertConfig = null;
const _alertSent = new Set(); // dedup: evita re-enviar la misma alerta en el mismo ciclo

async function loadAlerts() {
  try {
    _alertConfig = await window.quant.alertConfigRead();
    // Populate form
    const fields = { alertEmailTo: 'email', alertSmtpUser: 'smtpUser', alertSmtpPass: 'smtpPass' };
    for (const [id, key] of Object.entries(fields)) {
      const el = $(id); if (el) el.value = _alertConfig[key] || '';
    }
    const chk = $('alertEnabled'); if (chk) chk.checked = !!_alertConfig.enabled;
    renderAlertTriggers();
    await loadAlertLog();
  } catch (err) {
    logEvent('WARN', `loadAlerts: ${err.message}`);
  }
}

function renderAlertTriggers() {
  const grid = $('alertTriggersGrid');
  if (!grid || !_alertConfig) return;
  const triggers = _alertConfig.triggers || {};
  grid.innerHTML = Object.entries(triggers).map(([key, t]) =>
    `<label style="display:flex;align-items:flex-start;gap:10px;background:#0d1520;padding:12px;border-radius:6px;cursor:pointer;font-size:13px">
      <input type="checkbox" data-trigger-key="${key}" ${t.enabled ? 'checked' : ''} style="margin-top:2px" />
      <span style="color:#c5d3e8">${escapeHtml(t.label)}</span>
    </label>`
  ).join('');
}

async function saveAlertConfig() {
  const status = $('alertConfigStatus');
  try {
    if (status) status.textContent = 'Guardando...';
    const triggers = { ...(_alertConfig?.triggers || {}) };
    document.querySelectorAll('[data-trigger-key]').forEach((chk) => {
      const key = chk.dataset.triggerKey;
      if (triggers[key]) triggers[key] = { ...triggers[key], enabled: chk.checked };
    });
    const cfg = {
      email:    $('alertEmailTo')?.value.trim()  || 'kinotrance@gmail.com',
      smtpUser: $('alertSmtpUser')?.value.trim() || '',
      smtpPass: $('alertSmtpPass')?.value.trim() || '',
      enabled:  $('alertEnabled')?.checked ?? true,
      triggers
    };
    _alertConfig = await window.quant.alertConfigWrite(cfg);
    if (status) status.textContent = `Guardado: ${new Date().toLocaleString('es-CO')}`;
    logEvent('OK', 'Configuracion de alertas guardada');
  } catch (err) {
    if (status) status.textContent = 'Error al guardar';
    logEvent('WARN', `saveAlertConfig: ${err.message}`);
  }
}

async function sendTestEmail() {
  const status = $('alertConfigStatus');
  try {
    await saveAlertConfig();
    if (status) status.textContent = 'Enviando correo de prueba...';
    const result = await window.quant.sendTestEmail(_alertConfig);
    if (result.ok) {
      if (status) status.textContent = `Enviado a ${_alertConfig.email}`;
      logEvent('OK', `Email de prueba enviado a ${_alertConfig.email}`);
      await loadAlertLog();
    } else {
      if (status) status.textContent = `Error: ${result.reason || 'fallo SMTP'}`;
      logEvent('WARN', `sendTestEmail: ${result.reason}`);
    }
  } catch (err) {
    if (status) status.textContent = `Error: ${err.message}`;
    logEvent('WARN', `sendTestEmail: ${err.message}`);
  }
}

async function loadAlertLog() {
  try {
    const logs = await window.quant.alertLog(50);
    const table = $('alertLogTable');
    if (!table) return;
    table.innerHTML = logs.length
      ? logs.map((l) => `<div style="display:grid;grid-template-columns:160px 1fr;gap:8px;padding:8px 10px;border-bottom:1px solid #1a2535;font-size:13px">
          <span style="color:#8fa3c0">${new Date(l.ts).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</span>
          <span>${escapeHtml(l.subject)}</span>
        </div>`).join('')
      : '<div class="empty-state" style="padding:24px 0">Sin alertas enviadas aun.</div>';
  } catch (err) {
    logEvent('WARN', `loadAlertLog: ${err.message}`);
  }
}

// Llamado desde el ciclo de actualización de señal — comprueba condiciones y envía si corresponde
async function checkAndFireAlerts(signal, pair) {
  if (!_alertConfig?.enabled || !_alertConfig?.smtpUser) return;
  const now = Date.now();

  // ── Señal fuerte ──────────────────────────────────────────
  const tSignal = _alertConfig.triggers?.strongSignal;
  if (tSignal?.enabled && signal?.confidence >= (tSignal.minConfidence || 82) && signal?.bias !== 'NEUTRAL') {
    const key = `strongSignal:${pair?.symbol}:${signal.bias}:${String(signal.confidence)}`;
    if (!_alertSent.has(key)) {
      _alertSent.add(key);
      const subject = `Señal fuerte: ${pair?.symbol} ${signal.bias} (${signal.confidence}%)`;
      const body = `Par: ${pair?.symbol} | Venue: ${pair?.venue}\nDirección: ${signal.bias}\nConfianza: ${signal.confidence}%\nSetup: ${signal.setup || 'N/A'}\nPrecio actual: ${pair?.price}\nHorizonte: ${signal.horizon || 'N/A'}\nVol ratio: ${signal.volumeRatio?.toFixed(2) || 'N/A'}\nSpread: ${((pair?.spreadPct || 0) * 100).toFixed(4)}%`;
      window.quant.sendAlert(subject, body).catch(() => {});
      logEvent('OK', `Alerta enviada: ${subject}`);
    }
  }

  // ── Spread excesivo ──────────────────────────────────────
  const tSpread = _alertConfig.triggers?.highSpread;
  if (tSpread?.enabled && pair?.spreadPct > (tSpread.maxSpreadPct || 0.0015)) {
    const key = `highSpread:${pair?.symbol}:${Math.floor(now / 300000)}`; // una vez cada 5 min
    if (!_alertSent.has(key)) {
      _alertSent.add(key);
      const subject = `Spread alto: ${pair?.symbol} (${((pair.spreadPct) * 100).toFixed(4)}%)`;
      const body = `Par: ${pair.symbol} | Venue: ${pair.venue}\nSpread actual: ${(pair.spreadPct * 100).toFixed(4)}%\nUmbral: ${(tSpread.maxSpreadPct * 100).toFixed(3)}%\nPrecio: ${pair.price}`;
      window.quant.sendAlert(subject, body).catch(() => {});
    }
  }
}

async function loadCustomInstructions() {
  try {
    const data = await window.quant.customInstructionsRead();
    const ta = $('customInstructionsInput');
    if (ta) ta.value = data.text || '';
    const st = $('customInstructionsStatus');
    if (st) st.textContent = data.updatedAt ? `Ultimo guardado: ${new Date(data.updatedAt).toLocaleString('es-CO')}` : 'Sin instrucciones guardadas aun.';
  } catch (err) {
    logEvent('WARN', `loadCustomInstructions: ${err.message}`);
  }
}

async function saveCustomInstructions() {
  const ta = $('customInstructionsInput');
  const st = $('customInstructionsStatus');
  const text = ta ? ta.value : '';
  try {
    if (st) st.textContent = 'Guardando...';
    await window.quant.customInstructionsWrite(text);
    if (st) st.textContent = `Guardado: ${new Date().toLocaleString('es-CO')}`;
    logEvent('OK', 'Instrucciones personalizadas guardadas en disco');
  } catch (err) {
    if (st) st.textContent = 'Error al guardar.';
    logEvent('WARN', `saveCustomInstructions: ${err.message}`);
  }
}

const API_FIELD_INPUTS = {
  BINANCE_API_KEY: 'apiBinanceKey',
  BINANCE_SECRET: 'apiBinanceSecret',
  DEEPSEEK_API_KEY: 'apiDeepseekKey',
  DEEPINFRA_API_KEY: 'apiDeepinfraKey',
  DEFAULT_PROVIDER: 'apiDefaultProvider',
  QUANT_PRIMARY_MODEL: 'apiPrimaryModel',
  FINNHUB_API_KEY: 'apiFinnhubKey',
  ALPHA_VANTAGE_API_KEY: 'apiAlphaKey',
  MT5_ACCOUNT1_LOGIN: 'apiMt5Login',
  MT5_ACCOUNT1_PASSWORD: 'apiMt5Password',
  MT5_ACCOUNT1_SERVER: 'apiMt5Server',
  MT5_ACCOUNT2_LOGIN: 'apiMt5DemoLogin',
  MT5_ACCOUNT2_PASSWORD: 'apiMt5DemoPassword',
  MT5_ACCOUNT2_SERVER: 'apiMt5DemoServer',
  MT5_CONNECTOR_ENABLED: 'apiMt5Enabled',
  REAL_TRADING: 'apiRealTrading',
  QUANT_SYNC_URL: 'apiSyncUrl',
  QUANT_SYNC_KEY: 'apiSyncKey'
};

function isSensitiveApiField(key) {
  return /KEY|SECRET|PASSWORD|PASS/.test(key);
}

async function loadApiConfig() {
  const st = $('apiConfigStatus');
  try {
    const cfg = await window.quant.apiConfigRead();
    for (const [key, id] of Object.entries(API_FIELD_INPUTS)) {
      const el = $(id);
      if (!el) continue;
      if (isSensitiveApiField(key)) {
        el.value = '';
        el.placeholder = cfg.has?.[key] ? 'Guardada para esta sesion' : el.getAttribute('placeholder') || '';
      } else {
        el.value = cfg.values?.[key] || '';
      }
    }
    if (st) st.textContent = `Sesion: ${cfg.user?.email || 'local'} - ${cfg.file || 'configuracion en memoria'}`;
  } catch (err) {
    if (st) st.textContent = 'No pude cargar APIs.';
    logEvent('WARN', `loadApiConfig: ${err.message}`);
  }
}

async function saveApiConfig(event) {
  event.preventDefault();
  const st = $('apiConfigStatus');
  const payload = {};
  for (const [key, id] of Object.entries(API_FIELD_INPUTS)) {
    const el = $(id);
    if (!el) continue;
    const value = String(el.value || '').trim();
    if (isSensitiveApiField(key) && !value) continue;
    payload[key] = value;
  }
  try {
    if (st) st.textContent = 'Guardando APIs...';
    await window.quant.apiConfigWrite(payload);
    state.env = await window.quant.envStatus();
    renderStatus();
    await loadApiConfig();
    logEvent('OK', 'APIs guardadas para el usuario autenticado');
  } catch (err) {
    if (st) st.textContent = 'Error al guardar APIs.';
    logEvent('WARN', `saveApiConfig: ${err.message}`);
  }
}

async function loadCalibrationStatus() {
  try {
    const cal = await window.quant.calibrationRead();
    const st  = $('calibrationStatus');
    const det = $('calibrationDetail');
    if (!cal?.ok) {
      if (st)  st.textContent  = cal?.reason || 'Sin calibración guardada';
      if (det) det.textContent = '';
      return;
    }
    state.nightCalibration = cal;
    if (st)  st.textContent  = `Actualizado: ${new Date(cal.computedAt).toLocaleString('es-CO')}`;
    if (det) {
      const rows = Object.entries(cal.symbolRatios || {})
        .sort((a, b) => b[1].n - a[1].n).slice(0, 8)
        .map(([sym, v]) => `${sym}: hist ${(v.histWr * 100).toFixed(0)}% → live ${(v.liveWr * 100).toFixed(0)}% (×${v.ratio.toFixed(2)}, ${v.n} trades)`)
        .join('\n');
      det.textContent = `${cal.label}\n\nPor símbolo:\n${rows || 'Sin desglose por símbolo'}`;
    }
  } catch (err) {
    logEvent('WARN', `loadCalibrationStatus: ${err.message}`);
  }
}

// ── Conversaciones ────────────────────────────────────────────────────────────

function genConvId() {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function autoSaveConversation() {
  // Solo guarda si hay mensajes reales (excluye el saludo inicial)
  const msgs = state.messages.filter((m) => m.role !== 'system');
  if (msgs.length < 2) return;
  if (!state.conversationId) state.conversationId = genConvId();
  window.quant.conversationSave(state.conversationId, null, msgs).catch(() => {});
}

function startNewConversation() {
  // Guarda la sesión actual antes de crear una nueva
  autoSaveConversation();
  state.conversationId = genConvId();
  state.messages       = [];
  const box = $('chatLog');
  if (box) box.innerHTML = '';
  addChat('Quant', 'Nueva conversación iniciada. ¿En qué te ayudo?');
  setView('dashboard');
}

async function loadConversationsList() {
  const list = $('convList');
  if (!list) return;
  list.innerHTML = '<p style="color:#8fa3c0;font-size:13px">Cargando…</p>';
  try {
    const convs = await window.quant.conversationsList();
    if (!convs.length) {
      list.innerHTML = '<p style="color:#8fa3c0;font-size:13px">No hay conversaciones guardadas todavía. Las conversaciones se guardan automáticamente cuando hablas con Quant.</p>';
      return;
    }
    list.innerHTML = convs.map((c) => `
      <div class="conv-row" data-id="${escapeHtml(c.id)}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:6px;background:#0d1825;border:1px solid #1e3050;border-radius:8px;cursor:pointer">
        <div style="flex:1;min-width:0" class="conv-load-btn">
          <div style="font-weight:600;color:#c5d3e8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(c.name)}</div>
          <div style="font-size:12px;color:#5a7fa8;margin-top:2px">${new Date(c.updatedAt).toLocaleString('es-CO')} · ${c.messageCount} mensajes</div>
        </div>
        <button class="ghost-btn conv-rename-btn" style="padding:4px 10px;font-size:12px">✎ Renombrar</button>
        <button class="ghost-btn conv-delete-btn" style="padding:4px 10px;font-size:12px;color:#e05a5a;border-color:#e05a5a">✕ Eliminar</button>
      </div>`).join('');

    // Delegación de eventos
    list.querySelectorAll('.conv-load-btn').forEach((btn) => {
      btn.addEventListener('click', () => openConversation(btn.closest('.conv-row').dataset.id));
    });
    list.querySelectorAll('.conv-rename-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); showRenameDialog(btn.closest('.conv-row').dataset.id); });
    });
    list.querySelectorAll('.conv-delete-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); confirmDeleteConversation(btn.closest('.conv-row').dataset.id); });
    });
  } catch (err) {
    list.innerHTML = `<p style="color:#e05a5a;font-size:13px">Error cargando conversaciones: ${err.message}</p>`;
  }
}

// Boot cognitivo: si existe una conversación previa, la restaura silenciosamente.
// No emite mensajes teatrales. Si no hay nada que decir, no dice nada.
// Devuelve true si restauró contexto, false en caso contrario.
async function loadLastConversationIfAny() {
  try {
    const convs = await window.quant.conversationsList();
    if (!Array.isArray(convs) || convs.length === 0) return false;
    const sorted = [...convs].sort((a, b) => {
      const ta = new Date(a.updatedAt || 0).getTime();
      const tb = new Date(b.updatedAt || 0).getTime();
      return tb - ta;
    });
    const last = sorted[0];
    if (!last || !last.id) return false;
    const data = await window.quant.conversationLoad(last.id);
    if (!data || data.ok === false || !Array.isArray(data.messages)) return false;
    state.conversationId = last.id;
    state.messages = data.messages;
    const box = $('chatLog');
    if (!box) return false;
    box.innerHTML = '';
    for (const m of state.messages) {
      renderChatMessage(m.role === 'user' ? 'Tú' : 'Quant', m.content);
    }
    logEvent('OK', `Contexto restaurado: ${last.name || 'última conversación'}`);
    return true;
  } catch (err) {
    logEvent('WARN', `Restaurar contexto: ${err.message}`);
    return false;
  }
}

async function openConversation(id) {
  try {
    const data = await window.quant.conversationLoad(id);
    if (!data.ok) { alert(`No se pudo cargar la conversación: ${data.error}`); return; }
    // Guarda la sesión activa antes de cambiar
    autoSaveConversation();
    state.conversationId = id;
    state.messages = Array.isArray(data.messages) ? data.messages : [];
    // Renderizar en el chat
    const box = $('chatLog');
    if (box) {
      box.innerHTML = '';
      for (const m of state.messages) {
        addChat(m.role === 'user' ? 'Tú' : 'Quant', m.content);
      }
    }
    setView('dashboard');
    logEvent('OK', `Conversación cargada: ${data.name}`);
  } catch (err) {
    logEvent('WARN', `openConversation: ${err.message}`);
  }
}

let _renamingId = null;
function showRenameDialog(id) {
  _renamingId = id;
  const box = $('convRenameBox');
  const input = $('convRenameInput');
  if (!box || !input) return;
  input.value = '';
  box.style.display = 'block';
  input.focus();

  $('convRenameSaveBtn').onclick = async () => {
    const name = input.value.trim();
    if (!name) return;
    await window.quant.conversationRename(_renamingId, name);
    box.style.display = 'none';
    loadConversationsList();
  };
  $('convRenameCancelBtn').onclick = () => { box.style.display = 'none'; };
  input.onkeydown = (e) => { if (e.key === 'Enter') $('convRenameSaveBtn').click(); if (e.key === 'Escape') $('convRenameCancelBtn').click(); };
}

async function confirmDeleteConversation(id) {
  if (!confirm('¿Eliminar esta conversación? Esta acción no se puede deshacer.')) return;
  try {
    await window.quant.conversationDelete(id);
    if (state.conversationId === id) {
      state.conversationId = null;
      state.messages = [];
    }
    loadConversationsList();
    logEvent('OK', `Conversación ${id} eliminada`);
  } catch (err) {
    logEvent('WARN', `deleteConversation: ${err.message}`);
  }
}

async function manualCalibration() {
  const st  = $('calibrationStatus');
  const det = $('calibrationDetail');
  if (st) st.textContent = 'Calculando...';
  try {
    const cal = await window.quant.calibrationCompute();
    state.nightCalibration = cal;
    if (!cal?.ok) {
      if (st)  st.textContent  = cal?.reason || 'Insuficientes datos';
      if (det) det.textContent = '';
      return;
    }
    if (st) st.textContent = `Listo: ${new Date(cal.computedAt).toLocaleString('es-CO')}`;
    if (det) {
      const rows = Object.entries(cal.symbolRatios || {})
        .sort((a, b) => b[1].n - a[1].n).slice(0, 8)
        .map(([sym, v]) => `${sym}: hist ${(v.histWr * 100).toFixed(0)}% → live ${(v.liveWr * 100).toFixed(0)}% (×${v.ratio.toFixed(2)}, ${v.n} trades)`)
        .join('\n');
      det.textContent = `${cal.label}\n\nPor símbolo:\n${rows || 'Sin desglose por símbolo'}`;
    }
    logEvent('OK', `Calibración nocturna manual: ${cal.label}`);
  } catch (err) {
    if (st) st.textContent = `Error: ${err.message}`;
    logEvent('WARN', `manualCalibration: ${err.message}`);
  }
}

// ── Cálculo de tamaño por riesgo % ───────────────────────────────────────────
async function calcSizeFromRisk() {
  const symbol    = state.symbol;
  const stopPrice = parseFloat($('stopLossInput').value);
  const riskPct   = parseFloat($('riskPctInput').value  || '0.5');
  const entryPrice = state.ticker?.price ? parseFloat(state.ticker.price) : 0;
  const info = $('sizeCalcInfo');

  if (!stopPrice || stopPrice <= 0)  { if (info) info.textContent = 'Ingresa un precio de stop-loss.'; return; }
  if (!entryPrice || entryPrice <= 0) { if (info) info.textContent = 'Sin precio de mercado disponible.'; return; }
  if (Math.abs(entryPrice - stopPrice) / entryPrice < 0.0005) {
    if (info) info.textContent = 'Stop demasiado cercano al precio actual (< 0.05%).'; return;
  }

  if (info) info.textContent = 'Calculando…';
  try {
    const res = await window.quant.calcPositionSize(symbol, riskPct, entryPrice, stopPrice);
    if (res?.ok === false) { if (info) info.textContent = `Error: ${res.error}`; return; }
    $('qtyInput').value = res.qty;
    if (info) info.textContent =
      `Size: ${res.qty} ${symbol.replace(/USDT|BTC|ETH|BNB/, '')} · ` +
      `Riesgo: ${res.riskAmount.toFixed(2)} USDT (${riskPct}% de ${res.capital.toFixed(2)}) · ` +
      `Delta stop: ${res.priceDelta.toFixed(4)}`;
    logEvent('OK', `Size calculado: ${res.qty} ${symbol} @ riesgo ${riskPct}%`);
  } catch (err) {
    if (info) info.textContent = `Error: ${err.message}`;
    logEvent('WARN', `calcSizeFromRisk: ${err.message}`);
  }
}

// ── Envío de orden (real o bloqueada) ────────────────────────────────────────
async function submitOrder(side) {
  const symbol      = state.symbol;
  const venue       = state.platform;
  const qty         = parseFloat($('qtyInput').value);
  const orderType   = $('orderType').value || 'MARKET';
  const limitPrice  = parseFloat($('limitPriceInput').value) || null;
  const stopPrice   = parseFloat($('stopLossInput').value)   || null;
  const confirmation = $('confirmInput').value.trim().toUpperCase();
  const expected     = `CONFIRMO ${side} ${symbol}`.toUpperCase();
  const rb           = $('orderResultBox');

  // ── Candado 1: REAL_TRADING desactivado ────────────────────────────────
  if (!state.env.realTrading) {
    logEvent('WARN', `Orden ${side} ${symbol} bloqueada: REAL_TRADING=false`);
    window.quant.memoryWrite('trade', { status: 'blocked', reason: 'REAL_TRADING=false', side, symbol, qty, venue, stopPrice, macro_context: currentNewsContext(symbol) }).then(loadMemoryStats);
    if (rb) { rb.style.display = 'block'; rb.style.color = '#e05a5a'; rb.textContent = `⛔ Bloqueada: REAL_TRADING=false en .env. Actívalo y reinicia la app para operar real.`; }
    return;
  }

  // ── Candado 2: venue distinto de BINANCE ───────────────────────────────
  if (venue !== 'BINANCE') {
    if (rb) { rb.style.display = 'block'; rb.style.color = '#e09a3a'; rb.textContent = `⚠ Ejecución real actualmente solo disponible en BINANCE. Cambia el venue.`; }
    return;
  }

  // ── Candado 3: validaciones básicas ───────────────────────────────────
  if (!qty || qty <= 0) { if (rb) { rb.style.display='block'; rb.style.color='#e05a5a'; rb.textContent='Cantidad inválida.'; } return; }
  if (orderType === 'LIMIT' && (!limitPrice || limitPrice <= 0)) {
    if (rb) { rb.style.display='block'; rb.style.color='#e05a5a'; rb.textContent='Ingresa un precio límite.'; } return;
  }

  // ── Candado 4: confirmación textual exacta ─────────────────────────────
  if (confirmation !== expected) {
    logEvent('WARN', `Orden ${side} ${symbol} bloqueada: confirmación incorrecta`);
    if (rb) { rb.style.display='block'; rb.style.color='#e09a3a'; rb.textContent=`⚠ Escribe exactamente: ${expected}`; }
    return;
  }

  // ── Macro risk gate ────────────────────────────────────────────────────
  const macro = macroRiskLevel(symbol);
  if (macro.risk === 'high') {
    const ok = confirm(`⚠ Riesgo macro ALTO: ${macro.reasons.join(', ')}.\n¿Confirmas igualmente la orden ${side} ${qty} ${symbol}?`);
    if (!ok) { if (rb) { rb.style.display='block'; rb.style.color='#e09a3a'; rb.textContent='Orden cancelada por riesgo macro.'; } return; }
  }

  // ── Envío ──────────────────────────────────────────────────────────────
  if (rb) { rb.style.display='block'; rb.style.color='#8fa3c0'; rb.textContent=`Enviando ${orderType} ${side} ${qty} ${symbol}…`; }
  logEvent('OK', `Enviando orden real: ${orderType} ${side} ${qty} ${symbol}`);

  try {
    const res = await window.quant.placeOrder(side, symbol, qty, orderType, limitPrice);
    if (!res.ok) throw new Error(res.error || 'Error desconocido');

    const msg = `✅ ${res.status} · ID ${res.orderId} · ${res.qty} ${symbol.replace(/USDT$/, '')} @ ${fmtPrice(res.price)} · ${fmtPrice(res.notional)} USDT`;
    if (rb) { rb.style.display='block'; rb.style.color='#4caf7d'; rb.textContent=msg; }
    logEvent('OK', `Orden ejecutada: ${msg}`);

    await window.quant.memoryWrite('trade', {
      status: 'executed', orderId: res.orderId, side, symbol, qty: res.qty,
      price: res.price, notional: res.notional, type: orderType, venue,
      stopPrice: stopPrice || null,
      macro_risk: macro.risk,
      fills: res.fills,
      ts: new Date().toISOString()
    });
    loadMemoryStats();

    // Limpiar confirmación para evitar doble envío accidental
    $('confirmInput').value = '';

    // Disparar alerta de email si está configurado
    if (_alertConfig?.enabled) {
      window.quant.sendAlert(
        `Orden ejecutada: ${side} ${symbol}`,
        `${orderType} ${side} ${qty} ${symbol} ejecutada.\nID: ${res.orderId}\nPrecio promedio: ${fmtPrice(res.price)}\nNotional: ${fmtPrice(res.notional)} USDT\nStop configurado: ${stopPrice ? fmtPrice(stopPrice) : 'no especificado'}`
      ).catch(() => {});
    }
  } catch (err) {
    if (rb) { rb.style.display='block'; rb.style.color='#e05a5a'; rb.textContent=`❌ ${err.message}`; }
    logEvent('ERR', `Orden fallida: ${err.message}`);
    await window.quant.memoryWrite('trade', { status: 'error', reason: err.message, side, symbol, qty, venue, ts: new Date().toISOString() });
    loadMemoryStats();
  }
}

function updateClock() {
  const now = new Date();
  $('clockNow').textContent = now.toTimeString().slice(0, 8);
  $('dateNow').textContent = now.toLocaleDateString('es-CO');
}

// PHASE 1: Update hero section with live data
// PHASE 2: Update hero section with real data from Quant API Contract v1
async function updateHeroSection() {
  if (!window.heroController) return;

  try {
    // Fetch bot status from contract v1 (every 3 seconds)
    const statusResponse = await fetch(window.quantConfig.getEndpoint('/api/status'), {
      credentials: 'include'
    });

    if (statusResponse.status === 401) {
      // Not authenticated - show UI but don't update state
      window.heroController.updateUI();
      return;
    }

    if (statusResponse.status !== 200) {
      // Server error or other issue - update UI with current local state
      window.heroController.updateUI();
      return;
    }

    const statusData = await statusResponse.json();
    // statusData: {ok: true, bot: BotState, risk: RiskValidation, adapters: AdaptersSummary}
    // BotState: {tradingRealEnabled, trainingEnabled, killSwitch, paperMode, updatedAt}

    if (statusData.bot) {
      // Sync local state with backend authoritative state
      window.quantStateManager.tradingReal.enabled = statusData.bot.tradingRealEnabled;
      window.quantStateManager.training.enabled = statusData.bot.trainingEnabled;
      window.quantStateManager.killSwitch.enabled = statusData.bot.killSwitch;
      window.quantStateManager.tradingReal.lastUpdated = new Date(statusData.bot.updatedAt);
      window.quantStateManager.training.lastUpdated = new Date(statusData.bot.updatedAt);
      window.quantStateManager.killSwitch.lastUpdated = new Date(statusData.bot.updatedAt);
    }

    // Update hero controller UI with synced state
    window.heroController.updateUI();

    // Fetch trades for P&L calculation (less frequently - every 10 seconds)
    const now = Date.now();
    if (!window._lastTradesFetch || now - window._lastTradesFetch > 10000) {
      window._lastTradesFetch = now;

      try {
        const tradesResponse = await fetch(window.quantConfig.getEndpoint('/api/trades'), {
          credentials: 'include'
        });

        if (tradesResponse.status === 200) {
          const tradesData = await tradesResponse.json();
          // tradesData: {items: [MemoryRecord]}
          // MemoryRecord: {ts, kind, payload}

          if (Array.isArray(tradesData.items)) {
            const today = new Date().toDateString();
            let pnlToday = 0;
            let lastTrade = null;

            tradesData.items.forEach((record) => {
              const recordDate = new Date(record.ts).toDateString();
              if (recordDate === today && record.payload) {
                // Extract P&L from payload if available
                if (record.payload.realizedProfit) {
                  pnlToday += Number(record.payload.realizedProfit) || 0;
                }
                if (!lastTrade || new Date(record.ts) > new Date(lastTrade.ts)) {
                  lastTrade = record;
                }
              }
            });

            const estimatedDailyCapital = 10000;
            const pnlPercent = estimatedDailyCapital > 0 ? (pnlToday / estimatedDailyCapital) * 100 : 0;
            window.heroController.updatePnL(pnlToday, pnlPercent);

            if (lastTrade) {
              const side = lastTrade.payload?.side || 'TRADE';
              const symbol = lastTrade.payload?.symbol || state.symbol;
              const price = lastTrade.payload?.price || '--';
              const timeAgo = getTimeAgoText(new Date(lastTrade.ts));
              window.heroController.updateLastAction(`${side} ${symbol} @ ${price} • ${timeAgo}`);
            } else {
              window.heroController.updateLastAction('No operations yet');
            }
          }
        }
      } catch (err) {
        // Silently fail trades fetch
      }
    }

    // Fetch signals for confidence (less frequently - every 15 seconds)
    if (!window._lastSignalsFetch || now - window._lastSignalsFetch > 15000) {
      window._lastSignalsFetch = now;

      try {
        const signalsResponse = await fetch(window.quantConfig.getEndpoint('/api/signals'), {
          credentials: 'include'
        });

        if (signalsResponse.status === 200) {
          const signalsData = await signalsResponse.json();
          // signalsData: {items: [MemoryRecord]}

          if (Array.isArray(signalsData.items) && signalsData.items.length > 0) {
            const latestSignal = signalsData.items[signalsData.items.length - 1];
            // Extract confidence from payload if available
            const confidence = Math.min(100, Math.max(0, latestSignal.payload?.strength || 0) * 100);
            window.heroController.updateConfidence(Math.round(confidence));
          }
        }
      } catch (err) {
        // Silently fail signals fetch
      }
    }
  } catch (err) {
    // Silently handle update errors
    console.error('[HERO] Update error:', err);
  }
}

function getTimeAgoText(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// PHASE 2: Consume Quant API Contract v1 - Trading Real endpoints
async function setTradingRealBackend(enabled) {
  try {
    const endpoint = enabled
      ? window.quantConfig.getEndpoint('/api/bot/trading-real/on')
      : window.quantConfig.getEndpoint('/api/bot/trading-real/off');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({})
    });

    // Handle HTTP status codes per contract
    if (response.status === 401) {
      logEvent('ERR', 'Trading Real: Not authenticated');
      return false;
    }
    if (response.status === 409) {
      const error = await response.json();
      logEvent('ERR', `Trading Real conflict: ${error.error || 'Unknown conflict'}`);
      return false;
    }
    if (response.status === 500) {
      logEvent('ERR', 'Trading Real: Server error');
      return false;
    }
    if (response.status === 200) {
      const botState = await response.json();
      // BotState: {tradingRealEnabled, trainingEnabled, killSwitch, paperMode, updatedAt}
      logEvent('OK', `Trading Real: ${botState.tradingRealEnabled ? 'ON' : 'OFF'}`);
      updateHeroSection();
      return true;
    }
    logEvent('ERR', `Trading Real: Unexpected status ${response.status}`);
    return false;
  } catch (err) {
    logEvent('ERR', `Trading Real API error: ${err.message}`);
    return false;
  }
}

async function setTrainingBackend(enabled) {
  try {
    const endpoint = enabled
      ? window.quantConfig.getEndpoint('/api/bot/training/on')
      : window.quantConfig.getEndpoint('/api/bot/training/off');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({})
    });

    // Handle HTTP status codes per contract
    if (response.status === 401) {
      logEvent('ERR', 'Training: Not authenticated');
      return false;
    }
    if (response.status === 500) {
      logEvent('ERR', 'Training: Server error');
      return false;
    }
    if (response.status === 200) {
      const botState = await response.json();
      logEvent('OK', `Training: ${botState.trainingEnabled ? 'ON' : 'OFF'}`);
      updateHeroSection();
      return true;
    }
    logEvent('ERR', `Training: Unexpected status ${response.status}`);
    return false;
  } catch (err) {
    logEvent('ERR', `Training API error: ${err.message}`);
    return false;
  }
}

async function setKillSwitchBackend(enabled) {
  try {
    const endpoint = enabled
      ? window.quantConfig.getEndpoint('/api/bot/kill-switch/on')
      : window.quantConfig.getEndpoint('/api/bot/kill-switch/off');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({})
    });

    if (response.status === 401) {
      logEvent('ERR', 'Kill Switch: Not authenticated');
      return false;
    }
    if (response.status === 500) {
      logEvent('ERR', 'Kill Switch: Server error');
      return false;
    }
    if (response.status === 200) {
      const botState = await response.json();
      logEvent('OK', `Kill Switch: ${botState.killSwitch ? 'ON' : 'OFF'}`);
      updateHeroSection();
      return true;
    }

    logEvent('ERR', `Kill Switch: Unexpected status ${response.status}`);
    return false;
  } catch (err) {
    logEvent('ERR', `Kill Switch API error: ${err.message}`);
    return false;
  }
}

// PHASE 2: Connect state manager to Quant API Contract v1 endpoints
if (window.quantStateManager) {
  // Override toggle methods to call backend via contract
  const originalToggleTradingReal = window.quantStateManager.toggleTradingReal;
  window.quantStateManager.toggleTradingReal = async function(enable) {
    const success = await setTradingRealBackend(enable);
    if (success) {
      originalToggleTradingReal.call(this, enable);
    }
  };

  const originalToggleTraining = window.quantStateManager.toggleTraining;
  window.quantStateManager.toggleTraining = async function(enable) {
    const success = await setTrainingBackend(enable);
    if (success) {
      originalToggleTraining.call(this, enable);
    }
  };

  const originalSetKillSwitch = window.quantStateManager.setKillSwitch;
  window.quantStateManager.setKillSwitch = async function(enable) {
    const success = await setKillSwitchBackend(enable);
    if (success) {
      originalSetKillSwitch.call(this, enable);
    }
  };
}

function drawPerf() {
  const canvas = $('perfChart');
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, rect.width * dpr);
  canvas.height = Math.max(1, rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#101927'; ctx.fillRect(0, 0, rect.width, rect.height);
  ctx.strokeStyle = '#2e4268'; ctx.beginPath(); ctx.moveTo(14, rect.height / 2); ctx.lineTo(rect.width - 14, rect.height / 2); ctx.stroke();
  ctx.strokeStyle = '#2979ff'; ctx.beginPath(); ctx.moveTo(14, rect.height / 2 - 2); ctx.lineTo(rect.width - 14, rect.height / 2 - 2); ctx.stroke();
}

window.addEventListener('resize', () => { drawChart(); drawGauge(64); drawPerf(); });
window.addEventListener('beforeunload', () => { saveTrainingState(); });
boot();
