import assert from 'node:assert/strict';
import test from 'node:test';
import type { Bar } from '../shared/protocol';
import { timeframes } from '../shared/protocol';
import { aggregateRates, timeframePlan, timeframeStart } from './mt5-web-timeframes';

function bar(time: number, open = 10, close = 12, volume = 1): Bar { return { time, open, close, low: Math.min(open, close) - 1, high: Math.max(open, close) + 1, volume }; }

test('all 21 chart periods choose an exact native divisor and preserve the nine native periods', () => {
  assert.equal(timeframes.length, 21);
  const native = timeframes.filter((period) => !timeframePlan(period.label).isAggregated);
  assert.equal(native.length, 9);
  for (const period of timeframes) {
    const plan = timeframePlan(period.label);
    const source = timeframes.find((value) => value.label === plan.source)!;
    assert.equal(period.seconds % source.seconds, 0);
  }
  assert.equal(timeframePlan('M20').source, 'M5');
  assert.equal(timeframePlan('H8').source, 'H4');
  assert.equal(timeframePlan('H6').source, 'H1');
  assert.equal(timeframePlan('H8', 7200).source, 'H1');
  assert.equal(timeframePlan('H12', 7200).source, 'H1');
});

test('aggregated OHLC keeps first open, extrema, last close and summed actual volume', () => {
  const bars = [bar(120, 12, 13, 3), bar(0, 10, 11, 1), bar(60, 11, 12, 2)];
  assert.deepEqual(aggregateRates(bars, 'M3', 0), [{ time: 0, open: 10, close: 13, low: 9, high: 14, volume: 6 }]);
  assert.deepEqual(bars.map((value) => value.time), [120, 0, 60]);
});

test('gaps remain gaps and repeated source timestamps replace rather than double volume', () => {
  assert.deepEqual(aggregateRates([bar(0), bar(60), bar(60, 11, 13, 5), bar(600)], 'M2', 0).map((value) => [value.time, value.volume]), [[0, 6], [600, 1]]);
  assert.deepEqual(aggregateRates([], 'H12', 7200), []);
});

test('hour frames align to broker midnight across day boundaries', () => {
  const offset = 7200;
  for (const timeframe of ['H2', 'H3', 'H6', 'H8', 'H12'] as const) {
    const plan = timeframePlan(timeframe);
    const midnight = 86400 - offset;
    assert.equal(timeframeStart(midnight, plan.seconds, offset), midnight);
    assert.equal(timeframeStart(midnight - 1, plan.seconds, offset), midnight - plan.seconds);
    const bars = aggregateRates([bar(midnight - 3600), bar(midnight), bar(midnight + 3600)], timeframe, offset);
    assert.equal(bars[0].time, midnight - plan.seconds);
    assert.equal(bars[1].time, midnight);
  }
});

test('partial current bars are retained and invalid or overflowing sources reject', () => {
  assert.equal(aggregateRates([bar(0), bar(60), bar(120)], 'M2', 0).length, 2);
  assert.throws(() => aggregateRates([{ ...bar(0), high: Number.NaN }], 'M2', 0), /Invalid/);
  assert.throws(() => aggregateRates([bar(0, 10, 12, Number.MAX_SAFE_INTEGER), bar(60)], 'M2', 0), /precision/);
  assert.throws(() => timeframeStart(0, 120, 0.5), /alignment/);
});
