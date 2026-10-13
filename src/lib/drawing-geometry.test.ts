import test from 'node:test';
import assert from 'node:assert/strict';
import { fibonacciLevels, fibonacciRatios, isDrawing, rectangleBounds } from './drawing-geometry';

test('Fibonacci levels retrace from the second anchor toward the first without losing direction', () => {
  const upward = fibonacciLevels({ time: 1, price: 100 }, { time: 2, price: 200 });
  assert.deepEqual(fibonacciRatios, [0, 0.236, 0.382, 0.5, 0.618, 1, 1.618, 2.618, 4.236]);
  assert.equal(upward[0].price, 200);
  assert.equal(upward[3].price, 150);
  assert.equal(upward[5].price, 100);
  assert.ok(Math.abs(upward[6].price - 38.2) < 1e-9);
  const downward = fibonacciLevels({ time: 1, price: 200 }, { time: 2, price: 100 });
  assert.equal(downward[0].price, 100);
  assert.equal(downward[5].price, 200);
  assert.equal(downward[6].price, 261.8);
});

test('rectangle normalization is independent of click direction and handles equal timestamps', () => {
  assert.deepEqual(rectangleBounds({ time: 10, price: 50 }, { time: 5, price: 80 }), { startTime: 5, endTime: 10, lowPrice: 50, highPrice: 80 });
  assert.equal(rectangleBounds({ time: 5, price: 50 }, { time: 5, price: 80 }).startTime, 5);
});

test('persisted drawing validation accepts all supported kinds and rejects nonfinite anchors', () => {
  for (const kind of ['trend', 'rectangle', 'fibonacci']) assert.equal(isDrawing({ id: 'one', kind, from: { time: 1, price: 1 }, to: { time: 2, price: 2 } }), true);
  assert.equal(isDrawing({ id: 'one', kind: 'vline', time: 1 }), true);
  assert.equal(isDrawing({ id: 'one', kind: 'ray', from: { time: 1, price: 1 } }), true);
  assert.equal(isDrawing({ id: 'one', kind: 'ray', from: { time: Infinity, price: 1 } }), false);
  assert.equal(isDrawing({ id: 'one', kind: 'unknown' }), false);
});
