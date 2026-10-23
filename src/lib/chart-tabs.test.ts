import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inferMarket, makeTab, steppedChartId, syncPeers, tabActiveChartId, visibleChartIds, withChartMoved, withLayout, withoutChart } from './chart-tabs';
import { makeChart, type ChartConfig } from './workspace';

const chart = (id: string, linkGroup?: ChartConfig['linkGroup']): ChartConfig => ({ ...makeChart('EURUSD'), id, ...(linkGroup ? { linkGroup } : {}) });

test('growing a layout shows hidden charts before adding copies, and shrinking only hides', () => {
  let copies = 0;
  const clone = () => chart(`copy${++copies}`);
  const tab = makeTab('tab', ['a', 'b', 'c'], '2h');
  assert.deepEqual(visibleChartIds(tab), ['a', 'b']);
  const grown = withLayout(tab, '4', clone);
  assert.deepEqual(grown.tab.chartIds, ['a', 'b', 'c', 'copy1']);
  assert.deepEqual(grown.added.map((added) => added.id), ['copy1']);
  const shrunk = withLayout({ ...grown.tab, activeChartId: 'copy1' }, 's', clone);
  assert.deepEqual(shrunk.added, []);
  assert.deepEqual(shrunk.tab.chartIds, ['a', 'b', 'c', 'copy1']);
  assert.equal(shrunk.tab.activeChartId, 'a', 'a hidden chart hands the focus to a visible one');
});

test('closing a chart lets a hidden chart take its slot, else the layout steps down', () => {
  const tab = { ...makeTab('tab', ['a', 'b', 'c', 'd'], '3h'), activeChartId: 'b' };
  const refilled = withoutChart(tab, 'b');
  assert.equal(refilled.layout, '3h');
  assert.deepEqual(visibleChartIds(refilled), ['a', 'c', 'd']);
  assert.equal(refilled.activeChartId, 'a');
  assert.equal(withoutChart(refilled, 'a').layout, '2h');
});

test('sync peers share the source chart group, and charts outside any group sync with each other', () => {
  const charts = [chart('a'), chart('b', 'red'), chart('c', 'red'), chart('d'), chart('e', 'red')];
  const tab = makeTab('tab', ['a', 'b', 'c', 'd'], '4');
  assert.deepEqual(syncPeers(tab, charts, 'b').map((peer) => peer.id), ['c']);
  assert.deepEqual(syncPeers(tab, charts, 'a').map((peer) => peer.id), ['d']);
});

test('stepping and moving charts follow reading order, not slot order', () => {
  const tab = { ...makeTab('tab', ['a', 'b', 'c', 'd'], '4'), activeChartId: 'a' };
  assert.equal(steppedChartId(tab, 1), 'c', 'slot 2 is to the right of slot 0 in the two-by-two grid');
  assert.equal(steppedChartId(tab, -1), 'd');
  assert.equal(steppedChartId({ ...tab, activeChartId: 'd' }, 1), 'a');
  assert.deepEqual(withChartMoved(tab, 'a', 1).chartIds, ['c', 'b', 'a', 'd']);
  assert.equal(withChartMoved(tab, 'a', -1), tab);
  assert.equal(tabActiveChartId({ ...tab, activeChartId: 'gone' }), 'a');
});

test('exchange contracts read as crypto, broker CFDs and forex as forex', () => {
  for (const symbol of ['BTCUSDT', 'ETHUSDC', 'BTCPERP', 'BTCUSDT-26DEC25', 'BTCUSDT_251226', 'BTC-26DEC25', '1000PEPEUSDT']) assert.equal(inferMarket([symbol]), 'crypto', symbol);
  for (const symbol of ['EURUSD', 'BTCUSD', 'XAUUSD', 'US30', 'EURUSD.m']) assert.equal(inferMarket([symbol]), 'fx', symbol);
  assert.equal(inferMarket([]), 'fx');
});
