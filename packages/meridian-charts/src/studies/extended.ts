// Extended technical studies. Each is written from the indicator's standard published definition and
// shares the input reading and output normalising of the built-in studies: every plot holds exactly
// one value per bar, null during warm-up or wherever the value is undefined.

import type { Bar, StudyDefinition } from '../types';
import { atr, band, bollinger, boolInput, closes, define, floatInput, highs, intInput, lengthInput, level, lows, movingAverage, plot, rsi, selectInput, sourceInput, volumes } from './builtin';
import { change, clean, combine, divide, ema, highest, lag, linreg, lowest, map, nulls, rma, sma, source, stdev, sum, trueRange, volumeOf, wma, type ReadonlySeries, type Series } from './math';

// ── Palette ──────────────────────────────────────────────────────────────────

const BLUE = '#2962ff';
const ORANGE = '#ff9800';
const PURPLE = '#7e57c2';
const TEAL = '#26a69a';
const RED = '#ef5350';
const GREEN = '#089981';
const STRONG_RED = '#f23645';

const BLUE_FILL = 'rgba(41, 98, 255, 0.1)';
const WEAK_GREEN = 'rgba(8, 153, 129, 0.5)';
const WEAK_RED = 'rgba(242, 54, 69, 0.5)';

const DAY = 86_400_000;

const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

// ── Helpers ──────────────────────────────────────────────────────────────────

// Percent rate of change against the value `length` bars back.
function roc(src: ReadonlySeries, length: number): Series {
  return combine(src, lag(src, length), (x, p) => (p === 0 ? NaN : (100 * (x - p)) / p));
}

// Blau's double-smoothed momentum ratio: EMA(EMA(Δ, long), short) / EMA(EMA(|Δ|, long), short).
function tsiRatio(src: ReadonlySeries, longLength: number, shortLength: number): Series {
  const delta = change(src, 1);
  const numerator = ema(ema(delta, longLength), shortLength);
  const denominator = ema(ema(map(delta, Math.abs), longLength), shortLength);
  return combine(numerator, denominator, (a, b) => (b === 0 ? NaN : a / b));
}

// Accumulation/Distribution line: running Σ CLV · volume, CLV = ((C − L) − (H − C)) / (H − L), 0 on a
// zero-range bar.
function accumulationDistribution(bars: readonly Bar[]): Series {
  const out = nulls(bars.length);
  let total = 0;
  for (let i = 0; i < bars.length; i++) {
    const { high, low, close } = bars[i];
    const range = high - low;
    const clv = range > 0 && isNum(range) && isNum(close) ? (close - low - (high - close)) / range : 0;
    const flow = clv * volumeOf(bars[i]);
    if (isNum(flow)) total += flow;
    out[i] = total;
  }
  return out;
}

// Stochastic of a series over `length` values, smoothed with factor ½ (the Schaff Trend Cycle step).
// A flat window repeats the previous raw value (50 before there is one).
function halfSmoothedStochastic(src: ReadonlySeries, length: number): Series {
  const lo = lowest(src, length);
  const hi = highest(src, length);
  const out = nulls(src.length);
  let prevRaw: number | null = null;
  let prevSmooth: number | null = null;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    const l = lo[i];
    const h = hi[i];
    if (x === null || l === null || h === null) continue;
    const range = h - l;
    const raw: number = range > 0 ? (100 * (x - l)) / range : (prevRaw ?? 50);
    prevRaw = raw;
    prevSmooth = prevSmooth === null ? raw : prevSmooth + 0.5 * (raw - prevSmooth);
    out[i] = prevSmooth;
  }
  return out;
}

// Highest high and lowest low of the bars whose time lies within the trailing `span` milliseconds
// (time > current time − span), using monotonic queues so long intraday histories stay linear.
function extremesByTime(bars: readonly Bar[], span: number): { high: Series; low: Series } {
  const n = bars.length;
  const high = nulls(n);
  const low = nulls(n);
  const maxQ: number[] = [];
  const minQ: number[] = [];
  let maxHead = 0;
  let minHead = 0;
  for (let i = 0; i < n; i++) {
    const bar = bars[i];
    if (!isNum(bar.time)) continue;
    if (isNum(bar.high)) {
      while (maxQ.length > maxHead && bars[maxQ[maxQ.length - 1]].high <= bar.high) maxQ.pop();
      maxQ.push(i);
    }
    if (isNum(bar.low)) {
      while (minQ.length > minHead && bars[minQ[minQ.length - 1]].low >= bar.low) minQ.pop();
      minQ.push(i);
    }
    const cutoff = bar.time - span;
    while (maxHead < maxQ.length && !(bars[maxQ[maxHead]].time > cutoff)) maxHead++;
    while (minHead < minQ.length && !(bars[minQ[minHead]].time > cutoff)) minHead++;
    if (maxHead < maxQ.length) high[i] = bars[maxQ[maxHead]].high;
    if (minHead < minQ.length) low[i] = bars[minQ[minHead]].low;
  }
  return { high, low };
}

// Alligator lines: SMMA (Wilder) of HL2.
function alligatorLine(bars: readonly Bar[], length: number): Series {
  return rma(source(bars, 'HL2'), length);
}

const signColors = (values: ReadonlySeries, up: string, down: string) => values.map((v) => (v === null ? null : v >= 0 ? up : down));

// ── Moving averages (overlays) ───────────────────────────────────────────────

// DEMA = 2 · EMA − EMA(EMA).
const demaStudy = define({
  type: 'dema',
  title: 'Double EMA',
  shortTitle: 'DEMA',
  overlay: true,
  inputs: [lengthInput(9), sourceInput()],
  compute: (bars, read) => {
    const n = read.int('length');
    const e1 = ema(source(bars, read.source()), n);
    const e2 = ema(e1, n);
    return { plots: [plot('dema', 'DEMA', combine(e1, e2, (a, b) => 2 * a - b), BLUE)] };
  },
});

// TEMA = 3 · EMA − 3 · EMA(EMA) + EMA(EMA(EMA)).
const temaStudy = define({
  type: 'tema',
  title: 'Triple EMA',
  shortTitle: 'TEMA',
  overlay: true,
  inputs: [lengthInput(9), sourceInput()],
  compute: (bars, read) => {
    const n = read.int('length');
    const e1 = ema(source(bars, read.source()), n);
    const e2 = ema(e1, n);
    const e3 = ema(e2, n);
    const values = e1.map((a, i) => {
      const b = e2[i];
      const c = e3[i];
      return a === null || b === null || c === null ? null : 3 * a - 3 * b + c;
    });
    return { plots: [plot('tema', 'TEMA', values, ORANGE)] };
  },
});

const smmaStudy = define({
  type: 'smma',
  title: 'Smoothed Moving Average',
  shortTitle: 'SMMA',
  overlay: true,
  inputs: [lengthInput(7), sourceInput()],
  compute: (bars, read) => ({ plots: [plot('smma', 'SMMA', rma(source(bars, read.source()), read.int('length')), PURPLE)] }),
});

// ALMA: Gaussian-weighted window; weight k (0 = oldest) = exp(−(k − m)² / (2s²)), m = offset · (n − 1),
// s = n / sigma.
const almaStudy = define({
  type: 'alma',
  title: 'Arnaud Legoux Moving Average',
  shortTitle: 'ALMA',
  overlay: true,
  inputs: [lengthInput(9), floatInput('offset', 'Offset', 0.85, 0, 1, 0.01), floatInput('sigma', 'Sigma', 6, 0.1, 100, 0.1), sourceInput()],
  compute: (bars, read) => {
    const n = read.int('length');
    const m = read.float('offset') * (n - 1);
    const s = n / read.float('sigma');
    const weights = Array.from({ length: n }, (_, k) => Math.exp(-((k - m) ** 2) / (2 * s * s)));
    const norm = weights.reduce((a, b) => a + b, 0);
    const src = source(bars, read.source());
    const values = nulls(src.length);
    for (let i = n - 1; i < src.length; i++) {
      let total = 0;
      let ok = true;
      for (let k = 0; k < n; k++) {
        const x = src[i - n + 1 + k];
        if (x === null) {
          ok = false;
          break;
        }
        total += weights[k] * x;
      }
      if (ok) values[i] = divide(total, norm);
    }
    return { plots: [plot('alma', 'ALMA', values, TEAL)] };
  },
});

// KAMA: efficiency ratio ER = |x − x[n]| / Σ|Δx| over n; smoothing constant
// sc = (ER · (fastSC − slowSC) + slowSC)², SC = 2 / (length + 1); seeded with the previous value.
const kamaStudy = define({
  type: 'kama',
  title: 'Kaufman Adaptive Moving Average',
  shortTitle: 'KAMA',
  overlay: true,
  inputs: [lengthInput(10), intInput('fastLength', 'Fast length', 2), intInput('slowLength', 'Slow length', 30), sourceInput()],
  compute: (bars, read) => {
    const n = read.int('length');
    const fastSC = 2 / (read.int('fastLength') + 1);
    const slowSC = 2 / (read.int('slowLength') + 1);
    const src = source(bars, read.source());
    const values = nulls(src.length);
    let prev: number | null = null;
    for (let i = n; i < src.length; i++) {
      let noise = 0;
      let ok = src[i - n] !== null;
      for (let j = i - n + 1; ok && j <= i; j++) {
        const a = src[j];
        const b = src[j - 1];
        if (a === null || b === null) ok = false;
        else noise += Math.abs(a - b);
      }
      if (!ok) continue;
      const x = src[i] as number;
      if (prev === null) prev = src[i - 1] as number;
      const er = noise === 0 ? 0 : Math.abs(x - (src[i - n] as number)) / noise;
      const sc = (er * (fastSC - slowSC) + slowSC) ** 2;
      prev = prev + sc * (x - prev);
      values[i] = prev;
    }
    return { plots: [plot('kama', 'KAMA', values, BLUE)] };
  },
});

// ZLEMA = EMA(x + (x − x[(n − 1) / 2]), n).
const zlemaStudy = define({
  type: 'zlema',
  title: 'Zero-Lag EMA',
  shortTitle: 'ZLEMA',
  overlay: true,
  inputs: [lengthInput(21), sourceInput()],
  compute: (bars, read) => {
    const n = read.int('length');
    const src = source(bars, read.source());
    const delagged = combine(src, lag(src, Math.floor((n - 1) / 2)), (x, p) => 2 * x - p);
    return { plots: [plot('zlema', 'ZLEMA', ema(delagged, n), ORANGE)] };
  },
});

// McGinley Dynamic: MD = MD₋₁ + (x − MD₋₁) / (n · (x / MD₋₁)⁴), seeded with the SMA of the first n
// values. Where the ratio is undefined (a zero price) the line jumps to the price.
const mcginleyStudy = define({
  type: 'mcginley',
  title: 'McGinley Dynamic',
  shortTitle: 'MD',
  overlay: true,
  inputs: [lengthInput(14), sourceInput()],
  compute: (bars, read) => {
    const n = read.int('length');
    const src = source(bars, read.source());
    const seed = sma(src, n);
    const values = nulls(src.length);
    let md: number | null = null;
    for (let i = 0; i < src.length; i++) {
      const x = src[i];
      if (md === null) {
        md = seed[i];
        values[i] = md;
        continue;
      }
      if (x === null) continue;
      const next: number = md + (x - md) / (n * (x / md) ** 4);
      md = isNum(next) ? next : x;
      values[i] = md;
    }
    return { plots: [plot('mcginley', 'McGinley', values, PURPLE)] };
  },
});

const maCrossStudy = define({
  type: 'ma-cross',
  title: 'Moving Average Cross',
  shortTitle: 'MA Cross',
  overlay: true,
  inputs: [intInput('shortLength', 'Short length', 9), intInput('longLength', 'Long length', 21), selectInput('maType', 'Method', 'SMA', ['SMA', 'EMA']), sourceInput()],
  compute: (bars, read) => {
    const src = source(bars, read.source());
    const kind = read.select('maType');
    return {
      plots: [plot('short', 'Short', movingAverage(kind, src, read.int('shortLength')), ORANGE), plot('long', 'Long', movingAverage(kind, src, read.int('longLength')), BLUE)],
    };
  },
});

const maRibbonStudy = define({
  type: 'ma-ribbon',
  title: 'Moving Average Ribbon',
  shortTitle: 'MA Ribbon',
  overlay: true,
  inputs: [
    intInput('length1', 'Length 1', 20),
    intInput('length2', 'Length 2', 50),
    intInput('length3', 'Length 3', 100),
    intInput('length4', 'Length 4', 200),
    selectInput('maType', 'Method', 'EMA', ['SMA', 'EMA']),
    sourceInput(),
  ],
  compute: (bars, read) => {
    const src = source(bars, read.source());
    const kind = read.select('maType');
    const colors = [ORANGE, TEAL, BLUE, PURPLE];
    return {
      plots: [1, 2, 3, 4].map((k, i) => {
        const length = read.int(`length${k}`);
        return plot(`ma${k}`, `MA ${k}`, movingAverage(kind, src, length), colors[i]);
      }),
    };
  },
});

// ── Channels, stops and markers (overlays) ───────────────────────────────────

// Chandelier Exit: long stop = highest high − mult · ATR, short stop = lowest low + mult · ATR, each
// ratcheting while the previous close respects it. The side flips when the close crosses the
// opposite stop; only the active side is drawn.
const chandelierStudy = define({
  type: 'chandelier-exit',
  title: 'Chandelier Exit',
  shortTitle: 'CE',
  overlay: true,
  inputs: [lengthInput(22), floatInput('mult', 'ATR multiplier', 3, 0.01, 100, 0.1)],
  compute: (bars, read) => {
    const n = read.int('length');
    const range = map(atr(bars, n), (r) => r * read.float('mult'));
    const hh = highest(highs(bars), n);
    const ll = lowest(lows(bars), n);
    const longLine = nulls(bars.length);
    const shortLine = nulls(bars.length);
    let prevLong: number | null = null;
    let prevShort: number | null = null;
    let dir: 1 | -1 = 1;
    for (let i = 0; i < bars.length; i++) {
      const r = range[i];
      const h = hh[i];
      const l = ll[i];
      const c = bars[i].close;
      if (r === null || h === null || l === null || !isNum(c)) {
        prevLong = null;
        prevShort = null;
        continue;
      }
      let longStop = h - r;
      let shortStop = l + r;
      const prevClose = i > 0 ? bars[i - 1].close : Number.NaN;
      if (prevLong !== null && prevClose > prevLong) longStop = Math.max(longStop, prevLong);
      if (prevShort !== null && prevClose < prevShort) shortStop = Math.min(shortStop, prevShort);
      if (prevShort !== null && c > prevShort) dir = 1;
      else if (prevLong !== null && c < prevLong) dir = -1;
      if (dir === 1) longLine[i] = longStop;
      else shortLine[i] = shortStop;
      prevLong = longStop;
      prevShort = shortStop;
    }
    return {
      plots: [
        plot('long', 'Long stop', longLine, GREEN, { colors: longLine.map((v) => (v === null ? null : GREEN)), width: 2 }),
        plot('short', 'Short stop', shortLine, RED, { colors: shortLine.map((v) => (v === null ? null : RED)), width: 2 }),
      ],
    };
  },
});

// Chande Kroll Stop: first stops = highest(H, p) − x · ATR(p) and lowest(L, p) + x · ATR(p); the
// short stop is the highest first high stop over q bars, the long stop the lowest first low stop.
const chandeKrollStudy = define({
  type: 'chande-kroll-stop',
  title: 'Chande Kroll Stop',
  shortTitle: 'CKS',
  overlay: true,
  inputs: [intInput('atrLength', 'ATR length (p)', 10), floatInput('mult', 'ATR multiplier (x)', 1, 0.01, 100, 0.1), intInput('stopLength', 'Stop length (q)', 9)],
  compute: (bars, read) => {
    const p = read.int('atrLength');
    const range = map(atr(bars, p), (r) => r * read.float('mult'));
    const firstHigh = combine(highest(highs(bars), p), range, (h, r) => h - r);
    const firstLow = combine(lowest(lows(bars), p), range, (l, r) => l + r);
    const q = read.int('stopLength');
    return { plots: [plot('stopShort', 'Stop short', highest(firstHigh, q), RED), plot('stopLong', 'Stop long', lowest(firstLow, q), GREEN)] };
  },
});

// Williams Alligator: SMMA of HL2, each line drawn its offset bars ahead.
const alligatorStudy = define({
  type: 'williams-alligator',
  title: 'Williams Alligator',
  shortTitle: 'Alligator',
  overlay: true,
  inputs: [
    intInput('jawLength', 'Jaw length', 13),
    intInput('jawOffset', 'Jaw offset', 8, 0, 500),
    intInput('teethLength', 'Teeth length', 8),
    intInput('teethOffset', 'Teeth offset', 5, 0, 500),
    intInput('lipsLength', 'Lips length', 5),
    intInput('lipsOffset', 'Lips offset', 3, 0, 500),
  ],
  compute: (bars, read) => ({
    plots: [
      plot('jaw', 'Jaw', alligatorLine(bars, read.int('jawLength')), BLUE, { offset: read.int('jawOffset') }),
      plot('teeth', 'Teeth', alligatorLine(bars, read.int('teethLength')), RED, { offset: read.int('teethOffset') }),
      plot('lips', 'Lips', alligatorLine(bars, read.int('lipsLength')), GREEN, { offset: read.int('lipsOffset') }),
    ],
  }),
});

// Price Channel: highest high and lowest low of the previous n bars (the current bar excluded).
const priceChannelStudy = define({
  type: 'price-channel',
  title: 'Price Channel',
  shortTitle: 'PC',
  overlay: true,
  inputs: [lengthInput(20)],
  compute: (bars, read) => {
    const n = read.int('length');
    const upper = lag(highest(highs(bars), n), 1);
    const lower = lag(lowest(lows(bars), n), 1);
    return {
      plots: [plot('upper', 'Upper', upper, BLUE), plot('lower', 'Lower', lower, BLUE), plot('center', 'Center', combine(upper, lower, (u, l) => (u + l) / 2), ORANGE)],
      bands: [band('fill', 'upper', 'lower', BLUE_FILL)],
    };
  },
});

// 52-week high and low from bar times: the bars opened within the trailing 364 calendar days, so the
// window is the same span on any timeframe (364 daily bars, 52 weekly bars, 12 monthly bars).
const fiftyTwoWeekStudy = define({
  type: '52-week-high-low',
  title: '52 Week High/Low',
  shortTitle: '52W H/L',
  overlay: true,
  inputs: [],
  compute: (bars) => {
    const { high, low } = extremesByTime(bars, 364 * DAY);
    return { plots: [plot('high', '52W high', high, GREEN, { lineStyle: 'dashed' }), plot('low', '52W low', low, RED, { lineStyle: 'dashed' })] };
  },
});

// ZigZag: a swing is confirmed once price retraces `deviation` percent from its extreme and the swing
// spans at least `depth` bars from the previous pivot. If price breaks beyond the previous pivot
// before that, the pivot moves to the new extreme. The plot runs straight between confirmed pivots
// and is null before the first and after the last.
const zigzagStudy = define({
  type: 'zigzag',
  title: 'ZigZag',
  shortTitle: 'ZigZag',
  overlay: true,
  inputs: [floatInput('deviation', 'Deviation (%)', 5, 0.01, 100, 0.1), intInput('depth', 'Depth', 10)],
  compute: (bars, read) => {
    const dev = read.float('deviation') / 100;
    const depth = read.int('depth');
    const pivots: { index: number; price: number }[] = [];
    let dir: 0 | 1 | -1 = 0;
    let hiIdx = -1;
    let hiP = 0;
    let loIdx = -1;
    let loP = 0;
    let exIdx = -1;
    let exP = 0;
    for (let i = 0; i < bars.length; i++) {
      const h = bars[i].high;
      const l = bars[i].low;
      if (!isNum(h) || !isNum(l)) continue;
      if (dir === 0) {
        if (hiIdx < 0) {
          hiIdx = loIdx = i;
          hiP = h;
          loP = l;
          continue;
        }
        if (h > hiP) [hiIdx, hiP] = [i, h];
        if (l < loP) [loIdx, loP] = [i, l];
        if (loIdx < hiIdx && hiP - loP >= dev * Math.abs(loP)) {
          pivots.push({ index: loIdx, price: loP });
          dir = 1;
          [exIdx, exP] = [hiIdx, hiP];
        } else if (hiIdx < loIdx && hiP - loP >= dev * Math.abs(hiP)) {
          pivots.push({ index: hiIdx, price: hiP });
          dir = -1;
          [exIdx, exP] = [loIdx, loP];
        }
        continue;
      }
      const last = pivots[pivots.length - 1];
      if (dir === 1) {
        if (h > exP) [exIdx, exP] = [i, h];
        else if (exP - l >= dev * Math.abs(exP) && exIdx - last.index >= depth) {
          pivots.push({ index: exIdx, price: exP });
          dir = -1;
          [exIdx, exP] = [i, l];
        } else if (l < last.price) {
          pivots[pivots.length - 1] = { index: i, price: l };
          [exIdx, exP] = [i, h];
        }
      } else {
        if (l < exP) [exIdx, exP] = [i, l];
        else if (h - exP >= dev * Math.abs(exP) && exIdx - last.index >= depth) {
          pivots.push({ index: exIdx, price: exP });
          dir = 1;
          [exIdx, exP] = [i, h];
        } else if (h > last.price) {
          pivots[pivots.length - 1] = { index: i, price: h };
          [exIdx, exP] = [i, l];
        }
      }
    }
    const values = nulls(bars.length);
    if (pivots.length === 1) values[pivots[0].index] = pivots[0].price;
    for (let k = 1; k < pivots.length; k++) {
      const a = pivots[k - 1];
      const b = pivots[k];
      const span = b.index - a.index;
      for (let j = a.index; j <= b.index; j++) values[j] = span === 0 ? b.price : a.price + ((b.price - a.price) * (j - a.index)) / span;
    }
    return { plots: [plot('zigzag', 'ZigZag', values, ORANGE, { width: 2 })] };
  },
});

// Williams Fractals: an up fractal is a high strictly above the `period` highs either side, a down
// fractal a low strictly below the `period` lows either side. Markers sit just outside the bar, a
// tenth of the window's average range beyond the high (or low).
const fractalsStudy = define({
  type: 'williams-fractals',
  title: 'Williams Fractals',
  shortTitle: 'Fractals',
  overlay: true,
  inputs: [intInput('period', 'Periods', 2, 1, 100)],
  compute: (bars, read) => {
    const p = read.int('period');
    const n = bars.length;
    const up = nulls(n);
    const down = nulls(n);
    for (let i = p; i < n - p; i++) {
      let isUp = true;
      let isDown = true;
      let rangeSum = 0;
      for (let j = i - p; j <= i + p; j++) {
        const b = bars[j];
        if (!isNum(b.high) || !isNum(b.low)) {
          isUp = isDown = false;
          break;
        }
        rangeSum += b.high - b.low;
        if (j === i) continue;
        if (!(bars[i].high > b.high)) isUp = false;
        if (!(bars[i].low < b.low)) isDown = false;
      }
      const pad = (0.1 * rangeSum) / (2 * p + 1);
      if (isUp) up[i] = bars[i].high + pad;
      if (isDown) down[i] = bars[i].low - pad;
    }
    return {
      plots: [plot('up', 'Up fractal', up, GREEN, { kind: 'circles' }), plot('down', 'Down fractal', down, RED, { kind: 'circles' })],
    };
  },
});

// ── Volume studies ───────────────────────────────────────────────────────────

const adStudy = define({
  type: 'accumulation-distribution',
  title: 'Accumulation/Distribution',
  shortTitle: 'A/D',
  overlay: false,
  inputs: [],
  compute: (bars) => ({ plots: [plot('ad', 'A/D', accumulationDistribution(bars), BLUE)] }),
});

// Chaikin Oscillator = EMA(A/D, fast) − EMA(A/D, slow).
const chaikinOscStudy = define({
  type: 'chaikin-oscillator',
  title: 'Chaikin Oscillator',
  shortTitle: 'Chaikin Osc',
  overlay: false,
  inputs: [intInput('fastLength', 'Fast length', 3), intInput('slowLength', 'Slow length', 10)],
  compute: (bars, read) => {
    const ad = accumulationDistribution(bars);
    return { plots: [plot('osc', 'Chaikin Osc', combine(ema(ad, read.int('fastLength')), ema(ad, read.int('slowLength')), (f, s) => f - s), RED)], levels: [level('zero', 0)] };
  },
});

// EMV = SMA(divisor · ΔHL2 · (H − L) / volume, n); undefined on zero-volume bars.
const eomStudy = define({
  type: 'ease-of-movement',
  title: 'Ease of Movement',
  shortTitle: 'EOM',
  overlay: false,
  inputs: [lengthInput(14), floatInput('divisor', 'Divisor', 10000, 1, 1e12, 1)],
  compute: (bars, read) => {
    const divisor = read.float('divisor');
    const distance = change(source(bars, 'HL2'), 1);
    const raw = distance.map((d, i) => {
      const v = volumeOf(bars[i]);
      return d === null ? null : divide(divisor * d * (bars[i].high - bars[i].low), v);
    });
    return { plots: [plot('eom', 'EOM', sma(clean(raw), read.int('length')), TEAL)], levels: [level('zero', 0)] };
  },
});

// Force Index = EMA((C − C₋₁) · volume, n).
const forceIndexStudy = define({
  type: 'force-index',
  title: 'Force Index',
  shortTitle: 'EFI',
  overlay: false,
  inputs: [lengthInput(13)],
  compute: (bars, read) => {
    const raw = combine(change(closes(bars), 1), volumes(bars), (d, v) => d * v);
    return { plots: [plot('efi', 'EFI', ema(raw, read.int('length')), RED)], levels: [level('zero', 0)] };
  },
});

// Klinger Volume Oscillator: volume force VF = V · |2 · (dm / cm − 1)| · trend · 100 with dm = H − L,
// trend = ±1 by the change of H + L + C, and cm accumulating dm while the trend holds;
// KVO = EMA(VF, fast) − EMA(VF, slow), signal = EMA(KVO).
const klingerStudy = define({
  type: 'klinger-oscillator',
  title: 'Klinger Oscillator',
  shortTitle: 'KVO',
  overlay: false,
  inputs: [intInput('fastLength', 'Fast length', 34), intInput('slowLength', 'Slow length', 55), intInput('signalLength', 'Signal length', 13)],
  compute: (bars, read) => {
    const hlc = source(bars, 'HLC3');
    const vf = nulls(bars.length);
    let prevTrend = 0;
    let prevDm = bars.length > 0 ? bars[0].high - bars[0].low : 0;
    let cm = 0;
    for (let i = 1; i < bars.length; i++) {
      const now = hlc[i];
      const before = hlc[i - 1];
      const dm = bars[i].high - bars[i].low;
      if (now === null || before === null || !isNum(dm)) continue;
      const trend = now > before ? 1 : -1;
      cm = trend === prevTrend ? cm + dm : (isNum(prevDm) ? prevDm : 0) + dm;
      const force = cm === 0 ? 0 : volumeOf(bars[i]) * Math.abs(2 * (dm / cm - 1)) * trend * 100;
      vf[i] = isNum(force) ? force : 0;
      prevTrend = trend;
      prevDm = dm;
    }
    const kvo = combine(ema(vf, read.int('fastLength')), ema(vf, read.int('slowLength')), (f, s) => f - s);
    return { plots: [plot('kvo', 'KVO', kvo, BLUE), plot('signal', 'Signal', ema(kvo, read.int('signalLength')), GREEN)], levels: [level('zero', 0)] };
  },
});

// Negative/Positive Volume Index: starts at 1000 and compounds the close's percent change on bars
// whose volume fell (NVI) or rose (PVI) from the bar before.
function volumeIndex(bars: readonly Bar[], when: (volume: number, prevVolume: number) => boolean): Series {
  const out = nulls(bars.length);
  let value = 1000;
  for (let i = 0; i < bars.length; i++) {
    if (i > 0) {
      const c = bars[i].close;
      const p = bars[i - 1].close;
      if (when(volumeOf(bars[i]), volumeOf(bars[i - 1])) && isNum(c) && isNum(p) && p !== 0) {
        const next = value * (1 + (c - p) / p);
        if (isNum(next)) value = next;
      }
    }
    out[i] = value;
  }
  return out;
}

const volumeIndexStudy = (type: string, title: string, shortTitle: string, when: (v: number, p: number) => boolean) =>
  define({
    type,
    title,
    shortTitle,
    overlay: false,
    inputs: [intInput('emaLength', 'EMA length', 255)],
    compute: (bars, read) => {
      const index = volumeIndex(bars, when);
      return { plots: [plot('index', shortTitle, index, BLUE), plot('signal', 'EMA', ema(index, read.int('emaLength')), ORANGE)] };
    },
  });

const nviStudy = volumeIndexStudy('nvi', 'Negative Volume Index', 'NVI', (v, p) => v < p);
const pviStudy = volumeIndexStudy('pvi', 'Positive Volume Index', 'PVI', (v, p) => v > p);

// PVT = running Σ volume · (C − C₋₁) / C₋₁.
const pvtStudy = define({
  type: 'pvt',
  title: 'Price Volume Trend',
  shortTitle: 'PVT',
  overlay: false,
  inputs: [],
  compute: (bars) => {
    const values = nulls(bars.length);
    let total = 0;
    for (let i = 0; i < bars.length; i++) {
      if (i > 0) {
        const step = divide(bars[i].close - bars[i - 1].close, bars[i - 1].close);
        if (step !== null) {
          const next = total + step * volumeOf(bars[i]);
          if (isNum(next)) total = next;
        }
      }
      values[i] = total;
    }
    return { plots: [plot('pvt', 'PVT', values, BLUE)] };
  },
});

// Volume columns coloured by close ≥ open, with a moving average of volume. Bars without a volume
// are left blank.
const volumeStudy = define({
  type: 'volume',
  title: 'Volume',
  shortTitle: 'Vol',
  overlay: false,
  inputs: [intInput('maLength', 'MA length', 20)],
  compute: (bars, read) => {
    const vol = clean(bars.map((bar) => (isNum(bar.volume) ? bar.volume : null)));
    const colors = vol.map((v, i) => (v === null ? null : bars[i].close >= bars[i].open ? GREEN : STRONG_RED));
    return { plots: [plot('volume', 'Volume', vol, GREEN, { kind: 'histogram', colors }), plot('ma', 'Volume MA', sma(vol, read.int('maLength')), BLUE)] };
  },
});

// Relative volume = volume / SMA(volume, n).
const relativeVolumeStudy = define({
  type: 'relative-volume',
  title: 'Relative Volume',
  shortTitle: 'RVol',
  overlay: false,
  inputs: [lengthInput(20)],
  compute: (bars, read) => {
    const vol = volumes(bars);
    return { plots: [plot('rvol', 'RVol', combine(vol, sma(vol, read.int('length')), (v, m) => (m === 0 ? NaN : v / m)), BLUE, { kind: 'histogram' })], levels: [level('one', 1)] };
  },
});

// ── Oscillators ──────────────────────────────────────────────────────────────

// Elder Ray: bull power = high − EMA(close), bear power = low − EMA(close).
const elderRayStudy = define({
  type: 'elder-ray',
  title: 'Elder Ray',
  shortTitle: 'Elder Ray',
  overlay: false,
  inputs: [lengthInput(13)],
  compute: (bars, read) => {
    const e = ema(closes(bars), read.int('length'));
    return {
      plots: [
        plot('bull', 'Bull power', combine(highs(bars), e, (h, m) => h - m), GREEN, { kind: 'histogram' }),
        plot('bear', 'Bear power', combine(lows(bars), e, (l, m) => l - m), RED, { kind: 'histogram' }),
      ],
      levels: [level('zero', 0)],
    };
  },
});

// Balance of Power = SMA((C − O) / (H − L), n); a zero-range bar counts as 0.
const bopStudy = define({
  type: 'balance-of-power',
  title: 'Balance of Power',
  shortTitle: 'BoP',
  overlay: false,
  inputs: [lengthInput(14)],
  compute: (bars, read) => {
    const raw = clean(bars.map((b) => (b.high - b.low === 0 ? 0 : (b.close - b.open) / (b.high - b.low))));
    return { plots: [plot('bop', 'BoP', sma(raw, read.int('length')), RED)], levels: [level('zero', 0)] };
  },
});

// TTM Squeeze: the squeeze is on while the Bollinger Bands sit inside the Keltner Channel (SMA basis,
// Wilder ATR). Momentum = linreg(close − avg(avg(highest high, lowest low), SMA close), n).
const ttmSqueezeStudy = define({
  type: 'ttm-squeeze',
  title: 'TTM Squeeze',
  shortTitle: 'Squeeze',
  overlay: false,
  inputs: [lengthInput(20), floatInput('bbMult', 'BB multiplier', 2, 0.01, 50, 0.1), floatInput('kcMult', 'KC multiplier', 1.5, 0.01, 50, 0.1)],
  compute: (bars, read) => {
    const n = read.int('length');
    const close = closes(bars);
    const bb = bollinger(close, n, read.float('bbMult'));
    const kcRange = map(atr(bars, n), (r) => r * read.float('kcMult'));
    const mid = combine(combine(highest(highs(bars), n), lowest(lows(bars), n), (h, l) => (h + l) / 2), bb.basis, (a, b) => (a + b) / 2);
    const momentum = linreg(combine(close, mid, (c, m) => c - m), n);
    const momentumColors = momentum.map((m, i) => {
      if (m === null) return null;
      const prev = i > 0 ? momentum[i - 1] : null;
      if (m >= 0) return prev === null || m > prev ? GREEN : WEAK_GREEN;
      return prev === null || m < prev ? STRONG_RED : WEAK_RED;
    });
    const dots = nulls(bars.length);
    const dotColors: (string | null)[] = new Array<string | null>(bars.length).fill(null);
    for (let i = 0; i < bars.length; i++) {
      const basis = bb.basis[i];
      const upper = bb.upper[i];
      const lower = bb.lower[i];
      const r = kcRange[i];
      if (basis === null || upper === null || lower === null || r === null) continue;
      const on = lower > basis - r && upper < basis + r;
      dots[i] = 0;
      dotColors[i] = on ? STRONG_RED : GREEN;
    }
    return {
      plots: [plot('momentum', 'Momentum', momentum, GREEN, { kind: 'histogram', colors: momentumColors }), plot('squeeze', 'Squeeze', dots, STRONG_RED, { kind: 'circles', colors: dotColors })],
    };
  },
});

// Vortex: VI± = Σ VM± / Σ TR over n, VM+ = |H − L₋₁|, VM− = |L − H₋₁|.
const vortexStudy = define({
  type: 'vortex',
  title: 'Vortex Indicator',
  shortTitle: 'VI',
  overlay: false,
  inputs: [lengthInput(14)],
  compute: (bars, read) => {
    const n = read.int('length');
    const high = highs(bars);
    const low = lows(bars);
    const plusVM = combine(high, lag(low, 1), (h, l) => Math.abs(h - l));
    const minusVM = combine(low, lag(high, 1), (l, h) => Math.abs(l - h));
    const tr = trueRange(bars).map((v, i) => (i === 0 ? null : v));
    const trSum = sum(tr, n);
    return {
      plots: [
        plot('plus', 'VI+', combine(sum(plusVM, n), trSum, (a, t) => (t === 0 ? NaN : a / t)), BLUE),
        plot('minus', 'VI−', combine(sum(minusVM, n), trSum, (a, t) => (t === 0 ? NaN : a / t)), STRONG_RED),
      ],
      levels: [level('one', 1)],
    };
  },
});

// Choppiness = 100 · log₁₀(Σ TR / (highest high − lowest low)) / log₁₀(n).
const choppinessStudy = define({
  type: 'choppiness',
  title: 'Choppiness Index',
  shortTitle: 'CHOP',
  overlay: false,
  inputs: [intInput('length', 'Length', 14, 2)],
  compute: (bars, read) => {
    const n = read.int('length');
    const range = combine(highest(highs(bars), n), lowest(lows(bars), n), (h, l) => h - l);
    const values = combine(sum(trueRange(bars), n), range, (s, r) => (r === 0 ? NaN : (100 * Math.log10(s / r)) / Math.log10(n)));
    return { plots: [plot('chop', 'CHOP', values, BLUE)], levels: [level('upper', 61.8), level('lower', 38.2)] };
  },
});

// Mass Index = Σ over n of EMA(H − L, e) / EMA(EMA(H − L, e), e).
const massIndexStudy = define({
  type: 'mass-index',
  title: 'Mass Index',
  shortTitle: 'MI',
  overlay: false,
  inputs: [intInput('emaLength', 'EMA length', 9), intInput('sumLength', 'Sum length', 25)],
  compute: (bars, read) => {
    const e = read.int('emaLength');
    const e1 = ema(combine(highs(bars), lows(bars), (h, l) => h - l), e);
    const ratio = combine(e1, ema(e1, e), (a, b) => (b === 0 ? NaN : a / b));
    return { plots: [plot('mi', 'MI', sum(ratio, read.int('sumLength')), BLUE)], levels: [level('bulge', 27)] };
  },
});

// Ulcer Index = √(mean over n of the squared percent drawdown from the n-bar highest close).
const ulcerStudy = define({
  type: 'ulcer-index',
  title: 'Ulcer Index',
  shortTitle: 'UI',
  overlay: false,
  inputs: [lengthInput(14), sourceInput()],
  compute: (bars, read) => {
    const n = read.int('length');
    const src = source(bars, read.source());
    const drawdown = combine(src, highest(src, n), (x, h) => (h === 0 ? NaN : ((100 * (x - h)) / h) ** 2));
    return { plots: [plot('ui', 'UI', map(sma(drawdown, n), Math.sqrt), BLUE)] };
  },
});

// Relative Vigor Index: RVI = Σ symmetric-weighted (C − O) / Σ symmetric-weighted (H − L) over n,
// weights 1-2-2-1 / 6; signal = the same 1-2-2-1 weighting of RVI.
const symmetricWeight = (src: ReadonlySeries): Series =>
  src.map((x, i) => {
    if (i < 3) return null;
    const a = src[i - 1];
    const b = src[i - 2];
    const c = src[i - 3];
    return x === null || a === null || b === null || c === null ? null : (x + 2 * a + 2 * b + c) / 6;
  });

const rvgiStudy = define({
  type: 'rvgi',
  title: 'Relative Vigor Index',
  shortTitle: 'RVGI',
  overlay: false,
  inputs: [lengthInput(10)],
  compute: (bars, read) => {
    const n = read.int('length');
    const numerator = symmetricWeight(combine(closes(bars), source(bars, 'Open'), (c, o) => c - o));
    const denominator = symmetricWeight(combine(highs(bars), lows(bars), (h, l) => h - l));
    const rvi = combine(sum(numerator, n), sum(denominator, n), (a, b) => (b === 0 ? NaN : a / b));
    return { plots: [plot('rvi', 'RVGI', rvi, GREEN), plot('signal', 'Signal', symmetricWeight(rvi), STRONG_RED)], levels: [level('zero', 0)] };
  },
});

// Relative Volatility Index (Dorsey): RSI-style ratio of EMA-smoothed standard deviations on up and
// down closes. RVI = 100 · U / (U + D); 50 when both are zero.
const rviStudy = define({
  type: 'rvi',
  title: 'Relative Volatility Index',
  shortTitle: 'RVI',
  overlay: false,
  inputs: [intInput('stdevLength', 'StdDev length', 10), intInput('length', 'Smoothing length', 14), sourceInput()],
  compute: (bars, read) => {
    const src = source(bars, read.source());
    const sd = stdev(src, read.int('stdevLength'));
    const delta = change(src, 1);
    const n = read.int('length');
    const up = ema(combine(delta, sd, (d, s) => (d > 0 ? s : 0)), n);
    const down = ema(combine(delta, sd, (d, s) => (d < 0 ? s : 0)), n);
    const values = combine(up, down, (u, d) => (u + d === 0 ? 50 : (100 * u) / (u + d)));
    return { plots: [plot('rvi', 'RVI', values, PURPLE)], levels: [level('upper', 80), level('middle', 50), level('lower', 20)] };
  },
});

// Connors RSI = (RSI(close, 3) + RSI(up/down streak, 2) + percent rank of the 1-bar ROC over 100)/3.
// The percent rank is the share of the previous `rank` ROC values below the current one.
const connorsRsiStudy = define({
  type: 'connors-rsi',
  title: 'Connors RSI',
  shortTitle: 'CRSI',
  overlay: false,
  inputs: [intInput('rsiLength', 'RSI length', 3), intInput('streakLength', 'Up/down length', 2), intInput('rankLength', 'ROC length', 100)],
  compute: (bars, read) => {
    const close = closes(bars);
    const streak = nulls(bars.length);
    let run = 0;
    for (let i = 0; i < close.length; i++) {
      const c = close[i];
      const p = i > 0 ? close[i - 1] : null;
      if (c === null) {
        run = 0;
        continue;
      }
      if (p === null || c === p) run = 0;
      else if (c > p) run = run > 0 ? run + 1 : 1;
      else run = run < 0 ? run - 1 : -1;
      streak[i] = run;
    }
    const rate = roc(close, 1);
    const rankLength = read.int('rankLength');
    const rank = nulls(bars.length);
    for (let i = rankLength; i < rate.length; i++) {
      const x = rate[i];
      if (x === null) continue;
      let below = 0;
      let ok = true;
      for (let j = i - rankLength; j < i; j++) {
        const y = rate[j];
        if (y === null) {
          ok = false;
          break;
        }
        if (y < x) below++;
      }
      if (ok) rank[i] = (100 * below) / rankLength;
    }
    const a = rsi(close, read.int('rsiLength'));
    const b = rsi(streak, read.int('streakLength'));
    const values = a.map((x, i) => {
      const y = b[i];
      const z = rank[i];
      return x === null || y === null || z === null ? null : (x + y + z) / 3;
    });
    return { plots: [plot('crsi', 'CRSI', values, BLUE)], levels: [level('upper', 70), level('lower', 30)] };
  },
});

// Ehlers' Fisher Transform of HL2 over n: v = 0.66 · (normalised position − 0.5) + 0.67 · v₋₁, clamped
// to ±0.999; fisher = 0.5 · ln((1 + v) / (1 − v)) + 0.5 · fisher₋₁; trigger = fisher₋₁.
const fisherStudy = define({
  type: 'fisher-transform',
  title: 'Fisher Transform',
  shortTitle: 'Fisher',
  overlay: false,
  inputs: [lengthInput(9)],
  compute: (bars, read) => {
    const n = read.int('length');
    const hl2 = source(bars, 'HL2');
    const hi = highest(hl2, n);
    const lo = lowest(hl2, n);
    const fisher = nulls(bars.length);
    const trigger = nulls(bars.length);
    let value = 0;
    let prevFisher: number | null = null;
    for (let i = 0; i < bars.length; i++) {
      const x = hl2[i];
      const h = hi[i];
      const l = lo[i];
      if (x === null || h === null || l === null) continue;
      const position = h - l === 0 ? 0 : (x - l) / (h - l) - 0.5;
      value = Math.max(-0.999, Math.min(0.999, 0.66 * position + 0.67 * value));
      const f: number = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * (prevFisher ?? 0);
      fisher[i] = f;
      trigger[i] = prevFisher;
      prevFisher = f;
    }
    return { plots: [plot('fisher', 'Fisher', fisher, BLUE), plot('trigger', 'Trigger', trigger, ORANGE)], levels: [level('upper', 1.5), level('zero', 0), level('lower', -1.5)] };
  },
});

// Schaff Trend Cycle: the MACD (EMA fast − EMA slow) passed twice through a half-smoothed stochastic
// over the cycle length.
const stcStudy = define({
  type: 'schaff-trend-cycle',
  title: 'Schaff Trend Cycle',
  shortTitle: 'STC',
  overlay: false,
  inputs: [intInput('cycleLength', 'Cycle length', 10), intInput('fastLength', 'Fast length', 23), intInput('slowLength', 'Slow length', 50), sourceInput()],
  compute: (bars, read) => {
    const src = source(bars, read.source());
    const macd = combine(ema(src, read.int('fastLength')), ema(src, read.int('slowLength')), (f, s) => f - s);
    const n = read.int('cycleLength');
    return { plots: [plot('stc', 'STC', halfSmoothedStochastic(halfSmoothedStochastic(macd, n), n), RED)], levels: [level('upper', 75), level('lower', 25)] };
  },
});

// KST = SMA(ROC₁) + 2 · SMA(ROC₂) + 3 · SMA(ROC₃) + 4 · SMA(ROC₄); signal = SMA(KST).
const kstStudy = define({
  type: 'kst',
  title: 'Know Sure Thing',
  shortTitle: 'KST',
  overlay: false,
  inputs: [
    intInput('roc1', 'ROC length 1', 10),
    intInput('roc2', 'ROC length 2', 15),
    intInput('roc3', 'ROC length 3', 20),
    intInput('roc4', 'ROC length 4', 30),
    intInput('sma1', 'SMA length 1', 10),
    intInput('sma2', 'SMA length 2', 10),
    intInput('sma3', 'SMA length 3', 10),
    intInput('sma4', 'SMA length 4', 15),
    intInput('signalLength', 'Signal length', 9),
  ],
  compute: (bars, read) => {
    const close = closes(bars);
    const parts = [1, 2, 3, 4].map((k) => map(sma(roc(close, read.int(`roc${k}`)), read.int(`sma${k}`)), (v) => v * k));
    const kst = parts.reduce((acc, part) => combine(acc, part, (a, b) => a + b));
    return { plots: [plot('kst', 'KST', kst, GREEN), plot('signal', 'Signal', sma(kst, read.int('signalLength')), STRONG_RED)], levels: [level('zero', 0)] };
  },
});

// Coppock Curve = WMA(ROC(long) + ROC(short), n).
const coppockStudy = define({
  type: 'coppock-curve',
  title: 'Coppock Curve',
  shortTitle: 'Coppock',
  overlay: false,
  inputs: [intInput('wmaLength', 'WMA length', 10), intInput('longRoc', 'Long ROC length', 14), intInput('shortRoc', 'Short ROC length', 11)],
  compute: (bars, read) => {
    const close = closes(bars);
    const total = combine(roc(close, read.int('longRoc')), roc(close, read.int('shortRoc')), (a, b) => a + b);
    return { plots: [plot('coppock', 'Coppock', wma(total, read.int('wmaLength')), BLUE)], levels: [level('zero', 0)] };
  },
});

// DPO with shift = n / 2 + 1. Centred: close[shift bars back] − SMA, drawn shift bars back. Not
// centred: close − SMA from shift bars back, on the current bar.
const dpoStudy = define({
  type: 'dpo',
  title: 'Detrended Price Oscillator',
  shortTitle: 'DPO',
  overlay: false,
  inputs: [lengthInput(21), boolInput('centered', 'Centered', false)],
  compute: (bars, read) => {
    const n = read.int('length');
    const shift = Math.floor(n / 2) + 1;
    const close = closes(bars);
    const average = sma(close, n);
    if (read.bool('centered')) {
      return { plots: [plot('dpo', 'DPO', combine(lag(close, shift), average, (c, m) => c - m), BLUE, { offset: -shift })], levels: [level('zero', 0)] };
    }
    return { plots: [plot('dpo', 'DPO', combine(close, lag(average, shift), (c, m) => c - m), BLUE)], levels: [level('zero', 0)] };
  },
});

// PPO = 100 · (EMA fast − EMA slow) / EMA slow; signal = EMA(PPO); histogram = PPO − signal.
const ppoStudy = define({
  type: 'ppo',
  title: 'Percentage Price Oscillator',
  shortTitle: 'PPO',
  overlay: false,
  inputs: [intInput('fastLength', 'Fast length', 12), intInput('slowLength', 'Slow length', 26), intInput('signalLength', 'Signal length', 9), sourceInput()],
  compute: (bars, read) => {
    const src = source(bars, read.source());
    const ppo = combine(ema(src, read.int('fastLength')), ema(src, read.int('slowLength')), (f, s) => (s === 0 ? NaN : (100 * (f - s)) / s));
    const signal = ema(ppo, read.int('signalLength'));
    const histogram = combine(ppo, signal, (p, s) => p - s);
    return {
      plots: [plot('histogram', 'Histogram', histogram, TEAL, { kind: 'histogram', colors: signColors(histogram, TEAL, RED) }), plot('ppo', 'PPO', ppo, BLUE), plot('signal', 'Signal', signal, ORANGE)],
      levels: [level('zero', 0)],
    };
  },
});

// TSI = 100 · EMA(EMA(Δ, long), short) / EMA(EMA(|Δ|, long), short); signal = EMA(TSI).
const tsiStudy = define({
  type: 'tsi',
  title: 'True Strength Index',
  shortTitle: 'TSI',
  overlay: false,
  inputs: [intInput('longLength', 'Long length', 25), intInput('shortLength', 'Short length', 13), intInput('signalLength', 'Signal length', 13), sourceInput()],
  compute: (bars, read) => {
    const tsi = map(tsiRatio(source(bars, read.source()), read.int('longLength'), read.int('shortLength')), (v) => 100 * v);
    return { plots: [plot('tsi', 'TSI', tsi, BLUE), plot('signal', 'Signal', ema(tsi, read.int('signalLength')), STRONG_RED)], levels: [level('zero', 0)] };
  },
});

// SMI Ergodic: Blau's ergodic (the TSI ratio, −1..1) with short and long EMA lengths, and its EMA.
const smiErgodicStudy = define({
  type: 'smi-ergodic',
  title: 'SMI Ergodic Indicator',
  shortTitle: 'SMIEI',
  overlay: false,
  inputs: [intInput('shortLength', 'Short length', 5), intInput('longLength', 'Long length', 20), intInput('signalLength', 'Signal length', 5)],
  compute: (bars, read) => {
    const erg = tsiRatio(closes(bars), read.int('longLength'), read.int('shortLength'));
    return { plots: [plot('smi', 'SMI', erg, BLUE), plot('signal', 'Signal', ema(erg, read.int('signalLength')), ORANGE)], levels: [level('zero', 0)] };
  },
});

// Gator Oscillator: |jaw − teeth| above zero and −|teeth − lips| below, using the Alligator lines at
// their displaced positions. A bar is green when its magnitude grew, red when it shrank.
const gatorStudy = define({
  type: 'gator-oscillator',
  title: 'Gator Oscillator',
  shortTitle: 'Gator',
  overlay: false,
  inputs: [
    intInput('jawLength', 'Jaw length', 13),
    intInput('jawOffset', 'Jaw offset', 8, 0, 500),
    intInput('teethLength', 'Teeth length', 8),
    intInput('teethOffset', 'Teeth offset', 5, 0, 500),
    intInput('lipsLength', 'Lips length', 5),
    intInput('lipsOffset', 'Lips offset', 3, 0, 500),
  ],
  compute: (bars, read) => {
    const jaw = lag(alligatorLine(bars, read.int('jawLength')), read.int('jawOffset'));
    const teeth = lag(alligatorLine(bars, read.int('teethLength')), read.int('teethOffset'));
    const lips = lag(alligatorLine(bars, read.int('lipsLength')), read.int('lipsOffset'));
    const upper = combine(jaw, teeth, (j, t) => Math.abs(j - t));
    const lower = combine(teeth, lips, (t, l) => -Math.abs(t - l));
    const growth = (values: Series) =>
      values.map((v, i) => {
        if (v === null) return null;
        const prev = i > 0 ? values[i - 1] : null;
        return prev === null || Math.abs(v) >= Math.abs(prev) ? GREEN : STRONG_RED;
      });
    return {
      plots: [plot('upper', 'Upper', upper, GREEN, { kind: 'histogram', colors: growth(upper) }), plot('lower', 'Lower', lower, STRONG_RED, { kind: 'histogram', colors: growth(lower) })],
      levels: [level('zero', 0)],
    };
  },
});

// Chaikin Volatility = 100 · (EMA(H − L) − EMA(H − L)[n]) / EMA(H − L)[n].
const chaikinVolatilityStudy = define({
  type: 'chaikin-volatility',
  title: 'Chaikin Volatility',
  shortTitle: 'CV',
  overlay: false,
  inputs: [intInput('emaLength', 'EMA length', 10), intInput('rocLength', 'ROC length', 10)],
  compute: (bars, read) => {
    const spread = ema(combine(highs(bars), lows(bars), (h, l) => h - l), read.int('emaLength'));
    return { plots: [plot('cv', 'CV', roc(spread, read.int('rocLength')), BLUE)], levels: [level('zero', 0)] };
  },
});

// Stochastic Momentum Index (Blau): 100 · EMA²(close − midpoint) / (½ · EMA²(highest − lowest)), with
// EMA² a double EMA of the smoothing length; signal = EMA(SMI).
const smiStudy = define({
  type: 'stochastic-momentum',
  title: 'Stochastic Momentum Index',
  shortTitle: 'SMI',
  overlay: false,
  inputs: [intInput('kLength', '%K length', 10), intInput('kSmoothing', '%K smoothing', 3), intInput('dLength', '%D length', 3)],
  compute: (bars, read) => {
    const n = read.int('kLength');
    const k = read.int('kSmoothing');
    const hh = highest(highs(bars), n);
    const ll = lowest(lows(bars), n);
    const relative = combine(closes(bars), combine(hh, ll, (h, l) => (h + l) / 2), (c, m) => c - m);
    const range = combine(hh, ll, (h, l) => h - l);
    const smi = combine(ema(ema(relative, k), k), ema(ema(range, k), k), (r, d) => (d === 0 ? NaN : (200 * r) / d));
    return { plots: [plot('smi', 'SMI', smi, BLUE), plot('signal', 'Signal', ema(smi, read.int('dLength')), ORANGE)], levels: [level('upper', 40), level('zero', 0), level('lower', -40)] };
  },
});

// Price Oscillator = 100 · (MA fast − MA slow) / MA slow.
const priceOscillatorStudy = define({
  type: 'price-oscillator',
  title: 'Price Oscillator',
  shortTitle: 'PO',
  overlay: false,
  inputs: [intInput('shortLength', 'Short length', 10), intInput('longLength', 'Long length', 21), selectInput('maType', 'Method', 'SMA', ['SMA', 'EMA']), sourceInput()],
  compute: (bars, read) => {
    const src = source(bars, read.source());
    const kind = read.select('maType');
    const values = combine(movingAverage(kind, src, read.int('shortLength')), movingAverage(kind, src, read.int('longLength')), (f, s) => (s === 0 ? NaN : (100 * (f - s)) / s));
    return { plots: [plot('po', 'PO', values, TEAL)], levels: [level('zero', 0)] };
  },
});

export const extendedStudies: readonly StudyDefinition[] = [
  demaStudy,
  temaStudy,
  smmaStudy,
  almaStudy,
  kamaStudy,
  zlemaStudy,
  mcginleyStudy,
  maCrossStudy,
  maRibbonStudy,
  chandelierStudy,
  chandeKrollStudy,
  alligatorStudy,
  priceChannelStudy,
  fiftyTwoWeekStudy,
  zigzagStudy,
  fractalsStudy,
  adStudy,
  chaikinOscStudy,
  eomStudy,
  forceIndexStudy,
  klingerStudy,
  nviStudy,
  pviStudy,
  pvtStudy,
  volumeStudy,
  relativeVolumeStudy,
  elderRayStudy,
  bopStudy,
  ttmSqueezeStudy,
  vortexStudy,
  choppinessStudy,
  massIndexStudy,
  ulcerStudy,
  rvgiStudy,
  rviStudy,
  connorsRsiStudy,
  fisherStudy,
  stcStudy,
  kstStudy,
  coppockStudy,
  dpoStudy,
  ppoStudy,
  tsiStudy,
  smiErgodicStudy,
  gatorStudy,
  chaikinVolatilityStudy,
  smiStudy,
  priceOscillatorStudy,
];
