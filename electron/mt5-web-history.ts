import type { Bar, Deal, History, Order, Timeframe } from '../shared/protocol.js';
import { timeframes } from '../shared/protocol.js';
import { parseWebOrder } from './mt5-web-trading.js';
import { BinaryReader, BinaryWriter } from './mt5-web-codec.js';

export const RATES_COMMAND = 11;
export const HISTORY_COMMAND = 5;
export const ORDER_RECORD_BYTES = 356;
export const DEAL_RECORD_BYTES = 356;

export function safeInteger(value: bigint, field: string): number {
  const result = Number(value);
  if (value < 0n || !Number.isSafeInteger(result)) throw new RangeError(`Unsafe ${field}`);
  return result;
}

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`Non-finite ${field}`);
  return value;
}

function volume(value: bigint): number {
  return safeInteger(value, 'volume') / 100_000_000;
}

function milliseconds(seconds: number, fraction: number): number {
  if (fraction < 0 || fraction > 999) throw new RangeError('Invalid millisecond fraction');
  return seconds * 1000 + fraction;
}

function timestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0x7fffffff) throw new RangeError('Invalid history timestamp');
  return value;
}

export function encodeHistoryRequest(from: number, to: number): Buffer {
  if (from > to) throw new RangeError('History range is reversed');
  return new BinaryWriter(8).i32(timestamp(from)).i32(timestamp(to)).finish();
}

export function encodeRatesRequest(symbol: string, timeframe: Timeframe, from: number, to: number): Buffer {
  const period = timeframes.find((item) => item.label === timeframe);
  if (!period) throw new RangeError('Unknown timeframe');
  const minutes = period.seconds / 60;
  if (![1, 5, 15, 30, 60, 240, 1440, 10080, 43200].includes(minutes)) throw new RangeError('Timeframe is not supported by the observed web history protocol');
  const wirePeriod = timeframe === 'MN1' ? 49153 : timeframe === 'W1' ? 32769 : minutes >= 60 ? 16384 + minutes / 60 : minutes;
  if (!symbol) throw new RangeError('History symbol is required');
  if (from > to) throw new RangeError('History range is reversed');
  return new BinaryWriter(74).fixedString(symbol, 64).u16(wirePeriod).i32(timestamp(from)).i32(timestamp(to)).finish();
}

export const decodeOrderRecord = parseWebOrder;

const dealTypes = ['buy', 'sell', 'balance', 'credit', 'charge', 'correction', 'bonus', 'commission', 'daily commission', 'monthly commission', 'daily agent commission', 'monthly agent commission', 'interest rate', 'canceled buy', 'canceled sell', 'dividend', 'franked dividend', 'tax'] as const;
const dealEntries = ['in', 'out', 'inout', 'outBy'] as const;

export function decodeDealRecord(bytes: Uint8Array): Deal {
  if (bytes.byteLength !== DEAL_RECORD_BYTES) throw new RangeError('Invalid deal record length');
  const reader = new BinaryReader(bytes);
  const ticket = safeInteger(reader.i64(), 'deal ticket');
  reader.fixedString(64);
  const order = safeInteger(reader.i64(), 'deal order');
  const seconds = reader.u32();
  const changed = reader.u32();
  const symbol = reader.fixedString(64);
  const typeId = reader.u32();
  const entryId = reader.u32();
  const price = finite(reader.f64(), 'deal price');
  reader.f64();
  reader.f64();
  reader.f64();
  const amount = volume(reader.u64());
  const profit = finite(reader.f64(), 'deal profit');
  reader.f64();
  reader.f64();
  const commission = finite(reader.f64(), 'deal commission');
  const swap = finite(reader.f64(), 'deal swap');
  safeInteger(reader.i64(), 'deal magic');
  const positionId = safeInteger(reader.i64(), 'deal position');
  const comment = reader.fixedString(64);
  reader.f64();
  reader.u32();
  reader.u32();
  reader.u32();
  const time = milliseconds(seconds, reader.i32());
  milliseconds(changed, reader.i32());
  const fee = finite(reader.f64(), 'deal fee');
  reader.finish();
  const entry = dealEntries[entryId];
  if (!entry) throw new RangeError(`Unsupported deal entry: ${entryId}`);
  const type = dealTypes[typeId] ?? `unknown:${typeId}`;
  return { type, entry, symbol, comment, fee, swap, time, order, price, ticket, volume: amount, profit, positionId, commission };
}

function records<T>(reader: BinaryReader, size: number, decode: (bytes: Uint8Array) => T): T[] {
  const count = reader.u32();
  if (count > Math.floor(reader.remaining / size)) throw new RangeError('Truncated history record list');
  return Array.from({ length: count }, () => decode(reader.bytes(size)));
}

export function decodeOrderList(bytes: Uint8Array): Order[] {
  const reader = new BinaryReader(bytes);
  const orders = records(reader, ORDER_RECORD_BYTES, decodeOrderRecord);
  reader.finish();
  return orders;
}

export function decodeHistory(bytes: Uint8Array): History {
  const reader = new BinaryReader(bytes);
  const deals = records(reader, DEAL_RECORD_BYTES, decodeDealRecord);
  const orders = records(reader, ORDER_RECORD_BYTES, decodeOrderRecord);
  reader.finish();
  return { deals, orders };
}

export function decodeRates(bytes: Uint8Array): Bar[] {
  if (bytes.byteLength % 48 !== 0) throw new RangeError('Invalid chart history record length');
  const reader = new BinaryReader(bytes);
  const bars: Bar[] = [];
  while (reader.remaining > 0) {
    const time = timestamp(reader.i32());
    const open = finite(reader.f64(), 'bar open');
    const high = finite(reader.f64(), 'bar high');
    const low = finite(reader.f64(), 'bar low');
    const close = finite(reader.f64(), 'bar close');
    const volume = reader.u32();
    const realVolume = finite(reader.f64(), 'bar real volume');
    if (realVolume < 0 || low > high || open < low || open > high || close < low || close > high) throw new RangeError('Invalid chart history prices or volume');
    if (bars.length && time <= bars[bars.length - 1]!.time) throw new RangeError('Chart history timestamps are not increasing');
    bars.push({ time, open, high, low, close, volume });
  }
  return bars;
}
