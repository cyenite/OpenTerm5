import assert from 'node:assert/strict';
import test from 'node:test';
import { PineTS } from 'pinets';
import { BarClock, toStudyOutput, type PinePlot } from './pine-output';

const HOUR = 3_600_000;
const START = Date.UTC(2026, 0, 1);

// A gentle wave: bars alternate between rising and falling runs.
const candles = Array.from({ length: 60 }, (_, index) => {
  const close = 100 + Math.sin(index / 4) * 3;
  return { openTime: START + index * HOUR, closeTime: START + (index + 1) * HOUR - 1, open: close - 0.3 * Math.sign(Math.cos(index / 4)), high: close + 1, low: close - 1, close, volume: 5 };
});

const times = candles.map((candle) => candle.openTime);

async function convert(source: string) {
  const context = await new PineTS(candles).run(source);
  return toStudyOutput(context.plots as Record<string, PinePlot>, new BarClock(times, HOUR));
}

test('the clock places bar times between and beyond bars', () => {
  const clock = new BarClock([0, 10, 20], 10);
  assert.equal(clock.index(10), 1);
  assert.equal(clock.index(15), 1.5);
  assert.equal(clock.index(50), 5);
  assert.equal(clock.index(-10), -1);
  assert.equal(clock.x(3, 'bi'), 3);
  assert.equal(clock.x(20, 'bt'), 2);
  assert.equal(clock.x(Number.NaN, 'bi'), null);
});

test('plots keep their style, width, offset, per-bar colours and visibility', async () => {
  const { output } = await convert(`//@version=6
indicator("Plots", overlay=true)
plot(close, "Hidden", display=display.none)
plot(close + 1, "Shifted", offset=2, linewidth=3, color=close > open ? color.green : color.red)
plot(close, "Steps", color.orange, style=plot.style_stepline)
plot(close - open, "Hist", style=plot.style_histogram)
plot(close, "Window", display=display.data_window + display.status_line)`);
  const [hidden, shifted, steps, histogram, window] = output.plots;
  assert.equal(window.isHidden, true);
  assert.equal(hidden.isHidden, true);
  assert.equal(shifted.offset, 2);
  assert.equal(shifted.width, 3);
  assert.equal(shifted.values.length, 60);
  assert.ok(shifted.colors?.includes('#F23645') && shifted.colors.includes('#4CAF50'));
  assert.equal(steps.kind, 'stepline');
  assert.equal(steps.colors, undefined);
  assert.equal(histogram.kind, 'histogram');
  assert.ok(Math.abs(steps.values[59]! - candles[59].close) < 1e-9);
});

test('hlines become levels, and fills between them bands', async () => {
  const { output } = await convert(`//@version=6
indicator("Levels")
h1 = hline(103, "Upper", color.gray, linestyle=hline.style_dotted, linewidth=2)
h2 = hline(97, "Lower")
fill(h1, h2, color.new(color.teal, 90), title="Zone")`);
  assert.deepEqual(output.levels, [
    { key: 'Upper', price: 103, color: '#787B86', title: 'Upper', width: 2, lineStyle: 'dotted' },
    { key: 'Lower', price: 97, color: '#787b86', title: 'Lower', width: 1, lineStyle: 'dashed' },
  ]);
  assert.deepEqual(output.bands, [{ key: 'Zone', from: 'Upper', to: 'Lower', color: '#0899811A' }]);
  assert.deepEqual(output.plots.map((plot) => [plot.key, plot.isHidden, plot.values[10]]), [['Upper', true, 103], ['Lower', true, 97]]);
});

test('shapes, characters and arrows become markers on their bars', async () => {
  const { output } = await convert(`//@version=6
indicator("Marks", overlay=true)
plotshape(bar_index == 5, "Buy", shape.labelup, location.belowbar, color.green, text="Buy", textcolor=color.white)
plotchar(bar_index == 6, "Star", "★", location.abovebar, color.yellow, size=size.tiny)
plotarrow(bar_index == 7 ? 1 : na, "Arrow")`);
  assert.deepEqual(output.markers, [
    { index: 5, text: 'Buy', color: '#4CAF50', textColor: '#FFFFFF', size: 'small', shape: 'labelUp', location: 'belowBar' },
    { index: 6, char: '★', color: '#FDD835', size: 'tiny', location: 'aboveBar' },
    { index: 7, color: '#2962ff', size: 'small', shape: 'arrowUp', location: 'belowBar' },
  ]);
});

test('bgcolor and barcolor colour single bars, and na leaves the rest alone', async () => {
  const background = await convert('//@version=6\nindicator("Bg", overlay=true)\nbgcolor(bar_index % 2 == 0 ? color.new(color.green, 80) : na)');
  assert.equal(background.output.backgrounds?.[0], '#4CAF5033');
  assert.equal(background.output.backgrounds?.[1], null);
  const bars = await convert('//@version=6\nindicator("Bars", overlay=true)\nbarcolor(bar_index == 3 ? color.lime : na, title="Bars")');
  assert.equal(bars.output.barColors?.[3], '#00E676');
  assert.equal(bars.output.barColors?.filter(Boolean).length, 1);
});

test('lines, boxes, labels, polylines, linefills and tables convert with bar-time x placed on bars', async () => {
  const { output } = await convert(`//@version=6
indicator("Objects", overlay=true)
if barstate.islast
    l1 = line.new(time[10], high, time, low, xloc=xloc.bar_time, extend=extend.both, style=line.style_arrow_right)
    l2 = line.new(bar_index - 10, low, bar_index, low - 1)
    linefill.new(l1, l2, color.new(color.blue, 80))
    label.new(bar_index, 0, "AB", yloc=yloc.abovebar, style=label.style_triangledown, size=size.large)
    label.new(time + 3 * 3600000, high, "Later", xloc=xloc.bar_time, style=label.style_label_lower_left)
    box.new(time[5], high, time, low, xloc=xloc.bar_time, extend=extend.right, text="Zone", text_size=size.small, text_halign=text.align_right)
    polyline.new(array.from(chart.point.from_index(bar_index - 5, high), chart.point.from_time(time, low)), closed=true)
    var tb = table.new(position.bottom_center, 3, 2, border_width=1)
    table.cell(tb, 0, 0, "first")
    table.cell(tb, 2, 1, "last", bgcolor=color.yellow)`);
  const objects = output.objects!;
  assert.deepEqual(objects.lines.map((line) => [line.startIndex, line.endIndex, line.extend, line.hasEndArrow, line.color]), [[49, 59, 'both', true, '#2962ff'], [49, 59, 'none', false, '#2962ff']]);
  assert.deepEqual(objects.labels.map((label) => [label.index, label.location, label.style, label.size, label.text]), [[59, 'aboveBar', 'triangleDown', 'large', 'AB'], [62, 'price', 'labelLowerLeft', 'normal', 'Later']]);
  assert.deepEqual(objects.boxes.map((box) => [box.leftIndex, box.rightIndex, box.extend, box.text, box.textSize, box.textHalign]), [[54, 59, 'right', 'Zone', 'small', 'right']]);
  assert.equal(objects.polylines.length, 2);
  assert.equal(objects.polylines[0].fillColor, '#2962FF33');
  assert.deepEqual(objects.polylines[0].points.map((point) => point.index), [49, 59, 59, 49]);
  assert.deepEqual(objects.polylines[1].points.map((point) => point.index), [54, 59]);
  const [table] = objects.tables;
  assert.equal(table.position, 'bottom-center');
  assert.equal(table.rows[0][0]?.text, 'first');
  assert.equal(table.rows[1][2]?.text, 'last');
  assert.equal(table.rows[1][2]?.fillColor, '#FDD835');
  assert.equal(table.rows[0][1], null);
});

test('plotcandle is reported as not drawn rather than silently dropped', async () => {
  const { unsupported } = await convert('//@version=6\nindicator("Candles")\nplotcandle(open, high, low, close, "C")');
  assert.deepEqual(unsupported, ['plotcandle']);
});

test('gradient fills carry each bar\'s price range and colours', async () => {
  const { output } = await convert(`//@version=6
indicator("Gradient", overlay=true)
a = plot(close + 1, "Top")
b = plot(close - 1, "Bottom")
fill(a, b, close + 1, close - 1, color.new(color.teal, 20), color.new(color.teal, 100), "Glow")`);
  const [band] = output.bands!;
  assert.equal(band.colors, undefined);
  assert.equal(band.gradients?.length, 60);
  const gradient = band.gradients![30]!;
  assert.ok(Math.abs(gradient.topPrice - (candles[30].close + 1)) < 1e-9);
  assert.equal(gradient.topColor, '#089981CC');
  assert.equal(gradient.bottomColor, '#08998100');
});
