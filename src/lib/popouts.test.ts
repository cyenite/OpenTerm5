import assert from 'node:assert/strict';
import test from 'node:test';
import { makeTab } from './chart-tabs';
import { dockedTabId, dockTab, forgetPopout, popOutTab, popouts, popoutOf } from './popouts';
import { makeChart, moveTab, workspace } from './workspace';

function setUp(): void {
  const [eur, gbp, jpy] = [makeChart('EURUSD'), makeChart('GBPUSD'), makeChart('USDJPY')];
  workspace.set({ market: 'fx', charts: [eur, gbp, jpy], tabs: [makeTab('eur', [eur.id]), makeTab('gbp', [gbp.id]), makeTab('jpy', [jpy.id])], activeTabId: 'gbp' });
  popouts.set({ list: [] });
}

const tabIds = () => workspace.get().tabs.map((tab) => tab.id);

test('the main window shows the active tab, or the one it showed while a pop-out is worked in', () => {
  assert.equal(dockedTabId(['eur', 'jpy'], 'eur', 'jpy'), 'eur');
  assert.equal(dockedTabId(['eur', 'jpy'], 'gbp', 'jpy'), 'jpy', 'the active tab is popped out');
  assert.equal(dockedTabId(['eur', 'jpy'], 'gbp', 'gbp'), 'eur', 'the tab shown before is popped out too');
  assert.equal(dockedTabId([], 'gbp', 'eur'), undefined);
});

test('popping out the active tab moves the main window on; docking brings the tab back to the front', () => {
  setUp();
  popOutTab('gbp', 'lite', { x: 1900, y: 200 });
  assert.deepEqual(popoutOf(popouts.get(), 'gbp'), { tabId: 'gbp', mode: 'lite', at: { x: 1900, y: 200 } });
  assert.equal(workspace.get().activeTabId, 'eur');
  popOutTab('gbp', 'full');
  assert.equal(popouts.get().list.length, 1, 'a popped-out tab only changes mode');
  assert.equal(popoutOf(popouts.get(), 'gbp')?.mode, 'full');
  dockTab('gbp', 'eur');
  assert.equal(popoutOf(popouts.get(), 'gbp'), undefined);
  assert.deepEqual(tabIds(), ['gbp', 'eur', 'jpy'], 'dropped in front of the tab it landed on');
  assert.equal(workspace.get().activeTabId, 'gbp');
});

test('a pop-out window the user closes returns its tab without taking the front', () => {
  setUp();
  popOutTab('jpy', 'lite');
  forgetPopout('jpy');
  assert.deepEqual(popouts.get().list, []);
  assert.equal(workspace.get().activeTabId, 'gbp');
});

test('tabs move in front of another tab or to the end', () => {
  setUp();
  moveTab('jpy', 'eur');
  assert.deepEqual(tabIds(), ['jpy', 'eur', 'gbp']);
  moveTab('jpy', null);
  assert.deepEqual(tabIds(), ['eur', 'gbp', 'jpy']);
  moveTab('eur', 'eur');
  assert.deepEqual(tabIds(), ['eur', 'gbp', 'jpy']);
});
