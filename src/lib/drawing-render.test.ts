import test from 'node:test';
import assert from 'node:assert/strict';
import { DrawingPrimitive } from '../components/chart/drawing-primitive';

test('drawing primitive anchors to current chart coordinates and paints rays/rectangles in the pane', () => {
  const operations: [string, ...unknown[]][] = [];
  const context = Object.fromEntries(['save', 'restore', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'fillRect', 'strokeRect', 'setLineDash', 'fillText'].map((name) => [name, (...args: unknown[]) => operations.push([name, ...args])])) as unknown as CanvasRenderingContext2D;
  const target = { useMediaCoordinateSpace: (callback: (scope: { context: CanvasRenderingContext2D; mediaSize: { width: number; height: number } }) => void) => callback({ context, mediaSize: { width: 100, height: 100 } }) } as Parameters<DrawingPrimitive['draw']>[0];
  let offset = 0;
  const primitive = new DrawingPrimitive((time) => time * 10 + offset, (price) => 100 - price * 10);
  primitive.update([{ id: 'v', kind: 'vline', time: 2 }, { id: 'r', kind: 'ray', from: { time: 3, price: 8 } }, { id: 'box', kind: 'rectangle', from: { time: 2, price: 2 }, to: { time: 4, price: 4 } }], 'orange', 2);
  primitive.draw(target);
  assert.ok(operations.some((entry) => JSON.stringify(entry) === JSON.stringify(['moveTo', 20, 0])));
  assert.ok(operations.some((entry) => JSON.stringify(entry) === JSON.stringify(['lineTo', 100, 20])));
  assert.ok(operations.some((entry) => JSON.stringify(entry) === JSON.stringify(['fillRect', 20, 60, 20, 20])));
  operations.length = 0;
  offset = 5;
  primitive.draw(target);
  assert.ok(operations.some((entry) => JSON.stringify(entry) === JSON.stringify(['moveTo', 25, 0])));
});
