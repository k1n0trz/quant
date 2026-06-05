const assert = require('node:assert');

const {
  getBogotaMarketClock,
  getMt5MarketSession
} = require('../backend/market/mt5-market-hours');

const fridayBeforeWeekendCut = getMt5MarketSession(new Date('2026-05-29T20:30:00.000Z'));
assert.equal(fridayBeforeWeekendCut.open, false);
assert.equal(fridayBeforeWeekendCut.reason, 'daily_maintenance');
assert.equal(fridayBeforeWeekendCut.bogota.day, 5);
assert.equal(fridayBeforeWeekendCut.bogota.hour, 15);

const fridayAfterCut = getMt5MarketSession(new Date('2026-05-29T21:01:00.000Z'));
assert.equal(fridayAfterCut.open, false);
assert.equal(fridayAfterCut.reason, 'weekend_cut');
assert.equal(fridayAfterCut.bogota.day, 5);
assert.equal(fridayAfterCut.bogota.hour, 16);

const saturday = getMt5MarketSession(new Date('2026-05-30T15:00:00.000Z'));
assert.equal(saturday.open, false);
assert.equal(saturday.reason, 'weekend_cut');

const sundayBeforeResume = getMt5MarketSession(new Date('2026-05-31T21:30:00.000Z'));
assert.equal(sundayBeforeResume.open, false);
assert.equal(sundayBeforeResume.reason, 'weekend_cut');

const sundayOpen = getMt5MarketSession(new Date('2026-05-31T22:01:00.000Z'));
assert.equal(sundayOpen.open, true);
assert.equal(sundayOpen.reason, 'open');

const weekdayMaintenance = getMt5MarketSession(new Date('2026-05-27T20:30:00.000Z'));
assert.equal(weekdayMaintenance.open, false);
assert.equal(weekdayMaintenance.reason, 'daily_maintenance');

const weekdayOpen = getMt5MarketSession(new Date('2026-05-27T19:30:00.000Z'));
assert.equal(weekdayOpen.open, true);
assert.equal(weekdayOpen.reason, 'open');

const clock = getBogotaMarketClock(new Date('2026-05-27T19:30:00.000Z'));
assert.deepEqual(
  { day: clock.day, hour: clock.hour, minute: clock.minute },
  { day: 3, hour: 14, minute: 30 }
);

console.log('mt5_market_hours.test.js OK');
