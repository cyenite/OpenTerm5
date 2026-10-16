import assert from 'node:assert/strict';
import { test } from 'node:test';
import { offsetFromTick, ServerClockEstimator } from './journaling-clock';

const now = Date.UTC(2026, 9, 15, 12, 0, 0);
const HOUR = 3_600_000;

test('a fresh tick gives the offset rounded to 15 minutes', () => {
  assert.equal(offsetFromTick(now + 3 * HOUR - 2_000, now), 180);
  assert.equal(offsetFromTick(now + 3 * HOUR + 500, now), 180);
  assert.equal(offsetFromTick(now - 2_000, now), 0);
  assert.equal(offsetFromTick(now + 5.75 * HOUR - 30_000, now), 345);
  assert.equal(offsetFromTick(now - 5 * HOUR - 1_000, now), -300);
});

test('ticks a minute or more old, and offsets outside -12h..+14h, are ignored', () => {
  assert.equal(offsetFromTick(now + 3 * HOUR - 90_000, now), null);
  assert.equal(offsetFromTick(now + 2 * HOUR - 7 * 60_000, now), null);
  assert.equal(offsetFromTick(now + 15 * HOUR, now), null);
  assert.equal(offsetFromTick(now - 13 * HOUR, now), null);
  assert.equal(offsetFromTick(0, now), null);
});

test('an offset settles after three agreeing ticks and is reported once', () => {
  const clock = new ServerClockEstimator();
  assert.equal(clock.observe('MetaQuotes-Demo', now + 3 * HOUR, now), null);
  assert.equal(clock.observe('MetaQuotes-Demo', now + 3 * HOUR - 1_000, now), null);
  assert.equal(clock.observe('MetaQuotes-Demo', now + 3 * HOUR - 2_000, now), 180);
  assert.equal(clock.offset('MetaQuotes-Demo'), 180);
  assert.equal(clock.observe('MetaQuotes-Demo', now + 3 * HOUR, now), null);
  assert.deepEqual(clock.entries(), { 'MetaQuotes-Demo': 180 });
});

test('a disagreeing tick restarts the count, and a daylight saving change replaces the offset', () => {
  const clock = new ServerClockEstimator(new Map([['Broker-Live', 180]]));
  assert.equal(clock.observe('Broker-Live', now + 2 * HOUR, now), null);
  assert.equal(clock.observe('Broker-Live', now + 3 * HOUR, now), null);
  assert.equal(clock.observe('Broker-Live', now + 2 * HOUR, now), null);
  assert.equal(clock.observe('Broker-Live', now + 2 * HOUR, now), null);
  assert.equal(clock.observe('Broker-Live', now + 2 * HOUR, now), 120);
  assert.equal(clock.offset('Other'), null);
});
