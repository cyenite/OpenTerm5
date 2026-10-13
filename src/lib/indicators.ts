export interface Point {
  time: number;
  value: number;
}

export interface Candle {
  time: number;
  close: number;
}

export const indicatorKinds = [
  { key: 'ma', label: 'Moving Average', isOverlay: true, defaults: { period: 14, isExponential: false } },
  { key: 'bands', label: 'Bollinger Bands', isOverlay: true, defaults: { period: 20, deviations: 2 } },
  { key: 'rsi', label: 'Relative Strength Index', isOverlay: false, defaults: { period: 14 } },
  { key: 'ichimoku', label: 'Ichimoku Kinko Hyo', isOverlay: true, defaults: { tenkan: 9, kijun: 26, senkou: 52 } },
  { key: 'sar', label: 'Parabolic SAR', isOverlay: true, defaults: { acceleration: 0.02, maxAcceleration: 0.2 } },
  { key: 'atr', label: 'Average True Range', isOverlay: false, defaults: { period: 14 } },
  { key: 'stochastic', label: 'Stochastic Oscillator', isOverlay: false, defaults: { period: 5, slowing: 3, signal: 3 } },
  { key: 'cci', label: 'Commodity Channel Index', isOverlay: false, defaults: { period: 14 } },
  { key: 'momentum', label: 'Momentum', isOverlay: false, defaults: { period: 14 } },
  { key: 'roc', label: 'Rate of Change', isOverlay: false, defaults: { period: 14 } },
  { key: 'wpr', label: 'Williams %R', isOverlay: false, defaults: { period: 14 } },
  { key: 'adxWilder', label: 'ADX Wilder', isOverlay: false, defaults: { period: 14 } },
  { key: 'obv', label: 'On Balance Volume', isOverlay: false, defaults: {} },
  { key: 'mfi', label: 'Money Flow Index', isOverlay: false, defaults: { period: 14 } },
  { key: 'macd', label: 'MACD', isOverlay: false, defaults: { fast: 12, slow: 26, signal: 9 } },
] as const;

export type IndicatorKey = (typeof indicatorKinds)[number]['key'];

export interface IndicatorConfig {
  id: string;
  kind: IndicatorKey;
  params: Record<string, number | boolean>;
}

export function indicatorKind(key: IndicatorKey) {
  return indicatorKinds.find((kind) => kind.key === key)!;
}

export function describeIndicator(indicator: IndicatorConfig): string {
  const kind = indicatorKind(indicator.kind);
  const values = Object.entries(indicator.params)
    .filter(([, value]) => typeof value === 'number')
    .map(([, value]) => value);
  const prefix = indicator.kind === 'ma' && indicator.params.isExponential ? 'EMA' : kind.label;
  return values.length ? `${prefix}(${values.join(',')})` : prefix;
}

export function sma(candles: Candle[], period: number): Point[] {
  if (!isPeriod(period)) return [];
  const result: Point[] = [];
  let sum = 0;
  candles.forEach((candle, index) => {
    sum += candle.close;
    if (index >= period) {
      sum -= candles[index - period].close;
    }
    if (index >= period - 1) {
      result.push({ time: candle.time, value: sum / period });
    }
  });
  return result;
}

export function ema(candles: Candle[], period: number): Point[] {
  if (!isPeriod(period) || candles.length < period) {
    return [];
  }
  const factor = 2 / (period + 1);
  const seed = candles.slice(0, period).reduce((total, candle) => total + candle.close, 0) / period;
  const result: Point[] = [{ time: candles[period - 1].time, value: seed }];
  for (let index = period; index < candles.length; index++) {
    const previous = result[result.length - 1].value;
    result.push({ time: candles[index].time, value: candles[index].close * factor + previous * (1 - factor) });
  }
  return result;
}

export function bollinger(candles: Candle[], period: number, deviations: number): { upper: Point[]; middle: Point[]; lower: Point[] } {
  if (!isPeriod(period) || !Number.isFinite(deviations) || deviations < 0) return { upper: [], middle: [], lower: [] };
  const upper: Point[] = [];
  const middle: Point[] = [];
  const lower: Point[] = [];
  for (let index = period - 1; index < candles.length; index++) {
    const window = candles.slice(index - period + 1, index + 1);
    const mean = window.reduce((total, candle) => total + candle.close, 0) / period;
    const variance = window.reduce((total, candle) => total + (candle.close - mean) ** 2, 0) / period;
    const spread = Math.sqrt(variance) * deviations;
    const time = candles[index].time;
    middle.push({ time, value: mean });
    upper.push({ time, value: mean + spread });
    lower.push({ time, value: mean - spread });
  }
  return { upper, middle, lower };
}

export function rsi(candles: Candle[], period: number): Point[] {
  if (!isPeriod(period) || candles.length <= period) {
    return [];
  }
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index++) {
    const change = candles[index].close - candles[index - 1].close;
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  gain /= period;
  loss /= period;
  const value = (up: number, down: number) => (up + down === 0 ? 50 : down === 0 ? 100 : 100 - 100 / (1 + up / down));
  const result: Point[] = [{ time: candles[period].time, value: value(gain, loss) }];
  for (let index = period + 1; index < candles.length; index++) {
    const change = candles[index].close - candles[index - 1].close;
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
    result.push({ time: candles[index].time, value: value(gain, loss) });
  }
  return result;
}

export function macd(candles: Candle[], fast: number, slow: number, signal: number): { main: Point[]; signal: Point[]; histogram: Point[] } {
  const fastLine = new Map(ema(candles, fast).map((point) => [point.time, point.value]));
  const main = ema(candles, slow)
    .filter((point) => fastLine.has(point.time))
    .map((point) => ({ time: point.time, value: fastLine.get(point.time)! - point.value }));
  // MT5's MACD smooths the signal line with a simple average, not an EMA.
  const signalLine = sma(main.map((point) => ({ time: point.time, close: point.value })), signal);
  const signalByTime = new Map(signalLine.map((point) => [point.time, point.value]));
  const histogram = main
    .filter((point) => signalByTime.has(point.time))
    .map((point) => ({ time: point.time, value: point.value - signalByTime.get(point.time)! }));
  return { main, signal: signalLine, histogram };
}

export interface RangeCandle extends Candle {
  low: number;
  high: number;
}

export interface VolumeCandle extends RangeCandle {
  volume: number;
}

function isPeriod(period: number): boolean {
  return Number.isInteger(period) && period > 0;
}

function typicalPrice(candle: RangeCandle): number {
  return (candle.high + candle.low + candle.close) / 3;
}

function trueRange(candle: RangeCandle, previous: RangeCandle): number {
  return Math.max(candle.high - candle.low, Math.abs(candle.high - previous.close), Math.abs(candle.low - previous.close));
}

function smoothed(points: Point[], period: number): Point[] {
  if (!isPeriod(period) || points.length < period) return [];
  let value = points.slice(0, period).reduce((sum, point) => sum + point.value, 0) / period;
  const result = [{ time: points[period - 1].time, value }];
  for (let index = period; index < points.length; index++) {
    value = (value * (period - 1) + points[index].value) / period;
    result.push({ time: points[index].time, value });
  }
  return result;
}

export function atr(candles: RangeCandle[], period: number): Point[] {
  return sma(candles.slice(1).map((candle, index) => ({ time: candle.time, close: trueRange(candle, candles[index]) })), period);
}

export function stochastic(candles: RangeCandle[], period: number, slowing: number, signal: number): { main: Point[]; signal: Point[] } {
  if (![period, slowing, signal].every(isPeriod)) return { main: [], signal: [] };
  const ranges: { time: number; numerator: number; denominator: number }[] = [];
  for (let index = period - 1; index < candles.length; index++) {
    const window = candles.slice(index - period + 1, index + 1);
    const low = Math.min(...window.map((candle) => candle.low));
    const high = Math.max(...window.map((candle) => candle.high));
    ranges.push({ time: candles[index].time, numerator: candles[index].close - low, denominator: high - low });
  }
  const main: Point[] = [];
  for (let index = slowing - 1; index < ranges.length; index++) {
    const window = ranges.slice(index - slowing + 1, index + 1);
    const numerator = window.reduce((sum, range) => sum + range.numerator, 0);
    const denominator = window.reduce((sum, range) => sum + range.denominator, 0);
    main.push({ time: ranges[index].time, value: denominator === 0 ? 50 : 100 * numerator / denominator });
  }
  return { main, signal: sma(main.map((point) => ({ time: point.time, close: point.value })), signal) };
}

export function cci(candles: RangeCandle[], period: number): Point[] {
  if (!isPeriod(period)) return [];
  const result: Point[] = [];
  const prices = candles.map(typicalPrice);
  for (let index = period - 1; index < candles.length; index++) {
    const window = prices.slice(index - period + 1, index + 1);
    const mean = window.reduce((sum, price) => sum + price, 0) / period;
    const deviation = window.reduce((sum, price) => sum + Math.abs(price - mean), 0) / period;
    result.push({ time: candles[index].time, value: deviation === 0 ? 0 : (prices[index] - mean) / (0.015 * deviation) });
  }
  return result;
}

export function momentum(candles: Candle[], period: number): Point[] {
  if (!isPeriod(period)) return [];
  const result: Point[] = [];
  for (let index = period; index < candles.length; index++) {
    const previous = candles[index - period].close;
    if (previous !== 0) result.push({ time: candles[index].time, value: candles[index].close / previous * 100 });
  }
  return result;
}

export function roc(candles: Candle[], period: number): Point[] {
  return momentum(candles, period).map((point) => ({ ...point, value: point.value - 100 }));
}

export function williams(candles: RangeCandle[], period: number): Point[] {
  return stochastic(candles, period, 1, 1).main.map((point) => ({ ...point, value: point.value - 100 }));
}

export function adxWilder(candles: RangeCandle[], period: number): { main: Point[]; plus: Point[]; minus: Point[] } {
  if (!isPeriod(period)) return { main: [], plus: [], minus: [] };
  const ranges: Point[] = [];
  const positives: Point[] = [];
  const negatives: Point[] = [];
  for (let index = 1; index < candles.length; index++) {
    const candle = candles[index];
    const previous = candles[index - 1];
    const up = candle.high - previous.high;
    const down = previous.low - candle.low;
    ranges.push({ time: candle.time, value: trueRange(candle, previous) });
    positives.push({ time: candle.time, value: up > down && up > 0 ? up : 0 });
    negatives.push({ time: candle.time, value: down > up && down > 0 ? down : 0 });
  }
  const tr = smoothed(ranges, period);
  const positive = smoothed(positives, period);
  const negative = smoothed(negatives, period);
  const plus = positive.map((point, index) => ({ time: point.time, value: tr[index].value === 0 ? 0 : 100 * point.value / tr[index].value }));
  const minus = negative.map((point, index) => ({ time: point.time, value: tr[index].value === 0 ? 0 : 100 * point.value / tr[index].value }));
  const dx = plus.map((point, index) => {
    const denominator = point.value + minus[index].value;
    return { time: point.time, value: denominator === 0 ? 0 : 100 * Math.abs(point.value - minus[index].value) / denominator };
  });
  return { main: smoothed(dx, period), plus, minus };
}

export function obv(candles: VolumeCandle[]): Point[] {
  if (!candles.length) return [];
  let value = candles[0].volume;
  return candles.map((candle, index) => {
    if (index > 0) value += Math.sign(candle.close - candles[index - 1].close) * candle.volume;
    return { time: candle.time, value };
  });
}

export function mfi(candles: VolumeCandle[], period: number): Point[] {
  if (!isPeriod(period)) return [];
  const result: Point[] = [];
  for (let index = period; index < candles.length; index++) {
    let positive = 0;
    let negative = 0;
    let isValid = true;
    for (let cursor = index - period + 1; cursor <= index; cursor++) {
      const candle = candles[cursor];
      const price = typicalPrice(candle);
      const previous = typicalPrice(candles[cursor - 1]);
      if (price < 0 || previous < 0) { isValid = false; break; }
      const flow = price * candle.volume;
      if (price > previous) positive += flow;
      if (price < previous) negative += flow;
    }
    const total = positive + negative;
    if (isValid) result.push({ time: candles[index].time, value: total === 0 ? 50 : 100 * positive / total });
  }
  return result;
}

export interface ShiftedPoint {
  index: number;
  value: number;
}

export interface IchimokuResult {
  tenkan: Point[];
  kijun: Point[];
  chikou: Point[];
  spanA: ShiftedPoint[];
  spanB: ShiftedPoint[];
}

export function ichimoku(candles: RangeCandle[], tenkan: number, kijun: number, senkou: number): IchimokuResult {
  const result: IchimokuResult = { tenkan: [], kijun: [], chikou: [], spanA: [], spanB: [] };
  if (![tenkan, kijun, senkou].every(isPeriod)) return result;
  const midpoint = (index: number, period: number): number => {
    const window = candles.slice(index - period + 1, index + 1);
    return (Math.max(...window.map((candle) => candle.high)) + Math.min(...window.map((candle) => candle.low))) / 2;
  };
  for (let index = 0; index < candles.length; index++) {
    if (index >= tenkan - 1) result.tenkan.push({ time: candles[index].time, value: midpoint(index, tenkan) });
    if (index >= kijun - 1) result.kijun.push({ time: candles[index].time, value: midpoint(index, kijun) });
    if (index >= Math.max(tenkan, kijun) - 1) result.spanA.push({ index: index + kijun, value: (midpoint(index, tenkan) + midpoint(index, kijun)) / 2 });
    if (index >= senkou - 1) result.spanB.push({ index: index + kijun, value: midpoint(index, senkou) });
    if (index >= kijun) result.chikou.push({ time: candles[index - kijun].time, value: candles[index].close });
  }
  return result;
}

export function parabolicSar(candles: RangeCandle[], acceleration: number, maxAcceleration: number): Point[] {
  if (candles.length < 2 || !Number.isFinite(acceleration) || !Number.isFinite(maxAcceleration) || acceleration <= 0 || maxAcceleration < acceleration || maxAcceleration > 1) return [];
  let isRising = candles[1].close >= candles[0].close;
  let factor = acceleration;
  let extreme = isRising ? Math.max(candles[0].high, candles[1].high) : Math.min(candles[0].low, candles[1].low);
  let value = isRising ? Math.min(candles[0].low, candles[1].low) : Math.max(candles[0].high, candles[1].high);
  const result = [{ time: candles[1].time, value }];
  for (let index = 2; index < candles.length; index++) {
    const candle = candles[index];
    const previous = candles[index - 1];
    const earlier = candles[index - 2];
    value += factor * (extreme - value);
    if (isRising) {
      value = Math.min(value, previous.low, earlier.low);
      if (candle.low < value) {
        isRising = false;
        value = Math.max(extreme, candle.high);
        extreme = candle.low;
        factor = acceleration;
      } else if (candle.high > extreme) {
        extreme = candle.high;
        factor = Math.min(maxAcceleration, factor + acceleration);
      }
    } else {
      value = Math.max(value, previous.high, earlier.high);
      if (candle.high > value) {
        isRising = true;
        value = Math.min(extreme, candle.low);
        extreme = candle.high;
        factor = acceleration;
      } else if (candle.low < extreme) {
        extreme = candle.low;
        factor = Math.min(maxAcceleration, factor + acceleration);
      }
    }
    result.push({ time: candle.time, value });
  }
  return result;
}
