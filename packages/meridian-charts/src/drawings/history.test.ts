import assert from 'node:assert/strict';
import test from 'node:test';
import type { SerializedDrawing } from '../types';
import { rebaseDrawings } from './history';

const drawing = (id: string, price = 1): SerializedDrawing => ({
  id, type: 'horizontal-line', paneId: 'price', anchors: [{ time: 0, price }], style: { lineColor: '#2962ff', lineWidth: 2, lineStyle: 'solid' },
  locked: false, visible: true, zIndex: 1, createdAt: 0,
});

test('an undo state keeps drawings the host added, changed or removed', () => {
  const saved = [drawing('mine'), drawing('shared', 1), drawing('gone')];
  const previous = [drawing('mine', 2), drawing('shared', 1), drawing('gone')];
  const next = [drawing('mine', 2), drawing('shared', 5), drawing('imported')];
  const rebased = rebaseDrawings(saved, previous, next);
  assert.deepEqual(rebased.map((item) => [item.id, item.anchors[0].price]), [['mine', 1], ['shared', 5], ['imported', 1]]);
});

test('measure drawings are never written into an undo state', () => {
  const measure = { ...drawing('measure'), props: { isTransient: true } };
  assert.deepEqual(rebaseDrawings([], [], [measure]), []);
});
