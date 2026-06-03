const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainJs = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('HTTP api router receives Binance order/test dependency for real-order preflight', () => {
  const createRouterAt = mainJs.indexOf('const modularRouter = createApiRouter({');
  assert.notEqual(createRouterAt, -1, 'main.js should create the modular HTTP api router');

  const dispatchAt = mainJs.indexOf('const modularResult = await modularRouter.dispatch', createRouterAt);
  assert.notEqual(dispatchAt, -1, 'main.js should dispatch through the modular HTTP api router');

  const routerWiring = mainJs.slice(createRouterAt, dispatchAt);
  assert.match(
    routerWiring,
    /testOrderBinance:\s*\([^)]*side[^)]*symbol[^)]*qty[^)]*type[^)]*price[^)]*\)\s*=>\s*testOrderBinance\(side,\s*symbol,\s*qty,\s*type,\s*price,\s*userEnv\)/,
    'HTTP api router deps must pass testOrderBinance with the per-user env'
  );
});
