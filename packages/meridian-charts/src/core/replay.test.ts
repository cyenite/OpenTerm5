import assert from 'node:assert/strict';
import test from 'node:test';
import type { Bar } from '../types';
import { barEnd, mergeDetail, nextReplayTime, replayOpening, revealReplay } from './replay';
import { timeframeMs } from './timeframes';

const H4 = timeframeMs('4h');
const M15 = timeframeMs('15');
const MONTH = timeframeMs('1M');
const at = (text: string): number => Date.parse(`${text}Z`);

// Bars every `interval` from `from` up to `to`, skipping weekends (the market closes at Friday
// midnight). Prices follow the bar's position so each bar is recognisable.
function series(from: string, to: string, interval: number): Bar[] {
  const bars: Bar[] = [];
  for (let time = at(from); time < at(to); time += interval) {
    const day = new Date(time).getUTCDay();
    if (day === 0 || day === 6) continue;
    const base = bars.length;
    bars.push({ time, open: base, high: base + 2, low: base - 1, close: base + 1, volume: 10 });
  }
  return bars;
}

const chart = series('2026-10-08T00:00', '2026-10-14T00:00', H4);
const detail = series('2026-10-08T00:00', '2026-10-14T00:00', M15);

test('the bar in progress is built from the detail bars that have ended', () => {
  const revealed = revealReplay(chart, H4, detail, M15, at('2026-10-12T01:30'));
  const formingIndex = chart.findIndex((bar) => bar.time === at('2026-10-12T00:00'));
  assert.equal(revealed.length, formingIndex + 1);
  assert.deepEqual(revealed.slice(0, -1), chart.slice(0, formingIndex));
  const parts = detail.filter((bar) => bar.time >= at('2026-10-12T00:00') && bar.time < at('2026-10-12T01:30'));
  assert.equal(parts.length, 6);
  assert.deepEqual(revealed[revealed.length - 1], {
    time: at('2026-10-12T00:00'),
    open: parts[0].open,
    high: Math.max(...parts.map((bar) => bar.high)),
    low: Math.min(...parts.map((bar) => bar.low)),
    close: parts[5].close,
    volume: 60,
  });
  // A time on a bar boundary shows whole bars only.
  assert.deepEqual(revealReplay(chart, H4, detail, M15, at('2026-10-12T04:00')), chart.slice(0, formingIndex + 1));
  assert.equal(nextReplayTime(chart, H4, detail, M15, at('2026-10-12T01:30')), at('2026-10-12T01:45'));
  assert.equal(nextReplayTime(chart, H4, detail, M15, at('2026-10-12T01:40')), at('2026-10-12T01:45'));
});

test('Friday\'s last bar ends at the close and the next step is on Monday', () => {
  const friday = chart.findIndex((bar) => bar.time === at('2026-10-09T20:00'));
  assert.equal(barEnd(chart, friday, H4), at('2026-10-10T00:00'));
  assert.deepEqual(revealReplay(chart, H4, detail, M15, at('2026-10-11T12:00')), chart.slice(0, friday + 1));
  assert.equal(nextReplayTime(chart, H4, detail, M15, at('2026-10-09T23:45')), at('2026-10-10T00:00'));
  assert.equal(nextReplayTime(chart, H4, detail, M15, at('2026-10-10T00:00')), at('2026-10-12T00:15'));
  assert.equal(nextReplayTime(chart, H4, [], M15, at('2026-10-10T00:00')), at('2026-10-12T04:00'));
});

test('without detail for the bar in progress it is left out and steps use whole bars', () => {
  const late = detail.filter((bar) => bar.time >= at('2026-10-12T02:00'));
  const monday = chart.findIndex((bar) => bar.time === at('2026-10-12T00:00'));
  assert.deepEqual(revealReplay(chart, H4, late, M15, at('2026-10-12T03:00')), chart.slice(0, monday));
  assert.deepEqual(revealReplay(chart, H4, [], M15, at('2026-10-12T03:00')), chart.slice(0, monday));
  assert.deepEqual(revealReplay(chart, H4, detail, null, at('2026-10-12T03:00')), chart.slice(0, monday));
  assert.equal(nextReplayTime(chart, H4, late, M15, at('2026-10-12T01:00')), at('2026-10-12T04:00'));
  assert.equal(nextReplayTime(chart, H4, late, M15, at('2026-10-12T04:00')), at('2026-10-12T04:15'));
  // Past the loaded detail the steps go back to whole bars.
  const early = detail.filter((bar) => bar.time < at('2026-10-12T02:00'));
  assert.equal(nextReplayTime(chart, H4, early, M15, at('2026-10-12T02:00')), at('2026-10-12T04:00'));
});

test('a step as coarse as the chart interval gives whole bars', () => {
  const coarse = series('2026-10-08T00:00', '2026-10-14T00:00', H4);
  const monday = chart.findIndex((bar) => bar.time === at('2026-10-12T00:00'));
  assert.deepEqual(revealReplay(chart, H4, coarse, H4, at('2026-10-12T03:00')), chart.slice(0, monday));
  assert.equal(nextReplayTime(chart, H4, coarse, H4, at('2026-10-12T01:00')), at('2026-10-12T04:00'));
});

test('month bars end at the next month', () => {
  const months = ['2026-01-01', '2026-02-01', '2026-03-01'].map((day, index) => ({ time: at(`${day}T00:00`), open: index, high: index, low: index, close: index }));
  assert.equal(barEnd(months, 0, MONTH), at('2026-02-01T00:00'));
  assert.equal(barEnd(months, 2, MONTH), at('2026-04-01T00:00'));
  assert.deepEqual(revealReplay(months, MONTH, [], null, at('2026-02-15T00:00')), months.slice(0, 1));
  assert.deepEqual(revealReplay(months, MONTH, [], null, at('2026-03-31T00:00')), months.slice(0, 2));
  assert.deepEqual(revealReplay(months, MONTH, [], null, at('2026-04-01T00:00')), months);
  assert.equal(nextReplayTime(months, MONTH, [], null, at('2026-01-15T00:00')), at('2026-02-01T00:00'));
  assert.equal(nextReplayTime(months, MONTH, [], null, at('2026-02-01T00:00')), at('2026-03-01T00:00'));
});

test('the replay ends with the data, and shows nothing before the first bar ends', () => {
  const end = barEnd(chart, chart.length - 1, H4);
  assert.equal(nextReplayTime(chart, H4, detail, M15, end - 1), end);
  assert.equal(nextReplayTime(chart, H4, detail, M15, end), null);
  assert.equal(nextReplayTime([], H4, [], null, end), null);
  assert.deepEqual(revealReplay(chart, H4, [], null, chart[0].time + 1), []);
  assert.deepEqual(revealReplay(chart, H4, detail, M15, chart[0].time), []);
  assert.equal(nextReplayTime(chart, H4, [], null, chart[0].time - H4 * 10), chart[0].time + H4);
});

test('the bar in progress opens at its own time, and between bars at the time itself', () => {
  assert.equal(replayOpening(chart, H4, at('2026-10-12T01:30')), at('2026-10-12T00:00'));
  assert.equal(replayOpening(chart, H4, at('2026-10-12T04:00')), at('2026-10-12T04:00'));
  assert.equal(replayOpening(chart, H4, at('2026-10-11T12:00')), at('2026-10-11T12:00'));
});

test('fetched detail joins the loaded detail it meets and replaces detail it does not', () => {
  const head = detail.slice(0, 100);
  const tail = detail.slice(90, 200);
  assert.deepEqual(mergeDetail(head, tail, M15), detail.slice(0, 200));
  assert.deepEqual(mergeDetail(tail, head, M15), detail.slice(0, 200));
  assert.deepEqual(mergeDetail(head, detail.slice(150, 200), M15), detail.slice(150, 200));
  assert.deepEqual(mergeDetail(head, [], M15), head);
  assert.deepEqual(mergeDetail(head, tail, M15, 120), detail.slice(80, 200));
  assert.deepEqual(mergeDetail(tail, head, M15, 120), detail.slice(0, 120));
});
