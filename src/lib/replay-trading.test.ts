import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TerminalApi } from '../../shared/protocol';

const terminal = { platform: 'linux', on: () => () => undefined, request: async () => null } as unknown as TerminalApi;
Object.defineProperty(globalThis, 'window', { configurable: true, value: { terminal } });

// The chart menu and commands reach the session, which reads window.terminal when it loads.
const modules = Promise.all([import('./chart-tabs'), import('./chart-menu'), import('./commands'), import('./replay'), import('./replay-session'), import('./workspace')]);

// No engines are registered: the replay reaches them through optional lookups.
test('a replaying chart refuses trade tickets, while charts outside the replay still trade', async () => {
  const [{ makeTab }, { chartMenu }, { newOrder }, { exitReplay, startReplay }, { isReplayingChart, replay }, { focusChart, makeChart, openDialog, workspace }] = await modules;
  const charts = [makeChart('EURUSD', 'M15'), makeChart('EURUSD', 'M15')];
  const [left, right] = charts.map((chart) => chart.id);
  workspace.set({ charts, tabs: [makeTab('tab', [left, right], '2h')], activeTabId: 'tab', dialog: null, isAnalysisMode: false, replayMode: 'activeChart' });

  assert.equal(isReplayingChart(null, left), false);
  startReplay(left);
  const session = replay.get().session;
  assert.deepEqual([isReplayingChart(session, left), isReplayingChart(session, right), isReplayingChart(session, undefined)], [true, false, false]);

  openDialog({ kind: 'order', symbol: 'EURUSD', chartId: left, type: 'buy' });
  assert.equal(workspace.get().dialog, null);
  assert.equal(replay.get().session?.notice, 'Trading is off while this chart replays.');
  focusChart(left);
  newOrder();
  assert.equal(workspace.get().dialog, null, 'F9 and New Order default to the active chart, which replays');
  newOrder('EURUSD');
  assert.equal(workspace.get().dialog?.kind, 'order', 'a ticket for a named symbol (Market Watch, Toolbox) is not opened from the chart');
  workspace.set({ dialog: null });

  const labels = (chartId: string) => chartMenu(chartId).map((item) => [item.label, !!item.isDisabled]);
  const tradingItem = (chartId: string) => labels(chartId).find(([label]) => String(label).startsWith('Trading'));
  assert.deepEqual(tradingItem(left), ['Trading is off while this chart replays', true]);
  assert.equal(labels(left).some(([label]) => label === 'Trading'), false);
  assert.deepEqual(tradingItem(right), ['Trading', false]);
  openDialog({ kind: 'order', symbol: 'EURUSD', chartId: right });
  assert.equal(workspace.get().dialog?.kind, 'order');
  workspace.set({ dialog: null });
  focusChart(right);
  newOrder();
  assert.equal(workspace.get().dialog?.kind, 'order', 'the chart outside the replay keeps F9');
  workspace.set({ dialog: null });

  exitReplay();
  openDialog({ kind: 'order', symbol: 'EURUSD', chartId: left });
  assert.equal(workspace.get().dialog?.kind, 'order', 'the chart trades again once the replay ends');
});
