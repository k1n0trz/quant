const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const renderer = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');

assert(main.includes('Trading real no depende de que ICT/CRT tenga muestra suficiente'), 'El prompt sistema debe separar real trading de una estrategia especifica.');
assert(main.includes('restricciones suaves'), 'El prompt sistema debe hablar de restricciones suaves y gates operativos.');
assert(main.includes('puedes proponer correcciones concretas para warnings'), 'Quant debe tener poder para diagnosticar/corregir warnings.');
assert(main.includes('horario MT5 Colombia'), 'El prompt sistema debe conocer horario MT5 Colombia.');

assert(renderer.includes('mt5MarketScheduleContext'), 'El renderer debe inyectar horario MT5 al contexto del chat.');
assert(renderer.includes('Rendimiento/warnings'), 'El contexto del chat debe incluir warnings de rendimiento recientes.');
assert(renderer.includes('Trading real runtime'), 'El contexto debe reportar estado real runtime sin mezclarlo con Training.');
assert(renderer.includes('blockRealExecution solo protege el training'), 'El contexto debe aclarar que blockRealExecution no bloquea ordenes manuales reales.');
assert(renderer.includes('ICT/CRT no es requisito global para operar real'), 'El contexto debe aclarar que ICT/CRT es una estrategia y no un bloqueo global.');

console.log('chat_operational_context_static.test.js OK');
