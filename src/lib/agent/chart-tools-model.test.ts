import assert from 'node:assert/strict';
import test from 'node:test';
import type { Bar } from '@meridian/charts';
import { agentDrawing, averageTrueRange, barInterval, barRows, barSummary, describeDrawing, formatChartTime, isAgentDrawing, isHexColor, parseChartTime, pointsProblem, snapToBar } from './chart-tools-model';

const hour = 3_600_000;
const start = Date.UTC(2026, 10, 27, 8);
const bars: Bar[] = [0, 1, 2, 3, 4].map((index) => ({ time: start + index * hour, open: 1 + index, high: 2 + index, low: index, close: 1.5 + index, volume: 10 }));
const times = bars.map((bar) => bar.time);

test('chart times read and write the clock the chart shows', () => {
  assert.equal(formatChartTime(start), '2026-11-27 08:00');
  assert.equal(formatChartTime(start + 30_000), '2026-11-27 08:00:30');
  assert.equal(parseChartTime('2026-11-27 08:00'), start);
  assert.equal(parseChartTime('2026-11-27T08:00:30Z'), start + 30_000);
  assert.equal(parseChartTime('2026-11-27'), Date.UTC(2026, 10, 27));
  assert.equal(parseChartTime(start), start);
});

test('unreadable or impossible times are refused', () => {
  assert.equal(parseChartTime('yesterday'), null);
  assert.equal(parseChartTime('2026-02-30 10:00'), null);
  assert.equal(parseChartTime(Number.NaN), null);
  assert.equal(parseChartTime(undefined), null);
});

test('times snap to the nearest bar open, and to the interval grid past either end', () => {
  assert.equal(snapToBar(start + 1.4 * hour, times, hour), start + hour);
  assert.equal(snapToBar(start + 1.6 * hour, times, hour), start + 2 * hour);
  assert.equal(snapToBar(start + 1.5 * hour, times, hour), start + hour);
  assert.equal(snapToBar(start + 6.7 * hour, times, hour), start + 7 * hour);
  assert.equal(snapToBar(start - 2.2 * hour, times, hour), start - 2 * hour);
  assert.equal(snapToBar(123, [], hour), 123);
});

test('the bar interval is the smallest gap, so a weekend does not stretch it', () => {
  const gapped = [...bars, { ...bars[0], time: start + 60 * hour }];
  assert.equal(barInterval(gapped, 99), hour);
  assert.equal(barInterval(bars.slice(0, 1), 99), 99);
});

test('ATR averages the true ranges of the last bars', () => {
  assert.equal(averageTrueRange(bars, 4), 2);
  assert.equal(averageTrueRange(bars, 5), null);
});

test('rows and summary describe bars compactly', () => {
  assert.deepEqual(barRows(bars.slice(0, 1)), [['2026-11-27 08:00', 1, 2, 0, 1.5, 10]]);
  assert.deepEqual(barSummary(bars), { from: '2026-11-27 08:00', to: '2026-11-27 12:00', count: 5, high: 6, low: 0, lastClose: 5.5, atr14: null });
  assert.equal(barSummary([]), null);
});

test('point counts must fit the tool', () => {
  assert.equal(pointsProblem('trend-line', 2, 2), null);
  assert.equal(pointsProblem('horizontal-line', 1, 2), 'horizontal-line takes 1 point, not 2.');
  assert.equal(pointsProblem('path', 'multi', 1), 'path takes at least 2 points.');
  assert.equal(pointsProblem('brush', 'free', 3), null);
});

test('agent drawings are marked by id and described in chart time', () => {
  const drawing = agentDrawing({ id: 'agent-x-1', type: 'horizontal-line', style: { lineColor: '#ff0000', lineWidth: 2, lineStyle: 'solid' }, anchors: [{ time: start, price: 1.1 }], zIndex: 3, createdAt: 7, text: 'Support' });
  assert.equal(drawing.paneId, 'price');
  assert.equal(drawing.locked, false);
  assert.ok(isAgentDrawing(drawing));
  assert.ok(!isAgentDrawing({ id: 'drawing-abc' }));
  assert.deepEqual(describeDrawing(drawing), { id: 'agent-x-1', type: 'horizontal-line', points: [{ time: '2026-11-27 08:00', price: 1.1 }], text: 'Support', isAgent: true });
});

test('colours must be #rrggbb', () => {
  assert.ok(isHexColor('#2962ff'));
  assert.ok(!isHexColor('red'));
  assert.ok(!isHexColor('#fff'));
});
