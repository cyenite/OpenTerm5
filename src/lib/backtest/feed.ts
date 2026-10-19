import { timeframes, type Timeframe } from '../../../shared/protocol';
import { terminal } from '../session';
import { covers, type Series } from './series';

// The bars a backtest fills orders from. MetaTrader serves about the latest 20 000 bars of each
// timeframe, so M1 reaches back roughly two weeks and H1 about three years: a backtest uses the
// finest timeframe that reaches back to its clock, never coarser than the replay's step unless
// nothing finer reaches that far.

const MAX_BARS = 20_000;

const fillTimeframes: readonly Timeframe[] = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];

const cache = new Map<string, Promise<Series>>();

const secondsOf = (timeframe: Timeframe) => timeframes.find((candidate) => candidate.label === timeframe)!.seconds;

function load(symbol: string, timeframe: Timeframe): Promise<Series> {
  const key = `${symbol},${timeframe}`;
  let series = cache.get(key);
  if (!series) {
    series = terminal.request('rates.get', { symbol, timeframe, count: MAX_BARS }).then((bars) => ({
      interval: secondsOf(timeframe) * 1000,
      bars: bars.map((bar) => ({ time: bar.time * 1000, open: bar.open, high: bar.high, low: bar.low, close: bar.close })).sort((left, right) => left.time - right.time),
    }));
    // A failed request is asked again next time rather than remembered.
    series.catch(() => cache.delete(key));
    cache.set(key, series);
  }
  return series;
}

// Another account is another broker's prices.
export function clearFeed(): void {
  cache.clear();
}

// The finest series of the symbol that covers `time`, among timeframes no longer than `stepSeconds`;
// the coarsest of them when none reaches that far back.
export async function feedSeries(symbol: string, time: number, stepSeconds: number): Promise<Series> {
  const candidates = fillTimeframes.filter((timeframe) => secondsOf(timeframe) <= Math.max(60, stepSeconds));
  let fallback: Series | null = null;
  let failure: unknown = null;
  for (const timeframe of candidates) {
    try {
      const series = await load(symbol, timeframe);
      if (covers(series, time)) return series;
      fallback = series.bars.length ? series : fallback;
    } catch (error) {
      failure = error;
    }
  }
  if (fallback) return fallback;
  throw failure instanceof Error ? failure : new Error(`${symbol} has no history to backtest on.`);
}

export function feedTimeframeOf(series: Series): Timeframe | undefined {
  return fillTimeframes.find((timeframe) => secondsOf(timeframe) * 1000 === series.interval);
}
