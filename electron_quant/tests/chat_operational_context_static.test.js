const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

assert(main.includes('Trading real no depende de Training Mode, blockRealExecution'), 'El prompt sistema debe separar real trading del loop de training.');
assert(main.includes('la operacion como ejecutable en Binance'), 'El prompt sistema debe permitir tratar Binance como ejecutable cuando los gates reales estan armados.');
assert(main.includes('restricciones suaves y diagnosticas'), 'El prompt sistema debe hablar de restricciones suaves y diagnosticas, no bloqueos por estrategia.');
assert(main.includes('puedes proponer correcciones concretas para warnings'), 'Quant debe tener poder para diagnosticar/corregir warnings.');
assert(main.includes('horario MT5 Colombia'), 'El prompt sistema debe conocer horario MT5 Colombia.');
assert(main.includes('Fecha/hora actual obligatoria') && main.includes('bogotaNow'), 'El prompt sistema debe inyectar fecha/hora Colombia actual, no memoria vieja.');
assert(main.includes('getMt5MarketSession'), 'El backend debe calcular la sesion MT5 actual para el chat.');
assert.ok(/max_tokens:\s*(1[8-9]\d{2}|[2-9]\d{3,})/.test(main), 'El modelo debe tener presupuesto suficiente para respuestas completas.');
assert.equal(/max_tokens:\s*900\b/.test(main), false, 'El chat no debe limitar respuestas largas a 900 tokens.');

assert(renderer.includes('mt5MarketScheduleContext'), 'El renderer debe inyectar horario MT5 al contexto del chat.');
assert(renderer.includes('Rendimiento/warnings'), 'El contexto del chat debe incluir warnings de rendimiento recientes.');
assert(renderer.includes('Trading real runtime'), 'El contexto debe reportar estado real runtime sin mezclarlo con Training.');
assert(renderer.includes('canal real autorizado'), 'El contexto debe aclarar que blockRealExecution no bloquea el canal real autorizado.');
assert(renderer.includes('ICT/CRT no es requisito global para operar real'), 'El contexto debe aclarar que ICT/CRT es una estrategia y no un bloqueo global.');
assert(renderer.includes('Panorama global de oportunidades'), 'Quant debe recibir un panorama global y no limitarse al simbolo seleccionado.');
assert(renderer.includes('binance_watchlist') && renderer.includes('mt5_watchlist'), 'El contexto debe incluir candidatos Binance y MT5 para sugerencias alternativas.');
assert(renderer.includes('No limites el analisis al activo seleccionado'), 'El prompt operativo debe pedir explicitamente comparar alternativas.');
assert(renderer.includes('realExecutionUniverseContext'), 'El chat debe consultar el universo real ejecutable antes del LLM.');
assert(renderer.includes('binance_real_ready_pairs'), 'El contexto debe incluir pares Binance Spot que pasan saldo/minNotional/order-test.');
assert(renderer.includes('NO asumir BTC como unico activo'), 'El prompt debe impedir sesgo operativo hacia BTC.');
assert(renderer.includes('binance_api_whitelist_blocked_sample'), 'El contexto debe exponer muestras bloqueadas por whitelist API.');
assert(!renderer.includes('No lo voy a activar a ciegas'), 'El UI no debe presentar trading real como negativa absoluta cuando el backend ya esta armado.');

console.log('chat_operational_context_static.test.js OK');
