// Bid bars a backtest fills orders from, with times in chart milliseconds (the broker's clock
// written as UTC). A bar ends where the next one opens, capped at its interval, as Meridian's
// replay reveals them, so the simulation sees a bar exactly when the charts do.

export interface SimBar {
  readonly low: number;
  readonly time: number;
  readonly high: number;
  readonly open: number;
  readonly close: number;
}

export interface Series {
  readonly interval: number;
  readonly bars: readonly SimBar[];
}

export function barEnd(series: Series, index: number): number {
  const { bars, interval } = series;
  return Math.min(bars[index + 1]?.time ?? Infinity, bars[index].time + interval);
}

// Index of the first bar opening after `time`.
function firstAfter(bars: readonly SimBar[], time: number): number {
  let low = 0;
  let high = bars.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (bars[middle].time <= time) low = middle + 1;
    else high = middle;
  }
  return low;
}

// The bars that ended after `from` and by `to`, oldest first.
export function barsEnding(series: Series, from: number, to: number): SimBar[] {
  const result: SimBar[] = [];
  const { bars, interval } = series;
  for (let index = Math.max(0, firstAfter(bars, from - interval) - 1); index < bars.length && bars[index].time < to; index++) {
    const end = barEnd(series, index);
    if (end > from && end <= to) result.push(bars[index]);
  }
  return result;
}

// The close of the last bar that had ended by `time`: the bid the charts show then.
export function bidAt(series: Series, time: number): number | null {
  for (let index = firstAfter(series.bars, time) - 1; index >= 0; index--) {
    if (barEnd(series, index) <= time) return series.bars[index].close;
  }
  return null;
}

// The order prices are assumed to have traded in within a bar: a rising bar went down first, a
// falling bar up first, which is the usual convention when only OHLC is known.
export function barPath(bar: SimBar): readonly number[] {
  return bar.close >= bar.open ? [bar.open, bar.low, bar.high, bar.close] : [bar.open, bar.high, bar.low, bar.close];
}

// Whether the series reaches back to `time` with a bar open by then.
export function covers(series: Series, time: number): boolean {
  return series.bars.length > 0 && series.bars[0].time <= time;
}
