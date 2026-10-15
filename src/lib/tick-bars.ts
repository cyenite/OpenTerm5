import type { Bar } from '@meridian/charts';

// Seconds bars built from quotes. MetaTrader's web protocol has no tick history, so each
// symbol's one-second bars start when the terminal first receives its quotes. Longer seconds
// timeframes are assembled from them. Bars use the bid, like MetaTrader charts, and the volume
// is the number of ticks.

export interface SecondsSource {
  bars(symbol: string, seconds: number): Bar[];
  current(symbol: string, seconds: number): Bar | null;
  onBar(listener: (symbol: string) => void): () => void;
}

const bucketOf = (time: number, seconds: number) => Math.floor(time / (seconds * 1000)) * seconds * 1000;

function merge(into: Bar | undefined, bar: Bar, time: number): Bar {
  if (!into) return { ...bar, time };
  return { time, open: into.open, high: Math.max(into.high, bar.high), low: Math.min(into.low, bar.low), close: bar.close, volume: (into.volume ?? 0) + (bar.volume ?? 0) };
}

export function aggregate(bars: readonly Bar[], seconds: number): Bar[] {
  if (seconds === 1) return bars.map((bar) => ({ ...bar }));
  const result: Bar[] = [];
  for (const bar of bars) {
    const time = bucketOf(bar.time, seconds);
    const last = result.at(-1);
    if (last?.time === time) result[result.length - 1] = merge(last, bar, time);
    else result.push(merge(undefined, bar, time));
  }
  return result;
}

export class TickBarBook implements SecondsSource {
  private readonly series = new Map<string, Bar[]>();
  private readonly listeners = new Set<(symbol: string) => void>();

  // Keeps the latest `capacity` one-second bars per symbol: four hours by default.
  constructor(private readonly capacity = 4 * 3600) {}

  add(symbol: string, time: number, price: number): void {
    if (!Number.isFinite(time) || !Number.isFinite(price) || price <= 0) return;
    const second = bucketOf(time, 1);
    let bars = this.series.get(symbol);
    if (!bars) this.series.set(symbol, bars = []);
    const last = bars.at(-1);
    // A quote older than the bar in progress arrived out of order; the bar has moved on.
    if (last && second < last.time) return;
    if (last?.time === second) {
      last.high = Math.max(last.high, price);
      last.low = Math.min(last.low, price);
      last.close = price;
      last.volume = (last.volume ?? 0) + 1;
    } else {
      bars.push({ time: second, open: price, high: price, low: price, close: price, volume: 1 });
      // Trim in batches so a full series does not shift on every new second.
      if (bars.length > this.capacity * 1.1) bars.splice(0, bars.length - this.capacity);
    }
    for (const listener of this.listeners) listener(symbol);
  }

  clear(): void {
    this.series.clear();
  }

  bars(symbol: string, seconds: number): Bar[] {
    return aggregate(this.series.get(symbol) ?? [], seconds);
  }

  // The bar in progress for a timeframe, from the one-second bars it covers so far.
  current(symbol: string, seconds: number): Bar | null {
    const bars = this.series.get(symbol);
    const last = bars?.at(-1);
    if (!bars || !last) return null;
    const start = bucketOf(last.time, seconds);
    let index = bars.length - 1;
    while (index > 0 && bars[index - 1].time >= start) index--;
    return aggregate(bars.slice(index), seconds)[0];
  }

  // How much time the recorded quotes for a symbol span, in milliseconds.
  coverage(symbol: string): number {
    const bars = this.series.get(symbol);
    return bars?.length ? bars.at(-1)!.time - bars[0].time : 0;
  }

  onBar(listener: (symbol: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
