function finiteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normalizeSide(side) {
  const upper = String(side || '').trim().toUpperCase();
  if (upper === 'BUY' || upper === 'LONG') return 'BUY';
  if (upper === 'SELL' || upper === 'SHORT') return 'SELL';
  return null;
}

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function symbolKey(symbol) {
  const normalized = normalizeSymbol(symbol);
  if (normalized.startsWith('XAU')) return 'XAU';
  if (normalized.startsWith('XAG')) return 'XAG';
  if (/BTC|ETH|NAS|US30|SPX/.test(normalized)) return 'INDEX_CRYPTO';
  return 'FX';
}

function defaultMaxStopLossPct(symbol) {
  switch (symbolKey(symbol)) {
    case 'XAU':
      return 0.35;
    case 'XAG':
      return 0.55;
    case 'INDEX_CRYPTO':
      return 1.0;
    default:
      return 0.35;
  }
}

function resolveMaxStopLossPct(symbol, env = {}) {
  const normalized = normalizeSymbol(symbol);
  const specific = finiteNumber(
    env[`MT5_PROTECTION_${normalized}_MAX_STOP_LOSS_PCT`],
    env[`REAL_AUTONOMOUS_MT5_${normalized}_MAX_STOP_LOSS_PCT`]
  );
  if (specific !== null) return Math.max(0.01, Math.min(5, specific));
  const generic = finiteNumber(
    env.MT5_PROTECTION_MAX_STOP_LOSS_PCT,
    env.REAL_AUTONOMOUS_MT5_MAX_STOP_LOSS_PCT
  );
  if (generic !== null) return Math.max(0.01, Math.min(5, generic));
  return defaultMaxStopLossPct(symbol);
}

function validateMt5Protection(input = {}, env = {}) {
  const symbol = normalizeSymbol(input.symbol);
  const side = normalizeSide(input.side);
  const entryPrice = finiteNumber(input.entryPrice, input.entry_price, input.marketPrice, input.price);
  const sl = finiteNumber(input.sl, input.stopLoss, input.stop_loss);
  const tp = finiteNumber(input.tp, input.takeProfit, input.take_profit);

  if (!side) return { ok: false, reason: 'unsupported_side' };
  if (entryPrice === null || entryPrice <= 0) return { ok: false, reason: 'entry_price_required' };
  if (sl === null || tp === null) return { ok: false, reason: 'missing_sl_tp' };
  if (sl <= 0 || tp <= 0) return { ok: false, reason: 'invalid_sl_tp' };

  const isBuy = side === 'BUY';
  if (isBuy && sl >= entryPrice) return { ok: false, reason: 'buy_stop_loss_must_be_below_entry' };
  if (isBuy && tp <= entryPrice) return { ok: false, reason: 'buy_take_profit_must_be_above_entry' };
  if (!isBuy && sl <= entryPrice) return { ok: false, reason: 'sell_stop_loss_must_be_above_entry' };
  if (!isBuy && tp >= entryPrice) return { ok: false, reason: 'sell_take_profit_must_be_below_entry' };

  const stopDistancePct = Math.abs(entryPrice - sl) / entryPrice * 100;
  const rewardDistancePct = Math.abs(tp - entryPrice) / entryPrice * 100;
  const maxStopLossPct = resolveMaxStopLossPct(symbol, env);
  if (stopDistancePct > maxStopLossPct) {
    return {
      ok: false,
      reason: 'stop_loss_too_far',
      stopDistancePct,
      maxStopLossPct
    };
  }
  if (rewardDistancePct <= 0) return { ok: false, reason: 'invalid_take_profit_distance' };

  return {
    ok: true,
    entryPrice,
    sl,
    tp,
    stopDistancePct,
    rewardDistancePct,
    maxStopLossPct,
    rewardRisk: rewardDistancePct / Math.max(stopDistancePct, 1e-12)
  };
}

function buildMt5ProtectionLevels(input = {}, env = {}) {
  const side = normalizeSide(input.side);
  const entryPrice = finiteNumber(input.entryPrice, input.entry_price, input.marketPrice, input.price);
  const symbol = normalizeSymbol(input.symbol);
  if (!side) return { ok: false, reason: 'unsupported_side' };
  if (entryPrice === null || entryPrice <= 0) return { ok: false, reason: 'entry_price_required' };

  const maxStopLossPct = resolveMaxStopLossPct(symbol, env);
  const configuredStopPct = finiteNumber(
    input.stopLossPct,
    input.stop_loss_pct,
    env.REAL_AUTONOMOUS_MT5_STOP_LOSS_PCT,
    env.TRAINING_MT5_DEMO_STOP_LOSS_PCT,
    Math.min(maxStopLossPct, 0.25)
  );
  const stopLossPct = Math.max(0.01, Math.min(maxStopLossPct, configuredStopPct || Math.min(maxStopLossPct, 0.25)));
  const configuredTakeProfitPct = finiteNumber(
    input.takeProfitPct,
    input.take_profit_pct,
    env.REAL_AUTONOMOUS_MT5_TAKE_PROFIT_PCT,
    env.TRAINING_MT5_DEMO_TAKE_PROFIT_PCT,
    stopLossPct * 2
  );
  const takeProfitPct = Math.max(stopLossPct * 1.1, configuredTakeProfitPct || stopLossPct * 2);
  const stopMove = stopLossPct / 100;
  const takeMove = takeProfitPct / 100;
  const stopLoss = side === 'SELL'
    ? entryPrice * (1 + stopMove)
    : entryPrice * (1 - stopMove);
  const takeProfit = side === 'SELL'
    ? entryPrice * (1 - takeMove)
    : entryPrice * (1 + takeMove);
  const validation = validateMt5Protection({
    symbol,
    side,
    entryPrice,
    stopLoss,
    takeProfit
  }, env);
  if (!validation.ok) return validation;
  return {
    ...validation,
    stopLoss: Number(stopLoss.toFixed(8)),
    takeProfit: Number(takeProfit.toFixed(8)),
    stopLossPct,
    takeProfitPct
  };
}

function mt5ContractSize(symbol, env = {}) {
  const normalized = normalizeSymbol(symbol);
  const override = finiteNumber(env[`MT5_CONTRACT_SIZE_${normalized}`]);
  if (override !== null && override > 0) return override;
  switch (symbolKey(normalized)) {
    case 'XAU':
      return 100;
    case 'XAG':
      return 5000;
    case 'INDEX_CRYPTO':
      return 1;
    default:
      return 100000;
  }
}

function estimateMt5RiskUsd(input = {}, env = {}) {
  const symbol = normalizeSymbol(input.symbol);
  const entryPrice = finiteNumber(input.entryPrice, input.entry_price, input.priceOpen, input.price);
  const stopLoss = finiteNumber(input.stopLoss, input.sl, input.stop_loss);
  const volume = finiteNumber(input.volume, input.lots);
  if (!symbol || entryPrice === null || entryPrice <= 0 || volume === null || volume <= 0) {
    return { ok: false, reason: 'risk_inputs_missing' };
  }
  if (stopLoss === null || stopLoss <= 0) {
    return { ok: false, reason: 'risk_stop_loss_missing' };
  }
  const contractSize = mt5ContractSize(symbol, env);
  const riskQuote = Math.abs(entryPrice - stopLoss) * contractSize * volume;
  const letters = symbol.replace(/[^A-Z]/g, '');
  const quote = letters.length >= 6 ? letters.slice(3, 6) : 'USD';
  const base = letters.slice(0, 3);
  let riskUsd = riskQuote;
  if (quote !== 'USD' && (base === 'USD' || quote === 'JPY')) {
    riskUsd = riskQuote / entryPrice;
  }
  return {
    ok: true,
    symbol,
    contractSize,
    riskQuote,
    riskUsd,
    quoteCurrency: quote
  };
}

module.exports = {
  validateMt5Protection,
  buildMt5ProtectionLevels,
  resolveMaxStopLossPct,
  defaultMaxStopLossPct,
  mt5ContractSize,
  estimateMt5RiskUsd
};
