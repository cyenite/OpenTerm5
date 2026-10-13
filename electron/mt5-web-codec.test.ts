import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BinaryReader, BinaryWriter, MAX_FRAME_BYTES, decodeFrame, decodeResponse, encodeCommand, encodeFrame } from './mt5-web-codec';

test('frame matches independently specified little-endian bytes', () => {
  const frame = Buffer.from('0300000001000000aabbcc', 'hex');
  assert.deepEqual(encodeFrame(Buffer.from('aabbcc', 'hex')), frame);
  assert.deepEqual(decodeFrame(frame, 1), Buffer.from('aabbcc', 'hex'));
  assert.deepEqual(decodeFrame(Buffer.from('0300000000000000aabbcc', 'hex')), Buffer.from('aabbcc', 'hex'));
  assert.throws(() => decodeFrame(frame), /marker/);
  assert.throws(() => decodeFrame(Buffer.from('0300000000000000aabbcc', 'hex'), 1), /marker/);
});

test('request noise, command and response status occupy distinct fields', () => {
  const noise = Uint8Array.of(0x12, 0x34);
  assert.deepEqual(encodeCommand(0x5678, Uint8Array.of(0xaa), noise), Buffer.from('12347856aa', 'hex'));
  assert.deepEqual(decodeResponse(Buffer.from('1234785607aabb', 'hex')), {
    command: 0x5678, status: 7, payload: Buffer.from('aabb', 'hex'),
  });
  assert.deepEqual(decodeResponse(Buffer.from('0000000000', 'hex')), {
    command: 0, status: 0, payload: Buffer.alloc(0),
  });
});

test('numeric fields match known vectors and preserve large 64-bit integers', () => {
  const vector = Buffer.from('ab3412efcdab89feffffff01000000000020000000000000000080000000000000f83f', 'hex');
  const writer = new BinaryWriter(vector.length);
  assert.deepEqual(writer.u8(0xab).u16(0x1234).u32(0x89abcdef).i32(-2)
    .u64(9007199254740993n).i64(-9223372036854775808n).f64(1.5).finish(), vector);
  const reader = new BinaryReader(vector);
  assert.equal(reader.u8(), 0xab);
  assert.equal(reader.u16(), 0x1234);
  assert.equal(reader.u32(), 0x89abcdef);
  assert.equal(reader.i32(), -2);
  assert.equal(reader.u64(), 9007199254740993n);
  assert.equal(reader.i64(), -9223372036854775808n);
  assert.equal(reader.f64(), 1.5);
  assert.equal(reader.remaining, 0);
  reader.finish();
});

test('UTF-16 strings preserve Unicode code units and pad the fixed field', () => {
  const vector = Buffer.from('4100a9033dd800de00000000', 'hex');
  assert.deepEqual(new BinaryWriter(12).fixedString('AΩ😀', 12).finish(), vector);
  assert.equal(new BinaryReader(vector).fixedString(12), 'AΩ😀');
  assert.equal(new BinaryReader(Buffer.from('41004200', 'hex')).fixedString(4), 'AB');
  assert.deepEqual(new BinaryWriter(0).fixedString('', 0).finish(), Buffer.alloc(0));
  assert.throws(() => new BinaryWriter(2).fixedString('😀', 2), /exceeds/);
  assert.throws(() => new BinaryWriter(4).fixedString('A\0', 4), /null/);
  assert.throws(() => new BinaryWriter(3).fixedString('A', 3), /even/);
  assert.throws(() => new BinaryReader(Buffer.alloc(3)).fixedString(3), /even/);
});

test('sliced Uint8Arrays and Buffers retain only the selected bytes', () => {
  const source = Uint8Array.of(0xff, 0xaa, 0xbb, 0xee);
  const selected = source.subarray(1, 3);
  assert.deepEqual(new BinaryWriter(2).bytes(selected).finish(), Buffer.from('aabb', 'hex'));
  const reader = new BinaryReader(selected);
  source[1] = 0;
  assert.equal(reader.u16(), 0xbbaa);
  const wrapped = Buffer.concat([Buffer.from([99]), encodeFrame(selected), Buffer.from([88])]);
  assert.deepEqual(decodeFrame(wrapped.subarray(1, -1), 1), Buffer.from([0, 0xbb]));
});

test('frames reject truncated headers, lengths, extra bytes, bad markers and oversized data', () => {
  const frame = Buffer.from('0300000001000000aabbcc', 'hex');
  for (let length = 0; length < frame.length; length++) {
    assert.throws(() => decodeFrame(frame.subarray(0, length), 1), RangeError);
  }
  assert.throws(() => decodeFrame(Buffer.concat([frame, Buffer.from([0])]), 1), /length/);
  assert.throws(() => decodeFrame(Buffer.from('0000000002000000', 'hex')), /marker/);
  assert.throws(() => decodeFrame(Buffer.from('ffffffff00000000', 'hex')), /length/);
  assert.throws(() => decodeFrame(Buffer.alloc(MAX_FRAME_BYTES + 1)), /size/);
  assert.throws(() => encodeFrame(Buffer.alloc(MAX_FRAME_BYTES - 7)), /size/);
  assert.deepEqual(decodeFrame(encodeFrame(Buffer.alloc(0)), 1), Buffer.alloc(0));
});

test('responses reject every truncated inner header and request fields reject invalid values', () => {
  for (let length = 0; length < 5; length++) {
    assert.throws(() => decodeResponse(Buffer.alloc(length)), /Truncated/);
  }
  for (const command of [-1, 65536, 1.5, NaN]) {
    assert.throws(() => encodeCommand(command, Buffer.alloc(0)), RangeError);
  }
  assert.throws(() => encodeCommand(1, Buffer.alloc(0), Buffer.alloc(1)), /noise/);
});

test('binary fields reject range violations and incomplete or excessive reads and writes', () => {
  assert.throws(() => new BinaryWriter(-1), RangeError);
  assert.throws(() => new BinaryReader(Buffer.alloc(0)).u64(), /Truncated/);
  assert.throws(() => new BinaryReader(Buffer.alloc(1)).bytes(-1), /size/);
  assert.throws(() => new BinaryReader(Buffer.alloc(1)).finish(), /trailing/);
  assert.throws(() => new BinaryWriter(1).u16(1), /exceeds/);
  assert.throws(() => new BinaryWriter(1).finish(), /fill/);
  assert.throws(() => new BinaryWriter(1).u8(256), RangeError);
  assert.throws(() => new BinaryWriter(2).u16(-1), RangeError);
  assert.throws(() => new BinaryWriter(4).u32(4294967296), RangeError);
  assert.throws(() => new BinaryWriter(4).i32(-2147483649), RangeError);
  assert.throws(() => new BinaryWriter(8).u64(-1n), RangeError);
  assert.throws(() => new BinaryWriter(8).u64(18446744073709551616n), RangeError);
  assert.throws(() => new BinaryWriter(8).i64(9223372036854775808n), RangeError);
  assert.throws(() => new BinaryWriter(8).f64(Infinity), RangeError);
});
