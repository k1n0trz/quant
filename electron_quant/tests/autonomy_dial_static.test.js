const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

// The autonomy dial must be web-configurable (persisted per user) AND win over
// the VPS process.env, otherwise the operator cannot adjust aggressiveness
// without SSH into /etc/quant/quant.env.
assert(main.includes('AUTONOMY_TUNING_FIELDS'), 'Debe existir un whitelist de knobs de autonomia configurables.');
assert(main.includes('function autonomyTuningOverrides'), 'Debe existir el overlay que aplica el dial sobre process.env.');
assert(/const env = \{ \.\.\.baseEnv, \.\.\.autonomyTuningOverrides\(\) \}/.test(main),
  'createRealAutonomousRuntimeContext debe overlayar el dial del usuario por encima del env base.');

for (const key of [
  'REAL_AUTONOMOUS_MAX_OPEN_POSITIONS',
  'REAL_AUTONOMOUS_MAX_ORDERS_PER_TICK',
  'REAL_AUTONOMOUS_MAX_ORDERS_PER_DAY',
  'REAL_AUTONOMOUS_MIN_CONFIDENCE',
  'MT5_REAL_RISK_PER_TRADE_PCT',
  'MT5_REAL_TOTAL_RISK_PCT'
]) {
  assert(main.includes(`'${key}'`), `El knob ${key} debe estar registrado como configurable.`);
}

// The dial keys must be inside USER_API_FIELDS so /api/api-config-write accepts
// them and env-status reports them.
const fieldsBlock = main.slice(main.indexOf('const USER_API_FIELDS'), main.indexOf('const AUTONOMY_TUNING_FIELDS'));
assert(fieldsBlock.includes('REAL_AUTONOMOUS_MAX_OPEN_POSITIONS'), 'USER_API_FIELDS debe incluir el knob de posiciones abiertas.');
assert(fieldsBlock.includes('REAL_AUTONOMOUS_MIN_CONFIDENCE'), 'USER_API_FIELDS debe incluir el knob de confianza minima.');

console.log('autonomy_dial_static.test.js OK');
