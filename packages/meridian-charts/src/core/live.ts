import type { Bar } from '../types';
import { timeUnits } from './timeframes';

export interface LivePrice {
  readonly time: number;
  readonly price: number;
}

// Calendar months outlast a nominal month interval; bar times are UTC-based.
function periodEnd(time: number, interval: number): number {
  if (interval < 28 * timeUnits.DAY) return time + interval;
  const start = new Date(time);
  return Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1);
}

// Moves the bar in progress to a quote inside its period. A quote from a later period is left to
// the bar source, which knows where the next bar opens (sessions, weekly and monthly alignment).
export function foldPrice(bar: Bar, quote: LivePrice | null, interval: number): Bar | null {
  if (!quote || !(quote.price > 0) || quote.time < bar.time || quote.time >= periodEnd(bar.time, interval)) return null;
  if (bar.close === quote.price && bar.high >= quote.price && bar.low <= quote.price) return null;
  return { ...bar, high: Math.max(bar.high, quote.price), low: Math.min(bar.low, quote.price), close: quote.price };
}

// Applies a bar from the source, then the latest quote: polled or streamed bars can trail the
// quote stream, and the quote is the fresher price for the bar in progress.
export function mergeLiveBar(bars: Bar[], bar: Bar, quote: LivePrice | null, interval: number): 'replaced' | 'appended' | null {
  const last = bars[bars.length - 1];
  if (last && bar.time < last.time) return null;
  const merged = foldPrice(bar, quote, interval) ?? bar;
  if (last && bar.time === last.time) {
    bars[bars.length - 1] = merged;
    return 'replaced';
  }
  bars.push(merged);
  return 'appended';
}
