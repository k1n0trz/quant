const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const envExample = fs.readFileSync(path.join(root, 'backend', 'config', 'env.js'), 'utf8');
const demoOrderService = fs.readFileSync(path.join(root, 'backend', 'adapters', 'mt5', 'mt5-demo-order-service.js'), 'utf8');

assert.ok(main.includes('MT5_BRIDGE_STATUS_FILE'), 'main debe aceptar MT5_BRIDGE_STATUS_FILE.');
assert.ok(main.includes('MT5_BRIDGE_STATUS_TTL_MS'), 'bridge MT5 debe tener TTL defensivo.');
assert.ok(main.includes('function readMt5BridgeStatus'), 'debe existir lector del bridge MT5.');
assert.ok(main.includes('function mt5BridgeAccount'), 'debe existir normalizador de cuenta MT5 bridge.');
assert.ok(main.includes("source: 'mt5_bridge'"), 'mt5MultiAccounts debe identificar fuente mt5_bridge.');

const mt5MultiIdx = main.indexOf('async function mt5MultiAccounts');
const bridgeMultiIdx = main.indexOf('mt5BridgeAccount(readMt5BridgeStatus(env))', mt5MultiIdx);
const pythonMultiIdx = main.indexOf('_mt5MultiAccountsImpl', mt5MultiIdx);
assert.ok(bridgeMultiIdx > mt5MultiIdx && bridgeMultiIdx < pythonMultiIdx, 'mt5MultiAccounts debe leer bridge antes de invocar Python.');

const mt5InfoIdx = main.indexOf('async function mt5Info');
const bridgeInfoIdx = main.indexOf('mt5BridgeAccount(readMt5BridgeStatus(env))', mt5InfoIdx);
const pythonInfoIdx = main.indexOf('runPythonJson(code', mt5InfoIdx);
assert.ok(bridgeInfoIdx > mt5InfoIdx && bridgeInfoIdx < pythonInfoIdx, 'mt5Info debe leer bridge antes del fallback Python.');

const mt5PositionsIdx = main.indexOf('async function mt5Positions');
const bridgePositionsIdx = main.indexOf('mt5BridgeAccount(readMt5BridgeStatus(env))', mt5PositionsIdx);
const pythonPositionsIdx = main.indexOf('runPythonJson(code', mt5PositionsIdx);
assert.ok(bridgePositionsIdx > mt5PositionsIdx && bridgePositionsIdx < pythonPositionsIdx, 'mt5Positions debe leer bridge antes del fallback Python.');

assert.ok(envExample.includes('MT5_BRIDGE_STATUS_FILE='), 'ENV_EXAMPLE debe documentar MT5_BRIDGE_STATUS_FILE.');
assert.ok(envExample.includes('MT5_PYTHON_COMMAND='), 'ENV_EXAMPLE debe documentar MT5_PYTHON_COMMAND.');
assert.ok(/return env\.MT5_PYTHON_COMMAND \|\| env\.PYTHON_BIN/.test(demoOrderService), 'mt5-demo-order-service debe respetar MT5_PYTHON_COMMAND.');

console.log('mt5_bridge_status_static.test.js OK');
