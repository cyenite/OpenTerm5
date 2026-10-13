import assert from 'node:assert/strict';
import test from 'node:test';
import { adjustQuote, parseAccountModel, parseSymbolDetails, WEB_SYMBOL_DETAILS_BYTES } from './mt5-web-models';

function symbolPayload(): Buffer {
  const payload = Buffer.alloc(4 + WEB_SYMBOL_DETAILS_BYTES);
  payload.writeUInt32LE(1);
  const record = payload.subarray(4);
  const conditions = record.subarray(1536, 2164);
  record.write('EURUSD', 0, 'utf16le');
  record.write('Euro vs US Dollar', 96, 'utf16le');
  record.write('EUR', 1276, 'utf16le');
  record.write('USD', 1308, 'utf16le');
  record.write('EUR', 1340, 'utf16le');
  record.writeUInt32LE(5, 1392);
  record.writeDoubleLE(0.00001, 1396);
  record.writeUInt32LE(17, 1412);
  record.writeInt32LE(12, 1432);
  record.writeDoubleLE(9.8, 1440);
  record.writeDoubleLE(100000, 1456);
  record.writeUInt32LE(0, 1468);
  conditions.write('Forex\\Majors\\EURUSD', 0, 'utf16le');
  conditions.writeInt32LE(5, 256);
  conditions.writeInt32LE(1, 260);
  conditions.writeUInt32LE(4, 264);
  conditions.writeInt32LE(30, 268);
  conditions.writeInt32LE(10, 272);
  conditions.writeUInt32LE(2, 276);
  conditions.writeUInt32LE(3, 280);
  conditions.writeUInt32LE(15, 284);
  conditions.writeUInt32LE(127, 288);
  conditions.writeUInt32LE(777, 292);
  conditions.writeBigUInt64LE(500000000n, 316);
  conditions.writeBigUInt64LE(1000000n, 336);
  conditions.writeBigUInt64LE(10000000000n, 344);
  conditions.writeBigUInt64LE(1000000n, 352);
  conditions.writeDoubleLE(999, 516);
  conditions.writeDoubleLE(888, 524);
  conditions.writeDoubleLE(-7.25, 544);
  conditions.writeDoubleLE(1.75, 552);
  return payload;
}

function override(path: string): { path: string; raw: Buffer } {
  const raw = Buffer.alloc(628, 0xff);
  raw.fill(0, 0, 256);
  raw.write(path, 0, 'utf16le');
  for (const offset of [256, 260, 268, 272, 560]) raw.writeInt32LE(0x7fffffff, offset);
  for (const offset of [372, 380, 516, 524, 532, 544, 552, ...Array.from({ length: 16 }, (_, index) => 388 + index * 8), ...Array.from({ length: 7 }, (_, index) => 572 + index * 8)]) raw.writeDoubleLE(Number.MAX_VALUE, offset);
  return { path, raw };
}

test('account metadata preserves broker server, timezone, financial base and permission flags', () => {
  const payload = Buffer.alloc(816);
  payload.writeUInt8(1);
  payload.writeDoubleLE(10000, 9);
  payload.writeDoubleLE(100, 17);
  payload.write('USD', 25, 'utf16le');
  payload.writeUInt32LE(200, 93);
  payload.write('Test account', 97, 'utf16le');
  payload.write('MetaQuotes-Demo', 355, 'utf16le');
  payload.write('MetaQuotes', 483, 'utf16le');
  payload.writeInt32LE(7200, 739);
  payload.writeUInt8(1, 743);
  payload.writeUInt32LE(2, 744);
  const model = parseAccountModel(payload, 1234);
  assert.equal(model.account.tradeMode, 'demo');
  assert.equal(model.account.server, 'MetaQuotes-Demo');
  assert.equal(model.account.company, 'MetaQuotes');
  assert.equal(model.account.isHedging, true);
  assert.equal(model.account.isTradeAllowed, true);
  assert.equal(model.account.equity, 10100);
  assert.equal(model.serverOffsetSeconds, 10800);
  assert.equal(model.hasMargin, false);
  for (const bit of [4, 8, 512]) {
    payload.writeUInt32LE(bit, 1);
    assert.equal(parseAccountModel(payload, 1234).account.isTradeAllowed, false);
  }
  payload.writeUInt8(0);
  assert.equal(parseAccountModel(payload, 1234).account.tradeMode, 'real');
  payload.writeUInt8(2);
  assert.equal(parseAccountModel(payload, 1234).account.tradeMode, 'contest');
});

test('symbol details map currencies, actual stops/swaps/contract size and trade conditions', () => {
  const [details] = parseSymbolDetails(symbolPayload());
  assert.equal(details.id, 17);
  assert.equal(details.spec.currencyBase, 'EUR');
  assert.equal(details.spec.currencyProfit, 'USD');
  assert.equal(details.spec.currencyMargin, 'EUR');
  assert.equal(details.spec.contractSize, 100000);
  assert.equal(details.spec.stopsLevel, 30);
  assert.equal(details.spec.swapLong, -7.25);
  assert.equal(details.spec.swapShort, 1.75);
  assert.equal(details.spec.volumeMin, 0.01);
  assert.equal(details.spec.volumeMax, 100);
  assert.equal(details.trade.volumeStep, 0.01);
  assert.equal(details.trade.orderFlags, 127);
  assert.equal(details.trade.expirationFlags, 15);
  assert.equal(details.trade.instantVolumeMax, 5);
  assert.equal(details.calcMode, 0);
  assert.equal(details.spec.isSpreadFloat, false);
});

test('account path overrides honor exclusions, sentinels, and last matching reset to base', () => {
  const first = override('Forex\\*');
  const excluded = override('Forex\\*,!Forex\\Majors\\*');
  const last = override('*EURUSD');
  first.raw.writeInt32LE(99, 268);
  excluded.raw.writeInt32LE(80, 268);
  last.raw.writeInt32LE(8, 256);
  assert.equal(parseSymbolDetails(symbolPayload(), { tradeOverrides: [first, excluded] })[0].spec.stopsLevel, 99);
  const [details] = parseSymbolDetails(symbolPayload(), { tradeOverrides: [first, excluded, last] });
  assert.equal(details.spec.stopsLevel, 30);
  assert.equal(details.spreadAdjustment, 8);
  assert.equal(details.spec.swapLong, -7.25);
  assert.equal(details.spec.volumeStep, 0.01);
});

test('spread adjustment follows source G for positive, negative, zero and crossed spreads', () => {
  const [details] = parseSymbolDetails(symbolPayload());
  assert.deepEqual(adjustQuote(1.1, 1.10012, details), { bid: 1.09998, ask: 1.10015 });
  assert.deepEqual(adjustQuote(1.1, 1.1, details), { bid: 1.09998, ask: 1.10003 });
  assert.deepEqual(adjustQuote(1.1, 1.10012, { ...details, spreadAdjustment: -5 }), { bid: 1.10002, ask: 1.10009 });
  assert.deepEqual(adjustQuote(1.1, 1.10001, { ...details, spreadAdjustment: -5 }), { bid: 1.1, ask: 1.10001 });
  assert.deepEqual(adjustQuote(1.1, 0, details), { bid: 1.1, ask: 0 });
  assert.deepEqual(adjustQuote(1.1, 1.10012, { ...details, spreadAdjustment: 0 }), { bid: 1.1, ask: 1.10012 });
});

test('malformed records and invalid numeric fields are rejected without allocation from counts', () => {
  assert.throws(() => parseAccountModel(Buffer.alloc(815), 1), /Truncated/);
  const account = Buffer.alloc(820);
  account.writeUInt32LE(10000, 816);
  assert.throws(() => parseAccountModel(account, 1), /count exceeds/);
  assert.throws(() => parseSymbolDetails(Buffer.alloc(3)), /Truncated/);
  assert.throws(() => parseSymbolDetails(Buffer.from([255, 255, 255, 255])), /count does not match/);
  const symbol = symbolPayload();
  symbol.writeDoubleLE(NaN, 4 + 1396);
  assert.throws(() => parseSymbolDetails(symbol), /Non-finite/);
});

test('FIFO account policy follows source trailing flags and keeps absent or invalid rules unknown', () => {
  const base = Buffer.alloc(816);
  base.writeUInt32LE(2, 744);
  assert.equal(parseAccountModel(base, 123).account.isFifo, undefined);
  const empty = Buffer.concat([base, Buffer.alloc(4)]);
  assert.equal(parseAccountModel(empty, 123).account.isFifo, false);
  const extended = Buffer.concat([base, Buffer.alloc(4 + 628 + 4)]);
  extended.writeUInt32LE(1, 816);
  extended.writeInt32LE(256, 820 + 628);
  assert.equal(parseAccountModel(extended, 123).account.isFifo, true);
  extended.writeInt32LE(4096, 820 + 628);
  assert.equal(parseAccountModel(extended, 123).account.isFifo, undefined);
  extended.writeInt32LE(256, 820 + 628);
  extended.writeUInt32LE(0, 744);
  assert.equal(parseAccountModel(extended, 123).account.isFifo, false);
});
