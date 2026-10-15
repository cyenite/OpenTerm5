import assert from 'node:assert/strict';
import test from 'node:test';
import { readServerClock, serverOffsetAt, weekOffsetMs, zoneOffsetMs } from './server-clock';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Hourly bars from each Sunday 17:00 New York open to the Friday close, on a server whose clock
// is `offsetAt(utc)` ahead of UTC, for `weeks` weeks ending at `endUtc`.
function history(offsetAt: (utcMs: number) => number, weeks: number, endUtc: number): number[] {
  const times: number[] = [];
  let sunday = Math.floor(endUtc / DAY) * DAY;
  while (new Date(sunday).getUTCDay() !== 0) sunday -= DAY;
  for (let week = weeks - 1; week >= 0; week--) {
    const day = sunday - week * 7 * DAY;
    const open = day + 17 * HOUR - zoneOffsetMs('America/New_York', day + 22 * HOUR);
    for (let hour = 0; hour < 5 * 24 - 1; hour++) {
      const utc = open + hour * HOUR;
      times.push(utc + offsetAt(utc));
    }
  }
  return times;
}

const newYorkClose = (utc: number) => (zoneOffsetMs('America/New_York', utc) === -4 * HOUR ? 3 : 2) * HOUR;
const athens = (utc: number) => zoneOffsetMs('Europe/Athens', utc);
const END = Date.UTC(2026, 9, 14);

test('a week\'s first bar gives the server offset in summer and winter', () => {
  const summerOpen = Date.UTC(2026, 6, 12, 21);
  const winterOpen = Date.UTC(2026, 0, 11, 22);
  assert.equal(weekOffsetMs(summerOpen + 3 * HOUR), 3 * HOUR);
  assert.equal(weekOffsetMs(winterOpen + 2 * HOUR), 2 * HOUR);
  assert.equal(weekOffsetMs(summerOpen), 0);
  assert.equal(weekOffsetMs(Date.UTC(2026, 6, 15, 12)), null);
});

test('a New York close broker reads as UTC+3 in summer and UTC+2 in winter, before its history too', () => {
  const clock = readServerClock(history(newYorkClose, 41, END), 3 * HOUR);
  assert.ok(clock.weeks.length >= 40);
  assert.equal(serverOffsetAt(clock, Date.UTC(2026, 6, 15, 12)), 3 * HOUR);
  assert.equal(serverOffsetAt(clock, Date.UTC(2026, 1, 10, 12)), 2 * HOUR);
  assert.equal(serverOffsetAt(clock, Date.UTC(2024, 6, 15, 12)), 3 * HOUR);
  assert.equal(serverOffsetAt(clock, Date.UTC(2024, 11, 10, 12)), 2 * HOUR);
});

test('an EU-rule broker keeps UTC+2 in the weeks the US has already moved its clocks', () => {
  const clock = readServerClock(history(athens, 41, END), 3 * HOUR);
  assert.equal(serverOffsetAt(clock, Date.UTC(2026, 2, 17, 12)), 2 * HOUR);
  assert.equal(serverOffsetAt(clock, Date.UTC(2025, 2, 18, 12)), 2 * HOUR);
  assert.equal(serverOffsetAt(clock, Date.UTC(2025, 6, 15, 12)), 3 * HOUR);
});

test('holiday gaps and implausible openings are ignored, and the report covers no history', () => {
  const times = history(newYorkClose, 4, END);
  const holiday = times.findIndex((time, index) => index > 30 && new Date(time).getUTCDay() === 3);
  const withHoliday = [...times.slice(0, holiday), ...times.slice(holiday).map((time) => time + 2 * DAY)];
  assert.ok(readServerClock(withHoliday, 3 * HOUR).weeks.every((week) => week.offsetMs === 3 * HOUR));
  assert.equal(readServerClock(history(() => 8 * HOUR, 4, END), 3 * HOUR).weeks.length, 0);
  assert.equal(serverOffsetAt(readServerClock([], 3 * HOUR), Date.UTC(2026, 0, 5)), 3 * HOUR);
});
