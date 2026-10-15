import assert from 'node:assert/strict';
import test from 'node:test';
import type { Bar, InputValue, StudyDefinition, StudyOutput } from '../types';
import { builtinStudies } from './builtin';
import { extendedStudies } from './extended';
import { ema } from './math';

const HOUR = 3_600_000;
const DAY = 86_400_000;

// Deterministic pseudo-random walk: hourly bars, each opening at the previous close.
function syntheticBars(count: number, volume: 'random' | 'none' | 'zero' = 'random', step = HOUR): Bar[] {
  let seed = 7;
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
    const bar: Bar = { time: Date.UTC(2024, 0, 1) + i * step, open, high, low, close };
    if (volume === 'random') bar.volume = Math.round(1000 + random() * 5000);
    if (volume === 'zero') bar.volume = 0;
    bars.push(bar);
  }
  return bars;
}

function barsFromCloses(closes: readonly number[], volumes?: readonly number[], spread = 0): Bar[] {
  return closes.map((close, i) => ({ time: Date.UTC(2024, 0, 1) + i * DAY, open: close, high: close + spread, low: close - spread, close, volume: volumes?.[i] ?? 1000 }));
}

function study(type: string): StudyDefinition {
  const found = extendedStudies.find((s) => s.type === type);
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

function colors(output: StudyOutput, key: string): readonly (string | null)[] {
  const plot = output.plots.find((p) => p.key === key);
  if (!plot?.colors) throw new Error(`plot ${key} has colours`);
  return plot.colors;
}

function defaults(definition: StudyDefinition): Record<string, InputValue> {
  return Object.fromEntries(definition.inputs.map((input) => [input.key, input.default]));
}

const close = (actual: number | null | undefined, expected: number, epsilon = 1e-9) => {
  assert.equal(typeof actual, 'number', `expected a number, got ${actual}`);
  assert.ok(Math.abs((actual as number) - expected) <= epsilon, `${actual} ≈ ${expected}`);
};

// ── Structure ────────────────────────────────────────────────────────────────

test('study types are unique and kebab-case across built-in and extended lists', () => {
  const types = [...builtinStudies, ...extendedStudies].map((s) => s.type);
  assert.equal(new Set(types).size, types.length);
  for (const type of types) assert.match(type, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.equal(extendedStudies.length, 48);
});

test('every extended study returns aligned, finite-or-null plots for any input', () => {
  const series: Bar[][] = [syntheticBars(300), [], syntheticBars(1), syntheticBars(2), syntheticBars(300, 'none'), syntheticBars(300, 'zero'), barsFromCloses(Array.from({ length: 60 }, () => 50), Array.from({ length: 60 }, () => 0))];
  const wrong = { length: 'nope', source: 'Bogus', mult: Number.NaN, maType: 42, centered: 'yes', deviation: -5, depth: Infinity, period: -3, offset: 'x' } as unknown as Record<string, InputValue>;
  for (const definition of extendedStudies) {
    for (const s of definition.inputs) {
      if (s.type === 'int' || s.type === 'float') assert.ok(typeof s.default === 'number', `${definition.type}.${s.key} default`);
    }
    for (const inputs of [defaults(definition), {}, wrong]) {
      for (const bars of series) {
        const output = definition.compute(bars, inputs);
        assert.ok(output.plots.length > 0, `${definition.type} has plots`);
        const keys = new Set(output.plots.map((p) => p.key));
        assert.equal(keys.size, output.plots.length, `${definition.type} plot keys are unique`);
        for (const b of output.bands ?? []) assert.ok(keys.has(b.from) && keys.has(b.to), `${definition.type} band ${b.key} refers to its plots`);
        for (const l of output.levels ?? []) assert.equal(l.color, '#787b86');
        for (const plot of output.plots) {
          assert.equal(plot.values.length, bars.length, `${definition.type}.${plot.key} length`);
          if (plot.colors) assert.equal(plot.colors.length, bars.length, `${definition.type}.${plot.key} colours length`);
          for (const v of plot.values) assert.ok(v === null || Number.isFinite(v), `${definition.type}.${plot.key} holds ${v}`);
        }
      }
    }
  }
});

test('every extended study produces some values on a 300-bar series', () => {
  const bars = syntheticBars(600, 'random', DAY);
  for (const definition of extendedStudies) {
    const output = definition.compute(bars, defaults(definition));
    assert.ok(
      output.plots.some((p) => p.values.some((v) => v !== null)),
      `${definition.type} computes something`,
    );
  }
});

// ── Moving averages ──────────────────────────────────────────────────────────

test('DEMA and TEMA reproduce a linear series exactly once warmed up', () => {
  const closes = Array.from({ length: 60 }, (_, i) => 10 + 0.5 * i);
  const bars = barsFromCloses(closes);
  const dema = values(run('dema', bars, { length: 9 }), 'dema');
  const tema = values(run('tema', bars, { length: 9 }), 'tema');
  assert.equal(dema[15], null);
  assert.equal(tema[23], null);
  for (let i = 16; i < 60; i++) close(dema[i], closes[i], 1e-9);
  for (let i = 24; i < 60; i++) close(tema[i], closes[i], 1e-9);
});

test('Moving Average Ribbon draws four lines and MA Cross two', () => {
  const bars = syntheticBars(300);
  assert.equal(run('ma-ribbon', bars).plots.length, 4);
  assert.equal(run('ma-cross', bars).plots.length, 2);
});

test('Williams Alligator shifts its lines forward', () => {
  const output = run('williams-alligator', syntheticBars(100));
  assert.deepEqual(
    output.plots.map((p) => p.offset),
    [8, 5, 3],
  );
});

// ── Volume ───────────────────────────────────────────────────────────────────

test('Accumulation/Distribution adds volume when the close is high in the range and subtracts it when low', () => {
  const bars: Bar[] = [
    { time: 0, open: 9, high: 10, low: 8, close: 10, volume: 100 }, // CLV +1
    { time: DAY, open: 9, high: 10, low: 8, close: 8, volume: 50 }, // CLV −1
    { time: 2 * DAY, open: 9, high: 10, low: 8, close: 9, volume: 70 }, // CLV 0
    { time: 3 * DAY, open: 9, high: 9, low: 9, close: 9, volume: 500 }, // zero range
    { time: 4 * DAY, open: 9, high: 12, low: 8, close: 11, volume: 40 }, // CLV 0.5
    { time: 5 * DAY, open: 9, high: 12, low: 8, close: 12, volume: 0 }, // no volume
  ];
  assert.deepEqual(values(run('accumulation-distribution', bars), 'ad'), [100, 50, 50, 50, 70, 70]);
});

test('Force Index is the EMA of close change times volume', () => {
  const efi = values(run('force-index', barsFromCloses([10, 11, 10.5, 12], [100, 200, 300, 400]), { length: 2 }), 'efi');
  assert.deepEqual(efi.slice(0, 2), [null, null]);
  close(efi[2], (200 - 150) / 2);
  close(efi[3], (2 / 3) * 600 + (1 / 3) * 25);
  const raw = values(run('force-index', barsFromCloses([10, 11, 10.5, 12], [100, 200, 300, 400]), { length: 1 }), 'efi');
  assert.deepEqual(raw, [null, 200, -150, 600]);
});

test('Volume columns are coloured by close versus open', () => {
  const bars: Bar[] = [
    { time: 0, open: 1, high: 2, low: 1, close: 2, volume: 10 },
    { time: DAY, open: 2, high: 2, low: 1, close: 1, volume: 20 },
    { time: 2 * DAY, open: 1, high: 1, low: 1, close: 1 },
  ];
  const output = run('volume', bars, { maLength: 2 });
  assert.deepEqual(values(output, 'volume'), [10, 20, null]);
  assert.deepEqual(colors(output, 'volume'), ['#089981', '#f23645', null]);
  assert.deepEqual(values(output, 'ma'), [null, 15, null]);
});

// ── Oscillators ──────────────────────────────────────────────────────────────

test('Vortex sums directional movement over true range', () => {
  const bars: Bar[] = [
    { time: 0, open: 9, high: 10, low: 8, close: 9 },
    { time: DAY, open: 9, high: 11, low: 9, close: 10 },
    { time: 2 * DAY, open: 10, high: 12, low: 10, close: 11 },
    { time: 3 * DAY, open: 11, high: 11, low: 9, close: 9.5 },
  ];
  const output = run('vortex', bars, { length: 2 });
  const plus = values(output, 'plus');
  const minus = values(output, 'minus');
  assert.deepEqual(plus.slice(0, 2), [null, null]);
  close(plus[2], 6 / 4);
  close(minus[2], 2 / 4);
  close(plus[3], 4 / 4);
  close(minus[3], 4 / 4);
});

test('Choppiness stays within 0..100', () => {
  const chop = values(run('choppiness', syntheticBars(300)), 'chop').filter((v): v is number => v !== null);
  assert.ok(chop.length > 250);
  assert.ok(chop.every((v) => v >= 0 && v <= 100));
});

test('Fisher Transform stays bounded and its trigger lags by one bar', () => {
  const bound = Math.log(1.999 / 0.001); // |fisher| ≤ 2 · ½ · ln((1 + 0.999) / (1 − 0.999))
  const rising = barsFromCloses(Array.from({ length: 200 }, (_, i) => 100 * 1.05 ** i), undefined, 1);
  for (const bars of [syntheticBars(300), rising]) {
    const output = run('fisher-transform', bars);
    const fisher = values(output, 'fisher');
    const trigger = values(output, 'trigger');
    for (let i = 1; i < bars.length; i++) {
      if (fisher[i] !== null) assert.ok(Math.abs(fisher[i] as number) <= bound);
      if (fisher[i - 1] !== null && fisher[i] !== null) assert.equal(trigger[i], fisher[i - 1]);
    }
  }
  const up = values(run('fisher-transform', rising), 'fisher');
  assert.ok(up.slice(20).every((v) => v !== null && v > 2));
});

test('PPO is (fast EMA − slow EMA) / slow EMA · 100', () => {
  const bars = syntheticBars(300);
  const output = run('ppo', bars);
  const closes = bars.map((b) => b.close);
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const ppo = values(output, 'ppo');
  assert.equal(ppo[24], null);
  for (let i = 25; i < 300; i++) close(ppo[i], ((fast[i] as number) - (slow[i] as number)) / (slow[i] as number) * 100, 1e-9);
  const signal = values(output, 'signal');
  const histogram = values(output, 'histogram');
  for (let i = 33; i < 300; i++) close(histogram[i], (ppo[i] as number) - (signal[i] as number));
});

test('TTM Squeeze marks the squeeze with coloured dots at zero', () => {
  const output = run('ttm-squeeze', syntheticBars(300));
  const dots = values(output, 'squeeze');
  const dotColors = colors(output, 'squeeze');
  assert.ok(dots.slice(20).every((v) => v === 0));
  assert.ok(dotColors.slice(20).every((c) => c === '#f23645' || c === '#089981'));
  assert.ok(colors(output, 'momentum').slice(40).every((c) => typeof c === 'string'));
});

// ── Swings, channels and stops ───────────────────────────────────────────────

test('ZigZag runs straight between confirmed pivots and is null outside them', () => {
  const closes = [
    ...Array.from({ length: 11 }, (_, i) => 100 + 2 * i), // 0..10: 100 → 120
    ...Array.from({ length: 10 }, (_, i) => 118 - 2 * i), // 11..20: → 100
    ...Array.from({ length: 10 }, (_, i) => 103 + 3 * i), // 21..30: → 130
    ...Array.from({ length: 10 }, (_, i) => 128 - 2 * i), // 31..40: → 110 (unconfirmed)
  ];
  const zigzag = values(run('zigzag', barsFromCloses(closes), { deviation: 5, depth: 5 }), 'zigzag');
  for (let i = 0; i <= 30; i++) close(zigzag[i], closes[i]);
  close(zigzag[5], 110);
  close(zigzag[25], 115);
  assert.ok(zigzag.slice(31).every((v) => v === null));

  // Pivots at 0 (100), 6 (130) and 10 (90): bars in between are interpolated, not the closes.
  const jagged = [100, 104, 103, 120, 118, 125, 130, 112, 95, 100, 90, 95, 99];
  const line = values(run('zigzag', barsFromCloses(jagged), { deviation: 5, depth: 2 }), 'zigzag');
  close(line[0], 100);
  close(line[3], 115);
  close(line[6], 130);
  close(line[8], 110);
  close(line[10], 90);
  assert.equal(line[11], null);
});

test('Williams Fractals mark a five-bar peak and trough', () => {
  const bars = barsFromCloses([1, 2, 3, 5, 3, 2, 1, 0, -2, 0, 1], undefined, 1);
  const output = run('williams-fractals', bars);
  const up = values(output, 'up');
  const down = values(output, 'down');
  assert.deepEqual(
    up.map((v, i) => (v === null ? null : i)).filter((i) => i !== null),
    [3],
  );
  close(up[3], 6 + 0.2);
  assert.deepEqual(
    down.map((v, i) => (v === null ? null : i)).filter((i) => i !== null),
    [8],
  );
  close(down[8], -3 - 0.2);
  assert.ok(output.plots.every((p) => p.kind === 'circles'));
});

test('52-week high and low are the extremes of the bars within the trailing 364 days', () => {
  const raw = syntheticBars(1200, 'random', DAY);
  // Weekdays only, so the window is calendar-based rather than a bar count.
  const bars = raw.filter((b) => {
    const day = new Date(b.time).getUTCDay();
    return day !== 0 && day !== 6;
  });
  const output = run('52-week-high-low', bars);
  const high = values(output, 'high');
  const low = values(output, 'low');
  for (let i = 0; i < bars.length; i++) {
    const window = bars.filter((b) => b.time > bars[i].time - 364 * DAY && b.time <= bars[i].time);
    assert.equal(high[i], Math.max(...window.map((b) => b.high)));
    assert.equal(low[i], Math.min(...window.map((b) => b.low)));
  }
  // Weekly bars: 52 bars per window.
  const weekly = syntheticBars(120, 'random', 7 * DAY);
  const weeklyHigh = values(run('52-week-high-low', weekly), 'high');
  assert.equal(weeklyHigh[100], Math.max(...weekly.slice(49, 101).map((b) => b.high)));
});

test('Price Channel uses the previous n bars only', () => {
  const bars = syntheticBars(100);
  const output = run('price-channel', bars, { length: 10 });
  const upper = values(output, 'upper');
  assert.equal(upper[9], null);
  for (let i = 10; i < 100; i++) assert.equal(upper[i], Math.max(...bars.slice(i - 10, i).map((b) => b.high)));
});

test('Chandelier Exit switches from the long stop to the short stop on a reversal', () => {
  const closes = [...Array.from({ length: 40 }, (_, i) => 100 + i * 2), ...Array.from({ length: 40 }, (_, i) => 178 - i * 3)];
  const bars: Bar[] = closes.map((c, i) => ({ time: i * DAY, open: c, high: c + 1, low: c - 1, close: c }));
  const output = run('chandelier-exit', bars);
  const long = values(output, 'long');
  const short = values(output, 'short');
  for (let i = 0; i < bars.length; i++) assert.ok(long[i] === null || short[i] === null, `one side at bar ${i}`);
  assert.equal(long[20], null);
  assert.notEqual(long[39], null);
  assert.ok((long[39] as number) < bars[39].close);
  assert.notEqual(short[79], null);
  assert.ok((short[79] as number) > bars[79].close);
  const flip = short.findIndex((v) => v !== null);
  assert.ok(flip > 39 && flip < 79);
  assert.equal(colors(output, 'long')[39], '#089981');
  assert.equal(colors(output, 'short')[79], '#ef5350');
  assert.equal(colors(output, 'long')[79], null);
});
