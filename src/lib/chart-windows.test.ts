import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrangeFrames, clampFrame, isFrame, moveFrame, raise, resizeFrame } from './chart-windows';

const area = (frames: { width: number; height: number }[]) => frames.reduce((sum, frame) => sum + frame.width * frame.height, 0);

test('tiling covers the workspace exactly once', () => {
  for (const count of [1, 2, 3, 4, 5, 7]) {
    for (const arrangement of ['tile', 'tileHorizontally', 'tileVertically'] as const) {
      const frames = arrangeFrames(count, arrangement);
      assert.equal(frames.length, count);
      assert.ok(Math.abs(area(frames) - 1) < 1e-9, `${arrangement} with ${count}`);
      assert.ok(frames.every((frame) => frame.left + frame.width <= 1 + 1e-9 && frame.top + frame.height <= 1 + 1e-9));
    }
  }
  assert.deepEqual(arrangeFrames(2, 'tileVertically').map((frame) => frame.left), [0, 0.5]);
  assert.deepEqual(arrangeFrames(3, 'tile').map((frame) => [frame.left, frame.top]), [[0, 0], [0.5, 0], [0, 0.5]]);
});

test('cascade offsets each window and wraps before leaving the workspace', () => {
  const frames = arrangeFrames(20, 'cascade');
  assert.ok(frames[1].left > frames[0].left);
  assert.ok(frames.every((frame) => frame.left + frame.width <= 1 && frame.top + frame.height <= 1));
});

test('moving and resizing keep frames inside the workspace and above the minimum size', () => {
  const frame = { left: 0.1, top: 0.1, width: 0.5, height: 0.5 };
  assert.deepEqual(moveFrame(frame, 0.9, -0.5), { left: 0.5, top: 0, width: 0.5, height: 0.5 });
  const shrunk = resizeFrame(frame, 'nw', 0.6, 0.6);
  assert.ok(Math.abs(shrunk.left + shrunk.width - 0.6) < 1e-9, 'right edge stays pinned');
  assert.ok(shrunk.width >= 0.12 - 1e-9 && shrunk.height >= 0.14 - 1e-9);
  assert.deepEqual(resizeFrame(frame, 'se', 0.8, 0.8), { left: 0.1, top: 0.1, width: 0.9, height: 0.9 });
  assert.deepEqual(clampFrame({ left: -1, top: 2, width: 3, height: 0 }), { left: 0, top: 0.86, width: 1, height: 0.14 });
});

test('stack ordering and stored frame validation', () => {
  assert.deepEqual(raise(['a', 'b', 'c'], 'a'), ['b', 'c', 'a']);
  assert.deepEqual(raise(['a'], 'z'), ['a', 'z']);
  assert.equal(isFrame({ left: 0, top: 0, width: 1, height: 1 }), true);
  assert.equal(isFrame({ left: 0, top: 0, width: 2, height: 1 }), false);
  assert.equal(isFrame(null), false);
});
