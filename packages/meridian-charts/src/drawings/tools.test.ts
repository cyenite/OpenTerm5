import assert from 'node:assert/strict';
import test from 'node:test';
import type { Bar, DrawingPoint } from '../types';
import { drawingToolInfo } from './catalogue';
import { ShapeList, type Shape } from './shapes';
import { fieldValue, styleFor, toolDefinitions, type Level, type ToolDefinition, type ToolEnv } from './tools';

const T0 = 1_000_000;
const MINUTE = 60_000;

// 60 one-minute bars drifting upwards, with volume 10 each.
const bars: Bar[] = Array.from({ length: 60 }, (_, index) => {
  const open = 100 + index * 0.5;
  const close = open + (index % 3 === 0 ? -0.8 : 1);
  return { time: T0 + index * MINUTE, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 10 };
});

// One pixel per 10 s on x, two pixels per price unit on y.
const timeToX = (time: number) => (time - T0) / 10_000;
const priceToY = (price: number) => 400 - price * 2;

function envFor(type: string, anchors: DrawingPoint[], props: Record<string, unknown> = {}, text?: string): ToolEnv {
  const style = styleFor(type);
  return {
    points: anchors.map((anchor) => ({ x: timeToX(anchor.time), y: priceToY(anchor.price) })),
    anchors,
    drawing: { id: 'd', type, paneId: 'price', anchors, style, text, props, locked: false, visible: true, zIndex: 0, createdAt: 0 },
    bounds: { left: 0, top: 0, width: 800, height: 400 },
    style,
    theme: { text: '#fff', background: '#000', up: '#0f0', down: '#f00', muted: '#888' },
    formatPrice: (price) => price.toFixed(2),
    formatDuration: (ms) => `${Math.round(ms / MINUTE)}m`,
    formatTime: (time) => new Date(time).toISOString(),
    timeToX,
    priceToY,
    bars,
    indexOf: (time) => (time - T0) / MINUTE,
    intervalMs: MINUTE,
    isDraft: false,
    isSelected: false,
  };
}

const at = (bar: number, price: number): DrawingPoint => ({ time: T0 + bar * MINUTE, price });

// A zig-zag of `count` anchors, five bars apart, alternating between swing lows and highs.
const zigzag = (count: number) => Array.from({ length: count }, (_, index) => at(5 + index * 5, 100 + (index % 2 ? 12 : 0) + index));

// Representative anchors for each kind of tool.
function anchorsFor(definition: ToolDefinition): DrawingPoint[] {
  switch (definition.type) {
    case 'long-position': return [at(10, 100), at(30, 110), at(30, 95)];
    case 'short-position': return [at(10, 110), at(30, 100), at(30, 115)];
    case 'bars-pattern': return [at(5, 100), at(14, 105), at(40, 120)];
    case 'fib-extension': return [at(5, 100), at(15, 120), at(25, 110)];
    case 'brush': case 'highlighter': return Array.from({ length: 12 }, (_, index) => at(index, 100 + Math.sin(index) * 5));
    default: return definition.anchors === 'multi' ? zigzag(5) : definition.anchors === 'free' ? zigzag(8) : zigzag(definition.anchors as number);
  }
}

function build(type: string, anchors: DrawingPoint[], props: Record<string, unknown> = {}, text?: string): Shape[] {
  const definition = toolDefinitions.get(type)!;
  const shapes = new ShapeList();
  definition.build(shapes, envFor(type, anchors, props, text));
  return shapes.shapes;
}

function numbersOf(shape: Shape): number[] {
  switch (shape.kind) {
    case 'line': return [shape.a.x, shape.a.y, shape.b.x, shape.b.y];
    case 'poly': return shape.points.flatMap((point) => [point.x, point.y]);
    case 'rect': return [shape.x, shape.y, shape.w, shape.h];
    case 'ellipse': return [shape.cx, shape.cy, shape.rx, shape.ry, shape.start, shape.end, shape.rotation];
    case 'text': return [shape.x, shape.y, shape.size];
  }
}

function assertSane(shapes: readonly Shape[], what: string) {
  for (const shape of shapes) {
    for (const value of numbersOf(shape)) assert.ok(!Number.isNaN(value), `${what}: NaN in a ${shape.kind}`);
    if (shape.kind === 'text') assert.ok(!/NaN|undefined/.test(shape.text), `${what}: bad text "${shape.text}"`);
  }
}

const texts = (shapes: readonly Shape[]) => shapes.flatMap((shape) => (shape.kind === 'text' ? [shape.text] : []));

// A customised value for every field, to exercise the non-default paths.
function customised(definition: ToolDefinition): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const field of definition.fields ?? []) {
    if (field.type === 'checkbox') props[field.key] = !field.default;
    else if (field.type === 'number') props[field.key] = Math.min(field.max ?? Infinity, Math.max(field.min ?? -Infinity, field.default * 2 || 3));
    else if (field.type === 'select') props[field.key] = field.options[field.options.length - 1];
    else if (field.type === 'color') props[field.key] = '#123456';
    else if (field.type === 'levels') props[field.key] = field.default.map((level) => ({ ...level, isVisible: true }));
  }
  return props;
}

test('every tool builds shapes without NaN, with default and customised fields, from one anchor up', () => {
  for (const definition of toolDefinitions.values()) {
    const anchors = anchorsFor(definition);
    const full = build(definition.type, anchors);
    assert.ok(full.length > 0, `${definition.type} draws something`);
    assertSane(full, `${definition.type} (defaults)`);
    assertSane(build(definition.type, anchors, customised(definition), 'Line one\nLine two'), `${definition.type} (customised)`);
    for (let count = 1; count < anchors.length; count++) assertSane(build(definition.type, anchors.slice(0, count)), `${definition.type} (${count} anchors)`);
  }
});

test('every catalogued tool has a definition, and every field default has the right type', () => {
  for (const type of drawingToolInfo.keys()) assert.ok(toolDefinitions.has(type), type);
  for (const definition of toolDefinitions.values()) {
    for (const field of definition.fields ?? []) {
      const value = fieldValue<unknown>({ drawing: envFor(definition.type, []).drawing }, definition, field.key);
      if (field.type === 'checkbox') assert.equal(typeof value, 'boolean', `${definition.type}.${field.key}`);
      if (field.type === 'number') assert.equal(typeof value, 'number', `${definition.type}.${field.key}`);
      if (field.type === 'select') assert.ok(field.options.includes(value as string), `${definition.type}.${field.key}`);
      if (field.type === 'levels') assert.ok(Array.isArray(value) && value.length > 0, `${definition.type}.${field.key}`);
    }
  }
});

test('the Fibonacci tools offer levels, labels and background options', () => {
  for (const type of ['fib-retracement', 'fib-extension', 'fib-channel', 'fib-time-zone', 'fib-speed-fan', 'fib-circles', 'fib-arcs', 'fib-wedge']) {
    const keys = (toolDefinitions.get(type)!.fields ?? []).map((field) => field.key);
    for (const key of ['levels', 'showLevels', 'labelsPosition', 'fillBackground', 'backgroundOpacity']) assert.ok(keys.includes(key), `${type} has ${key}`);
  }
  for (const type of ['fib-retracement', 'fib-extension']) assert.ok(toolDefinitions.get(type)!.fields!.some((field) => field.key === 'reverse'), `${type} reverse`);
  const levels = fieldValue<Level[]>({ drawing: envFor('fib-retracement', []).drawing }, toolDefinitions.get('fib-retracement'), 'levels');
  assert.ok(levels.some((level) => level.value === 0.618 && level.isVisible));
  assert.ok(levels.some((level) => level.value === 1.272 && !level.isVisible), '1.272 is there but hidden');
});

test('hidden levels are not drawn', () => {
  const anchors = [at(5, 100), at(20, 150)];
  const defaults = texts(build('fib-retracement', anchors));
  assert.ok(defaults.some((text) => text.startsWith('0.618 ')));
  assert.ok(!defaults.some((text) => text.startsWith('1.272')), 'hidden by default');
  const levels: Level[] = [
    { value: 0, color: '#111111', isVisible: true },
    { value: 0.5, color: '#222222', isVisible: false },
    { value: 1, color: '#333333', isVisible: true },
  ];
  const shapes = build('fib-retracement', anchors, { levels });
  assert.deepEqual(texts(shapes), ['0 (150.00)', '1 (100.00)']);
  assert.equal(shapes.filter((shape) => shape.kind === 'line' && shape.style.color === '#222222').length, 0);
  const pitchfork = build('pitchfork', zigzag(3), { levels: [{ value: 0.5, color: '#abcdef', isVisible: false }, { value: 1, color: '#fedcba', isVisible: true }] });
  assert.equal(pitchfork.filter((shape) => shape.kind === 'line' && shape.style.color === '#abcdef').length, 0);
  assert.equal(pitchfork.filter((shape) => shape.kind === 'line' && shape.style.color === '#fedcba').length, 2);
});

test('fib reverse flips which anchor the levels count from', () => {
  const anchors = [at(5, 100), at(20, 150)];
  const levels = [{ value: 0, color: '#111111', isVisible: true }, { value: 0.25, color: '#222222', isVisible: true }];
  const yOf = (shapes: Shape[], color: string) => shapes.find((shape): shape is Extract<Shape, { kind: 'line' }> => shape.kind === 'line' && shape.style.color === color)!.a.y;
  const normal = build('fib-retracement', anchors, { levels, showPrices: true });
  const reversed = build('fib-retracement', anchors, { levels, reverse: true });
  assert.equal(yOf(normal, '#111111'), priceToY(150));
  assert.equal(yOf(reversed, '#111111'), priceToY(100));
  assert.equal(yOf(normal, '#222222'), priceToY(137.5));
  assert.equal(yOf(reversed, '#222222'), priceToY(112.5));
  assert.ok(texts(reversed).includes('0.25 (112.50)'));
  // The extension projects the first leg the other way when reversed.
  const extension = [at(5, 100), at(15, 120), at(25, 110)];
  const one = [{ value: 1, color: '#333333', isVisible: true }];
  assert.equal(yOf(build('fib-extension', extension, { levels: one }), '#333333'), priceToY(130));
  assert.equal(yOf(build('fib-extension', extension, { levels: one, reverse: true }), '#333333'), priceToY(90));
});

test('fib labels follow the label options', () => {
  const anchors = [at(5, 100), at(20, 150)];
  const levels = [{ value: 0.5, color: '#111111', isVisible: true }];
  assert.deepEqual(texts(build('fib-retracement', anchors, { levels, showPrices: false })), ['0.5']);
  assert.deepEqual(texts(build('fib-retracement', anchors, { levels, showLevels: false })), ['125.00']);
  assert.deepEqual(texts(build('fib-retracement', anchors, { levels, showLevels: false, showPrices: false })), []);
  const left = build('fib-retracement', anchors, { levels }).find((shape) => shape.kind === 'text')!;
  const right = build('fib-retracement', anchors, { levels, labelsPosition: 'Right' }).find((shape) => shape.kind === 'text')!;
  assert.ok(left.kind === 'text' && right.kind === 'text' && left.x < timeToX(at(5, 0).time) && right.x > timeToX(at(20, 0).time));
  const withFill = build('fib-retracement', anchors).filter((shape) => shape.kind === 'rect');
  const withoutFill = build('fib-retracement', anchors, { fillBackground: false }).filter((shape) => shape.kind === 'rect');
  assert.ok(withFill.length > 0 && withoutFill.length === 0);
  assert.ok(withFill.every((shape) => shape.kind === 'rect' && shape.style.fillOpacity === 0.08));
});

test('bars pattern copies the bars between its first two anchors to the third', () => {
  const bodies = (shapes: Shape[]) => shapes.filter((shape) => shape.kind === 'rect' && !!shape.style.fill);
  // Bars 5 through 14: ten of them.
  const shapes = build('bars-pattern', [at(5, 100), at(14, 105), at(40, 120)]);
  assert.equal(bodies(shapes).length, 10);
  const first = bodies(shapes)[0];
  assert.ok(first.kind === 'rect' && Math.abs(first.x + first.w / 2 - timeToX(at(40, 0).time)) < 1e-9, 'the copy starts at the third anchor');
  assert.equal(bodies(build('bars-pattern', [at(14, 100), at(5, 105), at(40, 120)])).length, 10, 'either order');
  assert.equal(bodies(build('bars-pattern', [at(5, 100), at(7, 105), at(40, 120)], { mirrored: true, flipped: true })).length, 3);
  assert.equal(bodies(build('bars-pattern', [at(5, 100), at(14, 105)])).length, 0, 'nothing is copied before the third anchor');
  assert.equal(bodies(build('bars-pattern', [at(5, 100), at(14, 105), at(40, 120)], { mode: 'Line' })).length, 0);
});

test('a position starts minimal: compact price labels and no stats until it is selected', () => {
  const labels = texts(build('long-position', [at(10, 100), at(30, 110), at(30, 95)]));
  assert.deepEqual(labels, ['110.00 (+10.00%)', '95.00 (-5.00%)']);
});

test('position labels show the quantity from account size, risk and lot size', () => {
  const full = { isCompact: false, showStats: true };
  // Risking 1% of 1000 = 10 over a 5-point stop: a quantity of 2.
  const long = texts(build('long-position', [at(10, 100), at(30, 110), at(30, 95)], full));
  assert.ok(long.some((text) => text.includes('Qty: 2')), long.join(' | '));
  assert.ok(long.some((text) => text.includes('Risk/Reward Ratio: 2.00')));
  assert.ok(long.some((text) => text.startsWith('Target: 110.00') && text.includes('Amount: 20')));
  assert.ok(long.some((text) => text.startsWith('Stop: 95.00') && text.includes('Amount: 10')));
  assert.ok(long.some((text) => /(Open|Closed) P&L: /.test(text)));
  // 2% of 5000 = 100 over 5 points with a lot size of 4: a quantity of 5.
  const custom = texts(build('long-position', [at(10, 100), at(30, 110), at(30, 95)], { ...full, accountSize: 5000, riskPercent: 2, lotSize: 4 }));
  assert.ok(custom.some((text) => text.includes('Qty: 5')), custom.join(' | '));
  const short = texts(build('short-position', [at(10, 110), at(30, 100), at(30, 115)], full));
  assert.ok(short.some((text) => text.includes('Qty: 2')), short.join(' | '));
});

test('line tools append price, bars and angle info on request', () => {
  const anchors = [at(5, 100), at(15, 110)];
  assert.deepEqual(texts(build('trend-line', anchors)), []);
  const info = texts(build('trend-line', anchors, { showPriceRange: true, showPercentPriceRange: true, showBarsRange: true, showDateTimeRange: true, showAngle: true }));
  assert.ok(info.includes('+10.00 (+10.00%)'), info.join(' | '));
  assert.ok(info.includes('10 bars, 10m'));
  assert.ok(info.some((text) => text.endsWith('°')));
  assert.ok(texts(build('ray', anchors, { showBarsRange: true })).includes('10 bars'));
  assert.ok(texts(build('trend-line', anchors, { showPercentPriceRange: true })).includes('+10.00%'));
  assert.deepEqual(texts(build('trend-line', anchors, { showPriceRange: true, alwaysShowStats: false })), []);
});

test('line text follows the line, reads upright, and sits above, on or below it', () => {
  const rising = build('trend-line', [at(5, 100), at(15, 110)], {}, 'BOS');
  const label = rising.find((shape): shape is Extract<Shape, { kind: 'text' }> => shape.kind === 'text')!;
  assert.equal(label.text, 'BOS');
  assert.ok(label.rotation < 0 && label.rotation > -Math.PI / 2);
  assert.equal(label.baseline, 'bottom');
  const falling = build('trend-line', [at(15, 110), at(5, 100)], { textPosition: 'Below line', textAlign: 'Right' }, 'BOS');
  const right = falling.find((shape): shape is Extract<Shape, { kind: 'text' }> => shape.kind === 'text')!;
  assert.equal(right.rotation, label.rotation);
  assert.deepEqual([right.baseline, right.align], ['top', 'right']);
});

test('a horizontal line hides its price label on request and a rectangle places its text inside', () => {
  const priced = texts(build('horizontal-line', [at(5, 100)]));
  assert.equal(priced.length, 1);
  assert.deepEqual(texts(build('horizontal-line', [at(5, 100)], { showPrice: false })), []);
  assert.deepEqual(texts(build('horizontal-line', [at(5, 100)], { showPrice: false }, 'POI')), ['POI']);
  const box = build('rectangle', [at(5, 100), at(15, 110)], { textAlign: 'Right', textPosition: 'Top' }, 'FVG');
  const text = box.find((shape): shape is Extract<Shape, { kind: 'text' }> => shape.kind === 'text')!;
  assert.deepEqual([text.text, text.align, text.baseline], ['FVG', 'right', 'top']);
});

test('text tools stack multi-line text and honour bold', () => {
  const shapes = build('note', [at(10, 100)], { bold: true }, 'First\nSecond\nThird');
  const lines = shapes.filter((shape): shape is Extract<Shape, { kind: 'text' }> => shape.kind === 'text');
  assert.deepEqual(lines.map((line) => line.text), ['First', 'Second', 'Third']);
  assert.ok(lines.every((line) => line.bold));
  assert.ok(lines[0].y < lines[1].y && lines[1].y < lines[2].y);
  const box = shapes.find((shape) => shape.kind === 'rect');
  assert.ok(box && box.kind === 'rect' && box.y <= lines[0].y - 6 && box.y + box.h >= lines[2].y + 6, 'one background behind all lines');
  const single = build('text', [at(10, 100)], {}, 'Plain');
  assert.equal(single.length, 1);
  assert.ok(single[0].kind === 'text' && !single[0].bold);
});

test('measurers and patterns label what they measure', () => {
  const range = texts(build('date-price-range', [at(5, 100), at(15, 110)])).join(' ');
  assert.match(range, /\+10\.00 \(\+10\.00%\)/);
  assert.match(range, /10 bars, 10m/);
  assert.match(range, /Vol 110/, 'eleven bars of volume 10');
  const xabcd = texts(build('xabcd-pattern', zigzag(5)));
  assert.ok(xabcd.filter((text) => /^\d+(\.\d+)?$/.test(text)).length >= 4, xabcd.join(' | '));
  assert.ok(texts(build('head-shoulders', zigzag(7))).includes('Neckline'));
  const drives = texts(build('three-drives', zigzag(7)));
  for (const name of ['1', '2', '3']) assert.ok(drives.includes(name));
  const profile = texts(build('fixed-range-volume-profile', [at(5, 0), at(40, 0)], { rows: 12, valueAreaPercent: 70 }));
  for (const name of ['POC', 'VAH', 'VAL']) assert.ok(profile.some((text) => text.startsWith(name)), name);
  assert.match(texts(build('projection', [at(5, 100), at(15, 120), at(25, 110)])).join(' '), /50\.0%/);
  const forecast = texts(build('forecast', [at(5, 0), at(15, 200)])).join(' ');
  assert.match(forecast, /10 bars/);
  assert.match(forecast, /Failure/);
});

test('ghost feed draws one candle per bar between its anchors, ending on the last anchor', () => {
  const shapes = build('ghost-feed', [at(5, 100), at(15, 110), at(20, 104)]);
  const bodies = shapes.filter((shape) => shape.kind === 'rect');
  assert.equal(bodies.length, 15);
  const last = bodies[bodies.length - 1];
  assert.ok(last.kind === 'rect');
  assert.ok(Math.abs(last.x + last.w / 2 - timeToX(at(20, 0).time)) < 1e-9);
  const y = priceToY(104);
  assert.ok(Math.abs(last.y - y) < 1e-6 || Math.abs(last.y + last.h - y) < 1.01, 'the last close sits on the anchor');
});

test('position handles sit where TradingView puts them: levels on the entry edge, length on the far edge', () => {
  const handles = toolDefinitions.get('long-position')!.handles!;
  const anchors = [at(10, 100), at(30, 110), at(30, 95)];
  assert.deepEqual(handles.at(anchors), [at(10, 100), at(10, 110), at(10, 95), at(30, 100)]);
  assert.deepEqual(handles.drag(anchors, 1, at(14, 112)), [at(10, 100), at(30, 112), at(30, 95)], 'the target keeps the length');
  assert.deepEqual(handles.drag(anchors, 2, at(12, 90)), [at(10, 100), at(30, 110), at(30, 90)]);
  assert.deepEqual(handles.drag(anchors, 3, at(40, 104)), [at(10, 100), at(40, 110), at(40, 95)], 'the far edge keeps the levels');
  assert.deepEqual(handles.drag(anchors, 0, at(12, 101)), [at(12, 101), at(30, 110), at(30, 95)]);
});

test('rectangle handles are TradingView\'s: four corners, then a handle in the middle of each side', () => {
  const handles = toolDefinitions.get('rectangle')!.handles!;
  const anchors = [at(10, 100), at(30, 120)];
  assert.deepEqual(handles.at(anchors), [at(10, 100), at(30, 120), at(10, 120), at(30, 100), at(10, 110), at(30, 110), at(20, 100), at(20, 120)]);
  assert.deepEqual(handles.drag(anchors, 2, at(5, 125)), [at(5, 100), at(30, 125)], 'a corner moves its two sides');
  assert.deepEqual(handles.drag(anchors, 5, at(40, 90)), [at(10, 100), at(40, 120)], 'a side handle moves only its side');
  assert.deepEqual(handles.drag(anchors, 6, at(40, 90)), [at(10, 90), at(30, 120)]);
  assert.equal(handles.cursors?.[4], 'ew-resize');
  assert.equal(handles.cursors?.[7], 'ns-resize');
});
