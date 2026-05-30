const assert = require('node:assert');

const {
  getBogotaMarketClock,
  getMt5MarketSession
} = require('../backend/market/mt5-market-hours');

const fridayAfterCut = getMt5MarketSession(new Date('2026-05-29T20:01:00.000Z'));
assert.equal(fridayAfterCut.open, false);
assert.equal(fridayAfterCut.reason, 'weekend_cut');
assert.equal(fridayAfterCut.bogota.day, 5);
assert.equal(fridayAfterCut.bogota.hour, 15);

const saturday = getMt5MarketSession(new Date('2026-05-30T15:00:00.000Z'));
assert.equal(saturday.open, false);
assert.equal(saturday.reason, 'weekend_cut');

const sundayBeforeDailyCloseEnds = getMt5MarketSession(new Date('2026-05-31T21:30:00.000Z'));
assert.equal(sundayBeforeDailyCloseEnds.open, false);
assert.equal(sundayBeforeDailyCloseEnds.reason, 'daily_maintenance');

const sundayOpen = getMt5MarketSession(new Date('2026-05-31T22:01:00.000Z'));
assert.equal(sundayOpen.open, true);
assert.equal(sundayOpen.reason, 'open');

const weekdayMaintenance = getMt5MarketSession(new Date('2026-05-27T21:30:00.000Z'));
assert.equal(weekdayMaintenance.open, false);
assert.equal(weekdayMaintenance.reason, 'daily_maintenance');

const weekdayOpen = getMt5MarketSession(new Date('2026-05-27T20:30:00.000Z'));
assert.equal(weekdayOpen.open, true);
assert.equal(weekdayOpen.reason, 'open');

const clock = getBogotaMarketClock(new Date('2026-05-27T20:30:00.000Z'));
assert.deepEqual(
  { day: clock.day, hour: clock.hour, minute: clock.minute },
  { day: 3, hour: 15, minute: 30 }
);

console.log('mt5_market_hours.test.js OK');
