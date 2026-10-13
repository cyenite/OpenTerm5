import assert from 'node:assert/strict';
import test from 'node:test';
import { BinaryWriter } from './mt5-web-codec';
import type { WebSymbolDetails } from './mt5-web-models';
import { adjustDepthPrice, decodeDepth, WebDepthBook, type WebDepthUpdate } from './mt5-web-depth';

const snapshot: WebDepthUpdate = { id: 17, digits: 0, flags: 2, time: 1700000000, levels: [
  { time: 1, type: 1, price: 110010n, volume: 200n },
  { time: 1, type: 2, price: 110000n, volume: 150n },
] };

test('depth decoder follows 22-byte header and 21-byte level source schema', () => {
  const payload = new BinaryWriter(4 + 22 + 42).u32(1).u32(17).i32(0).i32(0).u32(1700000000).u32(2).u16(2)
    .u32(1).u8(1).i64(110010n).i64(200n).u32(1).u8(2).i64(110000n).i64(150n).finish();
  assert.deepEqual(decodeDepth(payload), [snapshot]);
  assert.throws(() => decodeDepth(payload.subarray(0, -1)), /exceeds|Truncated/);
  assert.throws(() => decodeDepth(Buffer.concat([payload, Buffer.from([0])])), /trailing/);
  assert.deepEqual(decodeDepth(Buffer.alloc(4)), []);
});

test('depth snapshot uses symbol digits rather than wire digits and actual instrument volumes', () => {
  const book = new WebDepthBook('EURUSD', 5);
  assert.deepEqual(book.apply(snapshot), { symbol: 'EURUSD', isAvailable: true, levels: [
    { side: 'sell', price: 1.1001, volume: 0.000002 }, { side: 'buy', price: 1.1, volume: 0.0000015 },
  ] });
});

test('depth deltas add signed volumes, zero removes; unmatched deletion invalidates snapshot', () => {
  const book = new WebDepthBook('EURUSD', 5);
  book.apply(snapshot);
  assert.equal(book.apply({ ...snapshot, flags: 0, levels: [{ ...snapshot.levels[0], volume: -50n }] })?.levels[0].volume, 0.0000015);
  assert.equal(book.apply({ ...snapshot, flags: 0, levels: [{ ...snapshot.levels[0], volume: 0n }] })?.levels.length, 1);
  assert.equal(book.apply({ ...snapshot, flags: 0, levels: [{ ...snapshot.levels[0], volume: 0n }] }), null);
  assert.equal(book.apply({ ...snapshot, flags: 0 }), null);
  assert.ok(book.apply(snapshot));
});

test('reset markers establish a new snapshot and empty snapshots report unavailable without generated volume', () => {
  const book = new WebDepthBook('EURUSD', 5);
  assert.equal(book.apply({ ...snapshot, flags: 0 }), null);
  assert.ok(book.apply({ ...snapshot, flags: 0, levels: [{ type: 0, time: 1, price: 0n, volume: 0n }, ...snapshot.levels] }));
  assert.deepEqual(book.apply({ ...snapshot, flags: 0, levels: [{ type: 0, time: 1, price: 0n, volume: 0n }] }), { symbol: 'EURUSD', isAvailable: false, levels: [] });
});

test('unsafe volumes and negative accumulated volumes fail explicitly', () => {
  const book = new WebDepthBook('EURUSD', 5);
  assert.equal(book.apply({ ...snapshot, levels: [{ ...snapshot.levels[0], volume: 9007199254740992n }] }), null);
  book.apply(snapshot);
  assert.equal(book.apply({ ...snapshot, flags: 0, levels: [{ ...snapshot.levels[0], volume: -201n }] }), null);
});


test('depth adjusts each side independently, including a narrowed spread', () => {
  const detail = { spec: { digits: 5, point: 0.00001 }, spreadAdjustment: -3, spreadBalance: 1 } as WebSymbolDetails;
  assert.equal(adjustDepthPrice(1.1, 'buy', detail), 1.10001);
  assert.equal(adjustDepthPrice(1.1001, 'sell', detail), 1.10008);
  assert.equal(adjustDepthPrice(1.1001, 'sell', { ...detail, spreadAdjustment: 3 }), 1.10012);
});
