import type { Account, SymbolSpec } from '../shared/protocol';
import type { WebTradeContext } from './mt5-web-trading';
import { safeTradeNumber } from './mt5-web-trading';

export const WEB_ACCOUNT_BYTES = 816;
export const WEB_SYMBOL_DETAILS_BYTES = 3068;
export const WEB_TRADE_CONDITIONS_BYTES = 628;

export interface WebTradeOverride {
  readonly path: string;
  readonly raw: Buffer;
}

export interface WebAccountModel {
  readonly account: Account;
  readonly hasMargin: false;
  readonly serverOffsetSeconds: number;
  readonly tradeOverrides: readonly WebTradeOverride[];
}

export interface WebSymbolDetails {
  readonly id: number;
  readonly spec: SymbolSpec;
  readonly trade: Omit<WebTradeContext, 'requestId' | 'symbol'> & {
    readonly tradeMode: number;
    readonly orderFlags: number;
    readonly stopsLevel: number;
    readonly freezeLevel: number;
    readonly expirationFlags: number;
  };
  readonly calcMode: number;
  readonly spreadBalance: number;
  readonly spreadAdjustment: number;
  readonly allowsNegativePrices: boolean;
}

function string(buffer: Buffer, offset: number, size: number): string {
  const field = buffer.subarray(offset, offset + size);
  let end = field.length;
  for (let index = 0; index < field.length; index += 2) {
    if (field.readUInt16LE(index) === 0) { end = index; break; }
  }
  return field.toString('utf16le', 0, end);
}

function finite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`Non-finite ${field}`);
  return value;
}

export function parseAccountModel(payload: Uint8Array, login: number): WebAccountModel {
  const buffer = Buffer.from(payload);
  if (buffer.length < WEB_ACCOUNT_BYTES) throw new RangeError('Truncated account model');
  if (!Number.isSafeInteger(login) || login < 0) throw new RangeError('Invalid account login');
  const type = buffer.readUInt8(0);
  if (type > 2) throw new RangeError('Unsupported preliminary or unknown account type');
  const flags = buffer.readUInt32LE(1);
  const balance = finite(buffer.readDoubleLE(9), 'account balance');
  const credit = finite(buffer.readDoubleLE(17), 'account credit');
  const tradeOverrides: WebTradeOverride[] = [];
  let isFifo: boolean | undefined;
  if (buffer.length > WEB_ACCOUNT_BYTES) {
    if (buffer.length < WEB_ACCOUNT_BYTES + 4) throw new RangeError('Truncated account override count');
    const count = buffer.readUInt32LE(WEB_ACCOUNT_BYTES);
    if (count > Math.floor((buffer.length - WEB_ACCOUNT_BYTES - 4) / WEB_TRADE_CONDITIONS_BYTES)) throw new RangeError('Account override count exceeds payload');
    const cursor = count ? WEB_ACCOUNT_BYTES + 4 + count * WEB_TRADE_CONDITIONS_BYTES : WEB_ACCOUNT_BYTES;
    if (cursor + 4 <= buffer.length) {
      const flags = buffer.readInt32LE(cursor);
      if (flags >= 0 && !(flags & ~4095)) isFifo = buffer.readUInt32LE(744) === 2 && !!(flags & 256);
    }
    for (let index = 0; index < count; index++) {
      const offset = WEB_ACCOUNT_BYTES + 4 + index * WEB_TRADE_CONDITIONS_BYTES;
      const raw = Buffer.from(buffer.subarray(offset, offset + WEB_TRADE_CONDITIONS_BYTES));
      tradeOverrides.push({ path: string(raw, 0, 256), raw });
    }
  }
  return {
    account: {
      login, balance, credit,
      name: string(buffer, 97, 256),
      server: string(buffer, 355, 128),
      company: string(buffer, 483, 256),
      currency: string(buffer, 25, 64),
      leverage: buffer.readUInt32LE(93),
      tradeMode: type === 0 ? 'real' : type === 1 ? 'demo' : 'contest',
      isHedging: buffer.readUInt32LE(744) === 2,
      ...(isFifo === undefined ? {} : { isFifo }),
      isTradeAllowed: !(flags & (4 | 8 | 512)),
      profit: 0, margin: 0, equity: balance + credit,
      marginFree: balance + credit, marginLevel: 0,
    },
    hasMargin: false,
    serverOffsetSeconds: buffer.readInt32LE(739) + buffer.readUInt8(743) * 3600,
    tradeOverrides,
  };
}

function matchesPath(pattern: string, path: string): boolean {
  let isMatch = false;
  for (const entry of pattern.split(',').map((item) => item.trim())) {
    if (!entry) continue;
    const isExcluded = entry.startsWith('!');
    const value = entry.replace(/^!+/, '');
    const expression = value.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    if (new RegExp(`^${expression}$`).test(path)) {
      if (isExcluded) return false;
      isMatch = true;
    }
  }
  return isMatch;
}

function mergeConditions(base: Buffer, override: Buffer): Buffer {
  if (override.length !== WEB_TRADE_CONDITIONS_BYTES) throw new RangeError('Invalid trade override size');
  const result = Buffer.from(base);
  for (const offset of [256, 260, 268, 272, 560]) {
    if (override.readInt32LE(offset) !== 0x7fffffff) result.writeInt32LE(override.readInt32LE(offset), offset);
  }
  for (const offset of [264, 276, 280, 284, 288, 292, 296, 300, 304, 308, 312, 324, 328, 332, 368, 540, 564, 568]) {
    if (override.readUInt32LE(offset) !== 0xffffffff) result.writeUInt32LE(override.readUInt32LE(offset), offset);
  }
  for (const offset of [316, 336, 344, 352, 360]) {
    const value = override.readBigUInt64LE(offset);
    if (value && value !== 0xffffffffffffffffn) result.writeBigUInt64LE(value, offset);
  }
  for (const offset of [372, 380, 516, 524, 532, 544, 552, ...Array.from({ length: 16 }, (_, index) => 388 + index * 8), ...Array.from({ length: 7 }, (_, index) => 572 + index * 8)]) {
    const value = override.readDoubleLE(offset);
    if (value !== Number.MAX_VALUE) result.writeDoubleLE(value, offset);
  }
  return result;
}

export function parseSymbolDetails(payload: Uint8Array, profile?: Pick<WebAccountModel, 'tradeOverrides'>): WebSymbolDetails[] {
  const buffer = Buffer.from(payload);
  if (buffer.length < 4) throw new RangeError('Truncated symbol detail count');
  const count = buffer.readUInt32LE(0);
  if (count * WEB_SYMBOL_DETAILS_BYTES !== buffer.length - 4) throw new RangeError('Symbol detail count does not match payload');
  const result: WebSymbolDetails[] = [];
  const ids = new Set<number>();
  for (let index = 0; index < count; index++) {
    const record = buffer.subarray(4 + index * WEB_SYMBOL_DETAILS_BYTES, 4 + (index + 1) * WEB_SYMBOL_DETAILS_BYTES);
    const id = record.readUInt32LE(1412);
    const digits = record.readUInt32LE(1392);
    const point = finite(record.readDoubleLE(1396), 'symbol point');
    if (digits > 16 || point < 0 || ids.has(id)) throw new RangeError('Invalid symbol precision or duplicate identifier');
    ids.add(id);
    const base = record.subarray(1536, 2164);
    const path = string(base, 0, 256);
    let conditions: Buffer = Buffer.from(base);
    for (const override of profile?.tradeOverrides ?? []) {
      if (matchesPath(override.path, path)) conditions = mergeConditions(base, override.raw);
    }
    const tradeMode = conditions.readUInt32LE(264);
    const volumeMin = safeTradeNumber(conditions.readBigUInt64LE(336)) / 1e8;
    const volumeMax = safeTradeNumber(conditions.readBigUInt64LE(344)) / 1e8;
    const volumeStep = safeTradeNumber(conditions.readBigUInt64LE(352)) / 1e8;
    const stopsLevel = conditions.readInt32LE(268);
    const spread = record.readInt32LE(1432);
    const spec: SymbolSpec = {
      name: string(record, 0, 64), path,
      description: string(record, 96, 128),
      currencyBase: string(record, 1276, 32),
      currencyProfit: string(record, 1308, 32),
      currencyMargin: string(record, 1340, 32),
      tradeMode: ['Disabled', 'Long only', 'Short only', 'Close only', 'Full access'][tradeMode] ?? `Unknown (${tradeMode})`,
      point, digits, spread, volumeMin, volumeMax, stopsLevel, volumeStep,
      swapLong: finite(conditions.readDoubleLE(544), 'swap long'),
      swapShort: finite(conditions.readDoubleLE(552), 'swap short'),
      contractSize: finite(record.readDoubleLE(1456), 'contract size'),
      tickSize: finite(record.readDoubleLE(1448), 'tick size'),
      freezeLevel: conditions.readInt32LE(272),
      executionMode: conditions.readUInt32LE(276),
      fillingFlags: conditions.readUInt32LE(280),
      expirationFlags: conditions.readUInt32LE(284),
      orderFlags: conditions.readUInt32LE(288),
      visible: false, isSpreadFloat: spread <= 0,
    };
    result.push({ id, spec,
      trade: { digits, volumeMin, volumeMax, volumeStep, tradeMode, stopsLevel,
        executionMode: conditions.readUInt32LE(276),
        fillingFlags: conditions.readUInt32LE(280),
        expirationFlags: conditions.readUInt32LE(284),
        orderFlags: conditions.readUInt32LE(288),
        freezeLevel: conditions.readInt32LE(272),
        instantVolumeMax: safeTradeNumber(conditions.readBigUInt64LE(316)) / 1e8,
      },
      calcMode: record.readUInt32LE(1468),
      spreadBalance: conditions.readInt32LE(260),
      spreadAdjustment: conditions.readInt32LE(256),
      allowsNegativePrices: !!(record.readUInt32LE(1416) & 8),
    });
  }
  return result;
}

export function adjustQuote(bid: number, ask: number, details: WebSymbolDetails): { bid: number; ask: number } {
  finite(bid, 'bid');
  finite(ask, 'ask');
  const { spreadBalance, spreadAdjustment, spec } = details;
  if (!spreadAdjustment || !bid || !ask || !spec.point) return { bid, ask };
  const normalize = (value: number, digits: number) => {
    const scale = 10 ** Math.min(Math.max(digits, 0), 8);
    return value >= 0 ? Math.floor(value * scale + 0.5000001) / scale : Math.ceil(value * scale - 0.5000001) / scale;
  };
  const spread = normalize((ask - bid) / spec.point + spreadAdjustment, 0);
  const balance = spreadAdjustment > 0 ? -spreadBalance : spreadBalance;
  const nextBid = normalize(bid - spec.point * (spreadAdjustment - Math.trunc(spreadAdjustment / 2) + balance), spec.digits);
  const nextAsk = normalize(nextBid + spec.point * spread, spec.digits);
  if (nextBid > nextAsk) return { bid, ask };
  return { bid: nextBid, ask: nextAsk };
}
