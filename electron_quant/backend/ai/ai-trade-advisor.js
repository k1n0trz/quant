// AI trade advisor: an LLM (Claude) actually DECIDES each trade.
//
// The autonomous engine used to open trades from a mechanical signal with no
// intelligence in the loop. This module puts the model in charge of the
// decision: given real trend/technical data (multi-timeframe candles), recent
// news, the live account funds and the broker's minimum stop distance, the
// model returns a strict JSON verdict (OPEN/SKIP, side, SL, TP, confidence,
// reasoning). The orchestrator feeds it REAL data via injected deps and clamps
// the SL/TP so they are always valid (fixes the broker's [invalid stops]).

function finiteNumber(...values) {
  for (const v of values) {
    if (v === null || v === undefined || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function round(value, digits = 5) {
  const f = Math.pow(10, digits);
  return Math.round(Number(value) * f) / f;
}

// Compact technical summary of a candle series (oldest->newest OHLC).
function summarizeCandles(candles = [], label = '') {
  const rows = (Array.isArray(candles) ? candles : [])
    .map((c) => ({
      o: finiteNumber(c.o, c.open),
      h: finiteNumber(c.h, c.high),
      l: finiteNumber(c.l, c.low),
      c: finiteNumber(c.c, c.close)
    }))
    .filter((c) => c.c !== null);
  if (rows.length < 3) return { label, available: false };
  const closes = rows.map((r) => r.c);
  const last = closes[closes.length - 1];
  const first = closes[0];
  const high = Math.max(...rows.map((r) => r.h));
  const low = Math.min(...rows.map((r) => r.l));
  // Average true range (volatility) over the window.
  let trSum = 0;
  for (let i = 1; i < rows.length; i++) {
    const prevClose = rows[i - 1].c;
    trSum += Math.max(rows[i].h - rows[i].l, Math.abs(rows[i].h - prevClose), Math.abs(rows[i].l - prevClose));
  }
  const atr = trSum / Math.max(1, rows.length - 1);
  const changePct = first ? ((last - first) / first) * 100 : 0;
  // Simple slope of the last third vs first third.
  const third = Math.max(1, Math.floor(closes.length / 3));
  const earlyAvg = closes.slice(0, third).reduce((a, b) => a + b, 0) / third;
  const lateAvg = closes.slice(-third).reduce((a, b) => a + b, 0) / third;
  const trend = lateAvg > earlyAvg * 1.0005 ? 'UP' : lateAvg < earlyAvg * 0.9995 ? 'DOWN' : 'FLAT';
  return {
    label,
    available: true,
    bars: rows.length,
    lastClose: last,
    windowHigh: high,
    windowLow: low,
    changePct: Number(changePct.toFixed(3)),
    atr,
    trend
  };
}

// Summarize recent trade outcomes on a pair so the AI LEARNS from its history
// (stops repeating losers) instead of deciding each trade in a vacuum.
function summarizeOutcomes(trades = []) {
  const rows = (Array.isArray(trades) ? trades : [])
    .map((t) => ({ pnl: finiteNumber(t.pnl, t.pnl_demo, t.profit, t.netPnl), ts: t.ts || t.closed_timestamp || t.closed_at || null }))
    .filter((t) => t.pnl !== null);
  if (!rows.length) return { available: false, count: 0 };
  const wins = rows.filter((r) => r.pnl > 0).length;
  const losses = rows.filter((r) => r.pnl < 0).length;
  const net = rows.reduce((a, b) => a + b.pnl, 0);
  const last = rows.slice(-8).map((r) => Number(r.pnl.toFixed(2)));
  // consecutive losses at the tail = warning to be cautious
  let streak = 0;
  for (let i = rows.length - 1; i >= 0; i--) { if (rows[i].pnl < 0) streak++; else break; }
  return {
    available: true,
    count: rows.length,
    wins,
    losses,
    winRate: rows.length ? Number(((wins / rows.length) * 100).toFixed(0)) : 0,
    netPnl: Number(net.toFixed(2)),
    lossStreak: streak,
    last
  };
}

function newsHeadlines(news = [], max = 6) {
  return (Array.isArray(news) ? news : [])
    .map((n) => (typeof n === 'string' ? n : (n.headline || n.title || n.summary || '')))
    .map((h) => String(h).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, max);
}

// Minimum stop distance (price units) the SL/TP must clear to be valid: the
// larger of the broker's reported stops level and a volatility floor (ATR).
function resolveMinStopDistance({ atr, brokerMinDistance, marketPrice }) {
  const vol = finiteNumber(atr) || 0;
  const broker = finiteNumber(brokerMinDistance) || 0;
  const floor = (finiteNumber(marketPrice) || 0) * 0.0008; // 0.08% safety floor
  return Math.max(vol, broker, floor);
}

function buildTradeDecisionMessages(ctx = {}) {
  const {
    symbol, venue, marketPrice, spread, funds = {}, minStopDistance,
    h1, m15, h4, news = [], maxRiskUsd, outcomes
  } = ctx;
  const system = [
    'Eres el cerebro de trading de Quant: un analista cuantitativo que decide operaciones reales con dinero real.',
    'Analizas tendencia multi-timeframe, volatilidad (ATR), niveles y noticias antes de decidir. Priorizas PRECISION sobre frecuencia: si no hay ventaja clara, NO operas (SKIP).',
    'Eres consciente de los fondos reales y del costo (spread): nunca arriesgas mas de lo permitido y nunca pones SL/TP mas cerca que la distancia minima indicada.',
    'Respondes UNICAMENTE con un objeto JSON valido, sin texto adicional, sin markdown.'
  ].join(' ');

  const tf = (s) => s && s.available
    ? `${s.label}: tendencia=${s.trend}, cambio=${s.changePct}%, ult=${s.lastClose}, max=${s.windowHigh}, min=${s.windowLow}, ATR=${round(s.atr, 6)}`
    : `${s ? s.label : '?'}: sin datos`;

  const user = [
    `Par: ${symbol} (${venue}). Precio actual: ${marketPrice}. Spread aprox: ${spread ?? 'n/d'}.`,
    `Fondos reales: equity=${funds.equity ?? 'n/d'} ${funds.currency || ''}. Riesgo maximo permitido en esta operacion: ${maxRiskUsd ?? 'n/d'} USD.`,
    `Distancia minima valida para SL/TP (en precio): ${round(minStopDistance, 6)}. El SL y el TP DEBEN estar al menos a esa distancia del precio actual y del lado correcto.`,
    `Tecnico:`,
    `  ${tf(h4)}`,
    `  ${tf(h1)}`,
    `  ${tf(m15)}`,
    news.length ? `Noticias recientes:\n  - ${newsHeadlines(news).join('\n  - ')}` : 'Noticias: sin titulares relevantes disponibles.',
    outcomes && outcomes.available
      ? `Tu historial reciente en ${symbol}: ${outcomes.wins}G/${outcomes.losses}P (${outcomes.winRate}% aciertos), PnL neto ${outcomes.netPnl}, ultimas: [${outcomes.last.join(', ')}]${outcomes.lossStreak >= 3 ? `. ATENCION: ${outcomes.lossStreak} perdidas seguidas en este par, se MUY exigente o evita.` : ''}`
      : `Sin historial reciente en ${symbol}.`,
    '',
    'Decide si abrir una operacion AHORA. Considera: tu historial reciente en el par (aprende de tus perdidas), alineacion de tendencia entre timeframes, si el precio no esta sobre-extendido, si hay noticia de alto impacto que aconseje esperar, y un ratio riesgo/beneficio de al menos 1:1.5.',
    'Responde con este JSON exacto:',
    '{"decision":"OPEN|SKIP","side":"BUY|SELL","stopLossPrice":number,"takeProfitPrice":number,"confidence":0-100,"reasoning":"una frase corta en espanol"}',
    'Si decision es SKIP, igual incluye side/SL/TP con tu mejor estimado pero NO se ejecutara. Reasoning siempre obligatorio.'
  ].join('\n');

  return { system, user };
}

function parseTradeDecision(text) {
  const raw = String(text || '');
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, reason: 'no_json_in_response' };
  let obj;
  try { obj = JSON.parse(match[0]); } catch { return { ok: false, reason: 'invalid_json' }; }
  const decision = String(obj.decision || '').trim().toUpperCase();
  const side = String(obj.side || '').trim().toUpperCase();
  if (decision !== 'OPEN' && decision !== 'SKIP') return { ok: false, reason: 'invalid_decision', raw: obj };
  return {
    ok: true,
    decision,
    side: side === 'BUY' || side === 'SELL' ? side : null,
    stopLossPrice: finiteNumber(obj.stopLossPrice, obj.sl, obj.stopLoss),
    takeProfitPrice: finiteNumber(obj.takeProfitPrice, obj.tp, obj.takeProfit),
    confidence: finiteNumber(obj.confidence),
    reasoning: String(obj.reasoning || '').slice(0, 240)
  };
}

// Ensure SL/TP are on the correct side and at least minStopDistance away.
function validateAndClampDecision(decision, { marketPrice, minStopDistance, digits = 5 }) {
  if (!decision.ok || decision.decision !== 'OPEN') return decision;
  const price = finiteNumber(marketPrice);
  const minDist = Math.max(0, finiteNumber(minStopDistance) || 0);
  const side = decision.side;
  if (price === null || !side) return { ...decision, ok: false, reason: 'missing_price_or_side' };
  let sl = finiteNumber(decision.stopLossPrice);
  let tp = finiteNumber(decision.takeProfitPrice);
  // default distances if the model omitted/garbled them
  if (sl === null) sl = side === 'BUY' ? price - minDist * 1.5 : price + minDist * 1.5;
  if (tp === null) tp = side === 'BUY' ? price + minDist * 2.5 : price - minDist * 2.5;
  if (side === 'BUY') {
    sl = Math.min(sl, price - minDist);
    tp = Math.max(tp, price + minDist);
  } else {
    sl = Math.max(sl, price + minDist);
    tp = Math.min(tp, price - minDist);
  }
  return { ...decision, stopLoss: round(sl, digits), takeProfit: round(tp, digits) };
}

// Orchestrate a decision using injected deps (testable without real network).
//   deps.getCandles(symbol, timeframe, count) -> [{o,h,l,c}]
//   deps.getNews(symbol) -> [headlines]
//   deps.getFunds() -> { equity, balance, currency }
//   deps.getMarket(symbol) -> { price, spread, brokerMinDistance, digits }
//   deps.callModel({system,user}) -> string
async function decideTrade({ symbol, venue = 'MT5', deps = {}, env = {}, logger = null } = {}) {
  if (typeof deps.callModel !== 'function' || typeof deps.getCandles !== 'function' || typeof deps.getMarket !== 'function') {
    return { ok: false, executed: false, reason: 'advisor_deps_missing' };
  }
  const market = await deps.getMarket(symbol).catch(() => null);
  const marketPrice = finiteNumber(market?.price);
  if (marketPrice === null || marketPrice <= 0) return { ok: false, executed: false, reason: 'no_market_price', symbol };

  const [h4, h1, m15] = await Promise.all([
    deps.getCandles(symbol, 'H4', 60).catch(() => []),
    deps.getCandles(symbol, 'H1', 60).catch(() => []),
    deps.getCandles(symbol, 'M15', 60).catch(() => [])
  ]);
  const sumH1 = summarizeCandles(h1, 'H1');
  const minStopDistance = resolveMinStopDistance({
    atr: sumH1.available ? sumH1.atr : marketPrice * 0.001,
    brokerMinDistance: market?.brokerMinDistance,
    marketPrice
  });
  const news = typeof deps.getNews === 'function' ? await deps.getNews(symbol).catch(() => []) : [];
  const funds = typeof deps.getFunds === 'function' ? (await deps.getFunds().catch(() => ({})) || {}) : {};
  const outcomes = typeof deps.getRecentOutcomes === 'function'
    ? summarizeOutcomes(await deps.getRecentOutcomes(symbol).catch(() => []))
    : { available: false };
  const maxRiskUsd = finiteNumber(env.MT5_REAL_RISK_PER_TRADE_PCT) && funds.equity
    ? round((Number(funds.equity) * Number(env.MT5_REAL_RISK_PER_TRADE_PCT)) / 100, 2)
    : null;

  const messages = buildTradeDecisionMessages({
    symbol, venue, marketPrice, spread: market?.spread, funds, minStopDistance, maxRiskUsd, news, outcomes,
    h4: summarizeCandles(h4, 'H4'), h1: sumH1, m15: summarizeCandles(m15, 'M15')
  });

  let text;
  try { text = await deps.callModel(messages); }
  catch (error) { return { ok: false, executed: false, reason: 'model_call_failed', error: String(error?.message || error), symbol }; }

  const parsed = parseTradeDecision(text);
  if (!parsed.ok) return { ok: false, executed: false, reason: parsed.reason, symbol, modelText: String(text || '').slice(0, 200) };
  if (parsed.decision === 'SKIP') {
    if (logger?.info) logger.info('ai.trade.skip', { symbol, reason: parsed.reasoning });
    return { ok: true, executed: false, decision: 'SKIP', symbol, confidence: parsed.confidence, reasoning: parsed.reasoning };
  }
  const clamped = validateAndClampDecision(parsed, { marketPrice, minStopDistance, digits: finiteNumber(market?.digits) || 5 });
  if (!clamped.ok) return { ok: false, executed: false, reason: clamped.reason, symbol };

  return {
    ok: true,
    executed: false,
    decision: 'OPEN',
    symbol,
    venue,
    side: clamped.side,
    entryPrice: marketPrice,
    stopLoss: clamped.stopLoss,
    takeProfit: clamped.takeProfit,
    confidence: clamped.confidence,
    reasoning: clamped.reasoning
  };
}

module.exports = {
  summarizeCandles,
  summarizeOutcomes,
  buildTradeDecisionMessages,
  parseTradeDecision,
  validateAndClampDecision,
  resolveMinStopDistance,
  decideTrade
};
