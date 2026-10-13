import type { Bar, Timeframe } from '../shared/protocol';
import { timeframes } from '../shared/protocol';

const nativePeriods = new Set<Timeframe>(['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN1']);

export interface WebTimeframePlan {
  readonly source: Timeframe;
  readonly seconds: number;
  readonly isAggregated: boolean;
}

export function timeframePlan(timeframe: Timeframe, serverOffsetSeconds = 0): WebTimeframePlan {
  const target = timeframes.find((period) => period.label === timeframe);
  if (!target) throw new RangeError('Unknown chart timeframe');
  if (nativePeriods.has(timeframe)) return { source: timeframe, seconds: target.seconds, isAggregated: false };
  const source = timeframes.filter((period) => nativePeriods.has(period.label) && period.seconds < target.seconds && target.seconds % period.seconds === 0 && serverOffsetSeconds % period.seconds === 0).at(-1);
  if (!source) throw new RangeError('No broker period can supply this timeframe');
  return { source: source.label, seconds: target.seconds, isAggregated: true };
}

export function timeframeStart(time: number, seconds: number, serverOffsetSeconds: number): number {
  if (!Number.isSafeInteger(time) || !Number.isSafeInteger(seconds) || seconds < 1 || !Number.isSafeInteger(serverOffsetSeconds)) throw new RangeError('Invalid chart alignment');
  return Math.floor((time + serverOffsetSeconds) / seconds) * seconds - serverOffsetSeconds;
}

export function aggregateRates(bars: readonly Bar[], timeframe: Timeframe, serverOffsetSeconds: number): Bar[] {
  const plan = timeframePlan(timeframe, serverOffsetSeconds);
  const ordered = [...new Map(bars.map((bar) => [bar.time, bar])).values()].sort((left, right) => left.time - right.time);
  if (!plan.isAggregated) return ordered;
  const result: Bar[] = [];
  for (const bar of ordered) {
    if (![bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) || !Number.isSafeInteger(bar.time) || bar.volume < 0 || bar.low > bar.high || bar.open < bar.low || bar.open > bar.high || bar.close < bar.low || bar.close > bar.high) throw new RangeError('Invalid source chart bar');
    const time = timeframeStart(bar.time, plan.seconds, serverOffsetSeconds);
    const previous = result.at(-1);
    if (!previous || previous.time !== time) result.push({ ...bar, time });
    else {
      const volume = previous.volume + bar.volume;
      if (!Number.isSafeInteger(volume)) throw new RangeError('Aggregated tick volume exceeds integer precision');
      result[result.length - 1] = { time, open: previous.open, high: Math.max(previous.high, bar.high), low: Math.min(previous.low, bar.low), close: bar.close, volume };
    }
  }
  return result;
}
