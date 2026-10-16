import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayReference, tradingDayKey, zoneOffsetMs } from './trading-day';

test('broker server days follow the offset the broker reports', () => {
  const late = Date.UTC(2026, 9, 15, 20, 30);
  assert.equal(tradingDayKey(late, 'server', 0, 10_800), '2026-10-15');
  assert.equal(tradingDayKey(late + 45 * 60_000, 'server', 0, 10_800), '2026-10-16', '00:15 server time is the next day');
  assert.equal(tradingDayKey(late + 45 * 60_000, 'utc', 0), '2026-10-15', 'still 21:15 in UTC');
  assert.equal(tradingDayKey(late, 'server', 0), '2026-10-15', 'an unknown offset reads as UTC');
});

test('Prague midnight moves with summer time', () => {
  assert.equal(zoneOffsetMs('prague', Date.UTC(2026, 6, 1)), 2 * 3_600_000);
  assert.equal(zoneOffsetMs('prague', Date.UTC(2026, 11, 1)), 3_600_000);
  assert.equal(tradingDayKey(Date.UTC(2026, 9, 15, 22, 30), 'prague', 0), '2026-10-16', '00:30 CEST');
  assert.equal(tradingDayKey(Date.UTC(2026, 11, 15, 22, 30), 'prague', 0), '2026-12-15', '23:30 CET');
  assert.equal(tradingDayKey(Date.UTC(2026, 11, 15, 23, 30), 'prague', 0), '2026-12-16', '00:30 CET');
});

test('a reset hour moves the day boundary', () => {
  const ny = Date.UTC(2026, 9, 15, 20, 30);
  assert.equal(tradingDayKey(ny, 'newYork', 17), '2026-10-14', '16:30 EDT still belongs to the day that started at 17:00 yesterday');
  assert.equal(tradingDayKey(ny + 3_600_000, 'newYork', 17), '2026-10-15', '17:30 EDT starts the next trading day');
});

test('this computer uses the system time zone', () => {
  const time = Date.UTC(2026, 9, 15, 12);
  const local = new Date(time);
  assert.equal(tradingDayKey(time, 'local', 0), `${local.getFullYear()}-${local.getMonth() + 1}-${local.getDate()}`);
});

test('the loss reference follows the chosen basis', () => {
  assert.equal(dayReference('balance', 10_000, 9_800), 10_000);
  assert.equal(dayReference('equity', 10_000, 9_800), 9_800);
  assert.equal(dayReference('higher', 10_000, 10_300), 10_300);
  assert.equal(dayReference('higher', 10_000, 9_800), 10_000);
});
