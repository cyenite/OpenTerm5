import { Buffer } from 'node:buffer';
import { BinaryReader, BinaryWriter, MAX_FRAME_BYTES } from './mt5-web-codec';

export interface WebSymbol {
  readonly id: number;
  readonly flags: number;
  readonly digits: number;
  readonly calcMode: number;
  readonly name: string;
  readonly path: string;
  readonly basis: string;
  readonly description: string;
}

export interface WebSymbolList {
  readonly symbols: readonly WebSymbol[];
  readonly extension: Buffer;
}

export interface WebTickRawFields {
  readonly bid: number;
  readonly ask: number;
  readonly last: number;
  readonly flags: number;
  readonly digits: number;
  readonly wireDigits: number;
  readonly seconds: number;
  readonly mask: bigint;
  readonly volume: bigint;
  readonly timestamp: bigint;
  readonly record: Buffer;
}

export interface WebTickUpdate {
  readonly id: number;
  readonly bid?: number;
  readonly ask?: number;
  readonly last?: number;
  readonly timeMs: number;
  readonly symbol: string;
  readonly volume?: bigint;
  readonly isDelayed: boolean;
  readonly rawFields: WebTickRawFields;
}

function boundedPayload(payload: Uint8Array): Buffer {
  if (payload.byteLength > MAX_FRAME_BYTES) throw new RangeError('Market payload exceeds size limit');
  return Buffer.from(payload);
}

export function parseSymbols(payload: Uint8Array): WebSymbolList {
  const reader = new BinaryReader(payload);
  const count = reader.u32();
  const extensionSize = reader.remaining - count * 526;
  if (extensionSize !== 0 && extensionSize !== 16) throw new RangeError(`Symbol count does not match payload size (${count} records, ${reader.remaining} bytes)`);
  const ids = new Set<number>();
  const names = new Set<string>();
  const symbols: WebSymbol[] = [];
  for (let index = 0; index < count; index++) {
    const name = reader.fixedString(64);
    const description = reader.fixedString(128);
    const digits = reader.u32();
    const id = reader.u32();
    const path = reader.fixedString(256);
    const calcMode = reader.u32();
    const basis = reader.fixedString(64);
    const flags = reader.u16();
    if (!name) throw new RangeError('Symbol name cannot be empty');
    if (ids.has(id) || names.has(name)) throw new RangeError('Duplicate broker symbol');
    ids.add(id);
    names.add(name);
    symbols.push(Object.freeze({ id, flags, digits, calcMode, name, path, basis, description }));
  }
  const extension = reader.bytes(extensionSize);
  reader.finish();
  return Object.freeze({ symbols: Object.freeze(symbols), extension });
}

function safeTimestamp(timestamp: bigint): number {
  if (timestamp < BigInt(Number.MIN_SAFE_INTEGER) || timestamp > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('Tick timestamp cannot be represented safely');
  }
  return Number(timestamp);
}

function price(raw: number, digits: number): number {
  if (!Number.isFinite(raw)) throw new RangeError('Tick price must be finite');
  const precision = Math.min(digits, 8);
  return (raw >= 0 ? Math.floor(raw + 0.5000001) : Math.ceil(raw - 0.5000001)) / 10 ** precision;
}

export function parseTickUpdates(
  command: 8 | 17,
  payload: Uint8Array,
  symbols: ReadonlyMap<number, WebSymbol>,
): readonly WebTickUpdate[] {
  if (command !== 8 && command !== 17) throw new RangeError('Unsupported tick command');
  const size = command === 8 ? 50 : 274;
  const bytes = boundedPayload(payload);
  if (bytes.length % size !== 0) throw new RangeError('Truncated tick record');
  const updates: WebTickUpdate[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    const record = Buffer.from(bytes.subarray(offset, offset + size));
    const id = record.readUInt32LE(0);
    const symbol = symbols.get(id);
    if (!symbol) throw new RangeError(`Unknown broker symbol ID: ${id}`);
    const flags = record.readUInt16LE(size - 2);
    const digits = symbol.digits;
    const wireDigits = command === 8 ? symbol.digits : record.readUInt32LE(16);
    const seconds = record.readInt32LE(command === 8 ? 4 : 12);
    const bid = record.readDoubleLE(command === 8 ? 12 : 20);
    const ask = record.readDoubleLE(command === 8 ? 20 : 44);
    const last = record.readDoubleLE(command === 8 ? 28 : 68);
    const mask = command === 8 ? BigInt(record.readUInt32LE(8)) : record.readBigInt64LE(4);
    const volume = record.readBigInt64LE(command === 8 ? 36 : 92);
    const preciseTimestamp = command === 17 ? record.readBigInt64LE(208) : 0n;
    if (command === 17) safeTimestamp(preciseTimestamp);
    const timestamp = command === 8
      ? BigInt(seconds) * 1000n + BigInt(record.readUInt32LE(44))
      : preciseTimestamp > 0n ? preciseTimestamp : BigInt(seconds) * 1000n;
    const rawFields = Object.freeze({ bid, ask, last, flags, digits, wireDigits, seconds, mask, volume, timestamp, record });
    const update: WebTickUpdate = Object.freeze({
      id, symbol: symbol.name, timeMs: safeTimestamp(timestamp),
      isDelayed: (flags & (command === 8 ? 512 : 1)) !== 0,
      ...(mask & 1n ? { bid: price(bid, digits) } : {}),
      ...(mask & (command === 8 ? 2n : 8n) ? { ask: price(ask, digits) } : {}),
      ...(mask & (command === 8 ? 4n : 64n) ? { last: price(last, digits) } : {}),
      ...(mask & (command === 8 ? 8n : 512n) ? { volume } : {}),
      rawFields,
    });
    updates.push(update);
  }
  return Object.freeze(updates);
}

export function buildSymbolSubscription(ids: readonly number[]): Buffer {
  if (ids.length > (MAX_FRAME_BYTES - 4) / 4) throw new RangeError('Subscription exceeds size limit');
  if (new Set(ids).size !== ids.length) throw new RangeError('Duplicate subscription symbol ID');
  const writer = new BinaryWriter(4 + ids.length * 4).u32(ids.length);
  for (const id of ids) writer.u32(id);
  return writer.finish();
}
