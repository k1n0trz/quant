const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const envExample = fs.readFileSync(path.join(root, 'backend', 'config', 'env.js'), 'utf8');
const demoOrderService = fs.readFileSync(path.join(root, 'backend', 'adapters', 'mt5', 'mt5-demo-order-service.js'), 'utf8');
const quantBridge = fs.readFileSync(path.join(root, 'ops', 'mt5', 'QuantBridge.mq5'), 'utf8');

assert.ok(main.includes('MT5_BRIDGE_STATUS_FILE'), 'main debe aceptar MT5_BRIDGE_STATUS_FILE.');
assert.ok(main.includes('MT5_BRIDGE_STATUS_TTL_MS'), 'bridge MT5 debe tener TTL defensivo.');
assert.ok(main.includes('function readMt5BridgeStatus'), 'debe existir lector del bridge MT5.');
assert.ok(main.includes('function mt5BridgeAccount'), 'debe existir normalizador de cuenta MT5 bridge.');
assert.ok(main.includes('function mt5BridgeAccounts'), 'debe existir agregador de bridge MT5 demo + real.');
assert.ok(main.includes('readMt5RealBridgeStatus(env)'), 'mt5BridgeAccounts debe leer bridge real separado.');
assert.ok(main.includes("source: 'mt5_bridge'"), 'mt5MultiAccounts debe identificar fuente mt5_bridge.');
assert.ok(main.includes('bridgeRatesFromStatus'), 'mt5Rates debe poder leer velas OHLC desde el bridge antes de Python.');
assert.ok(main.includes('bridgeTickCandlesFromStatus'), 'mt5Rates debe tener fallback visible por tick si OHLC no esta disponible.');

const mt5MultiIdx = main.indexOf('async function mt5MultiAccounts');
const bridgeMultiIdx = main.indexOf('mt5BridgeAccounts(env, usdCop)', mt5MultiIdx);
const pythonMultiIdx = main.indexOf('_mt5MultiAccountsImpl', mt5MultiIdx);
assert.ok(bridgeMultiIdx > mt5MultiIdx && bridgeMultiIdx < pythonMultiIdx, 'mt5MultiAccounts debe leer bridges demo/real antes de invocar Python.');

const mt5InfoIdx = main.indexOf('async function mt5Info');
const bridgeInfoIdx = main.indexOf('mt5BridgeAccount(readMt5BridgeStatus(env))', mt5InfoIdx);
const pythonInfoIdx = main.indexOf('runPythonJson(code', mt5InfoIdx);
assert.ok(bridgeInfoIdx > mt5InfoIdx && bridgeInfoIdx < pythonInfoIdx, 'mt5Info debe leer bridge antes del fallback Python.');

const mt5PositionsIdx = main.indexOf('async function mt5Positions');
const bridgePositionsIdx = main.indexOf('mt5BridgeAccount(readMt5BridgeStatus(env))', mt5PositionsIdx);
const pythonPositionsIdx = main.indexOf('runPythonJson(code', mt5PositionsIdx);
assert.ok(bridgePositionsIdx > mt5PositionsIdx && bridgePositionsIdx < pythonPositionsIdx, 'mt5Positions debe leer bridge antes del fallback Python.');

const mt5RatesIdx = main.indexOf('function mt5Rates');
const bridgeRatesIdx = main.indexOf('bridgeRatesFromStatus(symbol, timeframe', mt5RatesIdx);
const pythonRatesIdx = main.indexOf('runPythonJson(code', mt5RatesIdx);
const tickFallbackIdx = main.indexOf('bridgeTickCandlesFromStatus(symbol, timeframe', mt5RatesIdx);
assert.ok(bridgeRatesIdx > mt5RatesIdx && bridgeRatesIdx < pythonRatesIdx, 'mt5Rates debe priorizar rates del bridge antes del fallback Python lento.');
assert.ok(tickFallbackIdx > pythonRatesIdx, 'mt5Rates debe intentar tick fallback si Python no entrega velas.');

assert.ok(envExample.includes('MT5_BRIDGE_STATUS_FILE='), 'ENV_EXAMPLE debe documentar MT5_BRIDGE_STATUS_FILE.');
assert.ok(envExample.includes('MT5_PYTHON_COMMAND='), 'ENV_EXAMPLE debe documentar MT5_PYTHON_COMMAND.');
assert.ok(/return env\.MT5_PYTHON_COMMAND \|\| env\.PYTHON_BIN/.test(demoOrderService), 'mt5-demo-order-service debe respetar MT5_PYTHON_COMMAND.');
assert.ok(quantBridge.includes('input bool AllowBridgeCommands = true;'), 'QuantBridge debe tener switch explicito para comandos.');
assert.ok(quantBridge.includes('bool BridgeCommandsEnabled()'), 'QuantBridge debe calcular permisos de comandos en una funcion dedicada.');
assert.ok(quantBridge.includes('input bool AllowRealOrderSend = false;'), 'QuantBridge debe bloquear trading real por defecto.');
assert.ok(quantBridge.includes('input string RealOrderFlagFile = "quant_bridge_real_order_enabled.flag";'), 'QuantBridge debe poder activar trading real por flag runtime controlado por VPS.');
assert.ok(quantBridge.includes('bool EffectiveRealOrderSend()'), 'QuantBridge debe calcular permiso real efectivo desde input o flag runtime.');
assert.ok(quantBridge.includes('real_order_not_allowed'), 'QuantBridge debe rechazar orden real si AllowRealOrderSend=false.');
assert.ok(quantBridge.includes('return AllowBridgeCommands && (DemoAccount() || EffectiveRealOrderSend() || EffectiveRealOrderCheck());'), 'QuantBridge debe permitir comandos reales solo con flags efectivos explicitos.');
assert.ok(quantBridge.includes('if(BridgeCommandsEnabled()) ProcessCommand();'), 'QuantBridge solo debe procesar comandos cuando BridgeCommandsEnabled este activo.');
assert.ok(quantBridge.includes('input string BridgeRatesSymbols'), 'QuantBridge debe permitir configurar simbolos para exportar velas.');
assert.ok(quantBridge.includes('input string BridgeRatesTimeframes'), 'QuantBridge debe permitir configurar timeframes para exportar velas.');
assert.ok(quantBridge.includes('CopyRates(sym, TfFromName(tf)'), 'QuantBridge debe exportar velas OHLC desde CopyRates.');
assert.ok(quantBridge.includes('\\\"rates\\\":%s'), 'QuantBridge debe persistir un objeto rates dentro del status JSON.');

console.log('mt5_bridge_status_static.test.js OK');
