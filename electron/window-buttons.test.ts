import assert from 'node:assert/strict';
import { test } from 'node:test';
import { windowButtonPosition } from './window-buttons';

test('the window controls are centred on the app bar at normal zoom', () => {
  assert.deepEqual(windowButtonPosition(1), { x: 14, y: 11 });
});

test('the window controls stay centred as zoom resizes the app bar', () => {
  assert.deepEqual(windowButtonPosition(1.5), { x: 14, y: 20 });
  assert.deepEqual(windowButtonPosition(2), { x: 14, y: 29 });
  assert.deepEqual(windowButtonPosition(0.8), { x: 14, y: 7 });
});

test('the window controls never move above the window at the smallest zoom', () => {
  assert.equal(windowButtonPosition(0.25).y, 0);
});
