import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCrosshairTime, precisionOf } from './core/format';
import { PriceScale, priceTicks } from './core/price-scale';
import { TimeScale } from './core/time-scale';
import { timeTicks } from './core/time-ticks';
import { isTimeframe, timeframeMs } from './core/timeframes';
import { cursorTools, toolGroups } from './drawings/catalogue';
import { extend, hitShape, ShapeList } from './drawings/shapes';
import { styleFor, toolDefinitions } from './drawings/tools';
import { icons } from './ui/icons';

test('timeframes cover seconds through months', () => {
  assert.equal(timeframeMs('5s'), 5000);
  assert.equal(timeframeMs('15'), 900_000);
  assert.equal(timeframeMs('4h'), 14_400_000);
  assert.equal(timeframeMs('1D'), 86_400_000);
  assert.equal(timeframeMs('W'), 604_800_000);
  assert.equal(timeframeMs('1M'), 30 * 86_400_000);
  assert.equal(isTimeframe('7x'), false);
  assert.equal(isTimeframe(''), false);
});

test('the time scale maps bars, times and pixels both ways, and extrapolates past the data', () => {
  const scale = new TimeScale();
  scale.width = 800;
  const times = Array.from({ length: 100 }, (_, index) => 1_000_000 + index * 60_000);
  scale.setTimes(times, 60_000);
  assert.equal(scale.rightEdge, 99 + scale.rightMarginBars);
  const x = scale.indexToX(50);
  assert.equal(scale.xToIndex(x), 50);
  assert.equal(scale.indexOf(times[10] + 30_000), 10.5);
  assert.equal(scale.timeAt(102), times[99] + 3 * 60_000);
  assert.equal(scale.indexOf(times[0] - 120_000), -2);
  scale.zoom(2, x);
  assert.ok(Math.abs(scale.indexToX(50) - x) < 1e-9, 'zoom keeps the anchor in place');
  const edge = scale.rightEdge;
  scale.setTimes([...Array.from({ length: 10 }, (_, index) => times[0] - (10 - index) * 60_000), ...times], 60_000, 10);
  assert.equal(scale.rightEdge, edge + 10, 'prepended history keeps the view on the same bars');
  scale.append(times[99] + 60_000);
  assert.equal(scale.count, 111);
});

test('barContaining maps a time onto the bar whose span holds it, across intervals and closures', () => {
  const hour = 3_600_000;
  const empty = new TimeScale();
  assert.equal(empty.barContaining(0), null);
  const friday = Date.UTC(2026, 9, 16, 20);
  const monday = Date.UTC(2026, 9, 18, 21);
  const hours = new TimeScale();
  hours.setTimes([friday - hour, friday, monday, monday + hour], hour);
  assert.equal(hours.barContaining(friday), 1, 'a bar holds its own opening time');
  assert.equal(hours.barContaining(friday + 35 * 60_000), 1, 'an M5 time lands on the H1 bar it falls in, not the next hour');
  assert.equal(hours.barContaining(friday + hour - 1), 1);
  assert.equal(hours.barContaining(friday + hour), 2, 'a time in the weekend closure lands on the first bar after it');
  assert.equal(hours.barContaining(Date.UTC(2026, 9, 17, 12)), 2);
  assert.equal(hours.barContaining(monday + hour + 59 * 60_000), 3, 'the last bar spans one interval');
  assert.equal(hours.barContaining(monday + 2 * hour), null, 'past the end of the last bar');
  assert.equal(hours.barContaining(friday - hour - 1), null, 'before the first bar');
  const minutes = new TimeScale();
  minutes.setTimes(Array.from({ length: 24 }, (_, index) => friday + index * 300_000), 300_000);
  assert.equal(minutes.barContaining(friday + hour), 12, 'an H1 time lands on the M5 bar opening then');
  const months = new TimeScale();
  const january = Date.UTC(2026, 0, 1);
  const february = Date.UTC(2026, 1, 1);
  months.setTimes([january, february], 30 * 86_400_000);
  assert.equal(months.barContaining(Date.UTC(2026, 0, 31, 12)), 0, 'a 31-day month still holds its last day');
  assert.equal(months.barContaining(Date.UTC(2026, 1, 28, 12)), 1);
  assert.equal(months.barContaining(Date.UTC(2026, 2, 5)), null);
});

test('the time scale fits a logical range and centres an index, keeping bars on screen', () => {
  const scale = new TimeScale();
  scale.width = 800;
  scale.setTimes(Array.from({ length: 500 }, (_, index) => index * 60_000), 60_000);
  scale.fit(100, 300);
  assert.equal(scale.spacing, 4);
  assert.equal(scale.rightEdge, 300);
  assert.equal(scale.xToIndex(0), 100);
  scale.fit(100, 101);
  assert.equal(scale.spacing, scale.maxSpacing, 'spacing stays within its limits');
  scale.fit(10, 10);
  assert.equal(scale.rightEdge, 101, 'an empty range changes nothing');
  scale.centerOn(250);
  assert.ok(Math.abs(scale.xToIndex(400) - 250) < 1e-9);
  scale.centerOn(-1000);
  assert.ok(scale.xToIndex(scale.width) >= 4, 'the oldest bars stay in view');
});

test('the price scale fits data with margins and keeps a manual range once dragged', () => {
  const scale = new PriceScale();
  scale.top = 0;
  scale.height = 400;
  scale.fit(100, 200);
  assert.ok(scale.priceToY(200) > 0 && scale.priceToY(100) < 400);
  assert.equal(Math.round(scale.yToPrice(scale.priceToY(150))), 150);
  scale.stretch(2);
  const range = scale.max - scale.min;
  scale.fit(0, 1);
  assert.equal(scale.max - scale.min, range, 'manual ranges ignore autoscale');
  scale.reset();
  scale.fit(5, 5);
  assert.ok(scale.max > 5 && scale.min < 5, 'a flat series still gets a range');
  assert.deepEqual(priceTicks(0, 1, 200, 40), [0, 0.2, 0.4, 0.6, 0.8, 1]);
});

test('time labels use clock times within a day and dates at day boundaries', () => {
  const start = Date.UTC(2026, 9, 13, 22, 0);
  const times = Array.from({ length: 300 }, (_, index) => start + index * 60_000);
  const ticks = timeTicks(times, 0, 299, 4, 90);
  assert.ok(ticks.some((tick) => tick.label === '14' && tick.isMajor));
  assert.ok(ticks.some((tick) => /^\d\d:\d\d$/.test(tick.label)));
  const seconds = Array.from({ length: 120 }, (_, index) => start + index * 1000);
  assert.ok(timeTicks(seconds, 0, 119, 10, 90).some((tick) => /^\d\d:\d\d:\d\d$/.test(tick.label)));
  assert.match(formatCrosshairTime(Date.UTC(2026, 9, 14, 9, 30, 15), 5000), /09:30:15$/);
  assert.equal(precisionOf(0.00001), 5);
  assert.equal(precisionOf(0.25), 2);
});

test('every catalogued tool has a definition and an icon', () => {
  for (const group of toolGroups) {
    assert.ok(icons[`group-${group.id}`], `group-${group.id} icon`);
    for (const section of group.sections) for (const tool of section.tools) {
      assert.ok(toolDefinitions.has(tool.type), `${tool.type} definition`);
      assert.ok(icons[tool.type], `${tool.type} icon`);
      assert.ok(styleFor(tool.type).lineColor);
    }
  }
  for (const tool of cursorTools) assert.ok(icons[tool.type], `${tool.type} icon`);
});

test('every tool builds shapes from its anchors without throwing', () => {
  const env = (count: number) => {
    const anchors = Array.from({ length: count }, (_, index) => ({ time: 1_000_000 + index * 600_000, price: 100 + (index % 2 ? 5 : -5) + index }));
    return {
      points: anchors.map((anchor) => ({ x: (anchor.time - 1_000_000) / 10_000, y: 300 - anchor.price })),
      anchors,
      drawing: { id: 'x', type: 'x', paneId: 'price', anchors, style: styleFor('trend-line'), locked: false, visible: true, zIndex: 0, createdAt: 0 },
      bounds: { left: 0, top: 0, width: 800, height: 400 },
      style: styleFor('trend-line'),
      theme: { text: '#fff', background: '#000', up: '#0f0', down: '#f00', muted: '#888' },
      formatPrice: (price: number) => price.toFixed(2),
      formatDuration: (ms: number) => `${ms}ms`,
      formatTime: (time: number) => String(time),
      timeToX: (time: number) => (time - 1_000_000) / 10_000,
      priceToY: (price: number) => 300 - price,
      bars: Array.from({ length: 50 }, (_, index) => ({ time: 1_000_000 + index * 60_000, open: 100, high: 102, low: 98, close: 101, volume: 10 })),
      indexOf: (time: number) => (time - 1_000_000) / 60_000,
      intervalMs: 60_000,
      isDraft: false,
    };
  };
  for (const definition of toolDefinitions.values()) {
    const count = typeof definition.anchors === 'number' ? definition.anchors : 5;
    for (const placed of new Set([1, count])) {
      const shapes = new ShapeList();
      assert.doesNotThrow(() => definition.build(shapes, env(placed)), definition.type);
    }
  }
});

test('shapes are hit along their outline, and inside when filled', () => {
  const measure = (text: string) => text.length * 7;
  const shapes = new ShapeList().line({ x: 0, y: 0 }, { x: 100, y: 100 }).rect({ x: 200, y: 200 }, { x: 300, y: 300 }, { fill: '#000' }).text({ x: 400, y: 50 }, 'Label', { color: '#fff' }).shapes;
  assert.equal(hitShape(shapes[0], { x: 50, y: 53 }, 5, measure), true);
  assert.equal(hitShape(shapes[0], { x: 50, y: 70 }, 5, measure), false);
  assert.equal(hitShape(shapes[1], { x: 250, y: 250 }, 5, measure), true);
  assert.equal(hitShape(shapes[2], { x: 410, y: 50 }, 5, measure), true);
  const [a, b] = extend({ x: 0, y: 0 }, { x: 10, y: 0 }, { left: 0, top: 0, width: 800, height: 400 }, false, true);
  assert.equal(a.x, 0);
  assert.ok(b.x > 800);
});
