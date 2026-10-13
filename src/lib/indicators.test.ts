import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ichimoku, parabolicSar, adxWilder, atr, cci, mfi, momentum, obv, roc, stochastic, williams, bollinger, ema, macd, rsi, sma } from './indicators.ts';

const candles = (closes: number[]) => closes.map((close, index) => ({ time: index, close }));
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test('sma averages a sliding window', () => {
  assert.deepEqual(sma(candles([1, 2, 3, 4, 5]), 3), [
    { time: 2, value: 2 },
    { time: 3, value: 3 },
    { time: 4, value: 4 },
  ]);
});

test('ema seeds with the simple average then smooths', () => {
  const points = ema(candles([1, 2, 3, 4]), 3);
  assert.equal(points.length, 2);
  near(points[0].value, 2);
  near(points[1].value, 4 * 0.5 + 2 * 0.5);
});

test('bollinger bands are symmetric around the middle line', () => {
  const { upper, middle, lower } = bollinger(candles([2, 4, 4, 4, 5, 5, 7, 9]), 8, 2);
  near(middle[0].value, 5);
  near(upper[0].value, 9);
  near(lower[0].value, 1);
});

test('rsi is 100 for a monotonic rise and 0 for a fall', () => {
  near(rsi(candles([1, 2, 3, 4, 5, 6]), 3).at(-1)!.value, 100);
  near(rsi(candles([6, 5, 4, 3, 2, 1]), 3).at(-1)!.value, 0);
});

test('macd histogram is main minus signal', () => {
  const closes = Array.from({ length: 60 }, (_, index) => 100 + Math.sin(index / 4) * 5);
  const result = macd(candles(closes), 12, 26, 9);
  const signal = new Map(result.signal.map((point) => [point.time, point.value]));
  const main = new Map(result.main.map((point) => [point.time, point.value]));
  assert.ok(result.histogram.length > 0);
  for (const point of result.histogram) {
    near(point.value, main.get(point.time)! - signal.get(point.time)!);
  }
});

const ranges = (closes: number[], volumes: number[] = []) => closes.map((close, index) => ({ time: index, close, high: close + 1, low: close - 1, volume: volumes[index] ?? 10 }));

test('ATR includes overnight gaps and requires a previous close plus a full window', () => {
  const bars = [{ time: 0, high: 10, low: 8, close: 9 }, { time: 1, high: 15, low: 14, close: 14 }, { time: 2, high: 16, low: 12, close: 15 }, { time: 3, high: 18, low: 16, close: 17 }];
  assert.deepEqual(atr(bars.slice(0, 2), 2), []);
  assert.deepEqual(atr(bars, 2), [{ time: 2, value: 5 }, { time: 3, value: 3.5 }]);
});

test('Stochastic slowing combines range numerators before forming %K and SMA %D', () => {
  const bars = [{ time: 0, high: 10, low: 0, close: 5 }, { time: 1, high: 20, low: 0, close: 20 }, { time: 2, high: 30, low: 10, close: 20 }];
  const result = stochastic(bars, 1, 2, 2);
  near(result.main[0].value, 100 * 25 / 30);
  near(result.main[1].value, 75);
  assert.equal(result.signal[0].time, 2);
  near(result.signal[0].value, (100 * 25 / 30 + 75) / 2);
  near(stochastic(ranges([5, 5, 5]), 2, 1, 1).main[0].value, 50);
});

test('CCI uses typical price divided by 0.015 mean absolute deviation', () => {
  const bars = ranges([1, 2, 3]);
  near(cci(bars, 3)[0].value, 100);
  near(cci(ranges([5, 5, 5]), 3)[0].value, 0);
});

test('Momentum is a price ratio, ROC centers it on zero, and zero baselines have no fabricated value', () => {
  assert.deepEqual(momentum(candles([2, 3, 4]), 2), [{ time: 2, value: 200 }]);
  assert.deepEqual(roc(candles([2, 3, 4]), 2), [{ time: 2, value: 100 }]);
  assert.deepEqual(momentum(candles([0, 2, 4]), 1), [{ time: 2, value: 200 }]);
});

test('Williams %R positions the close in its high-low range', () => {
  const bars = [{ time: 0, high: 10, low: 0, close: 5 }, { time: 1, high: 10, low: 0, close: 2 }];
  near(williams(bars, 2)[0].value, -80);
});

test('Wilder ADX seeds only after directional movement and DX warmup', () => {
  const result = adxWilder(ranges([2, 3, 4, 5, 6]), 2);
  assert.equal(result.plus[0].time, 2);
  near(result.plus[0].value, 50);
  near(result.minus[0].value, 0);
  assert.equal(result.main[0].time, 3);
  near(result.main[0].value, 100);
  const tied = adxWilder([{ time: 0, high: 3, low: 1, close: 2 }, { time: 1, high: 4, low: 0, close: 2 }], 1);
  near(tied.plus[0].value, 0);
  near(tied.minus[0].value, 0);
  near(tied.main[0].value, 0);
});

test('OBV adds and subtracts volume only when the closing price changes', () => {
  assert.deepEqual(obv(ranges([1, 2, 1, 1], [10, 20, 5, 100])).map((point) => point.value), [10, 30, 25, 25]);
});

test('MFI classifies money flow by typical price direction and handles neutral flow', () => {
  const result = mfi(ranges([1, 2, 1, 3], [10, 10, 20, 10]), 2);
  near(result[0].value, 50);
  near(result[1].value, 60);
  near(mfi(ranges([5, 5, 5]), 2)[0].value, 50);
});

test('completed indicator values do not change when future bars are appended', () => {
  const bars = ranges([5, 8, 6, 9, 5, 7, 4, 10, 3, 11]);
  const computations = [
    (data: typeof bars) => atr(data, 2), (data: typeof bars) => cci(data, 3),
    (data: typeof bars) => momentum(data, 2), (data: typeof bars) => roc(data, 2),
    (data: typeof bars) => williams(data, 3), (data: typeof bars) => obv(data),
    (data: typeof bars) => mfi(data, 3), (data: typeof bars) => adxWilder(data, 2).main,
    (data: typeof bars) => stochastic(data, 2, 2, 2).signal,
  ];
  for (const compute of computations) {
    assert.deepEqual(compute(bars).filter((point) => point.time < 6), compute(bars.slice(0, 6)));
  }
});

test('flat and invalid-period inputs yield finite neutral values after actual warmup', () => {
  near(rsi(candles([4, 4, 4, 4]), 2)[0].value, 50);
  const flat = ranges([4, 4, 4, 4]).map((bar) => ({ ...bar, high: 4, low: 4, volume: 0 }));
  near(stochastic(flat, 2, 1, 1).main[0].value, 50);
  near(williams(flat, 2)[0].value, -50);
  near(adxWilder(flat, 2).main[0].value, 0);
  for (const period of [0, -1, 1.5, NaN]) {
    assert.deepEqual(sma(candles([1, 2]), period), []);
    assert.deepEqual(ema(candles([1, 2]), period), []);
    assert.deepEqual(atr(flat, period), []);
    assert.deepEqual(cci(flat, period), []);
    assert.deepEqual(mfi(flat, period), []);
  }
});

test('Wilder ADX averages opposing direction changes and smooths its strength separately', () => {
  const result = adxWilder(ranges([2, 3, 2, 4]), 2);
  near(result.plus[0].value, 25);
  near(result.minus[0].value, 25);
  near(result.plus[1].value, 50);
  near(result.minus[1].value, 10);
  near(result.main[0].value, 100 / 3);
});

test('Ichimoku uses high-low midpoints and projects by candle index, not calendar duration', () => {
  const bars = ranges([2, 4, 6, 8, 10]).map((bar, index) => ({ ...bar, time: [100, 200, 1000, 1100, 1200][index] }));
  const result = ichimoku(bars, 2, 3, 4);
  assert.deepEqual(result.tenkan[0], { time: 200, value: 3 });
  assert.deepEqual(result.kijun[0], { time: 1000, value: 4 });
  assert.deepEqual(result.spanA[0], { index: 5, value: 4.5 });
  assert.deepEqual(result.spanB[0], { index: 6, value: 5 });
  assert.deepEqual(result.chikou, [{ time: 100, value: 8 }, { time: 200, value: 10 }]);
  assert.ok(result.spanA.at(-1)!.index > bars.length - 1);
  assert.deepEqual(ichimoku(bars, 0, 3, 4), { tenkan: [], kijun: [], chikou: [], spanA: [], spanB: [] });
});

test('Ichimoku forward span values remain fixed when later bars are appended', () => {
  const bars = ranges([2, 3, 4, 3, 1, 7, 8, 5, 9]);
  const first = ichimoku(bars.slice(0, 5), 2, 3, 4);
  const second = ichimoku(bars, 2, 3, 4);
  assert.deepEqual(second.spanA.filter((point) => point.index < 8), first.spanA);
  assert.deepEqual(second.spanB.filter((point) => point.index < 8), first.spanB);
});

test('Parabolic SAR clamps previous extremes, accelerates, and resets on reversal', () => {
  const result = parabolicSar(ranges([2, 3, 4, 5, 0, -1, 7]), 0.02, 0.2);
  assert.equal(result[0].time, 1);
  near(result[0].value, 1);
  near(result[1].value, 1);
  near(result[2].value, 1.16);
  near(result[3].value, 6);
  near(result[4].value, 6);
  near(result[5].value, -2);
});

test('Parabolic SAR never revises prior points using future prices and rejects invalid factors', () => {
  const bars = ranges([2, 3, 4, 2, 1, 0, 4, 5]);
  assert.deepEqual(parabolicSar(bars, 0.02, 0.2).filter((point) => point.time < 5), parabolicSar(bars.slice(0, 5), 0.02, 0.2));
  for (const [factor, maximum] of [[0, 0.2], [0.2, 0.02], [NaN, 0.2], [0.02, 2]]) assert.deepEqual(parabolicSar(bars, factor, maximum), []);
});
