import assert from 'node:assert/strict';
import test from 'node:test';
import type { Bar, InputValue, StudyDefinition, StudyOutput } from '../types';
import { builtinStudies } from './builtin';
import { ema, highest, lowest, rma, sma } from './math';

const HOUR = 3_600_000;
const DAY = 86_400_000;

// Deterministic pseudo-random walk: hourly bars across several UTC days, with volume.
function syntheticBars(count: number, withVolume = true): Bar[] {
  let seed = 42;
  const random = () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  const bars: Bar[] = [];
  let close = 100;
  for (let i = 0; i < count; i++) {
    const open = close;
    close = Math.max(1, open + (random() - 0.5) * 4);
    const high = Math.max(open, close) + random() * 2;
    const low = Math.min(open, close) - random() * 2;
    const bar: Bar = { time: Date.UTC(2024, 0, 1) + i * HOUR, open, high, low, close };
    if (withVolume) bar.volume = Math.round(1000 + random() * 5000);
    bars.push(bar);
  }
  return bars;
}

function barsFromCloses(closes: readonly number[], volumes?: readonly number[]): Bar[] {
  return closes.map((close, i) => ({ time: Date.UTC(2024, 0, 1) + i * DAY, open: close, high: close, low: close, close, volume: volumes?.[i] ?? 1000 }));
}

function study(type: string): StudyDefinition {
  const found = builtinStudies.find((s) => s.type === type);
  if (!found) throw new Error(`study ${type} exists`);
  return found;
}

function run(type: string, bars: readonly Bar[], inputs: Record<string, InputValue> = {}): StudyOutput {
  return study(type).compute(bars, inputs);
}

function values(output: StudyOutput, key: string): readonly (number | null)[] {
  const plot = output.plots.find((p) => p.key === key);
  if (!plot) throw new Error(`plot ${key} exists`);
  return plot.values;
}

function defaults(definition: StudyDefinition): Record<string, InputValue> {
  return Object.fromEntries(definition.inputs.map((input) => [input.key, input.default]));
}

const close = (actual: number | null | undefined, expected: number, epsilon = 1e-9) => {
  assert.equal(typeof actual, 'number', `expected a number, got ${actual}`);
  assert.ok(Math.abs((actual as number) - expected) <= epsilon, `${actual} ≈ ${expected}`);
};

// ── Structure ────────────────────────────────────────────────────────────────

test('study types are unique and kebab-case', () => {
  const types = builtinStudies.map((s) => s.type);
  assert.equal(new Set(types).size, types.length);
  for (const type of types) assert.match(type, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.equal(builtinStudies.length, 38);
});

test('every study returns aligned, finite-or-null plots for long, empty, single-bar and volume-less series', () => {
  const series: Bar[][] = [syntheticBars(300), [], syntheticBars(1), syntheticBars(2), syntheticBars(300, false)];
  for (const definition of builtinStudies) {
    for (const inputs of [defaults(definition), {}, { length: 'nope', source: 'Bogus', mult: Number.NaN } as Record<string, InputValue>]) {
      for (const bars of series) {
        const output = definition.compute(bars, inputs);
        assert.ok(output.plots.length > 0, `${definition.type} has plots`);
        const keys = new Set(output.plots.map((p) => p.key));
        assert.equal(keys.size, output.plots.length, `${definition.type} plot keys are unique`);
        for (const b of output.bands ?? []) assert.ok(keys.has(b.from) && keys.has(b.to), `${definition.type} band ${b.key} refers to its plots`);
        for (const plot of output.plots) {
          assert.equal(plot.values.length, bars.length, `${definition.type}.${plot.key} length`);
          if (plot.colors) assert.equal(plot.colors.length, bars.length, `${definition.type}.${plot.key} colours length`);
          for (const v of plot.values) assert.ok(v === null || Number.isFinite(v), `${definition.type}.${plot.key} holds ${v}`);
        }
      }
    }
  }
});

test('every study produces some values on a 300-bar series', () => {
  const bars = syntheticBars(300);
  for (const definition of builtinStudies) {
    const output = definition.compute(bars, defaults(definition));
    const first = output.plots[0];
    assert.ok(first.values.some((v) => v !== null), `${definition.type} computes something`);
  }
});

// ── Moving averages ──────────────────────────────────────────────────────────

test('SMA is the mean of the last length closes', () => {
  const sma3 = values(run('sma', barsFromCloses([1, 2, 3, 4, 5, 6, 10]), { length: 3 }), 'sma');
  assert.deepEqual(sma3.slice(0, 2), [null, null]);
  close(sma3[2], 2);
  close(sma3[5], 5);
  close(sma3[6], 7); // (5 + 6 + 10) / 3
});

test('EMA is seeded with the SMA of the first length values', () => {
  const ema3 = values(run('ema', barsFromCloses([2, 4, 6, 10, 4]), { length: 3 }), 'ema');
  assert.deepEqual(ema3.slice(0, 2), [null, null]);
  close(ema3[2], 4);
  close(ema3[3], 7); // 0.5 · 10 + 0.5 · 4
  close(ema3[4], 5.5); // 0.5 · 4 + 0.5 · 7
});

test('the math helpers skip leading nulls before seeding', () => {
  const src = [null, null, 1, 2, 3, 4];
  assert.deepEqual(sma(src, 2), [null, null, null, 1.5, 2.5, 3.5]);
  assert.deepEqual(ema(src, 3).slice(0, 4), [null, null, null, null]);
  close(ema(src, 3)[4], 2);
  close(rma(src, 2)[3], 1.5);
  close(rma(src, 2)[4], 2.25);
  assert.deepEqual(highest([1, 5, 3, 2], 2), [null, 5, 5, 3]);
  assert.deepEqual(lowest([1, 5, 3, 2], 2), [null, 1, 3, 2]);
});

// ── Oscillators ──────────────────────────────────────────────────────────────

test('RSI uses Wilder smoothing', () => {
  const rsi2 = values(run('rsi', barsFromCloses([10, 11, 10.5, 12]), { length: 2 }), 'rsi');
  assert.deepEqual(rsi2.slice(0, 2), [null, null]);
  close(rsi2[2], 100 - 100 / 3); // avg gain 0.5, avg loss 0.25
  close(rsi2[3], 100 - 100 / 9); // avg gain 1.0, avg loss 0.125
});

test('RSI of a strictly rising series is 100 after warm-up', () => {
  const rising = barsFromCloses(Array.from({ length: 40 }, (_, i) => 100 + i));
  const rsi14 = values(run('rsi', rising), 'rsi');
  assert.ok(rsi14.slice(0, 14).every((v) => v === null));
  assert.ok(rsi14.slice(14).every((v) => v === 100));
});

test('Bollinger bands are symmetric around the basis', () => {
  const output = run('bollinger-bands', syntheticBars(300));
  const basis = values(output, 'basis');
  const upper = values(output, 'upper');
  const lower = values(output, 'lower');
  assert.equal(basis[18], null);
  for (let i = 19; i < 300; i++) close((upper[i] as number) - (basis[i] as number), (basis[i] as number) - (lower[i] as number), 1e-9);
  assert.deepEqual(output.bands?.map((b) => [b.from, b.to]), [['upper', 'lower']]);
});

test('MACD histogram is MACD minus signal', () => {
  const output = run('macd', syntheticBars(300));
  const macd = values(output, 'macd');
  const signal = values(output, 'signal');
  const histogram = values(output, 'histogram');
  assert.equal(macd[24], null);
  assert.notEqual(macd[25], null);
  assert.equal(signal[32], null);
  assert.notEqual(signal[33], null);
  for (let i = 33; i < 300; i++) close(histogram[i], (macd[i] as number) - (signal[i] as number));
  const plot = output.plots.find((p) => p.key === 'histogram');
  assert.equal(plot?.kind, 'histogram');
  assert.ok(plot?.colors?.slice(33).every((c) => typeof c === 'string'));
});

test('ATR of a constant-range series equals the range for every smoothing', () => {
  const bars: Bar[] = Array.from({ length: 50 }, (_, i) => ({ time: i * DAY, open: 100, high: 101.5, low: 99, close: 100 }));
  for (const smoothing of ['RMA', 'SMA', 'EMA', 'WMA']) {
    const atr = values(run('atr', bars, { length: 14, smoothing }), 'atr');
    assert.equal(atr[12], null);
    for (let i = 13; i < 50; i++) close(atr[i], 2.5);
  }
});

test('OBV adds volume on up closes and subtracts it on down closes', () => {
  const obv = values(run('obv', barsFromCloses([10, 11, 11, 10, 12], [100, 200, 300, 400, 500])), 'obv');
  assert.deepEqual(obv, [0, 200, 200, -200, 300]);
});

test('Donchian channels track the highest high and lowest low', () => {
  const bars = syntheticBars(120);
  const output = run('donchian-channels', bars, { length: 10 });
  const upper = values(output, 'upper');
  const lower = values(output, 'lower');
  assert.equal(upper[8], null);
  for (let i = 9; i < bars.length; i++) {
    const window = bars.slice(i - 9, i + 1);
    assert.equal(upper[i], Math.max(...window.map((b) => b.high)));
    assert.equal(lower[i], Math.min(...window.map((b) => b.low)));
  }
});

test('Stochastic stays within 0..100 and Williams %R within −100..0', () => {
  const bars = syntheticBars(300);
  const stoch = run('stochastic', bars);
  for (const key of ['k', 'd']) {
    const series = values(stoch, key).filter((v): v is number => v !== null);
    assert.ok(series.length > 250);
    assert.ok(series.every((v) => v >= 0 && v <= 100));
  }
  const r = values(run('williams-r', bars), 'r').filter((v): v is number => v !== null);
  assert.ok(r.length > 250);
  assert.ok(r.every((v) => v >= -100 && v <= 0));
  // %R is the raw stochastic shifted down by 100.
  const k = values(run('stochastic', bars, { kLength: 14, kSmoothing: 1 }), 'k');
  const wr = values(run('williams-r', bars, { length: 14 }), 'r');
  for (let i = 13; i < 300; i++) close(wr[i], (k[i] as number) - 100, 1e-9);
});

test('SuperTrend switches direction on a reversal', () => {
  const closes = [...Array.from({ length: 40 }, (_, i) => 100 + i * 2), ...Array.from({ length: 40 }, (_, i) => 178 - i * 3)];
  const bars: Bar[] = closes.map((c, i) => ({ time: i * DAY, open: c, high: c + 1, low: c - 1, close: c }));
  const output = run('supertrend', bars, { atrLength: 10, factor: 3 });
  const up = values(output, 'up');
  const down = values(output, 'down');
  for (let i = 0; i < bars.length; i++) assert.ok(up[i] === null || down[i] === null, `one direction at bar ${i}`);
  assert.equal(up[8], null);
  assert.equal(down[8], null);
  assert.notEqual(up[39], null, 'uptrend at the top');
  assert.ok((up[39] as number) < bars[39].close);
  assert.notEqual(down[79], null, 'downtrend after the reversal');
  assert.ok((down[79] as number) > bars[79].close);
  const flip = down.findIndex((v, i) => i > 39 && v !== null);
  assert.ok(flip > 39 && flip < 79);
  const colors = output.plots.find((p) => p.key === 'up')?.colors;
  assert.equal(colors?.[39], '#089981');
  assert.equal(colors?.[79], null);
});

// ── Session studies ──────────────────────────────────────────────────────────

test('VWAP restarts when the UTC day changes', () => {
  const day1 = Date.UTC(2024, 4, 1);
  const bar = (time: number, price: number, volume: number): Bar => ({ time, open: price, high: price, low: price, close: price, volume });
  const bars = [bar(day1 + 22 * HOUR, 100, 10), bar(day1 + 23 * HOUR, 110, 30), bar(day1 + DAY, 200, 5), bar(day1 + DAY + HOUR, 230, 10)];
  const vwap = values(run('vwap', bars), 'vwap');
  close(vwap[0], 100);
  close(vwap[1], (100 * 10 + 110 * 30) / 40);
  close(vwap[2], 200);
  close(vwap[3], (200 * 5 + 230 * 10) / 15);
  const banded = run('vwap', bars, { bands: true });
  close(values(banded, 'upper')[2], 200);
  assert.ok((values(banded, 'upper')[3] as number) > (vwap[3] as number));
  assert.equal(run('vwap', bars).plots.length, 1);
});

test('pivot point P is (H + L + C) / 3 of the previous UTC day', () => {
  const day1 = Date.UTC(2024, 4, 1);
  const bars: Bar[] = [
    { time: day1 + 1 * HOUR, open: 10, high: 12, low: 9, close: 11 },
    { time: day1 + 5 * HOUR, open: 11, high: 15, low: 10, close: 14 },
    { time: day1 + 20 * HOUR, open: 14, high: 14.5, low: 8, close: 13 },
    { time: day1 + DAY + HOUR, open: 13, high: 13, low: 12, close: 12.5 },
    { time: day1 + DAY + 9 * HOUR, open: 12.5, high: 20, low: 12, close: 19 },
    { time: day1 + 2 * DAY + HOUR, open: 19, high: 19, low: 18, close: 18 },
  ];
  const output = run('pivot-points', bars);
  const p = values(output, 'p');
  assert.deepEqual(p.slice(0, 3), [null, null, null]);
  const day1P = (15 + 8 + 13) / 3;
  close(p[3], day1P);
  close(p[4], day1P);
  close(values(output, 'r1')[3], 2 * day1P - 8);
  close(values(output, 's1')[3], 2 * day1P - 15);
  close(values(output, 'r2')[3], day1P + 7);
  close(values(output, 's3')[3], 8 - 2 * (15 - day1P));
  close(p[5], (20 + 12 + 19) / 3);
});

test('Ichimoku spans are shifted by displacement − 1', () => {
  const output = run('ichimoku-cloud', syntheticBars(300));
  const offsets = Object.fromEntries(output.plots.map((p) => [p.key, p.offset ?? 0]));
  assert.deepEqual(offsets, { conversion: 0, base: 0, lagging: -25, spanA: 25, spanB: 25 });
});
