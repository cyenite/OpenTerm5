import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextSessionOpen, nextSessionOpenOnChart } from './market-sessions';
import type { ServerClock } from './server-clock';

const HOUR = 3_600_000;
const iso = (time: number) => new Date(time).toISOString().slice(0, 16);

test('sessions open at their local hour, following each city\'s daylight saving', () => {
  // Wednesday 2026-01-14 12:00 UTC: London is on GMT, New York on EST.
  const winter = Date.UTC(2026, 0, 14, 12);
  assert.equal(iso(nextSessionOpen('london', winter)), '2026-01-15T08:00');
  assert.equal(iso(nextSessionOpen('newYork', winter)), '2026-01-14T13:00');
  assert.equal(iso(nextSessionOpen('tokyo', winter)), '2026-01-15T00:00');
  assert.equal(iso(nextSessionOpen('sydney', winter)), '2026-01-14T20:00', 'Sydney is on daylight time in January');
  // In July London is on BST and New York on EDT.
  const summer = Date.UTC(2026, 6, 15, 11);
  assert.equal(iso(nextSessionOpen('london', summer)), '2026-07-16T07:00');
  assert.equal(iso(nextSessionOpen('newYork', summer)), '2026-07-15T12:00');
});

test('weekends are skipped', () => {
  const friday = Date.UTC(2026, 0, 16, 18);
  assert.equal(iso(nextSessionOpen('london', friday)), '2026-01-19T08:00');
  assert.equal(iso(nextSessionOpen('newYork', friday)), '2026-01-19T13:00');
});

test('on the chart, a session lands on the broker clock', () => {
  const clock: ServerClock = { weeks: [], bySeason: {}, reportedMs: 2 * HOUR };
  // 10:00 on a UTC+2 server is 08:00 UTC, just before London opens at 08:00 UTC in winter.
  const chartTime = Date.UTC(2026, 0, 14, 9, 59);
  assert.equal(iso(nextSessionOpenOnChart(clock, 'london', chartTime)), '2026-01-14T10:00');
});
