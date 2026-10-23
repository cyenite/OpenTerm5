import type { Tick } from '../shared/protocol';

const SUBSCRIPTION_LIMIT = 256;

export type TickSubscriber = (symbols: string[]) => Promise<(Tick | null)[]>;

// The link keeps one quote subscription and `ticks.subscribe` replaces it, so the window and every
// connected phone subscribe through here and the link gets their union, the window's symbols first.
export class TickInterest {
  private window: readonly string[] = [];
  private readonly devices = new Map<string, readonly string[]>();

  constructor(private readonly subscribe: TickSubscriber) {}

  async set(owner: string | null, symbols: unknown): Promise<(Tick | null)[]> {
    if (!Array.isArray(symbols) || symbols.length > SUBSCRIPTION_LIMIT || symbols.some((symbol) => typeof symbol !== 'string')) throw new Error('Invalid quote subscription');
    if (owner === null) this.window = symbols;
    else this.devices.set(owner, symbols);
    const ticks = await this.subscribe(this.union());
    const bySymbol = new Map(ticks.filter((tick): tick is Tick => tick !== null).map((tick) => [tick.symbol, tick]));
    return symbols.map((symbol: string) => bySymbol.get(symbol) ?? null);
  }

  async release(owner: string): Promise<void> {
    if (!this.devices.delete(owner)) return;
    await this.subscribe(this.union());
  }

  has(owner: string, symbol: string): boolean {
    return this.devices.get(owner)?.includes(symbol) ?? false;
  }

  union(): string[] {
    return [...new Set([...this.window, ...[...this.devices.values()].flat()])].slice(0, SUBSCRIPTION_LIMIT);
  }
}

// Chart bar subscriptions are counted per viewer by the link, so a phone that disconnects without
// unsubscribing would keep the bars coming; the hub remembers each phone's and returns them.
export class BarInterest {
  private readonly owners = new Map<string, Map<string, number>>();

  add(owner: string, key: string): void {
    const counts = this.owners.get(owner) ?? new Map<string, number>();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    this.owners.set(owner, counts);
  }

  // False when the phone holds no such subscription, so it cannot release one the window holds.
  remove(owner: string, key: string): boolean {
    const counts = this.owners.get(owner);
    const count = counts?.get(key) ?? 0;
    if (!counts || !count) return false;
    if (count > 1) counts.set(key, count - 1);
    else counts.delete(key);
    return true;
  }

  has(owner: string, key: string): boolean {
    return (this.owners.get(owner)?.get(key) ?? 0) > 0;
  }

  release(owner: string): string[] {
    const counts = this.owners.get(owner);
    this.owners.delete(owner);
    return counts ? [...counts].flatMap(([key, count]) => Array.from({ length: count }, () => key)) : [];
  }
}
