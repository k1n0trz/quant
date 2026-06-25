const { validateRiskConfig } = require('../risk/risk-policy');
const { buildMt5ProtectionLevels } = require('../adapters/mt5/mt5-protection-policy');

function boolFlag(value) {
  return String(value || 'false').trim().toLowerCase() === 'true';
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampNumber(value, fallback, min, max) {
  const number = finiteNumber(value);
  const resolved = number === null ? fallback : number;
  return Math.max(min, Math.min(max, resolved));
}

function textValue(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeVenue(value) {
  const venue = String(value || '').trim().toUpperCase();
  return venue === 'BINANCE' || venue === 'MT5' ? venue : '';
}

function normalizeSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9._-]{3,32}$/.test(symbol) ? symbol : '';
}

function normalizeBias(value) {
  const bias = String(value || '').trim().toUpperCase();
  if (bias === 'BUY' || bias === 'LONG') return 'LONG';
  if (bias === 'SELL' || bias === 'SHORT') return 'SHORT';
  return 'NEUTRAL';
}

function isRealAutonomousSchedulerEnabled(env = {}) {
  return boolFlag(env.REAL_AUTONOMOUS_SCHEDULER_ENABLED);
}

function resolveAllowedVenues(env = {}) {
  const raw = String(env.REAL_AUTONOMOUS_ALLOWED_VENUES || 'BINANCE,MT5')
    .split(',')
    .map((item) => normalizeVenue(item))
    .filter(Boolean);
  return raw.length ? Array.from(new Set(raw)) : ['BINANCE'];
}

function resolveRealAutonomousLimits(env = {}, riskConfig = {}) {
  const envMaxOpen = finiteNumber(env.REAL_AUTONOMOUS_MAX_OPEN_POSITIONS);
  const maxOpenPositions = Math.floor(clampNumber(envMaxOpen, 200, 1, 500));
  const maxOrdersPerTick = Math.floor(clampNumber(env.REAL_AUTONOMOUS_MAX_ORDERS_PER_TICK, 20, 1, 100));
  const maxOrdersPerDay = Math.floor(clampNumber(env.REAL_AUTONOMOUS_MAX_ORDERS_PER_DAY, 1000, 1, 10000));
  const configuredNotional = finiteNumber(env.REAL_AUTONOMOUS_MAX_NOTIONAL_USDT);
  const envCap = finiteNumber(env.REAL_TRADING_MAX_NOTIONAL_USDT);
  const maxNotionalUsdt = clampNumber(configuredNotional ?? Math.min(envCap || 5, 5), 5, 5, Math.max(5, envCap || 25));
  const minConfidence = clampNumber(env.REAL_AUTONOMOUS_MIN_CONFIDENCE, 78, 1, 100);
  const mt5Lots = clampNumber(env.REAL_AUTONOMOUS_MT5_LOTS ?? env.MT5_REAL_MAX_LOTS, 0.01, 0.01, 0.05);
  const stopLossPct = clampNumber(env.REAL_AUTONOMOUS_STOP_LOSS_PCT, 2, 0.1, 20);
  const takeProfitPct = clampNumber(env.REAL_AUTONOMOUS_TAKE_PROFIT_PCT, 3, 0.1, 50);
  const mt5StopLossPct = finiteNumber(env.REAL_AUTONOMOUS_MT5_STOP_LOSS_PCT);
  const mt5TakeProfitPct = finiteNumber(env.REAL_AUTONOMOUS_MT5_TAKE_PROFIT_PCT);
  const minHoldConfidence = clampNumber(
    env.REAL_AUTONOMOUS_MIN_HOLD_CONFIDENCE,
    Math.max(35, (clampNumber(env.REAL_AUTONOMOUS_MIN_CONFIDENCE, 78, 1, 100) - 20)),
    1,
    100
  );
  const mt5AllowOvernight = boolFlag(env.REAL_AUTONOMOUS_MT5_ALLOW_OVERNIGHT);
  const mt5MaxHoldHours = Math.floor(clampNumber(env.REAL_AUTONOMOUS_MT5_MAX_HOLD_HOURS, 22, 1, 168));
  const mt5OrphanMaxHoldHours = Math.floor(clampNumber(env.REAL_AUTONOMOUS_MT5_ORPHAN_MAX_HOLD_HOURS, 6, 1, 72));
  // Anti-overtrading: minimum minutes before re-opening the SAME pair, so a
  // losing pair can't be re-entered tick after tick (death by a thousand cuts).
  const reentryCooldownMinutes = Math.floor(clampNumber(env.REAL_AUTONOMOUS_REENTRY_COOLDOWN_MIN, 45, 0, 1440));
  return {
    reentryCooldownMinutes,
    allowedVenues: resolveAllowedVenues(env),
    autonomyMode: 'opportunity_only',
    minOpenPositions: 0,
    maxOpenPositions,
    maxOrdersPerTick,
    maxOrdersPerDay,
    maxNotionalUsdt,
    minConfidence,
    mt5Lots,
    stopLossPct,
    takeProfitPct,
    mt5StopLossPct,
    mt5TakeProfitPct,
    minHoldConfidence,
    mt5AllowOvernight,
    mt5MaxHoldHours,
    mt5OrphanMaxHoldHours
  };
}

function realGates(env = {}, botState = {}, riskConfig = {}) {
  const issues = [];
  if (!boolFlag(env.REAL_TRADING)) issues.push('REAL_TRADING no armado');
  if (botState.tradingRealEnabled !== true) issues.push('Trading real backend OFF');
  if (botState.killSwitch === true) issues.push('Kill switch activo');
  const risk = validateRiskConfig(riskConfig);
  if (!risk.ok) issues.push(...risk.issues);
  return { ok: issues.length === 0, issues };
}

function stateFromSnapshot(snapshot) {
  if (snapshot?.state && typeof snapshot.state === 'object') return snapshot.state;
  if (snapshot && typeof snapshot === 'object') return snapshot;
  return {};
}

function collectTrainingRows(state = {}) {
  const rows = [];
  if (Array.isArray(state.activePairs)) rows.push(...state.activePairs);
  if (Array.isArray(state.positions)) {
    rows.push(...state.positions.filter((position) => !position.exit_price));
  }
  return rows.filter((row) => normalizeVenue(row?.venue) && normalizeSymbol(row?.symbol));
}

function signalScore(row = {}) {
  const indicators = row.indicators && typeof row.indicators === 'object' ? row.indicators : {};
  const confidence = finiteNumber(row.confidence ?? indicators.confidence);
  const score = finiteNumber(row.score ?? indicators.score ?? indicators.primaryStrategy?.score);
  const signalQuality = finiteNumber(row.signalQuality ?? row.signal_quality ?? indicators.signalQuality ?? indicators.signal_quality);
  const qualityPct = signalQuality === null ? null : (signalQuality <= 1 ? signalQuality * 100 : signalQuality);
  return Math.max(confidence || 0, score || 0, qualityPct || 0);
}

function buildTrainingSignalIndex(state = {}) {
  const index = new Map();
  for (const row of collectTrainingRows(state)) {
    const venue = normalizeVenue(row.venue);
    const symbol = normalizeSymbol(row.symbol);
    const key = `${venue}:${symbol}`;
    const score = signalScore(row);
    const current = index.get(key);
    if (!current || score > current.score) {
      index.set(key, {
        venue,
        symbol,
        score,
        bias: normalizeBias(row.bias ?? row.direction ?? row.indicators?.bias),
        horizon: textValue(row.horizon, row.indicators?.horizon, 'intraday'),
        price: finiteNumber(row.price ?? row.mark ?? row.entry ?? row.entry_price ?? row.indicators?.price),
        reason: textValue(row.strategy_name, row.primaryStrategy?.name, row.indicators?.primaryStrategy?.name, 'training_signal')
      });
    }
  }
  return index;
}

function buildProtection(side, entryPrice, limits) {
  const price = finiteNumber(entryPrice);
  if (price === null || price <= 0) return null;
  const normalizedSide = String(side || '').toUpperCase();
  const slMove = limits.stopLossPct / 100;
  const tpMove = limits.takeProfitPct / 100;
  const stopLoss = normalizedSide === 'SELL'
    ? price * (1 + slMove)
    : price * (1 - slMove);
  const takeProfit = normalizedSide === 'SELL'
    ? price * (1 - tpMove)
    : price * (1 + tpMove);
  return {
    entryPrice: Number(price.toFixed(8)),
    stopLoss: Number(stopLoss.toFixed(8)),
    takeProfit: Number(takeProfit.toFixed(8)),
    stopLossPct: limits.stopLossPct,
    takeProfitPct: limits.takeProfitPct
  };
}

function realPositionKey(position = {}) {
  const venue = normalizeVenue(position.venue || position.exchange || position.platform);
  const symbol = normalizeSymbol(position.symbol || position.pair);
  return venue && symbol ? `${venue}:${symbol}` : '';
}

async function openRealPositionRows(deps = {}) {
  if (typeof deps.getOpenRealPositions !== 'function') return [];
  const rows = await deps.getOpenRealPositions().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

function openRealPositionSet(rows = []) {
  return new Set((Array.isArray(rows) ? rows : []).map(realPositionKey).filter(Boolean));
}

function isBinanceSpotExposure(position = {}) {
  return normalizeVenue(position.venue || position.platform) === 'BINANCE'
    && String(position.source || position.kind || '').toUpperCase() === 'SPOT_BALANCE';
}

function sortByScoreThenSymbol(left, right) {
  if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore;
  return `${left.venue}:${left.symbol}`.localeCompare(`${right.venue}:${right.symbol}`);
}

function balanceCandidateQueueByVenue(candidates = [], allowedVenues = []) {
  const buckets = new Map();
  for (const candidate of candidates) {
    const venue = normalizeVenue(candidate.venue);
    if (!venue) continue;
    if (!buckets.has(venue)) buckets.set(venue, []);
    buckets.get(venue).push(candidate);
  }
  const venues = allowedVenues.filter((venue) => buckets.has(venue));
  for (const venue of buckets.keys()) {
    if (!venues.includes(venue)) venues.push(venue);
  }
  const out = [];
  let moved = true;
  while (moved) {
    moved = false;
    for (const venue of venues) {
      const bucket = buckets.get(venue);
      if (bucket?.length) {
        out.push(bucket.shift());
        moved = true;
      }
    }
  }
  return out;
}

async function buildBinanceCandidates(context, state, limits, opened) {
  const deps = context.deps || {};
  if (!limits.allowedVenues.includes('BINANCE')) return [];
  if (typeof deps.discoverBinanceRealUniverse !== 'function') return [];
  const discovered = await deps.discoverBinanceRealUniverse({
    limit: Math.max(limits.maxOrdersPerTick * 8, 20),
    maxChecks: Math.max(limits.maxOrdersPerTick * 20, 80),
    targetNotional: limits.maxNotionalUsdt
  }).catch((error) => ({ ok: false, error: error?.message || String(error), ready: [] }));
  const index = buildTrainingSignalIndex(state);
  const rows = [];
  for (const row of (Array.isArray(discovered.ready) ? discovered.ready : [])) {
    const symbol = normalizeSymbol(row.symbol);
    if (!symbol) continue;
    const key = `BINANCE:${symbol}`;
    if (opened.has(key)) {
      rows.push({ venue: 'BINANCE', symbol, skipOnly: true, reason: 'already_open_real_position' });
      continue;
    }
    const signal = index.get(key) || index.get(`BINANCE:${symbol.replace(/USDC$|FDUSD$/, 'USDT')}`) || null;
    const priorityScore = signal?.score || finiteNumber(row.score) || limits.minConfidence;
    const bias = signal?.bias || normalizeBias(row.side);
    const protection = buildProtection('BUY', finiteNumber(row.price ?? row.entryPrice ?? signal?.price), limits);
    if (priorityScore < limits.minConfidence) continue;
    if (bias === 'SHORT') continue;
    if (!protection) {
      rows.push({ venue: 'BINANCE', symbol, skipOnly: true, reason: 'missing_protection_price' });
      continue;
    }
    rows.push({
      venue: 'BINANCE',
      symbol,
      side: 'BUY',
      type: 'MARKET',
      qty: row.qty,
      requestedNotional: Math.min(finiteNumber(row.requestedNotional) || limits.maxNotionalUsdt, limits.maxNotionalUsdt),
      priorityScore,
      ...protection,
      reason: signal?.reason || 'real_universe_ready'
    });
  }
  return rows;
}

function mt5MarketOpen(context) {
  const deps = context.deps || {};
  if (typeof deps.getMt5MarketSession !== 'function') return { open: true, reason: 'session_not_injected' };
  const session = deps.getMt5MarketSession(context.nowMs || Date.now(), context.env || {});
  return { open: session?.open !== false, reason: session?.reason || 'unknown' };
}

function mt5HorizonRequiresOvernight(horizon) {
  const text = String(horizon || '').trim().toLowerCase();
  if (!text) return false;
  if (text.includes('intraday') || text.includes('scalp') || text.includes('minute') || text.includes('m1') || text.includes('m5') || text.includes('m15') || text.includes('h1')) return false;
  return /swing|weekly|week|monthly|month|medium|long|position|daily|multi.?day/.test(text);
}

function positionTicket(position = {}) {
  const ticket = finiteNumber(position.ticket ?? position.positionTicket ?? position.order);
  return ticket && ticket > 0 ? Math.trunc(ticket) : null;
}

function positionSideBias(position = {}) {
  const raw = String(position.side ?? position.direction ?? position.positionSide ?? position.orderSide ?? '').trim().toUpperCase();
  if (raw.includes('BUY') || raw.includes('LONG')) return 'LONG';
  if (raw.includes('SELL') || raw.includes('SHORT')) return 'SHORT';
  const typeText = String(position.type ?? position.positionType ?? position.orderType ?? '').trim().toUpperCase();
  if (typeText.includes('BUY') || typeText.includes('LONG')) return 'LONG';
  if (typeText.includes('SELL') || typeText.includes('SHORT')) return 'SHORT';
  const typeNumber = finiteNumber(position.type ?? position.positionType);
  if (typeNumber === 0) return 'LONG';
  if (typeNumber === 1) return 'SHORT';
  return '';
}

function oppositeBias(left, right) {
  return (left === 'LONG' && right === 'SHORT') || (left === 'SHORT' && right === 'LONG');
}

function positionOpenTimeMs(position = {}) {
  const raw = position.openedAt ?? position.openTime ?? position.entryAt ?? position.createdAt ?? position.time;
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' || /^\d+(\.\d+)?$/.test(String(raw))) {
    const number = Number(raw);
    if (!Number.isFinite(number)) return null;
    return number < 100000000000 ? number * 1000 : number;
  }
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

function mt5RealPositionAgeHours(position = {}, nowMs = Date.now()) {
  const openedMs = positionOpenTimeMs(position);
  if (!openedMs) return null;
  return Math.max(0, (nowMs - openedMs) / 3600000);
}

function shouldCloseMt5RealPosition(position = {}, limits = {}, nowMs = Date.now()) {
  if (normalizeVenue(position.venue || position.platform) !== 'MT5') return null;
  const ticket = positionTicket(position);
  if (!ticket) return null;
  const ageHours = mt5RealPositionAgeHours(position, nowMs);
  const swap = finiteNumber(position.swap ?? position.swapValue ?? position.storage);
  if (ageHours !== null && ageHours >= limits.mt5MaxHoldHours) {
    return { ticket, reason: 'mt5_max_hold_hours_exceeded', ageHours, swap };
  }
  if (swap !== null && swap < 0 && ageHours !== null && ageHours >= Math.min(22, limits.mt5MaxHoldHours)) {
    return { ticket, reason: 'mt5_negative_swap_review', ageHours, swap };
  }
  return null;
}

function shouldCloseMt5RealPositionBySignal(position = {}, signalIndex = new Map(), limits = {}, nowMs = Date.now()) {
  if (normalizeVenue(position.venue || position.platform) !== 'MT5') return null;
  const ticket = positionTicket(position);
  const symbol = normalizeSymbol(position.symbol || position.pair);
  if (!ticket || !symbol) return null;
  const side = positionSideBias(position);
  if (!side) return null;
  const signal = signalIndex.get(`MT5:${symbol}`);
  const ageHours = mt5RealPositionAgeHours(position, nowMs);
  if (!signal) {
    if (ageHours !== null && ageHours >= limits.mt5OrphanMaxHoldHours) {
      return { ticket, reason: 'mt5_no_current_signal', ageHours, signalScore: null, signalBias: 'NONE' };
    }
    return null;
  }
  if (oppositeBias(side, signal.bias) && signal.score >= limits.minConfidence) {
    return { ticket, reason: 'mt5_signal_flipped', ageHours, signalScore: signal.score, signalBias: signal.bias, positionSide: side };
  }
  if (signal.score < limits.minHoldConfidence) {
    return { ticket, reason: 'mt5_signal_below_hold_confidence', ageHours, signalScore: signal.score, signalBias: signal.bias, positionSide: side };
  }
  return null;
}

async function closeSignalManagedMt5RealPositions(context, limits, openRows, state, maxCount) {
  const deps = context.deps || {};
  if (!limits.allowedVenues.includes('MT5')) return [];
  if (!boolFlag((context.env || {}).REAL_AUTONOMOUS_MT5_ENABLED)) return [];
  if (typeof deps.closeMt5RealPosition !== 'function') return [];
  const session = mt5MarketOpen(context);
  if (!session.open) {
    return [{
      ok: false,
      status: 'skipped',
      action: 'CLOSE',
      venue: 'MT5',
      symbol: '',
      reason: `mt5_market_closed:${session.reason}`,
      realTradingTouched: false
    }];
  }
  const signalIndex = buildTrainingSignalIndex(state);
  const closable = (Array.isArray(openRows) ? openRows : [])
    .map((position) => ({
      position,
      closeReason: shouldCloseMt5RealPositionBySignal(position, signalIndex, limits, context.nowMs || Date.now())
    }))
    .filter((row) => row.closeReason)
    .sort((a, b) => (b.closeReason.signalScore || 0) - (a.closeReason.signalScore || 0))
    .slice(0, Math.max(0, maxCount));
  const out = [];
  for (const row of closable) {
    const symbol = normalizeSymbol(row.position.symbol || row.position.pair);
    const input = {
      ticket: row.closeReason.ticket,
      symbol,
      reason: `real-autonomous-${row.closeReason.reason}`
    };
    const result = await deps.closeMt5RealPosition(input, { env: context.env || {} });
    out.push({
      ok: result?.ok === true,
      status: result?.ok ? 'executed' : (result?.status || 'blocked'),
      action: 'CLOSE',
      venue: 'MT5',
      symbol,
      side: 'CLOSE',
      reason: result?.reason || row.closeReason.reason,
      ticket: result?.ticket || input.ticket,
      orderId: result?.commandId || null,
      signalScore: row.closeReason.signalScore,
      signalBias: row.closeReason.signalBias,
      realTradingTouched: result?.realTradingTouched === true
    });
  }
  return out;
}

async function closeStaleMt5RealPositions(context, limits, openRows, maxCount) {
  const deps = context.deps || {};
  if (!limits.allowedVenues.includes('MT5')) return [];
  if (!boolFlag((context.env || {}).REAL_AUTONOMOUS_MT5_ENABLED)) return [];
  if (typeof deps.closeMt5RealPosition !== 'function') return [];
  const session = mt5MarketOpen(context);
  if (!session.open) {
    return [{
      ok: false,
      status: 'skipped',
      action: 'CLOSE',
      venue: 'MT5',
      symbol: '',
      reason: `mt5_market_closed:${session.reason}`,
      realTradingTouched: false
    }];
  }
  const stale = (Array.isArray(openRows) ? openRows : [])
    .map((position) => ({ position, closeReason: shouldCloseMt5RealPosition(position, limits, context.nowMs || Date.now()) }))
    .filter((row) => row.closeReason)
    .sort((a, b) => (b.closeReason.ageHours || 0) - (a.closeReason.ageHours || 0))
    .slice(0, Math.max(0, maxCount));
  const out = [];
  for (const row of stale) {
    const symbol = normalizeSymbol(row.position.symbol || row.position.pair);
    const input = {
      ticket: row.closeReason.ticket,
      symbol,
      reason: 'real-autonomous-stale-mt5-close'
    };
    const result = await deps.closeMt5RealPosition(input, { env: context.env || {} });
    out.push({
      ok: result?.ok === true,
      status: result?.ok ? 'executed' : (result?.status || 'blocked'),
      action: 'CLOSE',
      venue: 'MT5',
      symbol,
      side: 'CLOSE',
      reason: result?.reason || row.closeReason.reason,
      ticket: result?.ticket || input.ticket,
      orderId: result?.commandId || null,
      realTradingTouched: result?.realTradingTouched === true
    });
  }
  return out;
}

async function repairUnprotectedBinanceSpotPositions(context, limits, openRows, maxCount) {
  const deps = context.deps || {};
  if (!limits.allowedVenues.includes('BINANCE')) return [];
  if (typeof deps.placeProtectionBinance !== 'function') return [];
  const rows = (Array.isArray(openRows) ? openRows : [])
    .filter((position) => isBinanceSpotExposure(position) && position.hasOpenOrders !== true)
    .filter((position) => finiteNumber(position.quantity ?? position.qty ?? position.free) > 0)
    .sort((a, b) => (finiteNumber(b.valueQuote ?? b.valueUsdt) || 0) - (finiteNumber(a.valueQuote ?? a.valueUsdt) || 0))
    .slice(0, Math.max(0, maxCount));
  const out = [];
  for (const position of rows) {
    const symbol = normalizeSymbol(position.symbol || position.pair);
    const qty = finiteNumber(position.quantity ?? position.qty ?? position.free);
    const price = finiteNumber(position.price ?? position.mark ?? position.price_current);
    const valueQuote = finiteNumber(position.valueQuote ?? position.valueUsdt) || (qty && price ? qty * price : null);
    const protection = buildProtection('BUY', price, limits);
    if (!symbol || !qty || qty <= 0 || !protection) {
      out.push({
        ok: false,
        status: 'skipped',
        action: 'PROTECT',
        venue: 'BINANCE',
        symbol,
        reason: 'missing_spot_exposure_protection_context',
        realTradingTouched: false
      });
      continue;
    }
    const request = {
      venue: 'BINANCE',
      symbol,
      side: 'BUY',
      type: 'MARKET',
      qty,
      stopLoss: protection.stopLoss,
      takeProfit: protection.takeProfit,
      reason: 'real-autonomous-spot-protection-repair'
    };
    const syntheticOrder = { ok: true, symbol, side: 'BUY', qty, executedQty: qty, price };
    let result = null;
    try {
      result = await deps.placeProtectionBinance(request, syntheticOrder);
    } catch (error) {
      result = { ok: false, error: error?.message || String(error) };
    }
    if (result?.ok === true) {
      out.push({
        ok: true,
        status: 'protected',
        action: 'PROTECT',
        venue: 'BINANCE',
        symbol,
        side: 'SELL_OCO',
        reason: 'spot_balance_oco_repaired',
        orderId: result.orderListId || null,
        realTradingTouched: true
      });
      continue;
    }
    const smallEnoughToExit = valueQuote !== null && valueQuote <= limits.maxNotionalUsdt * 1.5;
    if (smallEnoughToExit && typeof deps.placeOrderBinance === 'function') {
      let close = null;
      try {
        close = await deps.placeOrderBinance('SELL', symbol, qty, 'MARKET', null);
      } catch (error) {
        close = { ok: false, error: error?.message || String(error) };
      }
      out.push({
        ok: close?.ok === true,
        status: close?.ok ? 'closed_unprotected' : 'protection_failed',
        action: 'CLOSE',
        venue: 'BINANCE',
        symbol,
        side: 'SELL',
        reason: close?.ok ? 'small_unprotected_spot_closed' : (close?.error || result?.error || 'spot_protection_failed'),
        orderId: close?.orderId || null,
        realTradingTouched: close?.ok === true
      });
      continue;
    }
    out.push({
      ok: false,
      status: 'protection_failed',
      action: 'PROTECT',
      venue: 'BINANCE',
      symbol,
      side: 'SELL_OCO',
      reason: result?.error || result?.reason || 'spot_protection_failed',
      realTradingTouched: false
    });
  }
  return out;
}

async function buildMt5Candidates(context, state, limits, opened) {
  const env = context.env || {};
  if (!limits.allowedVenues.includes('MT5')) return [];
  if (!boolFlag(env.REAL_AUTONOMOUS_MT5_ENABLED)) return [];
  if (typeof context.deps?.placeMt5RealOrder !== 'function') return [];
  const session = mt5MarketOpen(context);
  if (!session.open) return [{ venue: 'MT5', symbol: '', skipOnly: true, reason: `mt5_market_closed:${session.reason}` }];
  const index = buildTrainingSignalIndex(state);
  const rows = [];
  for (const signal of index.values()) {
    if (signal.venue !== 'MT5') continue;
    const key = `MT5:${signal.symbol}`;
    if (opened.has(key)) {
      rows.push({ venue: 'MT5', symbol: signal.symbol, skipOnly: true, reason: 'already_open_real_position' });
      continue;
    }
    if (signal.score < limits.minConfidence) continue;
    if (signal.bias !== 'LONG' && signal.bias !== 'SHORT') continue;
    if (!limits.mt5AllowOvernight && mt5HorizonRequiresOvernight(signal.horizon)) {
      rows.push({ venue: 'MT5', symbol: signal.symbol, skipOnly: true, reason: 'mt5_overnight_horizon_blocked' });
      continue;
    }
    const side = signal.bias === 'LONG' ? 'BUY' : 'SELL';
    const protection = buildMt5ProtectionLevels({
      symbol: signal.symbol,
      side,
      entryPrice: signal.price,
      stopLossPct: limits.mt5StopLossPct,
      takeProfitPct: limits.mt5TakeProfitPct
    }, env);
    if (!protection) {
      rows.push({ venue: 'MT5', symbol: signal.symbol, skipOnly: true, reason: 'missing_protection_price' });
      continue;
    }
    if (!protection.ok) {
      rows.push({ venue: 'MT5', symbol: signal.symbol, skipOnly: true, reason: protection.reason || 'invalid_mt5_protection' });
      continue;
    }
    rows.push({
      venue: 'MT5',
      symbol: signal.symbol,
      side,
      volume: limits.mt5Lots,
      type: 'MARKET',
      horizon: signal.horizon,
      priorityScore: signal.score,
      maxHoldHours: limits.mt5MaxHoldHours,
      entryPrice: protection.entryPrice,
      stopLoss: protection.stopLoss,
      takeProfit: protection.takeProfit,
      stopLossPct: protection.stopLossPct,
      takeProfitPct: protection.takeProfitPct,
      reason: signal.reason || 'training_signal'
    });
  }
  // Full-market watchlist for the AI: it should see the WHOLE panorama, not a
  // narrow handful. Favorites (env) go first, then EVERY symbol the bridge
  // streams candles for — so the AI never misses an opportunity in a pair just
  // because it wasn't on a hardcoded list. The AI sets side/SL/TP itself.
  if (boolFlag(env.REAL_AUTONOMOUS_AI_DECISIONS_ENABLED) || boolFlag(env.REAL_AUTONOMOUS_OPERATOR_PLAYBOOK)) {
    const favorites = String(env.REAL_AUTONOMOUS_MT5_WATCHLIST
      || 'EURUSD,GBPUSD,USDJPY,AUDUSD,USDCAD,NZDUSD,USDCHF,XAUUSD,EURJPY,AUDCAD')
      .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    // Pull the live universe of streamed symbols so the list grows automatically
    // whenever the bridge streams more pairs (no code change needed).
    let universe = [];
    try {
      const listed = typeof context.deps?.listMt5Symbols === 'function' ? context.deps.listMt5Symbols() : null;
      if (listed?.ok && Array.isArray(listed.symbols)) {
        universe = listed.symbols.map((s) => String(s).trim().toUpperCase()).filter(Boolean);
      }
    } catch { /* fall back to favorites only */ }
    const watchlist = [];
    for (const sym of favorites.concat(universe)) {
      if (sym && !watchlist.includes(sym)) watchlist.push(sym);
    }
    // rotate the order by the current minute so different pairs surface each tick
    const offset = new Date().getUTCMinutes() % Math.max(1, watchlist.length);
    const rotated = watchlist.slice(offset).concat(watchlist.slice(0, offset));
    for (const symbol of rotated) {
      const key = `MT5:${symbol}`;
      if (opened.has(key)) continue;
      if (rows.some((r) => r.symbol === symbol && !r.skipOnly)) continue;
      rows.push({
        venue: 'MT5', symbol, side: 'BUY', volume: limits.mt5Lots, type: 'MARKET',
        priorityScore: limits.minConfidence - 1, maxHoldHours: limits.mt5MaxHoldHours,
        aiCandidate: true, reason: 'ai_watchlist'
      });
    }
  }
  return rows;
}

async function executeCandidate(candidate, context) {
  const deps = context.deps || {};
  if (candidate.venue === 'BINANCE') {
    if (typeof deps.executeBinanceRealOrder !== 'function') {
      return { ok: false, status: 'blocked', reason: 'binance_executor_missing', candidate };
    }
    const input = {
      venue: 'BINANCE',
      symbol: candidate.symbol,
      side: candidate.side,
      type: candidate.type,
      qty: candidate.qty,
      entryPrice: candidate.entryPrice,
      stopLoss: candidate.stopLoss,
      takeProfit: candidate.takeProfit,
      reason: 'real-autonomous-scheduler'
    };
    // AI decides Binance spot BUYs too (full power over Binance, 24/7 incl. when
    // MT5 is closed). It can only BUY on spot; SKIP otherwise. Its SL/TP feed OCO.
    if (boolFlag((context.env || {}).REAL_AUTONOMOUS_AI_DECISIONS_ENABLED) && typeof deps.aiDecideTrade === 'function') {
      let decision = null;
      try { decision = await deps.aiDecideTrade(candidate.symbol, 'BINANCE'); }
      catch (error) { return { ok: false, status: 'blocked', reason: 'ai_decision_error', error: String(error?.message || error), candidate, input }; }
      if (!decision || decision.ok !== true) {
        return { ok: false, status: 'blocked', reason: decision?.reason || 'ai_decision_unavailable', candidate, input };
      }
      if (decision.decision !== 'OPEN' || decision.side !== 'BUY') {
        return { ok: false, status: 'ai_skip', reason: 'ai_skip', aiReasoning: decision.reasoning, aiConfidence: decision.confidence, candidate, input };
      }
      input.stopLoss = decision.stopLoss;
      input.takeProfit = decision.takeProfit;
      input.aiReasoning = decision.reasoning;
      input.aiConfidence = decision.confidence;
    }
    const result = await deps.executeBinanceRealOrder({
      input,
      env: context.env || {},
      botState: context.botState || {},
      riskConfig: context.riskConfig || {},
      deps
    });
    return { ...result, candidate, input };
  }

  if (candidate.venue === 'MT5') {
    const input = {
      venue: 'MT5',
      symbol: candidate.symbol,
      side: candidate.side,
      volume: candidate.volume,
      type: candidate.type,
      entryPrice: candidate.entryPrice,
      stopLoss: candidate.stopLoss,
      takeProfit: candidate.takeProfit,
      reason: 'real-autonomous-scheduler'
    };
    // Operator playbook decides (preferred): Edi's own rules (RSI reversal + MA
    // regime + session + $1-2 targets) as pure mechanics — no LLM, so it's free
    // per tick and cannot hang. When enabled it governs MT5 entries.
    if (boolFlag((context.env || {}).REAL_AUTONOMOUS_OPERATOR_PLAYBOOK) && typeof deps.operatorPlaybook === 'function') {
      let pb = null;
      try {
        pb = await deps.operatorPlaybook(candidate.symbol);
      } catch (error) {
        return { ok: false, status: 'blocked', reason: 'playbook_error', error: String(error?.message || error), candidate, input };
      }
      if (!pb || pb.ok !== true) {
        return { ok: false, status: 'blocked', reason: pb?.reason || 'playbook_unavailable', candidate, input };
      }
      if (!pb.wouldEnter) {
        return { ok: false, status: 'playbook_skip', reason: pb.reason, candidate, input };
      }
      input.side = pb.side;
      if (Number.isFinite(pb.entryPrice)) input.entryPrice = pb.entryPrice;
      input.stopLoss = pb.stopLoss;
      input.takeProfit = pb.takeProfit;
      input.playbookReason = pb.reason;
    } else if (boolFlag((context.env || {}).REAL_AUTONOMOUS_AI_DECISIONS_ENABLED) && typeof deps.aiDecideTrade === 'function') {
      // AI decides: an LLM analyzes trend/technicals/news and approves or rejects
      // the trade, setting its own SL/TP. Its verdict overrides the mechanical one.
      let decision = null;
      try {
        decision = await deps.aiDecideTrade(candidate.symbol, 'MT5');
      } catch (error) {
        return { ok: false, status: 'blocked', reason: 'ai_decision_error', error: String(error?.message || error), candidate, input };
      }
      if (!decision || decision.ok !== true) {
        return { ok: false, status: 'blocked', reason: decision?.reason || 'ai_decision_unavailable', candidate, input };
      }
      if (decision.decision !== 'OPEN') {
        return { ok: false, status: 'ai_skip', reason: 'ai_skip', aiReasoning: decision.reasoning, aiConfidence: decision.confidence, candidate, input };
      }
      input.side = decision.side;
      input.entryPrice = decision.entryPrice;
      input.stopLoss = decision.stopLoss;
      input.takeProfit = decision.takeProfit;
      input.aiReasoning = decision.reasoning;
      input.aiConfidence = decision.confidence;
    }
    if (typeof deps.checkMt5RealOrder === 'function') {
      const check = await deps.checkMt5RealOrder(input, { env: context.env || {} });
      if (!check?.ok) return { ok: false, status: 'blocked', reason: check?.reason || 'mt5_check_failed', candidate, input, check };
    }
    const result = await deps.placeMt5RealOrder(input, { env: context.env || {} });
    return { ...result, status: result?.ok ? 'executed' : (result?.status || 'blocked'), candidate, input };
  }

  return { ok: false, status: 'blocked', reason: 'unsupported_venue', candidate };
}

async function runRealAutonomousTick(context = {}) {
  const env = context.env || {};
  const botState = context.botState || {};
  const riskConfig = context.riskConfig || {};
  const limits = resolveRealAutonomousLimits(env, riskConfig);
  const gates = realGates(env, botState, riskConfig);
  if (!isRealAutonomousSchedulerEnabled(env) || !gates.ok) {
    return {
      ok: false,
      reason: 'real_autonomous_gates_not_armed',
      enabled: isRealAutonomousSchedulerEnabled(env),
      gateIssues: gates.issues,
      limits,
      executedCount: 0,
      realTradingTouched: false
    };
  }

  const snapshot = typeof context.deps?.readTrainingStateSnapshot === 'function'
    ? context.deps.readTrainingStateSnapshot()
    : null;
  const state = stateFromSnapshot(snapshot);

  // Protect first: set SL/TP on any already-open REAL position that is naked,
  // before evaluating new entries. A naked position must never persist.
  let protectionSweep = null;
  if (typeof context.deps?.runProtectionSweep === 'function') {
    try {
      protectionSweep = await context.deps.runProtectionSweep();
    } catch (error) {
      protectionSweep = { ok: false, ran: false, reason: 'protection_sweep_exception', error: String(error?.message || error) };
    }
  }

  const openRows = await openRealPositionRows(context.deps || {});
  const opened = openRealPositionSet(openRows);
  const protectionExecutions = await repairUnprotectedBinanceSpotPositions(context, limits, openRows, limits.maxOrdersPerTick);
  const signalCloseExecutions = await closeSignalManagedMt5RealPositions(
    context,
    limits,
    openRows,
    state,
    Math.max(0, limits.maxOrdersPerTick - protectionExecutions.filter((row) => row.ok).length)
  );
  const closeExecutions = await closeStaleMt5RealPositions(
    context,
    limits,
    openRows,
    Math.max(0, limits.maxOrdersPerTick
      - protectionExecutions.filter((row) => row.ok).length
      - signalCloseExecutions.filter((row) => row.ok).length)
  );
  const managementExecutions = [...protectionExecutions, ...signalCloseExecutions, ...closeExecutions];
  const successfulCloseKeys = new Set(managementExecutions
    .filter((row) => row.ok)
    .filter((row) => row.action === 'CLOSE')
    .map((row) => `${row.venue}:${row.symbol}`)
    .filter((key) => key !== 'MT5:'));
  for (const key of successfulCloseKeys) opened.delete(key);
  if (managementExecutions.filter((row) => row.ok).length >= limits.maxOrdersPerTick) {
    return {
      ok: true,
      ranAt: new Date(context.nowMs || Date.now()).toISOString(),
      limits,
      openRealPositions: opened.size,
      candidates: [],
      executed: managementExecutions,
      executedCount: managementExecutions.filter((row) => row.ok).length,
      skipped: [],
      realTradingTouched: managementExecutions.some((row) => row.realTradingTouched)
    };
  }
  const ordersToday = typeof context.deps?.getRealAutonomousOrdersToday === 'function'
    ? Math.max(0, Math.floor(Number(await context.deps.getRealAutonomousOrdersToday()) || 0))
    : 0;
  if (ordersToday >= limits.maxOrdersPerDay) {
    return {
      ok: true,
      reason: 'max_daily_orders_reached',
      limits,
      ordersToday,
      candidates: [],
      executed: managementExecutions,
      executedCount: managementExecutions.filter((row) => row.ok).length,
      skipped: [],
      realTradingTouched: managementExecutions.some((row) => row.realTradingTouched)
    };
  }
  if (opened.size >= limits.maxOpenPositions) {
    return {
      ok: true,
      reason: 'max_open_positions_reached',
      limits,
      openRealPositions: opened.size,
      candidates: [],
      executed: managementExecutions,
      executedCount: managementExecutions.filter((row) => row.ok).length,
      skipped: [],
      realTradingTouched: managementExecutions.some((row) => row.realTradingTouched)
    };
  }

  const candidates = [
    ...(await buildBinanceCandidates(context, state, limits, opened)),
    ...(await buildMt5Candidates(context, state, limits, opened))
  ];
  const skipped = candidates.filter((candidate) => candidate.skipOnly).map((candidate) => ({
    venue: candidate.venue,
    symbol: candidate.symbol,
    reason: candidate.reason
  }));
  // When the AI evaluates each candidate (an LLM call), bound how many it judges
  // per tick to control cost/latency; otherwise keep the wider mechanical queue.
  const aiEnabled = boolFlag((context.env || {}).REAL_AUTONOMOUS_AI_DECISIONS_ENABLED);
  const aiEvalBudget = Math.floor(clampNumber((context.env || {}).REAL_AUTONOMOUS_AI_MAX_EVAL_PER_TICK, 6, 1, 16));
  const queueLimit = aiEnabled ? aiEvalBudget : Math.max(limits.maxOrdersPerTick * 10, 20);
  const executable = balanceCandidateQueueByVenue(candidates
    .filter((candidate) => !candidate.skipOnly)
    .sort(sortByScoreThenSymbol), limits.allowedVenues)
    .slice(0, queueLimit);

  const executed = [...managementExecutions];
  const closeSuccessCount = managementExecutions.filter((row) => row.ok).length;
  const successLimit = Math.min(
    Math.max(0, limits.maxOrdersPerTick - closeSuccessCount),
    Math.max(0, limits.maxOpenPositions - opened.size),
    Math.max(0, limits.maxOrdersPerDay - ordersToday)
  );
  const nowMs = finiteNumber(context.nowMs) ?? Date.now();
  const cooldownMs = Math.max(0, (limits.reentryCooldownMinutes || 0) * 60000);
  // getRecentRealOpens may be sync (returns a plain object) or async; awaiting a
  // non-promise is harmless, and try/catch replaces the bogus `.catch` that was
  // crashing every tick when the dep was synchronous.
  let recentOpens = {};
  if (cooldownMs > 0 && typeof context.deps?.getRecentRealOpens === 'function') {
    try { recentOpens = (await context.deps.getRecentRealOpens()) || {}; } catch { recentOpens = {}; }
  }
  for (const candidate of executable) {
    if (executed.filter((row) => row.ok && !row.action).length >= successLimit) break;
    const key = `${candidate.venue}:${candidate.symbol}`;
    if (opened.has(key)) {
      skipped.push({ venue: candidate.venue, symbol: candidate.symbol, reason: 'already_open_real_position' });
      continue;
    }
    const lastOpenMs = finiteNumber(recentOpens[key]);
    if (lastOpenMs !== null && cooldownMs > 0 && (nowMs - lastOpenMs) < cooldownMs) {
      const waitMin = Math.ceil((cooldownMs - (nowMs - lastOpenMs)) / 60000);
      skipped.push({ venue: candidate.venue, symbol: candidate.symbol, reason: 'reentry_cooldown_active', waitMinutes: waitMin });
      continue;
    }
    const result = await executeCandidate(candidate, context);
    executed.push({
      ok: result?.ok === true,
      status: result?.status || (result?.ok ? 'executed' : 'blocked'),
      venue: candidate.venue,
      symbol: candidate.symbol,
      side: result?.input?.side || candidate.side,
      stopLoss: result?.input?.stopLoss ?? null,
      takeProfit: result?.input?.takeProfit ?? null,
      reason: result?.reason || result?.error || null,
      aiReasoning: result?.aiReasoning || result?.input?.aiReasoning || null,
      aiConfidence: result?.aiConfidence ?? result?.input?.aiConfidence ?? null,
      orderId: result?.order?.orderId || result?.commandId || null,
      realTradingTouched: result?.safety?.realTradingTouched === true || result?.realTradingTouched === true
    });
    if (result?.ok === true) {
      opened.add(key);
      if (cooldownMs > 0 && typeof context.deps?.recordRealOpen === 'function') {
        try { await context.deps.recordRealOpen(candidate.venue, candidate.symbol, nowMs); } catch {}
      }
    }
  }

  const touched = executed.some((row) => row.realTradingTouched);

  // Harvest realized profit (Spot quote above the trading float) into USDC Earn.
  // Best-effort and isolated: a harvest failure never affects trade execution.
  let profitHarvest = null;
  if (typeof context.deps?.runProfitHarvest === 'function') {
    try {
      profitHarvest = await context.deps.runProfitHarvest();
    } catch (error) {
      profitHarvest = { ok: false, ran: false, reason: 'harvest_exception', error: String(error?.message || error) };
    }
  }

  return {
    ok: true,
    ranAt: new Date(context.nowMs || Date.now()).toISOString(),
    limits,
    openRealPositions: opened.size,
    ordersToday,
    protectionSweep,
    profitHarvest,
    candidates: executable.map((candidate) => ({
      venue: candidate.venue,
      symbol: candidate.symbol,
      side: candidate.side,
      priorityScore: candidate.priorityScore,
      entryPrice: candidate.entryPrice,
      stopLoss: candidate.stopLoss,
      takeProfit: candidate.takeProfit,
      maxHoldHours: candidate.maxHoldHours,
      reason: candidate.reason
    })),
    skipped,
    executed,
    executedCount: executed.filter((row) => row.ok).length,
    realTradingTouched: touched
  };
}

function createStatusSnapshot(state, env = {}) {
  return {
    enabled: isRealAutonomousSchedulerEnabled(env),
    active: state.active,
    inProgress: state.inProgress,
    intervalMs: state.intervalMs,
    startedAt: state.startedAt,
    lastTickAt: state.lastTickAt,
    lastTickResult: state.lastTickResult,
    lastError: state.lastError,
    ticksRun: state.ticksRun,
    ticksSkipped: state.ticksSkipped,
    realTradingTouched: state.lastTickResult?.realTradingTouched === true
  };
}

function resolveRealAutonomousIntervalMs(env = {}) {
  return Math.floor(clampNumber(env.REAL_AUTONOMOUS_INTERVAL_MS, 60000, 10000, 3600000));
}

// Compact, log-friendly summary of a tick: what executed, what was skipped and
// — crucially — WHY nothing happened when nothing happened.
function summarizeTick(result) {
  if (!result || typeof result !== 'object') return { ok: false };
  const exec = Array.isArray(result.executed) ? result.executed : [];
  const executedOk = exec.filter((r) => r.ok && !r.action).length;
  const statuses = {};
  for (const r of exec) {
    const k = r.status || (r.ok ? 'executed' : 'blocked');
    statuses[k] = (statuses[k] || 0) + 1;
  }
  const skipReasons = {};
  for (const r of (Array.isArray(result.skipped) ? result.skipped : [])) {
    const k = r.reason || 'skip';
    skipReasons[k] = (skipReasons[k] || 0) + 1;
  }
  // A few concrete block/skip reasons so the cause is visible at a glance.
  const samples = exec.filter((r) => !r.ok).slice(0, 5)
    .map((r) => `${r.symbol || '?'}:${r.status || 'blocked'}${r.reason ? ':' + String(r.reason).slice(0, 40) : ''}`);
  return {
    ok: result.ok === true,
    reason: result.reason || null,
    executedOk,
    candidates: Array.isArray(result.candidates) ? result.candidates.length : undefined,
    statuses,
    skipReasons,
    samples,
    realTradingTouched: result.realTradingTouched === true
  };
}

function createRealAutonomousSchedulerController(options = {}) {
  const timers = options.timers || {
    setInterval: (...args) => setInterval(...args),
    clearInterval: (handle) => clearInterval(handle)
  };
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const runner = typeof options.runner === 'function' ? options.runner : runRealAutonomousTick;
  const state = {
    active: false,
    inProgress: false,
    intervalMs: 60000,
    timerHandle: null,
    startedAt: null,
    lastTickAt: null,
    lastTickResult: null,
    lastError: null,
    ticksRun: 0,
    ticksSkipped: 0,
    context: null
  };

  async function runNow(overrideContext = null) {
    if (state.inProgress) {
      state.ticksSkipped += 1;
      state.lastTickResult = { ok: false, reason: 'real_autonomous_tick_in_progress', skipped: true, realTradingTouched: false };
      return state.lastTickResult;
    }
    const context = overrideContext || state.context || {};
    state.inProgress = true;
    state.lastTickAt = new Date(now()).toISOString();
    let watchdogTimer = null;
    try {
      // Watchdog: a single hung call must never freeze the engine. If a tick
      // runs past the budget, reject so `finally` clears inProgress and the next
      // tick runs (the leaked op, if any, is abandoned).
      const tickTimeoutMs = Math.max(15000, Number(options.tickTimeoutMs) || 50000);
      const result = await Promise.race([
        runner({ ...context, nowMs: now() }),
        new Promise((_, rej) => { watchdogTimer = setTimeout(() => rej(new Error('real_autonomous_tick_timeout')), tickTimeoutMs); if (watchdogTimer.unref) watchdogTimer.unref(); })
      ]);
      state.ticksRun += 1;
      state.lastTickResult = result;
      state.lastError = result?.ok ? null : { at: state.lastTickAt, message: result?.reason || 'real_autonomous_tick_failed' };
      // Make every tick visible so the engine is never a silent black box: one
      // concise line per tick showing what it did or exactly why it did nothing.
      try { options.logger?.info?.('real.autonomous.tick', summarizeTick(result)); } catch { /* logging must never break the tick */ }
      return result;
    } catch (error) {
      state.ticksRun += 1;
      state.lastError = { at: state.lastTickAt, message: String(error?.message || error) };
      state.lastTickResult = { ok: false, reason: 'real_autonomous_tick_exception', error: state.lastError.message, realTradingTouched: false };
      try { options.logger?.error?.('real.autonomous.tick.exception', { error: state.lastError.message }); } catch { /* ignore */ }
      return state.lastTickResult;
    } finally {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      state.inProgress = false;
    }
  }

  function start(context = {}) {
    const env = context.env || {};
    if (!isRealAutonomousSchedulerEnabled(env)) {
      return { ok: false, reason: 'real_autonomous_scheduler_disabled', status: createStatusSnapshot(state, env) };
    }
    state.context = context;
    state.intervalMs = resolveRealAutonomousIntervalMs(env);
    if (state.active) return { ok: true, alreadyRunning: true, status: createStatusSnapshot(state, env) };
    state.active = true;
    state.startedAt = new Date(now()).toISOString();
    state.timerHandle = timers.setInterval(() => { void runNow(); }, state.intervalMs);
    return { ok: true, alreadyRunning: false, status: createStatusSnapshot(state, env) };
  }

  function stop(context = null) {
    const env = context?.env || state.context?.env || {};
    if (state.timerHandle) timers.clearInterval(state.timerHandle);
    state.timerHandle = null;
    state.active = false;
    state.inProgress = false;
    return { ok: true, status: createStatusSnapshot(state, env) };
  }

  function status(context = null) {
    const env = context?.env || state.context?.env || {};
    return createStatusSnapshot(state, env);
  }

  return { start, stop, status, runNow };
}

const defaultController = createRealAutonomousSchedulerController();

module.exports = {
  isRealAutonomousSchedulerEnabled,
  resolveRealAutonomousLimits,
  resolveRealAutonomousIntervalMs,
  runRealAutonomousTick,
  createRealAutonomousSchedulerController,
  startRealAutonomousScheduler: (context) => defaultController.start(context),
  stopRealAutonomousScheduler: (context) => defaultController.stop(context),
  getRealAutonomousSchedulerStatus: (context) => defaultController.status(context),
  runRealAutonomousSchedulerNow: (context) => defaultController.runNow(context)
};
