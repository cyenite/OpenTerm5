import type { Order, OrderTypeKey, Position, TradeRequest, TradeResult } from '../shared/protocol';
import { BinaryReader, BinaryWriter } from './mt5-web-codec';

export const WEB_TRADE_REQUEST_BYTES = 248;
export const WEB_POSITION_BYTES = 344;
export const WEB_ORDER_BYTES = 356;

const wireOrderTypes: Readonly<Record<OrderTypeKey, number>> = { buy: 0, sell: 1, buyLimit: 2, sellLimit: 3, buyStop: 4, sellStop: 5, buyStopLimit: 6, sellStopLimit: 7 };
const decodedOrderTypes = new Map(Object.entries(wireOrderTypes).map(([key, value]) => [value, key as OrderTypeKey]));

export interface WebTradeContext {
  readonly digits: number;
  readonly requestId: number;
  readonly executionMode: number;
  readonly fillingFlags: number;
  readonly orderFlags?: number;
  readonly expirationFlags?: number;
  readonly isNegativePriceAllowed?: boolean;
  readonly expirationMode?: number;
  readonly instantVolumeMax?: number;
  readonly volumeMin: number;
  readonly volumeMax: number;
  readonly volumeStep: number;
  readonly symbol: string;
}

export function safeTradeNumber(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Broker identifier cannot be represented safely');
  return Number(value);
}

function identifier(value = 0): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Invalid broker identifier');
  return BigInt(value);
}

export function encodeTradeVolume(value: number): bigint {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Invalid trade volume');
  const scaled = value * 1e8;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 0.000001) throw new RangeError('Trade volume exceeds supported precision');
  return BigInt(rounded);
}

function volume(value: bigint): number { return safeTradeNumber(value) / 1e8; }
function normalize(value: number, digits: number): number {
  return digits > 16 ? value : Number(value.toFixed(digits));
}
function finite(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('Non-finite trade price');
  return value;
}

export function encodeTradeRequest(request: TradeRequest, context: WebTradeContext): Buffer {
  if (!context.symbol || request.symbol && request.symbol !== context.symbol) throw new RangeError('Trade symbol mismatch');
  if (!Number.isInteger(context.digits) || context.digits < 0 || context.digits > 16) throw new RangeError('Invalid symbol digits');
  if (!Number.isInteger(context.requestId) || context.requestId <= 0 || context.requestId > 0xffffffff) throw new RangeError('Trade request identifier must be a nonzero uint32');
  if (request.type !== undefined && !Object.hasOwn(wireOrderTypes, request.type)) throw new RangeError('Unknown trade order type');
  const type = request.type === undefined ? -1 : wireOrderTypes[request.type];
  for (const value of [request.price, request.stoplimit, request.sl, request.tp]) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 && !context.isNegativePriceAllowed)) throw new RangeError('Invalid trade price');
  }
  if (!Number.isInteger(context.fillingFlags) || context.fillingFlags < 0 || context.fillingFlags > 7) throw new RangeError('Invalid filling flags');
  const lots = request.volume ?? 0;
  const units = encodeTradeVolume(lots);
  let action: number;
  let filling = request.action === 'deal' || request.action === 'pending' ? 2 : 0;
  let price = request.price ?? 0;
  switch (request.action) {
    case 'deal':
      if (type !== 0 && type !== 1) throw new RangeError('Market deal requires buy or sell');
      if (context.executionMode === 0) throw new RangeError('Request execution needs a price negotiation and is unsupported');
      if (context.executionMode === 1) {
        if (context.instantVolumeMax && lots > context.instantVolumeMax) throw new RangeError('Volume requires unsupported request execution');
        action = 2;
        filling = 0;
        if (!price) throw new RangeError('Instant execution requires a quote');
      }
      else if (context.executionMode === 2) { action = 3; price = 0; filling = context.fillingFlags & 2 ? 1 : context.fillingFlags & 1 ? 0 : -1; }
      else if (context.executionMode === 3) { action = 4; price = 0; }
      else throw new RangeError('Unknown execution mode');
      if (filling < 0) throw new RangeError('No supported market filling policy');
      break;
    case 'pending': if (type < 2 || type > 7 || !price) throw new RangeError('Pending order requires type and price'); action = 5; break;
    case 'sltp': if (!request.position) throw new RangeError('Position is required'); action = 6; break;
    case 'modify':
      if (!request.order || type < 2 || !price || !units) throw new RangeError('Modify requires the existing pending order type, price and initial volume');
      action = 7;
      break;
    case 'remove': if (!request.order) throw new RangeError('Order is required'); action = 8; break;
    case 'closeBy':
      if (!request.position || !request.positionBy || request.position === request.positionBy) throw new RangeError('Close By requires two distinct positions');
      if (type !== 0 && type !== 1 || !units) throw new RangeError('Close By requires the opposite side and first position volume');
      if (context.orderFlags === undefined || !(context.orderFlags & 64)) throw new RangeError('Close By is disabled by symbol');
      action = 10;
      break;
    default: throw new RangeError('Unsupported trade action');
  }
  if (request.action === 'deal' || request.action === 'pending') {
    const orderFlag = type < 2 ? 1 : type < 4 ? 2 : type < 6 ? 4 : 8;
    if (context.orderFlags !== undefined && !(context.orderFlags & orderFlag)) throw new RangeError('Order type disabled by symbol');
    const minimum = encodeTradeVolume(context.volumeMin);
    const maximum = encodeTradeVolume(context.volumeMax);
    const step = encodeTradeVolume(context.volumeStep);
    if (!units || !step || units < minimum || units > maximum || units % step) throw new RangeError('Volume violates symbol limits');
  }
  if (context.orderFlags !== undefined && (request.sl && !(context.orderFlags & 16) || request.tp && !(context.orderFlags & 32))) throw new RangeError('Stops disabled by symbol');
  if ((type === 6 || type === 7) && !(request.stoplimit && request.stoplimit > 0)) throw new RangeError('Stop-limit order requires trigger price');
  const expiration = request.expiration ?? 0;
  const expirationMode = context.expirationMode ?? (expiration ? 2 : 0);
  if (!Number.isInteger(expirationMode) || expirationMode < 0 || expirationMode > 3) throw new RangeError('Invalid expiration mode');
  if ((request.action === 'pending' || request.action === 'modify') && context.expirationFlags !== undefined && !(context.expirationFlags & (1 << expirationMode))) throw new RangeError('Expiration mode disabled by symbol');
  if (expiration && expirationMode !== 2 && expirationMode !== 3) throw new RangeError('Expiration mode does not accept timestamp');
  if (!expiration && expirationMode !== 0 && expirationMode !== 1) throw new RangeError('Expiration timestamp is required');
  if (request.deviation) throw new RangeError('Numeric deviation is unsupported by this web protocol');
  return new BinaryWriter(WEB_TRADE_REQUEST_BYTES)
    .u32(context.requestId).u32(action).fixedString(context.symbol, 64).u64(units)
    .u32(context.digits).u64(identifier(request.order)).u32(type < 0 ? 0 : type).u32(filling)
    .u32(expirationMode).u32(request.action === 'deal' ? request.position ? 3 : 2 : request.action === 'pending' ? 2 : request.action === 'closeBy' ? 3 : 0).u32(0)
    .f64(finite(price)).f64(finite(request.stoplimit ?? 0)).f64(finite(request.sl ?? 0)).f64(finite(request.tp ?? 0))
    .u32(0).f64(0).f64(0).fixedString(request.comment ?? '', 64)
    .u64(identifier(request.position)).u64(identifier(request.positionBy)).u32(expiration).finish();
}

export function parseTradeAdmission(payload: Uint8Array): number {
  const reader = new BinaryReader(payload);
  const code = reader.u32();
  reader.finish();
  return code;
}

export interface WebTradeResponse {
  readonly requestId: number;
  readonly isFinal: boolean;
  readonly result: TradeResult;
  readonly rawRequest: Buffer;
  readonly dealId: bigint;
  readonly orderId: bigint;
}

export function parseTradeResponse(payload: Uint8Array): WebTradeResponse {
  const reader = new BinaryReader(payload);
  reader.u32();
  const rawRequest = reader.bytes(WEB_TRADE_REQUEST_BYTES);
  const requestId = rawRequest.readUInt32LE(0);
  const retcode = reader.u32();
  const dealId = reader.i64();
  const orderId = reader.i64();
  const units = reader.i64();
  const price = finite(reader.f64());
  reader.u32();
  const bid = finite(reader.f64());
  const ask = finite(reader.f64());
  finite(reader.f64());
  const comment = reader.fixedString(64);
  reader.finish();
  const isSuccess = [10008, 10009, 10010, 11001].includes(retcode);
  const isFinal = ![0, 10001, 10002, 10003, 10028].includes(retcode);
  return Object.freeze({ requestId, isFinal, rawRequest, dealId, orderId,
    result: { retcode, isSuccess, comment, deal: safeTradeNumber(dealId), order: safeTradeNumber(orderId), volume: volume(units), price, bid, ask } });
}

export function parseWebPosition(payload: Uint8Array): Position {
  const reader = new BinaryReader(payload);
  const ticket = safeTradeNumber(reader.i64());
  reader.i64();
  const seconds = reader.u32();
  reader.u32();
  const symbol = reader.fixedString(64);
  const side = reader.u32();
  if (side !== 0 && side !== 1) throw new RangeError('Unsupported position type');
  const priceOpen = finite(reader.f64());
  const priceCurrent = finite(reader.f64());
  const sl = finite(reader.f64());
  const tp = finite(reader.f64());
  const lots = volume(reader.u64());
  const profit = finite(reader.f64());
  reader.bytes(24);
  const swap = finite(reader.f64());
  const magic = safeTradeNumber(reader.i64());
  reader.i64();
  const comment = reader.fixedString(64);
  reader.f64();
  const digits = reader.u32();
  const currencyDigits = reader.u32();
  reader.bytes(68);
  const millis = reader.i32();
  reader.i32();
  reader.finish();
  if (millis < 0 || millis > 999) throw new RangeError('Invalid position milliseconds');
  return {
    side: side === 0 ? 'buy' : 'sell', symbol, comment, magic, ticket, volume: lots, time: seconds * 1000 + millis,
    sl: normalize(sl, digits), tp: normalize(tp, digits), swap: normalize(swap, currencyDigits), profit: normalize(profit, currencyDigits),
    priceOpen: normalize(priceOpen, digits), priceCurrent: normalize(priceCurrent, digits),
  };
}

export function parseWebOrder(payload: Uint8Array): Order {
  const reader = new BinaryReader(payload);
  const ticket = safeTradeNumber(reader.i64());
  reader.fixedString(64);
  const symbol = reader.fixedString(64);
  const time = reader.u32();
  const expiration = reader.u32();
  const timeDone = reader.u32();
  const typeIndex = reader.u32();
  const type = decodedOrderTypes.get(typeIndex);
  if (!type) throw new RangeError('Unsupported order type');
  const filling = reader.u32();
  const expirationMode = reader.u32();
  reader.u32();
  const priceOpen = finite(reader.f64());
  const stoplimit = finite(reader.f64());
  const priceCurrent = finite(reader.f64());
  const sl = finite(reader.f64());
  const tp = finite(reader.f64());
  const volumeInitial = volume(reader.i64());
  const lots = volume(reader.i64());
  const state = reader.u32();
  reader.i64();
  const positionId = safeTradeNumber(reader.i64());
  const comment = reader.fixedString(64);
  reader.f64();
  const digits = reader.u32();
  reader.bytes(32);
  const milliseconds = reader.i32();
  const doneMilliseconds = reader.i32();
  reader.finish();
  if (milliseconds < 0 || milliseconds > 999 || doneMilliseconds < 0 || doneMilliseconds > 999) throw new RangeError('Invalid order milliseconds');
  return {
    type, symbol, comment, filling, expirationMode, state, ticket, volumeInitial, positionId, expiration, volume: lots,
    time: time * 1000 + milliseconds, timeDone: timeDone * 1000 + doneMilliseconds,
    sl: normalize(sl, digits), tp: normalize(tp, digits), stoplimit: normalize(stoplimit, digits), priceOpen: normalize(priceOpen, digits), priceCurrent: normalize(priceCurrent, digits),
  };
}

export function parseTradeSnapshot(payload: Uint8Array): { positions: Position[]; orders: Order[] } {
  const reader = new BinaryReader(payload);
  const positionCount = reader.u32();
  if (positionCount > Math.floor(reader.remaining / WEB_POSITION_BYTES)) throw new RangeError('Position count exceeds payload');
  const positions: Position[] = [];
  const orders: Order[] = [];
  for (let index = 0; index < positionCount; index++) positions.push(parseWebPosition(reader.bytes(WEB_POSITION_BYTES)));
  const orderCount = reader.u32();
  if (orderCount > Math.floor(reader.remaining / WEB_ORDER_BYTES)) throw new RangeError('Order count exceeds payload');
  for (let index = 0; index < orderCount; index++) orders.push(parseWebOrder(reader.bytes(WEB_ORDER_BYTES)));
  // Servers append padding after the order list when positions are open (24 zero bytes for two
  // positions on MetaQuotes-Demo); the official web client reads the two lists and ignores the rest.
  return { positions, orders };
}

export const WEB_DEAL_BYTES = 356;
export const WEB_ACCOUNT_CHANGE_BYTES = 40;

export enum TransactionAction { added, updated, removed }

export type TradeTransaction =
  | { readonly kind: 'order'; readonly action: TransactionAction; readonly order: Order }
  | { readonly kind: 'historyOrder'; readonly action: TransactionAction; readonly order: Order }
  | { readonly kind: 'deal'; readonly action: TransactionAction; readonly position: Position | null; readonly positions: readonly Position[]; readonly balance: number; readonly credit: number };

function transactionAction(value: number): TransactionAction {
  if (value > TransactionAction.removed) throw new RangeError('Unsupported trade transaction action');
  return value;
}

function optionalPosition(bytes: Buffer): Position | null {
  const position = parseWebPosition(bytes);
  return position.symbol ? position : null;
}

// A fill arrives as one frame holding an open-order removal followed by a history-order addition,
// so the kind is read per record.
export function parseTradeTransactions(payload: Uint8Array): TradeTransaction[] {
  const reader = new BinaryReader(payload);
  const transactions: TradeTransaction[] = [];
  while (reader.remaining > 0) {
    const kind = reader.u32();
    reader.u32();
    const action = transactionAction(reader.u32());
    if (kind === 2) {
      reader.bytes(WEB_DEAL_BYTES);
      const position = optionalPosition(reader.bytes(WEB_POSITION_BYTES));
      const balance = finite(reader.f64());
      const credit = finite(reader.f64());
      reader.bytes(WEB_ACCOUNT_CHANGE_BYTES - 16);
      const dealCount = reader.u32();
      if (dealCount > Math.floor(reader.remaining / WEB_DEAL_BYTES)) throw new RangeError('Deal count exceeds payload');
      reader.bytes(dealCount * WEB_DEAL_BYTES);
      const positionCount = reader.u32();
      if (positionCount > Math.floor(reader.remaining / WEB_POSITION_BYTES)) throw new RangeError('Position count exceeds payload');
      const positions = Array.from({ length: positionCount }, () => parseWebPosition(reader.bytes(WEB_POSITION_BYTES)));
      transactions.push({ kind: 'deal', action, position, positions, balance, credit });
    } else if (kind === 0 || kind === 1) {
      transactions.push({ kind: kind === 0 ? 'order' : 'historyOrder', action, order: parseWebOrder(reader.bytes(WEB_ORDER_BYTES)) });
    } else throw new RangeError(`Unsupported trade transaction kind ${kind}`);
  }
  return transactions;
}

export function applyPositionChange(positions: readonly Position[], change: Position): Position[] {
  const index = positions.findIndex((position) => change.ticket ? position.ticket === change.ticket : position.symbol === change.symbol);
  if (index < 0) return change.volume ? [...positions, change] : [...positions];
  return change.volume ? positions.map((position, at) => at === index ? change : position) : positions.filter((_, at) => at !== index);
}

export function applyOrderChange(orders: readonly Order[], action: TransactionAction, change: Order): Order[] {
  if (action === TransactionAction.removed) return orders.filter((order) => order.ticket !== change.ticket);
  const isKnown = orders.some((order) => order.ticket === change.ticket);
  return isKnown ? orders.map((order) => order.ticket === change.ticket ? change : order) : [...orders, change];
}
