// Numeric helpers for the built-in studies. Every series helper returns an array aligned with its
// input (same length), holding null where the value is undefined: during warm-up, where an input
// value is missing, or where the maths would divide by zero. No helper returns NaN or Infinity.

import type { Bar } from '../types';

export type Series = (number | null)[];
export type ReadonlySeries = readonly (number | null)[];

export type PriceSource = 'Close' | 'Open' | 'High' | 'Low' | 'HL2' | 'HLC3' | 'OHLC4';

const isNum = (value: number | null | undefined): value is number => typeof value === 'number' && Number.isFinite(value);

// Replaces anything that is not a finite number with null.
export function clean(values: readonly (number | null | undefined)[]): Series {
  return values.map((value) => (isNum(value) ? value : null));
}

export function nulls(length: number): Series {
  return new Array<number | null>(length).fill(null);
}

export function volumeOf(bar: Bar): number {
  return isNum(bar.volume) ? bar.volume : 0;
}

export function sourceValue(bar: Bar, source: PriceSource): number {
  switch (source) {
    case 'Open':
      return bar.open;
    case 'High':
      return bar.high;
    case 'Low':
      return bar.low;
    case 'HL2':
      return (bar.high + bar.low) / 2;
    case 'HLC3':
      return (bar.high + bar.low + bar.close) / 3;
    case 'OHLC4':
      return (bar.open + bar.high + bar.low + bar.close) / 4;
    case 'Close':
    default:
      return bar.close;
  }
}

export function source(bars: readonly Bar[], which: PriceSource): Series {
  return clean(bars.map((bar) => sourceValue(bar, which)));
}

// Element-wise combination of two series; null wherever either side is null or the result is not
// finite.
export function combine(a: ReadonlySeries, b: ReadonlySeries, fn: (x: number, y: number) => number): Series {
  return a.map((x, i) => {
    const y = b[i];
    if (x === null || y === null || y === undefined) return null;
    const value = fn(x, y);
    return isNum(value) ? value : null;
  });
}

export function map(a: ReadonlySeries, fn: (x: number, index: number) => number | null): Series {
  return a.map((x, i) => {
    if (x === null) return null;
    const value = fn(x, i);
    return isNum(value) ? value : null;
  });
}

// Rolling sum over `length` values ending at each index; null unless all of them are present. Each
// window is summed afresh so that values leaving the window leave no floating-point residue.
export function sum(src: ReadonlySeries, length: number): Series {
  const n = Math.max(1, Math.floor(length));
  const out = nulls(src.length);
  for (let i = n - 1; i < src.length; i++) {
    let total = 0;
    let ok = true;
    for (let j = i - n + 1; j <= i; j++) {
      const x = src[j];
      if (x === null) {
        ok = false;
        break;
      }
      total += x;
    }
    if (ok) out[i] = total;
  }
  return out;
}

// Simple moving average.
export function sma(src: ReadonlySeries, length: number): Series {
  const n = Math.max(1, Math.floor(length));
  return sum(src, n).map((total) => (total === null ? null : total / n));
}

// Recursive average with smoothing factor `alpha`, seeded with the simple average of the first
// `length` consecutive values. After seeding, a missing input yields null and leaves the state as it
// was.
function recursiveAverage(src: ReadonlySeries, length: number, alpha: number): Series {
  const n = Math.max(1, Math.floor(length));
  const out = nulls(src.length);
  let prev: number | null = null;
  let run = 0;
  let runSum = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i];
    if (prev === null) {
      if (x === null) {
        run = 0;
        runSum = 0;
        continue;
      }
      run++;
      runSum += x;
      if (run === n) {
        prev = runSum / n;
        out[i] = prev;
      }
      continue;
    }
    if (x === null) continue;
    prev = alpha * x + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

// Exponential moving average, alpha = 2 / (length + 1), seeded with an SMA.
export function ema(src: ReadonlySeries, length: number): Series {
  const n = Math.max(1, Math.floor(length));
  return recursiveAverage(src, n, 2 / (n + 1));
}

// Wilder's moving average (RMA / SMMA), alpha = 1 / length, seeded with an SMA.
export function rma(src: ReadonlySeries, length: number): Series {
  const n = Math.max(1, Math.floor(length));
  return recursiveAverage(src, n, 1 / n);
}

// Linearly weighted moving average: the newest value has weight `length`, the oldest weight 1.
export function wma(src: ReadonlySeries, length: number): Series {
  const n = Math.max(1, Math.floor(length));
  const out = nulls(src.length);
  const denominator = (n * (n + 1)) / 2;
  for (let i = n - 1; i < src.length; i++) {
    let total = 0;
    let ok = true;
    for (let k = 0; k < n; k++) {
      const x = src[i - k];
      if (x === null) {
        ok = false;
        break;
      }
      total += x * (n - k);
    }
    if (ok) out[i] = total / denominator;
  }
  return out;
}

// Population standard deviation over a window (divides by `length`).
export function stdev(src: ReadonlySeries, length: number): Series {
  const n = Math.max(1, Math.floor(length));
  const mean = sma(src, n);
  return mean.map((m, i) => {
    if (m === null) return null;
    let squares = 0;
    for (let j = i - n + 1; j <= i; j++) {
      const d = (src[j] as number) - m;
      squares += d * d;
    }
    return Math.sqrt(squares / n);
  });
}

// Mean absolute deviation from the window mean.
export function meanDeviation(src: ReadonlySeries, length: number): Series {
  const n = Math.max(1, Math.floor(length));
  const mean = sma(src, n);
  return mean.map((m, i) => {
    if (m === null) return null;
    let total = 0;
    for (let j = i - n + 1; j <= i; j++) total += Math.abs((src[j] as number) - m);
    return total / n;
  });
}

function extreme(src: ReadonlySeries, length: number, pick: (a: number, b: number) => number): Series {
  const n = Math.max(1, Math.floor(length));
  const out = nulls(src.length);
  for (let i = n - 1; i < src.length; i++) {
    let best: number | null = null;
    for (let j = i - n + 1; j <= i; j++) {
      const x = src[j];
      if (x === null) {
        best = null;
        break;
      }
      best = best === null ? x : pick(best, x);
    }
    out[i] = best;
  }
  return out;
}

// Highest value of the last `length` values, including the current one.
export function highest(src: ReadonlySeries, length: number): Series {
  return extreme(src, length, Math.max);
}

// Lowest value of the last `length` values, including the current one.
export function lowest(src: ReadonlySeries, length: number): Series {
  return extreme(src, length, Math.min);
}

// Bars since the highest (or lowest) value within the last `length` values; the most recent bar wins
// ties.
export function barsSinceExtreme(src: ReadonlySeries, length: number, kind: 'highest' | 'lowest'): Series {
  const n = Math.max(1, Math.floor(length));
  const out = nulls(src.length);
  for (let i = n - 1; i < src.length; i++) {
    let best: number | null = null;
    let at = 0;
    let ok = true;
    for (let k = 0; k < n; k++) {
      const x = src[i - k];
      if (x === null) {
        ok = false;
        break;
      }
      if (best === null || (kind === 'highest' ? x > best : x < best)) {
        best = x;
        at = k;
      }
    }
    if (ok) out[i] = at;
  }
  return out;
}

// Difference to the value `length` bars back.
export function change(src: ReadonlySeries, length = 1): Series {
  const n = Math.max(1, Math.floor(length));
  return src.map((x, i) => {
    if (i < n || x === null) return null;
    const prev = src[i - n];
    return prev === null ? null : x - prev;
  });
}

// Value `length` bars back.
export function lag(src: ReadonlySeries, length = 1): Series {
  const n = Math.max(0, Math.floor(length));
  return src.map((_, i) => (i < n ? null : src[i - n]));
}

// True range. The first bar, which has no previous close, uses high − low.
export function trueRange(bars: readonly Bar[]): Series {
  return clean(
    bars.map((bar, i) => {
      if (i === 0) return bar.high - bar.low;
      const prevClose = bars[i - 1].close;
      return Math.max(bar.high - bar.low, Math.abs(bar.high - prevClose), Math.abs(bar.low - prevClose));
    }),
  );
}

// Least-squares line through the last `length` values, evaluated at the current bar.
export function linreg(src: ReadonlySeries, length: number): Series {
  const n = Math.max(1, Math.floor(length));
  const out = nulls(src.length);
  if (n === 1) return src.map((x) => x);
  // x runs 0 (oldest) .. n − 1 (current).
  const sumX = ((n - 1) * n) / 2;
  const sumXX = ((n - 1) * n * (2 * n - 1)) / 6;
  const denominator = n * sumXX - sumX * sumX;
  for (let i = n - 1; i < src.length; i++) {
    let sumY = 0;
    let sumXY = 0;
    let ok = true;
    for (let x = 0; x < n; x++) {
      const y = src[i - n + 1 + x];
      if (y === null) {
        ok = false;
        break;
      }
      sumY += y;
      sumXY += x * y;
    }
    if (!ok) continue;
    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;
    const value = intercept + slope * (n - 1);
    out[i] = isNum(value) ? value : null;
  }
  return out;
}

// Safe division: null when either side is missing or the divisor is zero.
export function divide(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  const value = numerator / denominator;
  return isNum(value) ? value : null;
}

// Index of the UTC calendar day containing `time` (epoch ms): days since 1970-01-01.
export function utcDay(time: number): number {
  return Math.floor(time / 86_400_000);
}
