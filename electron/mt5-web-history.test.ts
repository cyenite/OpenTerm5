import assert from 'node:assert/strict';
import test from 'node:test';
import { BinaryWriter } from './mt5-web-codec.js';
import { DEAL_RECORD_BYTES, decodeDealRecord, decodeHistory, decodeRates, encodeHistoryRequest, encodeRatesRequest } from './mt5-web-history.js';

function bar(time: number, open = 1.1): Buffer {
  return new BinaryWriter(48).i32(time).f64(open).f64(1.3).f64(1.0).f64(1.2).u32(23).f64(5).finish();
}

function deal(): Buffer {
  return new BinaryWriter(DEAL_RECORD_BYTES)
    .i64(12n).fixedString('external', 64).i64(13n).u32(1700000000).u32(1700000001)
    .fixedString('EURUSD', 64).u32(1).u32(1).f64(1.125).f64(1.126).f64(1.12).f64(1.13)
    .u64(10_000_000n).f64(3.5).f64(1).f64(1).f64(-0.5).f64(-0.25).i64(0n).i64(14n)
    .fixedString('closed', 64).f64(100000).u32(5).u32(2).u32(0).i32(125).i32(250).f64(-0.1).finish();
}

test('chart history request matches independently constructed little-endian vector', () => {
  const expected = Buffer.alloc(74);
  expected.write('EURUSD', 0, 'utf16le');
  expected.writeUInt16LE(16385, 64);
  expected.writeInt32LE(1700000000, 66);
  expected.writeInt32LE(1700100000, 70);
  assert.deepEqual(encodeRatesRequest('EURUSD', 'H1', 1700000000, 1700100000), expected);
  assert.equal(encodeRatesRequest('EURUSD', 'MN1', 0, 1).readUInt16LE(64), 49153);
  assert.equal(encodeRatesRequest('EURUSD', 'D1', 0, 1).readUInt16LE(64), 16408);
  assert.throws(() => encodeRatesRequest('EURUSD', 'M2', 0, 1), /not supported/);
  assert.throws(() => encodeRatesRequest('EURUSD', 'M1', 2, 1), /reversed/);
  assert.throws(() => encodeRatesRequest('EURUSD', 'M1', 0, 0x80000000), /timestamp/);
  assert.throws(() => encodeRatesRequest('X'.repeat(33), 'M1', 0, 1), /exceeds/);
});

test('chart bars decode double prices and tick volume without scaling', () => {
  assert.deepEqual(decodeRates(Buffer.concat([bar(1700000000), bar(1700000060)])), [
    { time: 1700000000, open: 1.1, high: 1.3, low: 1, close: 1.2, volume: 23 },
    { time: 1700000060, open: 1.1, high: 1.3, low: 1, close: 1.2, volume: 23 },
  ]);
  assert.deepEqual(decodeRates(Buffer.alloc(0)), []);
  assert.throws(() => decodeRates(bar(1).subarray(1)), /record length/);
  assert.throws(() => decodeRates(Buffer.concat([bar(1), bar(1)])), /increasing/);
  assert.throws(() => decodeRates(bar(-1)), /timestamp/);
  assert.throws(() => decodeRates(bar(1, 1.4)), /prices/);
  const invalid = bar(1);
  invalid.writeDoubleLE(Number.NaN, 4);
  assert.throws(() => decodeRates(invalid), /Non-finite/);
});

test('history request encodes seconds and rejects unsafe ranges', () => {
  assert.equal(encodeHistoryRequest(1700000000, 1700100000).toString('hex'), '00f15365a0775565');
  assert.throws(() => encodeHistoryRequest(-1, 1), /timestamp/);
  assert.throws(() => encodeHistoryRequest(2, 1), /reversed/);
  assert.throws(() => encodeHistoryRequest(0, 0.5), /timestamp/);
});

test('deal history decodes milliseconds, financial values, volume and tickets', () => {
  const decoded = decodeDealRecord(deal());
  assert.deepEqual(decoded, { type: 'sell', entry: 'out', symbol: 'EURUSD', comment: 'closed', fee: -0.1, swap: -0.25, time: 1700000000125, order: 13, price: 1.125, ticket: 12, volume: 0.1, profit: 3.5, positionId: 14, commission: -0.5 });
  assert.deepEqual(decodeHistory(Buffer.concat([new BinaryWriter(4).u32(1).finish(), deal(), Buffer.alloc(4)])), { deals: [decoded], orders: [] });
  assert.deepEqual(decodeHistory(Buffer.alloc(8)), { deals: [], orders: [] });
  const unknown = deal();
  unknown.writeUInt32LE(999, 152);
  assert.equal(decodeDealRecord(unknown).type, 'unknown:999');
});

test('history parser rejects malformed counts, trailing fields and unsafe identifiers', () => {
  assert.throws(() => decodeHistory(new BinaryWriter(4).u32(0xffffffff).finish()), /Truncated/);
  assert.throws(() => decodeHistory(Buffer.alloc(9)), /trailing/);
  assert.throws(() => decodeDealRecord(deal().subarray(1)), /length/);
  const unsafe = deal();
  unsafe.writeBigInt64LE(9007199254740992n, 0);
  assert.throws(() => decodeDealRecord(unsafe), /Unsafe deal ticket/);
  const badEntry = deal();
  badEntry.writeUInt32LE(4, 156);
  assert.throws(() => decodeDealRecord(badEntry), /entry/);
  const badTime = deal();
  badTime.writeInt32LE(1000, 340);
  assert.throws(() => decodeDealRecord(badTime), /millisecond/);
  const badProfit = deal();
  badProfit.writeDoubleLE(Number.POSITIVE_INFINITY, 200);
  assert.throws(() => decodeDealRecord(badProfit), /Non-finite/);
});
