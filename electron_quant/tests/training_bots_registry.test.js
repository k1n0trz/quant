const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  readBotTemplates,
  buildTrainingBotsStatus
} = require('../backend/training/bot-registry-service');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-bots-'));
  const dir = path.join(root, 'templates', 'EdiLearningBot_XAUUSD');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    id: 'EdiLearningBot_XAUUSD',
    name: 'EdiLearningBot XAUUSD',
    symbol: 'XAUUSD',
    venue: 'MT5',
    mode: 'training',
    sourceFiles: ['EdiTrainingBot_XAUUSD.mq5', 'EdiTrainingBot_XAUUSD.ex5']
  }), 'utf8');
  fs.writeFileSync(path.join(dir, 'EdiTrainingBot_XAUUSD.mq5'), '// template', 'utf8');
  fs.writeFileSync(path.join(dir, 'EdiTrainingBot_XAUUSD.ex5'), 'compiled', 'utf8');
  return root;
}

test('readBotTemplates loads sanitized template manifests only', () => {
  const root = makeRoot();
  const templates = readBotTemplates(path.join(root, 'templates'));
  assert.equal(templates.length, 1);
  assert.equal(templates[0].id, 'EdiLearningBot_XAUUSD');
  assert.equal(templates[0].symbol, 'XAUUSD');
  assert.equal(templates[0].venue, 'MT5');
  assert.equal(templates[0].hasSource, true);
  assert.equal(templates[0].hasCompiled, true);
  assert.equal(JSON.stringify(templates).includes('secret'), false);
});

test('buildTrainingBotsStatus separates training and real bots and computes pnl', () => {
  const root = makeRoot();
  const state = {
    activePairs: [
      { venue: 'MT5', symbol: 'XAUUSD' },
      { venue: 'BINANCE', symbol: 'BTCUSDT' }
    ],
    positions: [
      { venue: 'MT5', symbol: 'XAUUSD', horizon: 'intraday', exit_price: null },
      { venue: 'BINANCE', symbol: 'BTCUSDT', horizon: 'swing', exit_price: null }
    ],
    closedTrades: [
      { venue: 'MT5', symbol: 'XAUUSD', pnl_demo: 42 },
      { venue: 'MT5', symbol: 'XAUUSD', pnl_demo: -10 },
      { venue: 'BINANCE', symbol: 'BTCUSDT', pnl_demo: 7 }
    ]
  };
  const status = buildTrainingBotsStatus({
    templatesRoot: path.join(root, 'templates'),
    state
  });
  assert.equal(status.ok, true);
  assert.equal(status.trainingBots.length, 2);
  assert.equal(status.realBots.length, 1);
  assert.equal(status.trainingBots[0].id, 'EdiLearningBot_XAUUSD');
  assert.equal(status.trainingBots[0].realizedPnl, 32);
  assert.equal(status.trainingBots[0].openPositions, 1);
  assert.equal(status.trainingBots[1].status, 'queued_for_generation');
  assert.equal(status.realBots[0].mode, 'real');
  assert.equal(status.realBots[0].status, 'not_deployed');
});

test('buildTrainingBotsStatus derives bot queue from open positions when activePairs is empty', () => {
  const root = makeRoot();
  const status = buildTrainingBotsStatus({
    templatesRoot: path.join(root, 'templates'),
    state: {
      activePairs: [],
      positions: [
        { venue: 'BINANCE', symbol: 'ETHUSDT', exit_price: null },
        { venue: 'BINANCE', symbol: 'ETHUSDT', exit_price: null },
        { venue: 'MT5', symbol: 'XAUUSD', exit_price: null }
      ]
    }
  });
  assert.equal(status.trainingBots.some((bot) => bot.symbol === 'ETHUSDT' && bot.status === 'queued_for_generation'), true);
  assert.equal(status.trainingBots.filter((bot) => bot.symbol === 'ETHUSDT').length, 1);
});
