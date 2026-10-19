import assert from 'node:assert/strict';
import test from 'node:test';
import { clearPinnedTrade, focusedGroup, hoverTrade, leaveTrade, positionGroup, togglePinnedTrade, tradeFocus } from './trade-focus';

test('hover wins over the pin, and only groups the chart shows are focused', () => {
  const shown = new Set([positionGroup(1), positionGroup(2)]);
  assert.equal(focusedGroup({ hovered: null, pinned: null }, shown), null);
  assert.equal(focusedGroup({ hovered: null, pinned: 'pos-1' }, shown), 'pos-1');
  assert.equal(focusedGroup({ hovered: 'pos-2', pinned: 'pos-1' }, shown), 'pos-2');
  assert.equal(focusedGroup({ hovered: 'pos-9', pinned: 'pos-1' }, shown), 'pos-1', 'a trade on another symbol leaves the pin');
  assert.equal(focusedGroup({ hovered: 'pos-9', pinned: null }, shown), null);
});

test('clicking a pinned trade again unpins it', () => {
  togglePinnedTrade('pos-1');
  assert.equal(tradeFocus.get().pinned, 'pos-1');
  togglePinnedTrade('pos-1');
  assert.equal(tradeFocus.get().pinned, null);
  togglePinnedTrade('pos-2');
  hoverTrade('pos-3');
  clearPinnedTrade();
  assert.deepEqual(tradeFocus.get(), { hovered: 'pos-3', pinned: null });
  hoverTrade('pos-4');
  leaveTrade('pos-3');
  assert.equal(tradeFocus.get().hovered, 'pos-4', 'a late leave from the previous element keeps the new hover');
  leaveTrade('pos-4');
  assert.equal(tradeFocus.get().hovered, null);
});
