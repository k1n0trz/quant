// Operator playbook — encodes Edi's manual trading rules so the system executes
// HIS method with the discipline a human can't always keep (no impulse, no
// off-hours entries, never "forgets" gold is volatile). Rules captured 2026-06-22:
//  - RSI(14): BUY when it dips into oversold and turns up (ideally still <=30,
//    tolerated up to ~35 "asomando la cabeza"); SELL symmetric at the 70 zone.
//  - Moving averages 40/100/200: when they touch/converge => consolidation =>
//    STAND ASIDE (no clear sentiment). When fanned and ordered => trend; take
//    RSI reversals only in the trend's direction (buy dips up-trend / sell pops
//    down-trend).
//  - Targets/risk ~ $1–$2 per trade at 0.01 lots.
//  - Sessions (Colombia, UTC-5): trade 05:00–09:00 and 18:00–21:00; NEVER
//    15:00–17:00; Friday only the morning; never weekends.
//  - Max ~24h hold (swap aware); trail to lock >=$1.5 once >$2 in profit.

function finite(n) { const x = Number(n); return Number.isFinite(x) ? x : null; }

// Wilder's RSI; returns an array aligned to `closes` (first `period` are null).
function computeRsi(closes, period = 14) {
  if (!Array.isArray(closes) || closes.length < period + 1) return [];
  const rsi = new Array(closes.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i] - closes[i - 1];
    if (ch >= 0) gain += ch; else loss -= ch;
  }
  let avgGain = gain / period, avgLoss = loss / period;
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    rsi[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsi;
}

function computeSma(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

// Are the 40/100/200 SMAs converged (touching => chop) or fanned & ordered (trend)?
// convergePct is the max-min spread as a % of price below which we call it chop.
function maRegime(closes, { periods = [40, 100, 200], convergePct = 0.12 } = {}) {
  const mas = periods.map((p) => computeSma(closes, p));
  if (mas.some((m) => m === null)) return { trend: 'UNKNOWN', reason: 'insufficient_history', mas, periods };
  const price = closes[closes.length - 1];
  const spreadPct = price ? (Math.max(...mas) - Math.min(...mas)) / price * 100 : 0;
  if (spreadPct < convergePct) return { trend: 'CHOP', spreadPct, mas, periods, reason: 'mas_converged' };
  // Ordered fast>...>slow = up-trend; fast<...<slow = down-trend (works for any
  // number of periods, so the MA set can adapt to the available history).
  let descending = true, ascending = true;
  for (let i = 0; i < mas.length - 1; i++) {
    if (!(mas[i] > mas[i + 1])) descending = false;
    if (!(mas[i] < mas[i + 1])) ascending = false;
  }
  if (descending) return { trend: 'UP', spreadPct, mas, periods };
  if (ascending) return { trend: 'DOWN', spreadPct, mas, periods };
  return { trend: 'MIXED', spreadPct, mas, periods, reason: 'mas_not_ordered' };
}

// RSI reversal trigger per Edi's rule: dip into <=lowZone then turning up (best
// before crossing 30, tolerated up to lowTol); symmetric for the sell side.
function rsiEntrySignal(rsi, { lowZone = 30, lowTol = 35, highZone = 70, highTol = 65, lookback = 6 } = {}) {
  const n = rsi.length;
  if (n < 3) return { side: null, reason: 'insufficient_rsi' };
  const cur = rsi[n - 1], prev = rsi[n - 2];
  if (cur === null || prev === null) return { side: null, reason: 'no_rsi' };
  const look = rsi.slice(Math.max(0, n - lookback)).filter((v) => v !== null);
  if (!look.length) return { side: null, reason: 'no_rsi' };
  const recentMin = Math.min(...look), recentMax = Math.max(...look);
  if (recentMin <= lowZone && cur > prev && cur <= lowTol) {
    return { side: 'BUY', rsi: cur, reason: `RSI ${cur.toFixed(1)} girando al alza desde sobreventa (min ${recentMin.toFixed(1)})` };
  }
  if (recentMax >= highZone && cur < prev && cur >= highTol) {
    return { side: 'SELL', rsi: cur, reason: `RSI ${cur.toFixed(1)} girando a la baja desde sobrecompra (max ${recentMax.toFixed(1)})` };
  }
  return { side: null, rsi: cur, reason: 'sin gatillo RSI' };
}

// Colombia is UTC-5 all year (no DST).
function colombiaParts(date) {
  const d = new Date(date.getTime() - 5 * 3600 * 1000);
  return { day: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

// Edi's session windows. Returns { open, window, reason }.
function inOperatorSession(date = new Date()) {
  const { day, hour } = colombiaParts(date);
  if (day === 0 || day === 6) return { open: false, reason: 'fin_de_semana' };
  if (hour >= 15 && hour < 17) return { open: false, reason: 'ventana_prohibida_15_17' };
  const morning = hour >= 5 && hour < 9;
  const evening = hour >= 18 && hour < 21;
  if (day === 5) { // Friday: only the morning, close by ~1pm
    return morning ? { open: true, window: 'manana', reason: 'viernes_manana' } : { open: false, reason: 'viernes_tarde_prohibido' };
  }
  if (morning) return { open: true, window: 'manana' };
  if (evening) return { open: true, window: 'noche' };
  return { open: false, reason: 'fuera_de_ventana' };
}

function pipSizeForDigits(digits) {
  return (Number(digits) >= 4) ? 0.0001 : 0.01;
}

// Translate Edi's $ risk/target into price-distance SL/TP using the pair's pip value.
function operatorTargets({ side, price, digits = 5, pipValueUsd = 0.1, riskUsd = 1.5, targetUsd = 2, minDistance = 0 }) {
  const pip = pipSizeForDigits(digits);
  const slPips = Math.max(1, riskUsd / Math.max(1e-9, pipValueUsd));
  const tpPips = Math.max(1, targetUsd / Math.max(1e-9, pipValueUsd));
  const slDist = Math.max(slPips * pip, minDistance);
  const tpDist = Math.max(tpPips * pip, minDistance);
  const round = (x) => Number(x.toFixed(digits));
  if (side === 'BUY') return { stopLoss: round(price - slDist), takeProfit: round(price + tpDist), slPips, tpPips };
  return { stopLoss: round(price + slDist), takeProfit: round(price - tpDist), slPips, tpPips };
}

// Trailing: once >$2 in profit, lock >=$1.5 by pulling the SL to a profit lock.
function operatorTrailing({ side, entryPrice, profitUsd, pipValueUsd = 0.1, digits = 5, lockUsd = 1.5 }) {
  if (!(finite(profitUsd) > 2)) return null;
  const pip = pipSizeForDigits(digits);
  const lockDist = (lockUsd / Math.max(1e-9, pipValueUsd)) * pip;
  const round = (x) => Number(x.toFixed(digits));
  const stopLoss = side === 'BUY' ? round(entryPrice + lockDist) : round(entryPrice - lockDist);
  return { stopLoss, reason: `asegura $${lockUsd} (posición >$2 en ganancia)` };
}

// Full playbook verdict for a pair, given its close series and the moment.
function evaluateOperatorSetup({
  closes, nowMs, price, digits = 5, pipValueUsd = 0.1,
  riskUsd = 1.5, targetUsd = 2, minDistance = 0, allowOutOfSession = false, maOptions, rsiOptions
} = {}) {
  const periods = (maOptions && Array.isArray(maOptions.periods)) ? maOptions.periods : [40, 100, 200];
  const minBars = Math.max(...periods) + 5;
  if (!Array.isArray(closes) || closes.length < minBars) {
    return { matches: false, reason: `historial_insuficiente (se requieren >=${minBars} velas para MA${Math.max(...periods)})` };
  }
  const session = inOperatorSession(new Date(nowMs || Date.now()));
  if (!session.open && !allowOutOfSession) return { matches: false, reason: `fuera_de_sesion:${session.reason}`, session };

  const regime = maRegime(closes, maOptions);
  if (regime.trend === 'CHOP') return { matches: false, reason: 'rango_estrecho: MAs convergidas, sin sentimiento claro', regime, session };
  if (regime.trend === 'UNKNOWN' || regime.trend === 'MIXED') return { matches: false, reason: `tendencia_no_clara:${regime.reason || regime.trend}`, regime, session };

  const rsi = computeRsi(closes);
  const sig = rsiEntrySignal(rsi, rsiOptions);
  if (!sig.side) return { matches: false, reason: sig.reason, regime, session, rsi: sig.rsi };

  // Only trade in the trend's direction (buy dips in up-trend, sell pops in down-trend).
  if (sig.side === 'BUY' && regime.trend !== 'UP') return { matches: false, reason: 'RSI_compra_pero_no_hay_tendencia_alcista', regime, session, rsi: sig.rsi };
  if (sig.side === 'SELL' && regime.trend !== 'DOWN') return { matches: false, reason: 'RSI_venta_pero_no_hay_tendencia_bajista', regime, session, rsi: sig.rsi };

  const last = finite(price) ?? closes[closes.length - 1];
  const targets = operatorTargets({ side: sig.side, price: last, digits, pipValueUsd, riskUsd, targetUsd, minDistance });
  return {
    matches: true,
    side: sig.side,
    entryPrice: last,
    ...targets,
    reason: `${sig.reason}; tendencia ${regime.trend} (MAs separadas ${regime.spreadPct.toFixed(2)}%); sesión ${session.window}`,
    regime, session, rsi: sig.rsi
  };
}

module.exports = {
  computeRsi,
  computeSma,
  maRegime,
  rsiEntrySignal,
  inOperatorSession,
  colombiaParts,
  operatorTargets,
  operatorTrailing,
  evaluateOperatorSetup
};
