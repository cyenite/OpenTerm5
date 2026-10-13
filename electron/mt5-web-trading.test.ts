import assert from 'node:assert/strict';
import test from 'node:test';
import { BinaryWriter } from './mt5-web-codec';
import { encodeTradeRequest, encodeTradeVolume, parseTradeAdmission, parseTradeResponse, parseTradeSnapshot, parseWebOrder, parseWebPosition, safeTradeNumber, WEB_ORDER_BYTES, WEB_POSITION_BYTES } from './mt5-web-trading';

const context = { digits: 5, requestId: 17, executionMode: 2, fillingFlags: 3, volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01, symbol: 'EURUSD' };

test('market buy and sell requests match recovered command 12 offsets', () => {
  for (const [type, code] of [['buy', 0], ['sell', 1]] as const) {
    const bytes = encodeTradeRequest({ action: 'deal', type, symbol: 'EURUSD', volume: 0.12, sl: 1.05, tp: 1.2 }, context);
    assert.equal(bytes.length, 248);
    assert.equal(bytes.readUInt32LE(0), 17);
    assert.equal(bytes.readUInt32LE(4), 3);
    assert.equal(bytes.readBigUInt64LE(72), 12000000n);
    assert.equal(bytes.readUInt32LE(92), code);
    assert.equal(bytes.readUInt32LE(96), 1);
    assert.equal(bytes.readDoubleLE(112), 0);
    assert.equal(bytes.readDoubleLE(128), 1.05);
    assert.equal(bytes.readDoubleLE(136), 1.2);
  }
});

test('pending, modify, remove and stop modifications preserve action and identifiers', () => {
  for (const type of ['buyLimit', 'sellLimit', 'buyStop', 'sellStop', 'buyStopLimit', 'sellStopLimit'] as const) {
    const bytes = encodeTradeRequest({ action: 'pending', type, volume: 0.01, price: 1.2, stoplimit: 1.1, expiration: 1700000000 }, context);
    assert.equal(bytes.readUInt32LE(4), 5);
    assert.equal(bytes.readUInt32LE(100), 2);
    assert.equal(bytes.readUInt32LE(244), 1700000000);
    assert.equal(bytes.readDoubleLE(120), 1.1);
  }
  for (const [action, code] of [['sltp', 6], ['modify', 7], ['remove', 8]] as const) {
    const bytes = encodeTradeRequest({ action, position: 99, order: 88, type: 'buyLimit', price: 1.2, volume: 0.01, sl: 1.1, tp: 1.2 }, context);
    assert.equal(bytes.readUInt32LE(4), code);
    assert.equal(bytes.readUInt32LE(96), 0);
    assert.equal(bytes.readUInt32LE(104), 0);
    assert.equal(bytes.readBigUInt64LE(84), 88n);
    assert.equal(bytes.readBigUInt64LE(228), 99n);
  }
  const close = encodeTradeRequest({ action: 'deal', type: 'sell', volume: 0.01, position: 99 }, context);
  assert.equal(close.readUInt32LE(104), 3);
  assert.equal(close.readBigUInt64LE(228), 99n);
});

test('rejects unsafe identifiers, unsupported actions and malformed requests', () => {
  assert.throws(() => safeTradeNumber(9007199254740992n));
  assert.throws(() => encodeTradeVolume(0.000000001));
  assert.throws(() => encodeTradeRequest({ action: 'closeBy' }, context));
  assert.throws(() => encodeTradeRequest({ action: 'deal', type: 'buy', volume: 0.015 }, context));
  assert.throws(() => encodeTradeRequest({ action: 'deal', type: 'buy', volume: 0.01, deviation: 20 }, context));
  assert.throws(() => encodeTradeRequest({ action: 'pending', type: 'buyStopLimit', volume: 0.01, price: 1 }, context));
  assert.throws(() => encodeTradeRequest({ action: 'deal', type: 'buy', volume: 0.01 }, { ...context, executionMode: 0 }));
});

test('admission is not execution and notification carries correlated final result', () => {
  assert.equal(parseTradeAdmission(new BinaryWriter(4).u32(0).finish()), 0);
  assert.throws(() => parseTradeAdmission(Buffer.alloc(5)));
  const request = encodeTradeRequest({ action: 'deal', type: 'buy', volume: 0.01 }, context);
  for (const code of [10001, 10008, 10009, 10010, 10012]) {
    const bytes = new BinaryWriter(380).u32(0).bytes(request).u32(code).i64(101n).i64(102n).i64(1000000n).f64(1.1).u32(1700000000).f64(1.09).f64(1.1).f64(0).fixedString('result', 64).finish();
    const parsed = parseTradeResponse(bytes);
    assert.equal(parsed.requestId, 17);
    assert.equal(parsed.isFinal, code !== 10001);
    assert.equal(parsed.result.isSuccess, [10008, 10009, 10010].includes(code));
    assert.equal(parsed.result.volume, 0.01);
    assert.equal(parsed.result.order, 102);
    assert.throws(() => parseTradeResponse(bytes.subarray(0, 379)));
  }
});

test('position and order records decode fixed offsets and snapshot counts', () => {
  const position = Buffer.alloc(WEB_POSITION_BYTES);
  position.writeBigInt64LE(51n, 0);
  position.writeUInt32LE(1700000000, 16);
  position.write('EURUSD', 24, 'utf16le');
  position.writeUInt32LE(1, 88);
  position.writeDoubleLE(1.2, 92);
  position.writeDoubleLE(1.1, 100);
  position.writeBigUInt64LE(12000000n, 124);
  position.writeDoubleLE(5.5, 132);
  position.writeDoubleLE(-0.5, 164);
  position.write('hello', 188, 'utf16le');
  position.writeInt32LE(123, 336);
  const order = Buffer.alloc(WEB_ORDER_BYTES);
  order.writeBigInt64LE(52n, 0);
  order.write('EURUSD', 72, 'utf16le');
  order.writeUInt32LE(2, 148);
  order.writeUInt32LE(1700000000, 136);
  order.writeInt32LE(456, 348);
  order.writeUInt32LE(2, 156);
  order.writeDoubleLE(1.1, 164);
  order.writeDoubleLE(1.05, 172);
  order.writeBigInt64LE(1000000n, 204);
  order.writeBigInt64LE(1000000n, 212);
  const snapshot = parseTradeSnapshot(new BinaryWriter(8 + position.length + order.length).u32(1).bytes(position).u32(1).bytes(order).finish());
  assert.equal(snapshot.positions[0].side, 'sell');
  assert.equal(snapshot.positions[0].profit, 5.5);
  assert.equal(snapshot.positions[0].swap, -0.5);
  assert.equal(snapshot.positions[0].volume, 0.12);
  assert.equal(snapshot.positions[0].time, 1700000000123);
  assert.equal(snapshot.orders[0].type, 'buyLimit');
  assert.equal(snapshot.orders[0].volume, 0.01);
  assert.equal(snapshot.orders[0].time, 1700000000456);
  assert.equal(snapshot.orders[0].stoplimit, 1.05);
  assert.equal(snapshot.orders[0].expirationMode, 2);
  assert.throws(() => parseTradeSnapshot(Buffer.alloc(7)));
  assert.throws(() => parseTradeSnapshot(new BinaryWriter(8).u32(2).u32(0).finish()));
  assert.throws(() => parseWebPosition(position.subarray(1)));
  assert.throws(() => parseWebOrder(order.subarray(1)));
  position.writeBigInt64LE(9007199254740992n, 0);
  assert.throws(() => parseWebPosition(position));
});

 test('permission flags, unknown types, negative values and incomplete modifications fail closed', () => {
  const request = { action: 'deal', type: 'buy', volume: 0.01 } as const;
  assert.throws(() => encodeTradeRequest(request, { ...context, requestId: 1.5 }));
  assert.throws(() => encodeTradeRequest(request, { ...context, requestId: 0x100000000 }));
  assert.throws(() => encodeTradeRequest(request, { ...context, orderFlags: 0 }));
  assert.throws(() => encodeTradeRequest({ ...request, sl: -1 }, context));
  assert.throws(() => encodeTradeRequest({ ...request, type: 'unknown' } as never, context));
  assert.throws(() => encodeTradeRequest({ action: 'modify', order: 5 }, context));
  assert.throws(() => encodeTradeRequest({ action: 'pending', type: 'buyLimit', volume: 0.01, price: 1.2, expiration: 100 }, { ...context, expirationFlags: 1 }));
  assert.throws(() => encodeTradeRequest({ ...request, sl: 1 }, { ...context, orderFlags: 1 }));
  assert.throws(() => encodeTradeRequest({ ...request, price: 1.1, volume: 1 }, { ...context, executionMode: 1, instantVolumeMax: 0.5 }));
});

test('close-by encodes source opcode, two position identifiers and closing flags', () => {
  const request = { action: 'closeBy', position: 51, positionBy: 52, type: 'sell', volume: 0.12, price: 1.1 } as const;
  const bytes = encodeTradeRequest(request, { ...context, orderFlags: 64 });
  assert.equal(bytes.readUInt32LE(4), 10);
  assert.equal(bytes.readBigUInt64LE(72), 12000000n);
  assert.equal(bytes.readUInt32LE(92), 1);
  assert.equal(bytes.readUInt32LE(96), 0);
  assert.equal(bytes.readUInt32LE(104), 3);
  assert.equal(bytes.readDoubleLE(112), 1.1);
  assert.equal(bytes.readBigUInt64LE(228), 51n);
  assert.equal(bytes.readBigUInt64LE(236), 52n);
  assert.throws(() => encodeTradeRequest({ ...request, positionBy: 51 }, { ...context, orderFlags: 64 }), /distinct/);
  assert.throws(() => encodeTradeRequest(request, { ...context, orderFlags: 63 }), /disabled/);
  assert.throws(() => encodeTradeRequest({ ...request, positionBy: Number.MAX_SAFE_INTEGER + 1 }, { ...context, orderFlags: 64 }), /identifier/);
});
