const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

assert.ok(main.includes('function mergeTrainingStateForWrite'), 'writeTrainingState debe mezclar contra el estado existente.');
assert.ok(main.includes('trainingTradeMergeKey'), 'El merge debe deduplicar closedTrades por llave estable.');
assert.ok(main.includes('trainingLessonMergeKey'), 'El merge debe deduplicar lessons por llave estable.');
assert.ok(main.includes('existingClosed.length > incomingClosed.length'), 'Un cliente stale no debe borrar closedTrades persistidos.');
assert.ok(main.includes('existingLessons.length > incomingLessons.length'), 'Un cliente stale no debe borrar lessons persistidas.');
assert.ok(main.includes('positions: incomingPositions.length ? incomingPositions : existingPositions'), 'Un payload vacio no debe borrar posiciones abiertas.');
assert.ok(main.includes('activePairs: incomingPairs.length ? incomingPairs : existingPairs'), 'Un payload vacio no debe borrar activePairs.');
assert.ok(main.includes('const TRAINING_CLOSED_TRADES_LIMIT = 5000'), 'closedTrades no debe quedar congelado en el limite historico de 400.');
assert.ok(main.includes('closedTrades: mergeTrainingArray(existingClosed, incomingClosed, trainingTradeMergeKey, TRAINING_CLOSED_TRADES_LIMIT)'), 'closedTrades debe usar el limite ampliado y nombrado.');
assert.ok(main.includes('xp: Math.max'), 'XP no debe retroceder por un cliente stale.');
assert.ok(main.includes('balance: staleHistoryWrite ? existingState.balance : incomingState.balance'), 'El balance no debe retroceder cuando el historial entrante es stale.');

console.log('training_state_write_merge_static.test.js OK');
