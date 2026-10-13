import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSymbolSubscription, parseSymbols, parseTickUpdates, type WebSymbol } from './mt5-web-market';

const symbol: WebSymbol = Object.freeze({ id: 7, name: 'EURUSD', description: 'Euro', digits: 5, path: 'Forex', calcMode: 0, basis: '', flags: 0 });
const symbols = new Map([[7, symbol]]);

function symbolFixture(): Buffer {
  const bytes = Buffer.alloc(530);
  bytes.writeUInt32LE(1, 0);
  bytes.write('EURUSD', 4, 'utf16le');
  bytes.write('Euro / Dollar Ω', 68, 'utf16le');
  bytes.writeUInt32LE(5, 196);
  bytes.writeUInt32LE(7, 200);
  bytes.write('Forex\\Majors', 204, 'utf16le');
  bytes.writeUInt32LE(2, 460);
  bytes.write('EUR', 464, 'utf16le');
  bytes.writeUInt16LE(0x1234, 528);
  return bytes;
}

function compactFixture(): Buffer {
  return Buffer.from('0700000000f153650b000000000000000068fb400000000000ccfb40000000000030fc400100000000002000410100000002', 'hex');
}

function snapshotFixture(): Buffer {
  const bytes = Buffer.alloc(274);
  bytes.writeUInt32LE(7, 0);
  bytes.writeBigInt64LE(1n | 8n | 64n | 512n | (1n << 40n), 4);
  bytes.writeInt32LE(1700000000, 12);
  bytes.writeUInt32LE(3, 16);
  bytes.writeDoubleLE(1234, 20);
  bytes.writeDoubleLE(1235, 44);
  bytes.writeDoubleLE(1233, 68);
  bytes.writeBigInt64LE(9007199254740993n, 92);
  bytes.writeBigInt64LE(1700000000321n, 208);
  bytes.writeUInt16LE(1, 272);
  return bytes;
}

test('symbol records decode their published offsets including Unicode', () => {
  assert.deepEqual(parseSymbols(symbolFixture()).symbols, [{
    id: 7, name: 'EURUSD', description: 'Euro / Dollar Ω', digits: 5,
    path: 'Forex\\Majors', calcMode: 2, basis: 'EUR', flags: 0x1234,
  }]);
  assert.deepEqual(parseSymbols(Buffer.from('00000000', 'hex')).symbols, []);
});

test('symbols reject malformed counts, truncated records and duplicate identifiers', () => {
  const bytes = symbolFixture();
  assert.throws(() => parseSymbols(bytes.subarray(0, -1)), /count/);
  assert.throws(() => parseSymbols(Buffer.alloc(3)), /Truncated/);
  assert.throws(() => parseSymbols(Buffer.from('ffffffff', 'hex')), /count/);
  const duplicates = Buffer.concat([Buffer.from('02000000', 'hex'), bytes.subarray(4), bytes.subarray(4)]);
  assert.throws(() => parseSymbols(duplicates), /Duplicate/);
  duplicates.writeUInt32LE(8, 726);
  assert.throws(() => parseSymbols(duplicates), /Duplicate/);
});

test('the observed symbol-list extension is preserved and other extra sizes are refused', () => {
  const extension = Buffer.alloc(16, 0x55);
  const parsed = parseSymbols(Buffer.concat([symbolFixture(), extension]));
  assert.deepEqual(parsed.extension, extension);
  assert.equal(parsed.symbols.length, 1);
  assert.throws(() => parseSymbols(Buffer.concat([symbolFixture(), Buffer.alloc(1)])), /count/);
});

test('compact quote vector keeps mask updates partial and volume lossless', () => {
  const [tick] = parseTickUpdates(8, compactFixture(), symbols);
  assert.equal(tick.id, 7);
  assert.equal(tick.symbol, 'EURUSD');
  assert.equal(tick.timeMs, 1700000000321);
  assert.equal(tick.bid, 1.12256);
  assert.equal(tick.ask, 1.13856);
  assert.equal(tick.last, undefined);
  assert.equal(tick.volume, 9007199254740993n);
  assert.equal(tick.isDelayed, true);
  assert.equal(tick.rawFields.last, 115456);
  assert.equal(tick.rawFields.mask, 11n);
});

test('snapshot quotes use symbol precision and preserve wire digits, unknown bits and timestamp', () => {
  const [tick] = parseTickUpdates(17, snapshotFixture(), symbols);
  assert.equal(tick.bid, 0.01234);
  assert.equal(tick.ask, 0.01235);
  assert.equal(tick.last, 0.01233);
  assert.equal(tick.volume, 9007199254740993n);
  assert.equal(tick.timeMs, 1700000000321);
  assert.equal(tick.isDelayed, true);
  assert.equal(tick.rawFields.digits, 5);
  assert.equal(tick.rawFields.wireDigits, 3);
  assert.ok((tick.rawFields.mask & (1n << 40n)) !== 0n);
  assert.deepEqual(tick.rawFields.record, snapshotFixture());
});

test('snapshot mask does not publish unmodified values and precision is capped at eight', () => {
  const bytes = snapshotFixture();
  bytes.writeBigInt64LE(8n, 4);
  bytes.writeUInt32LE(12, 16);
  bytes.writeDoubleLE(123456789, 44);
  bytes.writeUInt16LE(0, 272);
  const [tick] = parseTickUpdates(17, bytes, new Map([[7, { ...symbol, digits: 12 }]]));
  assert.equal(tick.bid, undefined);
  assert.equal(tick.ask, 1.23456789);
  assert.equal(tick.last, undefined);
  assert.equal(tick.volume, undefined);
  assert.equal(tick.isDelayed, false);
});

test('tick streams reject partial records, unknown symbols and unsafe timestamps', () => {
  assert.throws(() => parseTickUpdates(8, compactFixture().subarray(1), symbols), /Truncated/);
  assert.throws(() => parseTickUpdates(17, snapshotFixture().subarray(1), symbols), /Truncated/);
  assert.throws(() => parseTickUpdates(8, compactFixture(), new Map()), /Unknown/);
  const bytes = snapshotFixture();
  bytes.writeBigInt64LE(9007199254740992n, 208);
  assert.throws(() => parseTickUpdates(17, bytes, symbols), /safely/);
  bytes.writeBigInt64LE(-9007199254740992n, 208);
  assert.throws(() => parseTickUpdates(17, bytes, symbols), /safely/);
  bytes.writeBigInt64LE(1n, 208);
  bytes.writeDoubleLE(NaN, 20);
  assert.throws(() => parseTickUpdates(17, bytes, symbols), /finite/);
});

test('tick streams support multiple records and empty updates without mutating source', () => {
  const bytes = snapshotFixture();
  const ticks = parseTickUpdates(17, Buffer.concat([bytes, bytes]), symbols);
  assert.equal(ticks.length, 2);
  bytes.fill(0);
  assert.equal(ticks[0].id, 7);
  assert.equal(ticks[0].rawFields.record.readUInt32LE(0), 7);
  assert.ok(Object.isFrozen(ticks));
  assert.ok(Object.isFrozen(ticks[0]));
  assert.deepEqual(parseTickUpdates(8, Buffer.alloc(0), symbols), []);
});

test('initial snapshots with wire digits zero still use symbol scale and legacy timestamp fallback', () => {
  const bytes = snapshotFixture();
  bytes.writeUInt32LE(0, 16);
  bytes.writeDoubleLE(111831, 20);
  bytes.writeBigInt64LE(0n, 208);
  const [tick] = parseTickUpdates(17, bytes, symbols);
  assert.equal(tick.bid, 1.11831);
  assert.equal(tick.timeMs, 1700000000000);
  assert.equal(tick.rawFields.wireDigits, 0);
});

test('fractional raw prices use symmetric rounding at the broker precision', () => {
  const bytes = compactFixture();
  bytes.writeDoubleLE(111831.5, 12);
  bytes.writeDoubleLE(-111831.5, 20);
  const [tick] = parseTickUpdates(8, bytes, symbols);
  assert.equal(tick.bid, 1.11832);
  assert.equal(tick.ask, -1.11832);
});

test('subscription encodes count and IDs with independent byte expectations', () => {
  assert.deepEqual(buildSymbolSubscription([7, 0x12345678]), Buffer.from('020000000700000078563412', 'hex'));
  assert.deepEqual(buildSymbolSubscription([]), Buffer.from('00000000', 'hex'));
  assert.throws(() => buildSymbolSubscription([7, 7]), /Duplicate/);
  for (const id of [-1, 0x100000000, 1.5, NaN]) {
    assert.throws(() => buildSymbolSubscription([id]), RangeError);
  }
});
