// Protection sweep: guarantee no open MT5 position (demo or real) ever stays
// without a stop loss / take profit. Brokers sometimes execute a market order
// but reject the attached SL/TP (stops-level, price moved between signal and
// fill), leaving a naked position. This sweep detects those and sets SL/TP on
// the ALREADY-OPEN position via the bridge MODIFY command, sized from the
// current price by the same per-symbol protection policy used for entries.

const { buildMt5ProtectionLevels } = require('./mt5-protection-policy');

function finiteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeSide(side, type) {
  const upper = String(side || '').trim().toUpperCase();
  if (upper === 'BUY' || upper === 'SELL') return upper;
  if (upper === 'LONG') return 'BUY';
  if (upper === 'SHORT') return 'SELL';
  // MT5 position type fallback: 0 = BUY, 1 = SELL
  const t = Number(type);
  if (t === 0) return 'BUY';
  if (t === 1) return 'SELL';
  return null;
}

function positionMissingProtection(position = {}) {
  const sl = finiteNumber(position.sl, position.stopLoss);
  const tp = finiteNumber(position.tp, position.takeProfit);
  return (sl === null || sl <= 0) || (tp === null || tp <= 0);
}

// Pure: for each naked position, compute the SL/TP to apply (from current price).
function planMt5ProtectionSweep({ positions = [], env = {} } = {}) {
  const plans = [];
  const skipped = [];
  for (const position of (Array.isArray(positions) ? positions : [])) {
    const ticket = finiteNumber(position.ticket, position.position, position.order);
    const symbol = String(position.symbol || '').trim().toUpperCase();
    if (!ticket || ticket <= 0 || !symbol) {
      skipped.push({ ticket: ticket || null, symbol: symbol || null, reason: 'invalid_position' });
      continue;
    }
    if (!positionMissingProtection(position)) continue; // already protected
    const side = normalizeSide(position.side, position.type);
    const reference = finiteNumber(position.priceCurrent, position.price_current, position.priceOpen, position.price_open);
    if (!side || reference === null || reference <= 0) {
      skipped.push({ ticket, symbol, reason: 'missing_side_or_price' });
      continue;
    }
    const protection = buildMt5ProtectionLevels({ symbol, side, entryPrice: reference }, env);
    if (!protection.ok) {
      skipped.push({ ticket, symbol, reason: protection.reason || 'protection_unresolved' });
      continue;
    }
    plans.push({
      ticket: Math.trunc(ticket),
      symbol,
      side,
      sl: protection.stopLoss,
      tp: protection.takeProfit,
      reference
    });
  }
  return { plans, skipped };
}

function boolFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

// Apply the sweep. Primary action: set SL/TP on the open position (modifyPosition).
// Fallback: if stops cannot be added (e.g. the running bridge lacks MODIFY) and
// closeIfCannotProtect is on, CLOSE the naked position so unbounded risk never
// persists. Both deps are injected: modifyPosition(ticket,{sl,tp,symbol}) and
// closePosition(ticket,{symbol}).
async function runMt5ProtectionSweep({ positions = [], env = {}, modifyPosition, closePosition, logger = null } = {}) {
  if (typeof modifyPosition !== 'function') {
    return { ok: false, ran: false, reason: 'modify_unavailable', repaired: 0 };
  }
  const closeIfCannotProtect = boolFlag(env.MT5_PROTECT_CLOSE_NAKED, true);
  const { plans, skipped } = planMt5ProtectionSweep({ positions, env });
  if (!plans.length) {
    return { ok: true, ran: false, reason: 'no_naked_positions', repaired: 0, skipped };
  }
  const results = [];
  let repaired = 0;
  let closed = 0;
  for (const plan of plans) {
    let outcome;
    try {
      outcome = await modifyPosition(plan.ticket, { sl: plan.sl, tp: plan.tp, symbol: plan.symbol });
    } catch (error) {
      outcome = { ok: false, error: String(error?.message || error) };
    }
    if (outcome?.ok === true) {
      repaired += 1;
      results.push({ ticket: plan.ticket, symbol: plan.symbol, action: 'protected', sl: plan.sl, tp: plan.tp, ok: true });
      continue;
    }
    const modifyReason = outcome?.reason || outcome?.error || 'modify_failed';
    if (closeIfCannotProtect && typeof closePosition === 'function') {
      let closeOutcome;
      try {
        closeOutcome = await closePosition(plan.ticket, { symbol: plan.symbol });
      } catch (error) {
        closeOutcome = { ok: false, error: String(error?.message || error) };
      }
      if (closeOutcome?.ok === true) {
        closed += 1;
        results.push({ ticket: plan.ticket, symbol: plan.symbol, action: 'closed', ok: true, reason: `could_not_set_stops:${modifyReason}` });
        continue;
      }
      results.push({ ticket: plan.ticket, symbol: plan.symbol, action: 'failed', ok: false, reason: `modify_failed:${modifyReason}; close_failed:${closeOutcome?.reason || closeOutcome?.error || 'unknown'}` });
      continue;
    }
    results.push({ ticket: plan.ticket, symbol: plan.symbol, action: 'failed', ok: false, reason: modifyReason });
  }
  const summary = { ok: true, ran: true, repaired, closed, attempted: plans.length, results, skipped };
  if (logger && typeof logger.info === 'function') logger.info('mt5.protection_sweep', { repaired, closed, attempted: plans.length });
  return summary;
}

module.exports = {
  positionMissingProtection,
  planMt5ProtectionSweep,
  runMt5ProtectionSweep
};
