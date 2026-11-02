import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TerminalApi } from '../../shared/protocol';

const terminal = { platform: 'linux', on: () => () => undefined, request: async () => null } as unknown as TerminalApi;
Object.defineProperty(globalThis, 'window', { configurable: true, value: { terminal } });

const modules = Promise.all([import('./chart-tabs'), import('./chart-menu'), import('./commands'), import('./session'), import('./workspace')]);

test('a data feed chart refuses tickets, depth, alerts and chart-menu trading; a broker chart beside it still trades', async () => {
  const [{ makeTab }, { chartMenu }, { newOrder, toggleDepth }, { session }, { focusChart, makeChart, openDialog, workspace }] = await modules;
  const charts = [makeChart('HYPERLIQUID:BTC', 'M15'), makeChart('EURUSD', 'M15')];
  const [feed, broker] = charts.map((chart) => chart.id);
  workspace.set({ charts, tabs: [makeTab('tab', [feed, broker], '2h')], activeTabId: 'tab', dialog: null, depthSymbol: null, isAnalysisMode: false });
  session.set({ profileId: 'demo' });

  openDialog({ kind: 'order', symbol: 'EURUSD', chartId: feed, type: 'buy' });
  assert.equal(workspace.get().dialog, null, 'a ticket opened from the chart');
  openDialog({ kind: 'order', symbol: 'HYPERLIQUID:BTC' });
  assert.equal(workspace.get().dialog, null, 'a ticket for the market itself');
  focusChart(feed);
  newOrder();
  assert.equal(workspace.get().dialog, null, 'F9 on the chart');
  toggleDepth();
  assert.equal(workspace.get().depthSymbol, null);

  const labels = (chartId: string) => chartMenu(chartId, 100).map((item) => [item.label, !!item.isDisabled] as const);
  assert.ok(labels(feed).some(([label, isDisabled]) => label === 'Hyperliquid charts are data only, so trading is off' && isDisabled));
  assert.equal(labels(feed).some(([label]) => label === 'Trading' || String(label).startsWith('Add Alert')), false);
  assert.ok(labels(broker).some(([label, isDisabled]) => label === 'Trading' && !isDisabled));
  assert.ok(labels(broker).some(([label]) => String(label).startsWith('Add Alert')));

  focusChart(broker);
  newOrder();
  assert.equal(workspace.get().dialog?.kind, 'order');
  workspace.set({ dialog: null });
  toggleDepth();
  assert.equal(workspace.get().depthSymbol, 'EURUSD');
});
