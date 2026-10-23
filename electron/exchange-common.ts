import { createHash } from 'node:crypto';
import { timeframes, type Bar, type Timeframe } from '../shared/protocol';

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type Query = Record<string, string | number | boolean | undefined>;

export function queryString(query: Query): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) if (value !== undefined && value !== '') params.append(name, String(value));
  return params.toString();
}

export const num = (value: unknown): number => {
  if (value === '' || value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Exchanges identify orders by UUID or 64-bit id and positions by symbol; the terminal needs
// numeric tickets. 52 bits of a hash stay safe integers and collide with negligible probability.
export function ticketOf(id: string): number {
  return parseInt(createHash('sha256').update(id).digest('hex').slice(0, 13), 16) || 1;
}

export const decimalsOf = (step: number) => {
  const text = String(step);
  if (text.includes('e-')) return Number(text.split('e-')[1]);
  return text.includes('.') ? text.split('.')[1].length : 0;
};

export const roundTo = (value: number, step: number) => step > 0 ? Number((Math.round(value / step) * step).toFixed(decimalsOf(step))) : value;

export const formatQty = (value: number, step: number) => (Math.floor(value / step + 1e-9) * step).toFixed(decimalsOf(step));

export const formatPrice = (value: number, tickSize: number) => roundTo(value, tickSize).toFixed(decimalsOf(tickSize));

export interface KlinePlan {
  interval: string;
  seconds: number;
  sourceSeconds: number;
  isAggregated: boolean;
}

// Every non-native period divides a day, so epoch-aligned buckets match the exchange's UTC sessions.
export function planKlines(timeframe: Timeframe, intervals: Partial<Record<Timeframe, string>>, venue: string): KlinePlan {
  const target = timeframes.find((period) => period.label === timeframe);
  if (!target) throw new RangeError('Unknown chart timeframe');
  const native = intervals[timeframe];
  if (native) return { interval: native, seconds: target.seconds, sourceSeconds: target.seconds, isAggregated: false };
  const source = timeframes.filter((period) => intervals[period.label] && period.seconds < target.seconds && target.seconds % period.seconds === 0 && period.seconds < 86400).at(-1);
  if (!source) throw new RangeError(`${venue} has no data for ${timeframe}`);
  return { interval: intervals[source.label]!, seconds: target.seconds, sourceSeconds: source.seconds, isAggregated: true };
}

export const klineBar = (row: readonly string[]): Bar => ({
  time: Math.floor(num(row[0]) / 1000), open: num(row[1]), high: num(row[2]), low: num(row[3]), close: num(row[4]), volume: num(row[5]),
});

export function aggregateBars(bars: readonly Bar[], seconds: number): Bar[] {
  const ordered = [...new Map(bars.map((bar) => [bar.time, bar])).values()].sort((left, right) => left.time - right.time);
  const result: Bar[] = [];
  for (const bar of ordered) {
    const time = Math.floor(bar.time / seconds) * seconds;
    const previous = result.at(-1);
    if (!previous || previous.time !== time) result.push({ ...bar, time });
    else result[result.length - 1] = { time, open: previous.open, high: Math.max(previous.high, bar.high), low: Math.min(previous.low, bar.low), close: bar.close, volume: previous.volume + bar.volume };
  }
  return result;
}
