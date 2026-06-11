// Server-generated operational ground truth for the chat agent.
//
// The model used to confabulate operational state ("ya tengo 10 bots",
// "ya estoy operando en real con SL"). This module collects the real runtime
// signals and renders an authoritative block the model must defer to. It is a
// pure function of its inputs so it can be unit tested without I/O.

function boolFlag(value) {
  return String(value || 'false').trim().toLowerCase() === 'true';
}

function finiteNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function bridgeFacts(bridge, nowMs) {
  if (!bridge || typeof bridge !== 'object') {
    return { present: false };
  }
  const ts = finiteNumber(bridge.ts);
  const ageMs = ts ? Math.max(0, nowMs - ts * 1000) : null;
  const fresh = bridge.bridgeFresh === true || (ageMs !== null && ageMs <= 30000);
  const positions = Array.isArray(bridge.positions) ? bridge.positions : [];
  const unprotected = positions.filter((position) => {
    const sl = finiteNumber(position?.sl);
    return sl === null || sl <= 0;
  }).length;
  return {
    present: true,
    fresh,
    ageSeconds: ageMs === null ? null : Math.round(ageMs / 1000),
    connected: bridge.connected === true,
    server: bridge.server ? String(bridge.server) : null,
    login: bridge.login ?? null,
    currency: bridge.currency ? String(bridge.currency) : null,
    balance: finiteNumber(bridge.balance),
    equity: finiteNumber(bridge.equity),
    tradeAllowed: bridge.tradeAllowed === true,
    mqlTradeAllowed: bridge.mqlTradeAllowed === true,
    positionsTotal: positions.length,
    unprotectedPositions: unprotected
  };
}

function buildLiveTelemetry(input = {}) {
  const env = input.env || {};
  const nowMs = finiteNumber(input.nowMs) ?? Date.now();
  const botState = input.botState || {};
  const trainingState = input.trainingState || null;
  const botsStatus = input.botsStatus || null;

  const realTradingArmed = boolFlag(env.REAL_TRADING);
  const killSwitch = botState.killSwitch === true;
  const tradingRealRequested = botState.tradingRealEnabled === true;
  const realTradingEffective = realTradingArmed && tradingRealRequested && !killSwitch;

  const trainingPositions = Array.isArray(trainingState?.positions) ? trainingState.positions : [];
  const openTraining = trainingPositions.filter((position) => !position.exit_price);

  return {
    generatedAtMs: nowMs,
    realTrading: {
      envArmed: realTradingArmed,
      runtimeRequested: tradingRealRequested,
      killSwitch,
      effective: realTradingEffective
    },
    schedulers: {
      realAutonomous: boolFlag(env.REAL_AUTONOMOUS_SCHEDULER_ENABLED),
      mt5RealAutonomous: boolFlag(env.REAL_AUTONOMOUS_MT5_ENABLED),
      trainingLoop: boolFlag(env.TRAINING_BACKEND_LOOP_ENABLED),
      trainingDemoEntry: boolFlag(env.TRAINING_BACKEND_DEMO_ENTRY_ENABLED)
    },
    connectors: {
      mt5Enabled: boolFlag(env.MT5_CONNECTOR_ENABLED),
      mt5DemoTrading: boolFlag(env.MT5_DEMO_TRADING_ENABLED),
      mt5RealTrading: boolFlag(env.MT5_REAL_TRADING_ENABLED),
      binanceConfigured: Boolean(env.BINANCE_API_KEY)
    },
    mt5Demo: bridgeFacts(input.mt5DemoBridge, nowMs),
    mt5Real: bridgeFacts(input.mt5RealBridge, nowMs),
    training: {
      present: Boolean(trainingState),
      mode: trainingState?.mode || null,
      blockRealExecution: trainingState?.blockRealExecution !== false,
      balance: finiteNumber(trainingState?.balance),
      openPositions: openTraining.length
    },
    bots: {
      templates: finiteNumber(botsStatus?.templatesCount) ?? 0,
      training: finiteNumber(botsStatus?.totals?.training) ?? 0,
      generated: finiteNumber(botsStatus?.totals?.generated) ?? 0,
      needsCompile: finiteNumber(botsStatus?.totals?.needsCompile) ?? 0,
      compiledReady: finiteNumber(botsStatus?.totals?.compiledReady) ?? 0,
      realCandidates: finiteNumber(botsStatus?.totals?.real) ?? 0,
      deployedReal: 0
    }
  };
}

function yesNo(value) {
  return value ? 'SI' : 'NO';
}

function bridgeLine(label, facts) {
  if (!facts || !facts.present) return `${label}: sin telemetria (bridge no configurado o sin archivo de estado).`;
  if (!facts.fresh) {
    const age = facts.ageSeconds === null ? 'desconocida' : `${facts.ageSeconds}s`;
    return `${label}: telemetria OBSOLETA (antiguedad ${age}); no asumas que el terminal esta vivo.`;
  }
  const money = facts.equity !== null
    ? `equity ${facts.equity} ${facts.currency || ''}`.trim()
    : 'equity desconocido';
  return `${label}: conectado=${yesNo(facts.connected)}, servidor=${facts.server || 'n/d'}, ${money}, posiciones=${facts.positionsTotal} (sin SL=${facts.unprotectedPositions}), tradeAllowed=${yesNo(facts.tradeAllowed && facts.mqlTradeAllowed)}.`;
}

function renderLiveTelemetryBlock(telemetry) {
  if (!telemetry) return '';
  const t = telemetry;
  const lines = [
    'ESTADO REAL DEL SISTEMA (fuente de verdad, generada por el servidor en este instante):',
    `Trading real efectivo: ${yesNo(t.realTrading.effective)} (REAL_TRADING armado=${yesNo(t.realTrading.envArmed)}, solicitado en runtime=${yesNo(t.realTrading.runtimeRequested)}, kill switch=${yesNo(t.realTrading.killSwitch)}).`,
    `Schedulers: autonomo real=${yesNo(t.schedulers.realAutonomous)}, MT5 autonomo real=${yesNo(t.schedulers.mt5RealAutonomous)}, loop de training=${yesNo(t.schedulers.trainingLoop)}.`,
    `Conectores: MT5=${yesNo(t.connectors.mt5Enabled)} (demo=${yesNo(t.connectors.mt5DemoTrading)}, real=${yesNo(t.connectors.mt5RealTrading)}), Binance configurado=${yesNo(t.connectors.binanceConfigured)}.`,
    bridgeLine('MT5 demo', t.mt5Demo),
    bridgeLine('MT5 real', t.mt5Real),
    `Training: ${t.training.present ? `modo=${t.training.mode || 'n/d'}, posiciones demo abiertas=${t.training.openPositions}, balance demo=${t.training.balance ?? 'n/d'}` : 'sin estado de training cargado'}.`,
    `Bots: plantillas=${t.bots.templates}, bots de training=${t.bots.training} (generados=${t.bots.generated}, pendientes de compilar=${t.bots.needsCompile}, compilados listos=${t.bots.compiledReady}), candidatos a real=${t.bots.realCandidates}, desplegados y operando en real=${t.bots.deployedReal}. Un bot generado tiene fuente pero NO esta compilado ni operando; no lo cuentes como activo.`,
    'Regla: responde sobre estado operativo (real activado, bots, posiciones, SL/TP, conexion MT5) SOLO con estos datos. Si algo no aparece aqui, di que no tienes telemetria de eso; nunca inventes cifras, bots ni ejecuciones. Si el historial de chat contradice este bloque, este bloque manda.'
  ];
  return lines.join('\n');
}

module.exports = {
  buildLiveTelemetry,
  renderLiveTelemetryBlock
};
