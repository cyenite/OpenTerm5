// Built-in technical studies. Each is written from the indicator's standard published definition.
// Every plot holds exactly one value per bar, null during warm-up or wherever the value is undefined
// (for example a division by zero on a flat market).

import { priceSources, type Bar, type InputValue, type StudyBand, type StudyDefinition, type StudyInput, type StudyLevel, type StudyOutput, type StudyPlot } from '../types';
import {
  barsSinceExtreme,
  change,
  clean,
  combine,
  divide,
  ema,
  highest,
  lag,
  linreg,
  lowest,
  map,
  meanDeviation,
  nulls,
  rma,
  sma,
  source,
  stdev,
  sum,
  trueRange,
  utcDay,
  volumeOf,
  wma,
  type PriceSource,
  type ReadonlySeries,
  type Series,
} from './math';

// ── Palette ──────────────────────────────────────────────────────────────────

const BLUE = '#2962ff';
const ORANGE = '#ff9800';
const PURPLE = '#7e57c2';
const TEAL = '#26a69a';
const RED = '#ef5350';
const GREEN = '#089981';
const GREY = '#787b86';

const BLUE_FILL = 'rgba(41, 98, 255, 0.1)';
const TEAL_FILL = 'rgba(38, 166, 154, 0.1)';
const GREEN_FILL = 'rgba(8, 153, 129, 0.15)';

// ── Inputs ───────────────────────────────────────────────────────────────────

export const intInput = (key: string, title: string, value: number, min = 1, max = 5000): StudyInput => ({ key, title, type: 'int', default: value, min, max, step: 1 });
export const floatInput = (key: string, title: string, value: number, min: number, max: number, step: number): StudyInput => ({ key, title, type: 'float', default: value, min, max, step });
export const boolInput = (key: string, title: string, value: boolean): StudyInput => ({ key, title, type: 'bool', default: value });
export const selectInput = (key: string, title: string, value: string, options: readonly string[]): StudyInput => ({ key, title, type: 'select', default: value, options });
export const sourceInput = (value: PriceSource = 'Close', key = 'source', title = 'Source'): StudyInput => ({ key, title, type: 'source', default: value });

export const lengthInput = (value: number, key = 'length', title = 'Length') => intInput(key, title, value);

// Reads input values against their definitions, falling back to the default whenever a value is
// missing, of the wrong type or outside the allowed set, and clamping numbers to their bounds.
export class InputReader {
  private readonly defs = new Map<string, StudyInput>();

  constructor(
    defs: readonly StudyInput[],
    private readonly values: Record<string, InputValue> | undefined,
  ) {
    for (const def of defs) this.defs.set(def.key, def);
  }

  private def(key: string): StudyInput {
    const def = this.defs.get(key);
    if (!def) throw new Error(`Unknown study input "${key}"`);
    return def;
  }

  private raw(key: string): unknown {
    const values = this.values;
    if (!values || typeof values !== 'object') return undefined;
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;
  }

  private number(key: string, integer: boolean): number {
    const def = this.def(key);
    const fallback = typeof def.default === 'number' ? def.default : 0;
    const value = this.raw(key);
    let n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    if (integer) n = Math.round(n);
    if (def.min !== undefined) n = Math.max(def.min, n);
    if (def.max !== undefined) n = Math.min(def.max, n);
    return n;
  }

  int(key: string): number {
    return this.number(key, true);
  }

  float(key: string): number {
    return this.number(key, false);
  }

  bool(key: string): boolean {
    const value = this.raw(key);
    if (typeof value === 'boolean') return value;
    return this.def(key).default === true;
  }

  select(key: string): string {
    const def = this.def(key);
    const value = this.raw(key);
    const options = def.options ?? [];
    if (typeof value === 'string' && options.includes(value)) return value;
    return String(def.default);
  }

  source(key = 'source'): PriceSource {
    const value = this.raw(key);
    const sources: readonly string[] = priceSources;
    if (typeof value === 'string' && sources.includes(value)) return value as PriceSource;
    const fallback = this.def(key).default;
    return typeof fallback === 'string' && sources.includes(fallback) ? (fallback as PriceSource) : 'Close';
  }
}

// ── Output helpers ───────────────────────────────────────────────────────────

export type PlotOptions = Partial<Omit<StudyPlot, 'key' | 'title' | 'values' | 'color'>>;

export const plot = (key: string, title: string, values: ReadonlySeries, color: string, options: PlotOptions = {}): StudyPlot => ({ key, title, values, color, ...options });

export const level = (key: string, price: number, title?: string): StudyLevel => (title === undefined ? { key, price, color: GREY } : { key, price, color: GREY, title });

export const band = (key: string, from: string, to: string, color: string): StudyBand => ({ key, from, to, color });

export interface Spec {
  type: string;
  title: string;
  shortTitle?: string;
  overlay: boolean;
  inputs: StudyInput[];
  compute: (bars: readonly Bar[], read: InputReader) => StudyOutput;
}

// Wraps a study so that compute always receives a well-formed reader and always returns plots of
// exactly bars.length finite-or-null values.
export function define(spec: Spec): StudyDefinition {
  const { compute, ...rest } = spec;
  return {
    ...rest,
    compute: (bars, inputs) => {
      const list: readonly Bar[] = Array.isArray(bars) ? bars : [];
      const output = compute(list, new InputReader(spec.inputs, inputs));
      const n = list.length;
      const fit = <T,>(values: readonly T[] | undefined, fill: T): T[] => {
        const out = (values ?? []).slice(0, n);
        while (out.length < n) out.push(fill);
        return out;
      };
      return {
        ...output,
        plots: output.plots.map((p) => {
          const fixed: StudyPlot = { ...p, values: clean(fit(p.values, null)) };
          if (p.colors) fixed.colors = fit(p.colors, null);
          return fixed;
        }),
      };
    },
  };
}

// Moving average chosen by name.
export function movingAverage(kind: string, src: ReadonlySeries, length: number): Series {
  switch (kind) {
    case 'SMA':
      return sma(src, length);
    case 'EMA':
      return ema(src, length);
    case 'WMA':
      return wma(src, length);
    case 'RMA':
    default:
      return rma(src, length);
  }
}

export const highs = (bars: readonly Bar[]) => source(bars, 'High');
export const lows = (bars: readonly Bar[]) => source(bars, 'Low');
export const closes = (bars: readonly Bar[]) => source(bars, 'Close');
export const volumes = (bars: readonly Bar[]): Series => clean(bars.map(volumeOf));

// Average true range with Wilder smoothing.
export const atr = (bars: readonly Bar[], length: number) => rma(trueRange(bars), length);

// Wilder's RSI: average gain and loss smoothed with RMA, seeded with their simple averages.
export function rsi(src: ReadonlySeries, length: number): Series {
  const delta = change(src, 1);
  const gains = rma(map(delta, (d) => Math.max(d, 0)), length);
  const losses = rma(map(delta, (d) => Math.max(-d, 0)), length);
  return combine(gains, losses, (up, down) => {
    if (down === 0) return up === 0 ? 50 : 100;
    if (up === 0) return 0;
    return 100 - 100 / (1 + up / down);
  });
}

// 100 · (value − lowest) / (highest − lowest); null on a flat window.
export function stochastic(value: ReadonlySeries, high: ReadonlySeries, low: ReadonlySeries, length: number): Series {
  const hh = highest(high, length);
  const ll = lowest(low, length);
  return value.map((v, i) => {
    const h = hh[i];
    const l = ll[i];
    if (v === null || h === null || l === null) return null;
    const ratio = divide(v - l, h - l);
    return ratio === null ? null : 100 * ratio;
  });
}

export function bollinger(src: ReadonlySeries, length: number, mult: number) {
  const basis = sma(src, length);
  const dev = map(stdev(src, length), (d) => d * mult);
  return {
    basis,
    upper: combine(basis, dev, (b, d) => b + d),
    lower: combine(basis, dev, (b, d) => b - d),
  };
}

// ── Overlays ─────────────────────────────────────────────────────────────────

const smaStudy = define({
  type: 'sma',
  title: 'Simple Moving Average',
  shortTitle: 'SMA',
  overlay: true,
  inputs: [lengthInput(20), sourceInput()],
  compute: (bars, read) => ({ plots: [plot('sma', 'SMA', sma(source(bars, read.source()), read.int('length')), BLUE)] }),
});

const emaStudy = define({
  type: 'ema',
  title: 'Exponential Moving Average',
  shortTitle: 'EMA',
  overlay: true,
  inputs: [lengthInput(20), sourceInput()],
  compute: (bars, read) => ({ plots: [plot('ema', 'EMA', ema(source(bars, read.source()), read.int('length')), ORANGE)] }),
});

const wmaStudy = define({
  type: 'wma',
  title: 'Weighted Moving Average',
  shortTitle: 'WMA',
  overlay: true,
  inputs: [lengthInput(20), sourceInput()],
  compute: (bars, read) => ({ plots: [plot('wma', 'WMA', wma(source(bars, read.source()), read.int('length')), PURPLE)] }),
});

// HMA = WMA(2 · WMA(n/2) − WMA(n), √n).
const hmaStudy = define({
  type: 'hma',
  title: 'Hull Moving Average',
  shortTitle: 'HMA',
  overlay: true,
  inputs: [lengthInput(9), sourceInput()],
  compute: (bars, read) => {
    const n = read.int('length');
    const src = source(bars, read.source());
    const raw = combine(wma(src, Math.max(1, Math.floor(n / 2))), wma(src, n), (half, full) => 2 * half - full);
    return { plots: [plot('hma', 'HMA', wma(raw, Math.max(1, Math.floor(Math.sqrt(n)))), TEAL)] };
  },
});

// VWMA = Σ(price · volume) / Σ volume over the window.
const vwmaStudy = define({
  type: 'vwma',
  title: 'Volume Weighted Moving Average',
  shortTitle: 'VWMA',
  overlay: true,
  inputs: [lengthInput(20), sourceInput()],
  compute: (bars, read) => {
    const n = read.int('length');
    const vol = volumes(bars);
    const pv = combine(source(bars, read.source()), vol, (p, v) => p * v);
    const values = combine(sum(pv, n), sum(vol, n), (a, b) => (b === 0 ? NaN : a / b));
    return { plots: [plot('vwma', 'VWMA', values, BLUE)] };
  },
});

// Session VWAP: cumulative Σ(price · volume) / Σ volume, restarting whenever the UTC calendar day
// changes. The optional bands sit `bandMult` volume-weighted standard deviations either side.
// Null while the session has traded no volume.
const vwapStudy = define({
  type: 'vwap',
  title: 'VWAP',
  shortTitle: 'VWAP',
  overlay: true,
  inputs: [sourceInput('HLC3'), boolInput('bands', 'Show bands', false), floatInput('bandMult', 'Bands multiplier', 1, 0.1, 10, 0.1)],
  compute: (bars, read) => {
    const src = source(bars, read.source());
    const showBands = read.bool('bands');
    const mult = read.float('bandMult');
    const vwap = nulls(bars.length);
    const upper = nulls(bars.length);
    const lower = nulls(bars.length);
    let day = Number.NaN;
    let sumV = 0;
    let sumPV = 0;
    let sumP2V = 0;
    for (let i = 0; i < bars.length; i++) {
      const d = utcDay(bars[i].time);
      if (d !== day) {
        day = d;
        sumV = 0;
        sumPV = 0;
        sumP2V = 0;
      }
      const p = src[i];
      const v = volumeOf(bars[i]);
      if (p !== null && v > 0) {
        sumV += v;
        sumPV += p * v;
        sumP2V += p * p * v;
      }
      if (sumV <= 0) continue;
      const mean = sumPV / sumV;
      vwap[i] = mean;
      const deviation = Math.sqrt(Math.max(0, sumP2V / sumV - mean * mean));
      upper[i] = mean + mult * deviation;
      lower[i] = mean - mult * deviation;
    }
    const plots = [plot('vwap', 'VWAP', vwap, BLUE, { width: 2 })];
    if (!showBands) return { plots };
    plots.push(plot('upper', 'Upper band', upper, TEAL), plot('lower', 'Lower band', lower, TEAL));
    return { plots, bands: [band('fill', 'upper', 'lower', TEAL_FILL)] };
  },
});

const bollingerStudy = define({
  type: 'bollinger-bands',
  title: 'Bollinger Bands',
  shortTitle: 'BB',
  overlay: true,
  inputs: [lengthInput(20), floatInput('mult', 'StdDev', 2, 0.001, 50, 0.1), sourceInput()],
  compute: (bars, read) => {
    const { basis, upper, lower } = bollinger(source(bars, read.source()), read.int('length'), read.float('mult'));
    return {
      plots: [plot('basis', 'Basis', basis, ORANGE), plot('upper', 'Upper', upper, BLUE), plot('lower', 'Lower', lower, BLUE)],
      bands: [band('fill', 'upper', 'lower', BLUE_FILL)],
    };
  },
});

// Basis = EMA(source); bands = basis ± mult · ATR (Wilder).
const keltnerStudy = define({
  type: 'keltner-channels',
  title: 'Keltner Channels',
  shortTitle: 'KC',
  overlay: true,
  inputs: [lengthInput(20), floatInput('mult', 'Multiplier', 2, 0.001, 50, 0.1), intInput('atrLength', 'ATR length', 10), sourceInput()],
  compute: (bars, read) => {
    const basis = ema(source(bars, read.source()), read.int('length'));
    const range = map(atr(bars, read.int('atrLength')), (r) => r * read.float('mult'));
    return {
      plots: [
        plot('basis', 'Basis', basis, BLUE),
        plot('upper', 'Upper', combine(basis, range, (b, r) => b + r), BLUE),
        plot('lower', 'Lower', combine(basis, range, (b, r) => b - r), BLUE),
      ],
      bands: [band('fill', 'upper', 'lower', BLUE_FILL)],
    };
  },
});

const donchianStudy = define({
  type: 'donchian-channels',
  title: 'Donchian Channels',
  shortTitle: 'DC',
  overlay: true,
  inputs: [lengthInput(20)],
  compute: (bars, read) => {
    const n = read.int('length');
    const upper = highest(highs(bars), n);
    const lower = lowest(lows(bars), n);
    return {
      plots: [plot('upper', 'Upper', upper, BLUE), plot('lower', 'Lower', lower, BLUE), plot('basis', 'Basis', combine(upper, lower, (u, l) => (u + l) / 2), ORANGE)],
      bands: [band('fill', 'upper', 'lower', BLUE_FILL)],
    };
  },
});

const envelopeStudy = define({
  type: 'ma-envelope',
  title: 'Moving Average Envelope',
  shortTitle: 'Env',
  overlay: true,
  inputs: [lengthInput(20), floatInput('percent', 'Percent', 10, 0, 100, 0.5), selectInput('maType', 'Method', 'SMA', ['SMA', 'EMA']), sourceInput()],
  compute: (bars, read) => {
    const basis = movingAverage(read.select('maType'), source(bars, read.source()), read.int('length'));
    const k = read.float('percent') / 100;
    return {
      plots: [plot('basis', 'Basis', basis, ORANGE), plot('upper', 'Upper', map(basis, (b) => b * (1 + k)), BLUE), plot('lower', 'Lower', map(basis, (b) => b * (1 - k)), BLUE)],
      bands: [band('fill', 'upper', 'lower', BLUE_FILL)],
    };
  },
});

// SuperTrend: bands at HL2 ± factor · ATR that only tighten while the trend holds; the trend flips
// when the close crosses the active band. The up line (green) shows the lower band in an uptrend,
// the down line (red) the upper band in a downtrend.
const supertrendStudy = define({
  type: 'supertrend',
  title: 'SuperTrend',
  shortTitle: 'ST',
  overlay: true,
  inputs: [intInput('atrLength', 'ATR length', 10), floatInput('factor', 'Factor', 3, 0.01, 100, 0.1)],
  compute: (bars, read) => {
    const n = bars.length;
    const range = atr(bars, read.int('atrLength'));
    const factor = read.float('factor');
    const up = nulls(n);
    const down = nulls(n);
    let prevUpper: number | null = null;
    let prevLower: number | null = null;
    let trend: 1 | -1 = -1;
    for (let i = 0; i < n; i++) {
      const r = range[i];
      const bar = bars[i];
      if (r === null || !Number.isFinite(bar.close)) {
        prevUpper = null;
        prevLower = null;
        continue;
      }
      const mid = (bar.high + bar.low) / 2;
      let upper = mid + factor * r;
      let lower = mid - factor * r;
      if (prevUpper === null || prevLower === null) {
        trend = -1;
      } else {
        const prevClose = bars[i - 1].close;
        if (!(lower > prevLower || prevClose < prevLower)) lower = prevLower;
        if (!(upper < prevUpper || prevClose > prevUpper)) upper = prevUpper;
        if (trend === -1) trend = bar.close > upper ? 1 : -1;
        else trend = bar.close < lower ? -1 : 1;
      }
      if (trend === 1) up[i] = lower;
      else down[i] = upper;
      prevUpper = upper;
      prevLower = lower;
    }
    return {
      plots: [
        plot('up', 'Up trend', up, GREEN, { colors: up.map((v) => (v === null ? null : GREEN)), width: 2 }),
        plot('down', 'Down trend', down, RED, { colors: down.map((v) => (v === null ? null : RED)), width: 2 }),
      ],
    };
  },
});

// Wilder's Parabolic SAR. The initial direction comes from the first two closes.
const psarStudy = define({
  type: 'parabolic-sar',
  title: 'Parabolic SAR',
  shortTitle: 'SAR',
  overlay: true,
  inputs: [floatInput('start', 'Start', 0.02, 0.001, 1, 0.001), floatInput('increment', 'Increment', 0.02, 0.001, 1, 0.001), floatInput('maximum', 'Max value', 0.2, 0.001, 1, 0.01)],
  compute: (bars, read) => {
    const start = read.float('start');
    const increment = read.float('increment');
    const maximum = Math.max(start, read.float('maximum'));
    const n = bars.length;
    const values = nulls(n);
    const colors: (string | null)[] = new Array<string | null>(n).fill(null);
    if (n < 2) return { plots: [plot('sar', 'SAR', values, BLUE, { kind: 'circles', colors })] };
    let rising = bars[1].close >= bars[0].close;
    let sar = rising ? Math.min(bars[0].low, bars[1].low) : Math.max(bars[0].high, bars[1].high);
    let ep = rising ? Math.max(bars[0].high, bars[1].high) : Math.min(bars[0].low, bars[1].low);
    let af = start;
    values[1] = sar;
    colors[1] = rising ? GREEN : RED;
    for (let i = 2; i < n; i++) {
      const bar = bars[i];
      let next = sar + af * (ep - sar);
      if (rising) {
        next = Math.min(next, bars[i - 1].low, bars[i - 2].low);
        if (bar.low < next) {
          rising = false;
          next = ep;
          ep = bar.low;
          af = start;
        } else if (bar.high > ep) {
          ep = bar.high;
          af = Math.min(af + increment, maximum);
        }
      } else {
        next = Math.max(next, bars[i - 1].high, bars[i - 2].high);
        if (bar.high > next) {
          rising = true;
          next = ep;
          ep = bar.high;
          af = start;
        } else if (bar.low < ep) {
          ep = bar.low;
          af = Math.min(af + increment, maximum);
        }
      }
      sar = next;
      values[i] = sar;
      colors[i] = rising ? GREEN : RED;
    }
    return { plots: [plot('sar', 'SAR', values, BLUE, { kind: 'circles', colors })] };
  },
});

// Ichimoku Kinko Hyo. The leading spans are plotted displacement − 1 bars ahead and the lagging span
// displacement − 1 bars back, so a displacement of 26 puts them 25 bars from the bar they describe.
const ichimokuStudy = define({
  type: 'ichimoku-cloud',
  title: 'Ichimoku Cloud',
  shortTitle: 'Ichimoku',
  overlay: true,
  inputs: [
    intInput('conversionLength', 'Conversion line length', 9),
    intInput('baseLength', 'Base line length', 26),
    intInput('spanBLength', 'Leading span B length', 52),
    intInput('displacement', 'Displacement', 26),
  ],
  compute: (bars, read) => {
    const high = highs(bars);
    const low = lows(bars);
    const midpoint = (length: number) => combine(highest(high, length), lowest(low, length), (h, l) => (h + l) / 2);
    const conversion = midpoint(read.int('conversionLength'));
    const base = midpoint(read.int('baseLength'));
    const spanA = combine(conversion, base, (c, b) => (c + b) / 2);
    const spanB = midpoint(read.int('spanBLength'));
    const shift = read.int('displacement') - 1;
    return {
      plots: [
        plot('conversion', 'Conversion line', conversion, BLUE),
        plot('base', 'Base line', base, RED),
        plot('lagging', 'Lagging span', closes(bars), PURPLE, { offset: -shift }),
        plot('spanA', 'Leading span A', spanA, GREEN, { offset: shift }),
        plot('spanB', 'Leading span B', spanB, RED, { offset: shift }),
      ],
      bands: [band('cloud', 'spanA', 'spanB', GREEN_FILL)],
    };
  },
});

const linregStudy = define({
  type: 'linear-regression',
  title: 'Linear Regression Curve',
  shortTitle: 'LinReg',
  overlay: true,
  inputs: [lengthInput(50), sourceInput()],
  compute: (bars, read) => ({ plots: [plot('linreg', 'Linear regression', linreg(source(bars, read.source()), read.int('length')), BLUE, { width: 2 })] }),
});

// Standard (floor) pivots for each UTC day from the previous day's high, low and close.
const pivotStudy = define({
  type: 'pivot-points',
  title: 'Pivot Points Standard',
  shortTitle: 'Pivots',
  overlay: true,
  inputs: [],
  compute: (bars) => {
    const n = bars.length;
    const keys = ['p', 'r1', 'r2', 'r3', 's1', 's2', 's3'] as const;
    const out: Record<(typeof keys)[number], Series> = { p: nulls(n), r1: nulls(n), r2: nulls(n), r3: nulls(n), s1: nulls(n), s2: nulls(n), s3: nulls(n) };
    let day = Number.NaN;
    let current: { high: number; low: number; close: number } | null = null;
    let previous: { high: number; low: number; close: number } | null = null;
    for (let i = 0; i < n; i++) {
      const bar = bars[i];
      const d = utcDay(bar.time);
      if (d !== day) {
        day = d;
        previous = current;
        current = { high: bar.high, low: bar.low, close: bar.close };
      } else if (current) {
        current.high = Math.max(current.high, bar.high);
        current.low = Math.min(current.low, bar.low);
        current.close = bar.close;
      }
      if (!previous) continue;
      const { high: h, low: l, close: c } = previous;
      const p = (h + l + c) / 3;
      out.p[i] = p;
      out.r1[i] = 2 * p - l;
      out.s1[i] = 2 * p - h;
      out.r2[i] = p + (h - l);
      out.s2[i] = p - (h - l);
      out.r3[i] = h + 2 * (p - l);
      out.s3[i] = l - 2 * (h - p);
    }
    return {
      plots: [
        plot('p', 'P', out.p, ORANGE),
        plot('r1', 'R1', out.r1, RED),
        plot('r2', 'R2', out.r2, RED),
        plot('r3', 'R3', out.r3, RED),
        plot('s1', 'S1', out.s1, GREEN),
        plot('s2', 'S2', out.s2, GREEN),
        plot('s3', 'S3', out.s3, GREEN),
      ],
    };
  },
});

// ── Oscillators and other pane studies ───────────────────────────────────────

const rsiStudy = define({
  type: 'rsi',
  title: 'Relative Strength Index',
  shortTitle: 'RSI',
  overlay: false,
  inputs: [lengthInput(14), sourceInput()],
  compute: (bars, read) => ({
    plots: [plot('rsi', 'RSI', rsi(source(bars, read.source()), read.int('length')), PURPLE)],
    levels: [level('upper', 70, 'Overbought'), level('middle', 50, 'Middle'), level('lower', 30, 'Oversold')],
  }),
});

// %K = SMA(raw stochastic, smoothing); %D = SMA(%K, dLength).
const stochasticStudy = define({
  type: 'stochastic',
  title: 'Stochastic',
  shortTitle: 'Stoch',
  overlay: false,
  inputs: [intInput('kLength', '%K length', 14), intInput('kSmoothing', '%K smoothing', 1), intInput('dLength', '%D smoothing', 3)],
  compute: (bars, read) => {
    const k = sma(stochastic(closes(bars), highs(bars), lows(bars), read.int('kLength')), read.int('kSmoothing'));
    return {
      plots: [plot('k', '%K', k, BLUE), plot('d', '%D', sma(k, read.int('dLength')), ORANGE)],
      levels: [level('upper', 80, 'Upper'), level('middle', 50, 'Middle'), level('lower', 20, 'Lower')],
    };
  },
});

const stochRsiStudy = define({
  type: 'stoch-rsi',
  title: 'Stochastic RSI',
  shortTitle: 'Stoch RSI',
  overlay: false,
  inputs: [intInput('smoothK', 'K', 3), intInput('smoothD', 'D', 3), intInput('rsiLength', 'RSI length', 14), intInput('stochLength', 'Stochastic length', 14), sourceInput()],
  compute: (bars, read) => {
    const r = rsi(source(bars, read.source()), read.int('rsiLength'));
    const k = sma(stochastic(r, r, r, read.int('stochLength')), read.int('smoothK'));
    return {
      plots: [plot('k', 'K', k, BLUE), plot('d', 'D', sma(k, read.int('smoothD')), ORANGE)],
      levels: [level('upper', 80, 'Upper'), level('middle', 50, 'Middle'), level('lower', 20, 'Lower')],
    };
  },
});

const MACD_UP_STRONG = '#26a69a';
const MACD_UP_WEAK = '#b2dfdb';
const MACD_DOWN_WEAK = '#ffcdd2';
const MACD_DOWN_STRONG = '#ef5350';

const macdStudy = define({
  type: 'macd',
  title: 'MACD',
  shortTitle: 'MACD',
  overlay: false,
  inputs: [intInput('fastLength', 'Fast length', 12), intInput('slowLength', 'Slow length', 26), intInput('signalLength', 'Signal smoothing', 9), sourceInput()],
  compute: (bars, read) => {
    const src = source(bars, read.source());
    const macd = combine(ema(src, read.int('fastLength')), ema(src, read.int('slowLength')), (f, s) => f - s);
    const signal = ema(macd, read.int('signalLength'));
    const histogram = combine(macd, signal, (m, s) => m - s);
    const colors = histogram.map((h, i) => {
      if (h === null) return null;
      const prev = i > 0 ? histogram[i - 1] : null;
      if (h >= 0) return prev === null || h >= prev ? MACD_UP_STRONG : MACD_UP_WEAK;
      return prev === null || h <= prev ? MACD_DOWN_STRONG : MACD_DOWN_WEAK;
    });
    return {
      plots: [plot('histogram', 'Histogram', histogram, TEAL, { kind: 'histogram', colors }), plot('macd', 'MACD', macd, BLUE), plot('signal', 'Signal', signal, ORANGE)],
      levels: [level('zero', 0)],
    };
  },
});

// CCI = (price − SMA) / (0.015 · mean deviation).
const cciStudy = define({
  type: 'cci',
  title: 'Commodity Channel Index',
  shortTitle: 'CCI',
  overlay: false,
  inputs: [lengthInput(20), sourceInput('HLC3')],
  compute: (bars, read) => {
    const n = read.int('length');
    const src = source(bars, read.source());
    const mean = sma(src, n);
    const md = meanDeviation(src, n);
    const values = src.map((x, i) => {
      const m = mean[i];
      const d = md[i];
      if (x === null || m === null || d === null) return null;
      return d === 0 ? 0 : (x - m) / (0.015 * d);
    });
    return { plots: [plot('cci', 'CCI', values, BLUE)], levels: [level('upper', 100, 'Upper'), level('middle', 0, 'Middle'), level('lower', -100, 'Lower')] };
  },
});

const williamsStudy = define({
  type: 'williams-r',
  title: 'Williams %R',
  shortTitle: '%R',
  overlay: false,
  inputs: [lengthInput(14), sourceInput()],
  compute: (bars, read) => {
    const k = stochastic(source(bars, read.source()), highs(bars), lows(bars), read.int('length'));
    return {
      plots: [plot('r', '%R', map(k, (v) => v - 100), PURPLE)],
      levels: [level('upper', -20, 'Upper'), level('middle', -50, 'Middle'), level('lower', -80, 'Lower')],
    };
  },
});

// AO = SMA(HL2, 5) − SMA(HL2, 34); a bar is green when it is above the one before, red otherwise.
const aoStudy = define({
  type: 'awesome-oscillator',
  title: 'Awesome Oscillator',
  shortTitle: 'AO',
  overlay: false,
  inputs: [intInput('fastLength', 'Fast length', 5), intInput('slowLength', 'Slow length', 34)],
  compute: (bars, read) => {
    const hl2 = source(bars, 'HL2');
    const ao = combine(sma(hl2, read.int('fastLength')), sma(hl2, read.int('slowLength')), (f, s) => f - s);
    const colors = ao.map((v, i) => {
      if (v === null) return null;
      const prev = i > 0 ? ao[i - 1] : null;
      return prev === null || v > prev ? GREEN : RED;
    });
    return { plots: [plot('ao', 'AO', ao, GREEN, { kind: 'histogram', colors })], levels: [level('zero', 0)] };
  },
});

// Aroon Up/Down = 100 · (length − bars since the highest high / lowest low) / length, over the last
// length + 1 bars.
const aroonStudy = define({
  type: 'aroon',
  title: 'Aroon',
  shortTitle: 'Aroon',
  overlay: false,
  inputs: [lengthInput(14)],
  compute: (bars, read) => {
    const n = read.int('length');
    const toAroon = (since: Series) => map(since, (s) => (100 * (n - s)) / n);
    return {
      plots: [
        plot('up', 'Aroon Up', toAroon(barsSinceExtreme(highs(bars), n + 1, 'highest')), ORANGE),
        plot('down', 'Aroon Down', toAroon(barsSinceExtreme(lows(bars), n + 1, 'lowest')), BLUE),
      ],
      levels: [level('upper', 70), level('lower', 30)],
    };
  },
});

// Wilder's directional movement system.
const adxStudy = define({
  type: 'adx',
  title: 'Average Directional Index',
  shortTitle: 'ADX',
  overlay: false,
  inputs: [intInput('diLength', 'DI length', 14), intInput('adxSmoothing', 'ADX smoothing', 14)],
  compute: (bars, read) => {
    const diLength = read.int('diLength');
    const upMove = change(highs(bars));
    const downMove = map(change(lows(bars)), (d) => -d);
    const plusDM = combine(upMove, downMove, (u, d) => (u > d && u > 0 ? u : 0));
    const minusDM = combine(upMove, downMove, (u, d) => (d > u && d > 0 ? d : 0));
    // The first bar has no previous bar, so no directional movement; leave its range out too.
    const tr = trueRange(bars).map((v, i) => (i === 0 ? null : v));
    const smoothedTr = rma(tr, diLength);
    const plusDI = combine(rma(plusDM, diLength), smoothedTr, (dm, t) => (t === 0 ? 0 : (100 * dm) / t));
    const minusDI = combine(rma(minusDM, diLength), smoothedTr, (dm, t) => (t === 0 ? 0 : (100 * dm) / t));
    const dx = combine(plusDI, minusDI, (p, m) => (p + m === 0 ? 0 : (100 * Math.abs(p - m)) / (p + m)));
    return {
      plots: [plot('adx', 'ADX', rma(dx, read.int('adxSmoothing')), RED, { width: 2 }), plot('plusDI', '+DI', plusDI, TEAL), plot('minusDI', '−DI', minusDI, ORANGE)],
      levels: [level('trend', 25)],
    };
  },
});

const atrStudy = define({
  type: 'atr',
  title: 'Average True Range',
  shortTitle: 'ATR',
  overlay: false,
  inputs: [lengthInput(14), selectInput('smoothing', 'Smoothing', 'RMA', ['RMA', 'SMA', 'EMA', 'WMA'])],
  compute: (bars, read) => ({ plots: [plot('atr', 'ATR', movingAverage(read.select('smoothing'), trueRange(bars), read.int('length')), RED)] }),
});

// OBV adds the bar's volume when the close rises and subtracts it when the close falls.
const obvStudy = define({
  type: 'obv',
  title: 'On Balance Volume',
  shortTitle: 'OBV',
  overlay: false,
  inputs: [],
  compute: (bars) => {
    const values = nulls(bars.length);
    let total = 0;
    for (let i = 0; i < bars.length; i++) {
      if (i > 0) {
        const diff = bars[i].close - bars[i - 1].close;
        if (diff > 0) total += volumeOf(bars[i]);
        else if (diff < 0) total -= volumeOf(bars[i]);
      }
      values[i] = total;
    }
    return { plots: [plot('obv', 'OBV', values, BLUE)] };
  },
});

// CMF = Σ(money-flow multiplier · volume) / Σ volume; the multiplier is ((C − L) − (H − C)) / (H − L).
const cmfStudy = define({
  type: 'cmf',
  title: 'Chaikin Money Flow',
  shortTitle: 'CMF',
  overlay: false,
  inputs: [lengthInput(20)],
  compute: (bars, read) => {
    const n = read.int('length');
    const vol = volumes(bars);
    const flow = clean(
      bars.map((bar) => {
        const range = bar.high - bar.low;
        const multiplier = range === 0 ? 0 : (bar.close - bar.low - (bar.high - bar.close)) / range;
        return multiplier * volumeOf(bar);
      }),
    );
    const values = combine(sum(flow, n), sum(vol, n), (f, v) => (v === 0 ? NaN : f / v));
    return { plots: [plot('cmf', 'CMF', values, TEAL)], levels: [level('zero', 0)] };
  },
});

// MFI: RSI-like ratio of positive to negative raw money flow (typical price · volume).
const mfiStudy = define({
  type: 'mfi',
  title: 'Money Flow Index',
  shortTitle: 'MFI',
  overlay: false,
  inputs: [lengthInput(14)],
  compute: (bars, read) => {
    const n = read.int('length');
    const tp = source(bars, 'HLC3');
    const delta = change(tp);
    const raw = combine(tp, volumes(bars), (p, v) => p * v);
    const positive = combine(delta, raw, (d, f) => (d > 0 ? f : 0));
    const negative = combine(delta, raw, (d, f) => (d < 0 ? f : 0));
    const values = combine(sum(positive, n), sum(negative, n), (up, down) => {
      if (down === 0) return up === 0 ? 50 : 100;
      return 100 - 100 / (1 + up / down);
    });
    return { plots: [plot('mfi', 'MFI', values, PURPLE)], levels: [level('upper', 80, 'Overbought'), level('middle', 50, 'Middle'), level('lower', 20, 'Oversold')] };
  },
});

// TRIX: one-bar percent rate of change of a triple-smoothed EMA.
const trixStudy = define({
  type: 'trix',
  title: 'TRIX',
  shortTitle: 'TRIX',
  overlay: false,
  inputs: [lengthInput(18), sourceInput()],
  compute: (bars, read) => {
    const n = read.int('length');
    const triple = ema(ema(ema(source(bars, read.source()), n), n), n);
    const prev = lag(triple, 1);
    const values = triple.map((t, i) => {
      const p = prev[i];
      if (t === null || p === null) return null;
      const ratio = divide(t - p, p);
      return ratio === null ? null : 100 * ratio;
    });
    return { plots: [plot('trix', 'TRIX', values, RED)], levels: [level('zero', 0)] };
  },
});

const stdDevStudy = define({
  type: 'std-dev',
  title: 'Standard Deviation',
  shortTitle: 'StdDev',
  overlay: false,
  inputs: [lengthInput(20), sourceInput()],
  compute: (bars, read) => ({ plots: [plot('stdev', 'StdDev', stdev(source(bars, read.source()), read.int('length')), BLUE)] }),
});

const rocStudy = define({
  type: 'roc',
  title: 'Rate of Change',
  shortTitle: 'ROC',
  overlay: false,
  inputs: [lengthInput(9), sourceInput()],
  compute: (bars, read) => {
    const src = source(bars, read.source());
    const prev = lag(src, read.int('length'));
    const values = src.map((x, i) => {
      const p = prev[i];
      if (x === null || p === null) return null;
      const ratio = divide(x - p, p);
      return ratio === null ? null : 100 * ratio;
    });
    return { plots: [plot('roc', 'ROC', values, BLUE)], levels: [level('zero', 0)] };
  },
});

const momentumStudy = define({
  type: 'momentum',
  title: 'Momentum',
  shortTitle: 'Mom',
  overlay: false,
  inputs: [lengthInput(10), sourceInput()],
  compute: (bars, read) => ({ plots: [plot('momentum', 'Momentum', change(source(bars, read.source()), read.int('length')), BLUE)], levels: [level('zero', 0)] }),
});

// UO = 100 · (4·A₁ + 2·A₂ + A₃) / 7, where Aₙ = Σ buying pressure / Σ true range over n bars.
const ultimateStudy = define({
  type: 'ultimate-oscillator',
  title: 'Ultimate Oscillator',
  shortTitle: 'UO',
  overlay: false,
  inputs: [intInput('fastLength', 'Fast length', 7), intInput('middleLength', 'Middle length', 14), intInput('slowLength', 'Slow length', 28)],
  compute: (bars, read) => {
    const pressure = nulls(bars.length);
    const range = nulls(bars.length);
    for (let i = 1; i < bars.length; i++) {
      const prevClose = bars[i - 1].close;
      const trueLow = Math.min(bars[i].low, prevClose);
      pressure[i] = bars[i].close - trueLow;
      range[i] = Math.max(bars[i].high, prevClose) - trueLow;
    }
    const average = (length: number) => combine(sum(clean(pressure), length), sum(clean(range), length), (p, r) => (r === 0 ? NaN : p / r));
    const a1 = average(read.int('fastLength'));
    const a2 = average(read.int('middleLength'));
    const a3 = average(read.int('slowLength'));
    const values = a1.map((x, i) => {
      const y = a2[i];
      const z = a3[i];
      return x === null || y === null || z === null ? null : (100 * (4 * x + 2 * y + z)) / 7;
    });
    return { plots: [plot('uo', 'UO', values, RED)], levels: [level('upper', 70), level('lower', 30)] };
  },
});

// CMO = 100 · (Σ gains − Σ losses) / (Σ gains + Σ losses) over the window.
const cmoStudy = define({
  type: 'cmo',
  title: 'Chande Momentum Oscillator',
  shortTitle: 'CMO',
  overlay: false,
  inputs: [lengthInput(9), sourceInput()],
  compute: (bars, read) => {
    const n = read.int('length');
    const delta = change(source(bars, read.source()));
    const gains = sum(map(delta, (d) => Math.max(d, 0)), n);
    const losses = sum(map(delta, (d) => Math.max(-d, 0)), n);
    const values = combine(gains, losses, (g, l) => (g + l === 0 ? 0 : (100 * (g - l)) / (g + l)));
    return { plots: [plot('cmo', 'CMO', values, BLUE)], levels: [level('zero', 0)] };
  },
});

// Width = (upper − lower) / basis.
const bbWidthStudy = define({
  type: 'bb-width',
  title: 'Bollinger Bands Width',
  shortTitle: 'BBW',
  overlay: false,
  inputs: [lengthInput(20), floatInput('mult', 'StdDev', 2, 0.001, 50, 0.1), sourceInput()],
  compute: (bars, read) => {
    const { basis, upper, lower } = bollinger(source(bars, read.source()), read.int('length'), read.float('mult'));
    const values = basis.map((b, i) => {
      const u = upper[i];
      const l = lower[i];
      return b === null || u === null || l === null ? null : divide(u - l, b);
    });
    return { plots: [plot('width', 'BBW', values, BLUE)] };
  },
});

// %B = (price − lower) / (upper − lower).
const bbPercentBStudy = define({
  type: 'bb-percent-b',
  title: 'Bollinger Bands %B',
  shortTitle: '%B',
  overlay: false,
  inputs: [lengthInput(20), floatInput('mult', 'StdDev', 2, 0.001, 50, 0.1), sourceInput()],
  compute: (bars, read) => {
    const src = source(bars, read.source());
    const { upper, lower } = bollinger(src, read.int('length'), read.float('mult'));
    const values = src.map((x, i) => {
      const u = upper[i];
      const l = lower[i];
      return x === null || u === null || l === null ? null : divide(x - l, u - l);
    });
    return { plots: [plot('percentB', '%B', values, TEAL)], levels: [level('upper', 1), level('middle', 0.5), level('lower', 0)] };
  },
});

// 100 · (EMA(volume, short) − EMA(volume, long)) / EMA(volume, long).
const volumeOscillatorStudy = define({
  type: 'volume-oscillator',
  title: 'Volume Oscillator',
  shortTitle: 'Vol Osc',
  overlay: false,
  inputs: [intInput('shortLength', 'Short length', 5), intInput('longLength', 'Long length', 10)],
  compute: (bars, read) => {
    const vol = volumes(bars);
    const values = combine(ema(vol, read.int('shortLength')), ema(vol, read.int('longLength')), (s, l) => (l === 0 ? NaN : (100 * (s - l)) / l));
    return { plots: [plot('osc', 'Volume oscillator', values, BLUE)], levels: [level('zero', 0)] };
  },
});

// Annualised close-to-close volatility in percent: 100 · stdev(ln(Cₜ / Cₜ₋₁), length) · √365. The
// 365 assumes one bar per calendar day (crypto-style daily bars); on other timeframes the figure is
// the per-bar volatility scaled as if bars were daily.
const PERIODS_PER_YEAR = 365;

const historicalVolatilityStudy = define({
  type: 'historical-volatility',
  title: 'Historical Volatility',
  shortTitle: 'HV',
  overlay: false,
  inputs: [lengthInput(10)],
  compute: (bars, read) => {
    const close = closes(bars);
    const prev = lag(close, 1);
    const logReturns = combine(close, prev, (c, p) => (c > 0 && p > 0 ? Math.log(c / p) : NaN));
    const values = map(stdev(logReturns, read.int('length')), (s) => 100 * s * Math.sqrt(PERIODS_PER_YEAR));
    return { plots: [plot('hv', 'HV', values, BLUE)] };
  },
});

export const builtinStudies: readonly StudyDefinition[] = [
  smaStudy,
  emaStudy,
  wmaStudy,
  hmaStudy,
  vwmaStudy,
  vwapStudy,
  bollingerStudy,
  keltnerStudy,
  donchianStudy,
  envelopeStudy,
  supertrendStudy,
  psarStudy,
  ichimokuStudy,
  linregStudy,
  pivotStudy,
  rsiStudy,
  stochasticStudy,
  stochRsiStudy,
  macdStudy,
  cciStudy,
  williamsStudy,
  aoStudy,
  aroonStudy,
  adxStudy,
  atrStudy,
  obvStudy,
  cmfStudy,
  mfiStudy,
  trixStudy,
  stdDevStudy,
  rocStudy,
  momentumStudy,
  ultimateStudy,
  cmoStudy,
  bbWidthStudy,
  bbPercentBStudy,
  volumeOscillatorStudy,
  historicalVolatilityStudy,
];
