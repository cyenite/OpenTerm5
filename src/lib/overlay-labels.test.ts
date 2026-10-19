import assert from 'node:assert/strict';
import test from 'node:test';
import { spreadLabels } from './overlay-labels';

test('labels far apart stay on their lines', () => {
  const offsets = spreadLabels([{ id: 'a', y: 100, lane: 'right' }, { id: 'b', y: 200, lane: 'right' }], 18, 500);
  assert.deepEqual([...offsets.entries()].sort(), [['a', 0], ['b', 0]]);
});

test('crowded labels stack downwards in price order, one lane at a time', () => {
  const offsets = spreadLabels([
    { id: 'tp', y: 100, lane: 'plan' },
    { id: 'entry', y: 104, lane: 'plan' },
    { id: 'sl', y: 108, lane: 'plan' },
    { id: 'position', y: 104, lane: 'right' },
  ], 18, 500);
  assert.equal(offsets.get('tp'), 0);
  assert.equal(offsets.get('entry'), 14);
  assert.equal(offsets.get('sl'), 28);
  assert.equal(offsets.get('position'), 0, 'another lane is not pushed');
});

test('a stack at the bottom edge moves up to stay on screen', () => {
  const offsets = spreadLabels([{ id: 'a', y: 495, lane: 'right' }, { id: 'b', y: 496, lane: 'right' }], 18, 500);
  assert.equal(496 + offsets.get('b')!, 491);
  assert.equal(495 + offsets.get('a')!, 473);
});
