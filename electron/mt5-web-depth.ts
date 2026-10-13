import type { Book } from '../shared/protocol';
import type { WebSymbolDetails } from './mt5-web-models';
import { BinaryReader } from './mt5-web-codec';

export interface WebDepthLevel {
  readonly type: number;
  readonly time: number;
  readonly price: bigint;
  readonly volume: bigint;
}

export interface WebDepthUpdate {
  readonly id: number;
  readonly time: number;
  readonly flags: number;
  readonly digits: number;
  readonly levels: readonly WebDepthLevel[];
}

export function decodeDepth(payload: Uint8Array): WebDepthUpdate[] {
  const reader = new BinaryReader(payload);
  const updates: WebDepthUpdate[] = [];
  if (!reader.remaining) return updates;
  const count = reader.u32();
  if (count > reader.remaining / 22) throw new RangeError('Depth header count exceeds payload');
  for (let index = 0; index < count; index++) {
    const id = reader.u32();
    const digits = reader.i32();
    reader.i32();
    const time = reader.u32();
    const flags = reader.u32();
    const size = reader.u16();
    const levels: WebDepthLevel[] = [];
    if (size > reader.remaining / 21) throw new RangeError('Depth level count exceeds payload');
    for (let level = 0; level < size; level++) {
      const time = reader.u32();
      const type = reader.u8();
      const price = reader.i64();
      const volume = reader.i64();
      if (type > 4) throw new RangeError('Unknown depth level type');
      levels.push({ type, time, price, volume });
    }
    updates.push({ id, time, flags, digits, levels });
  }
  reader.finish();
  return updates;
}

export function adjustDepthPrice(value: number, side: 'buy' | 'sell', detail: WebSymbolDetails): number {
  const adjustment = detail.spreadAdjustment;
  if (!adjustment) return value;
  const balance = adjustment > 0 ? detail.spreadBalance : -detail.spreadBalance;
  const shifted = side === 'sell' ? value + detail.spec.point * (Math.trunc(adjustment / 2) + balance) : value - detail.spec.point * (adjustment - Math.trunc(adjustment / 2) - balance);
  const scale = 10 ** Math.min(Math.max(detail.spec.digits, 0), 8);
  return shifted >= 0 ? Math.floor(shifted * scale + 0.5000001) / scale : Math.ceil(shifted * scale - 0.5000001) / scale;
}

export class WebDepthBook {
  private hasSnapshot = false;
  private levels = new Map<string, WebDepthLevel>();

  constructor(readonly symbol: string, private readonly digits: number) {}

  apply(update: WebDepthUpdate, price: (value: number, side: 'buy' | 'sell') => number = (value) => value): Book | null {
    let incoming = update.levels;
    if (!this.hasSnapshot) {
      if (!(update.flags & 2)) {
        const reset = incoming.findIndex((level) => level.type === 0);
        if (reset < 0) return null;
        incoming = incoming.slice(reset + 1);
      }
    } else if (update.flags & 2) return null;
    const next = this.hasSnapshot ? new Map(this.levels) : new Map<string, WebDepthLevel>();
    for (const level of incoming) {
      const key = `${level.type}:${level.price}`;
      const previous = next.get(key);
      if (level.type === 0) next.clear();
      else if (!this.hasSnapshot) next.set(key, level);
      else if (!level.volume) {
        if (!previous) { this.reset(); return null; }
        next.delete(key);
      } else {
        const volume = (previous?.volume ?? 0n) + level.volume;
        if (!volume) next.delete(key);
        else next.set(key, { ...level, volume });
      }
    }
    if ([...next.values()].some((level) => level.volume < 0n)) { this.reset(); return null; }
    const levels: Book['levels'] = [];
    for (const level of next.values()) {
      if (level.type !== 1 && level.type !== 2) continue;
      const side = level.type === 1 ? 'sell' : 'buy';
      const rawVolume = Number(level.volume);
      const volume = rawVolume / 100_000_000;
      const scaled = Number(level.price) / 10 ** this.digits;
      const adjusted = price(scaled, side);
      if (!Number.isSafeInteger(rawVolume) || !Number.isSafeInteger(Number(level.price)) || !Number.isFinite(adjusted)) { this.reset(); return null; }
      levels.push({ side, price: adjusted, volume });
    }
    this.levels = next;
    this.hasSnapshot = true;
    return { symbol: this.symbol, isAvailable: levels.length > 0, levels: levels.sort((left, right) => right.price - left.price) };
  }

  reset(): void { this.hasSnapshot = false; this.levels.clear(); }
}
