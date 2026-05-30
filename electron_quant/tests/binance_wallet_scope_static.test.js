const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

assert(main.includes("const BINANCE_FAPI_BASE = 'https://fapi.binance.com'"), 'Debe existir base URL para USD-M Futures.');
assert(main.includes("const BINANCE_DAPI_BASE = 'https://dapi.binance.com'"), 'Debe existir base URL para COIN-M Futures.');
assert(main.includes("signedBinance('/sapi/v1/margin/account'"), 'Wallet debe intentar leer margen Binance.');
assert(main.includes("signedBinance('/fapi/v2/account'"), 'Wallet debe intentar leer USD-M Futures.');
assert(main.includes("signedBinance('/dapi/v1/account'"), 'Wallet debe intentar leer COIN-M Futures.');
assert(main.includes('marginError') && main.includes('usdFuturesError') && main.includes('coinFuturesError'), 'Wallet debe exponer errores por sub-wallet sin romper.');

assert(renderer.includes('Binance Margin'), 'El contexto de Quant debe incluir Binance Margin.');
assert(renderer.includes('Binance USD-M Futures'), 'El contexto de Quant debe incluir USD-M Futures.');
assert(renderer.includes('Binance COIN-M Futures'), 'El contexto de Quant debe incluir COIN-M Futures.');
assert(renderer.includes('Autonomia Binance'), 'El contexto debe declarar autonomia de lectura sobre wallets Binance configuradas.');

console.log('binance_wallet_scope_static.test.js OK');
