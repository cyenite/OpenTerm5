import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings } from '@meridian/charts';
import { makeTab } from './chart-tabs';
import { applyChartSettingsToAll, closeChart, loadProfile, makeChart, openChart, openDialog, openTab, toggleAnalysisMode, removeProfile, saveProfile, setChartSymbol, setChartTimeframe, setLinkGroup, setTabLayout, toggleLayoutSync, updateActiveChart, workspace } from './workspace';

test('profile switches retain current edits and persist them without transient UI state', () => {
  const writes = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem: (key: string, value: string) => writes.set(key, value) } });
  const chart = makeChart('EURUSD');
  workspace.set({ charts: [chart], tabs: [makeTab('tab', [chart.id])], activeTabId: 'tab', activeProfile: 'Default', profiles: [] });
  saveProfile('London');
  updateActiveChart({ timeframe: 'M5' });
  loadProfile('London');
  assert.equal(workspace.get().charts[0].timeframe, 'M5');
  saveProfile('New York');
  updateActiveChart({ timeframe: 'H4' });
  loadProfile('London');
  assert.equal(workspace.get().charts[0].timeframe, 'M5');
  loadProfile('New York');
  assert.equal(workspace.get().charts[0].timeframe, 'H4');
  const persisted = JSON.parse(writes.get('openterm.workspace.v1')!);
  assert.equal(persisted.profiles.find((profile: { name: string }) => profile.name === 'New York').charts[0].timeframe, 'H4');
  assert.equal('dialog' in persisted, false);
  assert.throws(() => removeProfile('New York'));
  assert.throws(() => removeProfile('Default'));
  removeProfile('London');
  assert.equal(workspace.get().profiles.some((profile) => profile.name === 'London'), false);
  closeChart(workspace.get().charts[0].id);
  assert.equal(workspace.get().charts.length, 0);
  assert.equal(JSON.parse(writes.get('openterm.workspace.v1')!).charts.length, 0);
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

test('analysis mode refuses trade tickets but keeps charting dialogs', () => {
  workspace.set({ isAnalysisMode: true, dialog: null });
  openDialog({ kind: 'order', symbol: 'EURUSD' });
  openDialog({ kind: 'modifyPosition', ticket: 1 });
  openDialog({ kind: 'manage', ticket: 1 });
  assert.equal(workspace.get().dialog, null);
  openDialog({ kind: 'alerts' });
  assert.deepEqual(workspace.get().dialog, { kind: 'alerts' });
  workspace.set({ isAnalysisMode: false, dialog: null });
  openDialog({ kind: 'order', symbol: 'EURUSD' });
  assert.equal(workspace.get().dialog?.kind, 'order');
  workspace.set({ dialog: null });
});

test('entering analysis mode leaves trading state behind but keeps charting state', () => {
  workspace.set({ isAnalysisMode: false, page: 'copier', tool: 'riskOrder', depthSymbol: 'EURUSD', dialog: { kind: 'order', symbol: 'EURUSD' } });
  toggleAnalysisMode();
  let state = workspace.get();
  assert.equal(state.isAnalysisMode, true);
  assert.equal(state.page, 'trading');
  assert.equal(state.tool, 'cursor');
  assert.equal(state.depthSymbol, null);
  assert.equal(state.dialog, null);
  toggleAnalysisMode();
  assert.equal(workspace.get().isAnalysisMode, false);

  workspace.set({ tool: 'trend', dialog: { kind: 'alerts' } });
  toggleAnalysisMode();
  state = workspace.get();
  assert.equal(state.tool, 'trend');
  assert.deepEqual(state.dialog, { kind: 'alerts' });
  workspace.set({ isAnalysisMode: false, dialog: null, tool: 'cursor' });
});

test('imported chart settings reach every chart, and new charts when they are the default', () => {
  const charts = [makeChart('EURUSD'), { ...makeChart('XAUUSD'), type: 'line' as const }];
  workspace.set({ charts, tabs: [makeTab('tab', charts.map((chart) => chart.id), '2h')], activeTabId: 'tab', defaultChartSettings: undefined });
  const settings = { ...defaultSettings, background: '#ffffff', scaleFontSize: 12 };
  applyChartSettingsToAll(settings);
  assert.deepEqual(workspace.get().charts.map((chart) => [chart.type, chart.settings?.background]), [['candles', '#ffffff'], ['line', '#ffffff']]);
  openChart('GBPUSD');
  assert.equal(workspace.get().charts.at(-1)?.settings, undefined);
  applyChartSettingsToAll(settings, 'hollow', true);
  assert.deepEqual(workspace.get().charts.map((chart) => chart.type), ['hollow', 'hollow', 'hollow']);
  openChart('USDJPY');
  const opened = workspace.get().charts.at(-1)!;
  assert.deepEqual([opened.type, opened.settings], ['candles', settings]);
  assert.notEqual(opened.settings, workspace.get().defaultChartSettings);
});

test('symbol and interval sync spread within the sync group of the chart that changed', () => {
  const charts = [makeChart('EURUSD'), { ...makeChart('GBPUSD'), linkGroup: 'red' as const }, { ...makeChart('USDJPY'), linkGroup: 'red' as const }, makeChart('XAUUSD', 'H4')];
  workspace.set({ charts, tabs: [makeTab('tab', charts.map((chart) => chart.id), '4', [])], activeTabId: 'tab' });
  setChartSymbol(charts[1].id, 'AUDUSD');
  assert.deepEqual(workspace.get().charts.map((chart) => chart.symbol), ['EURUSD', 'AUDUSD', 'USDJPY', 'XAUUSD'], 'nothing spreads while symbol sync is off');
  toggleLayoutSync('tab', 'symbol');
  assert.deepEqual(workspace.get().charts.map((chart) => chart.symbol), ['EURUSD', 'AUDUSD', 'AUDUSD', 'EURUSD'], 'each group lines up behind its leader');
  setChartSymbol(charts[2].id, 'NZDUSD');
  setChartTimeframe(charts[0].id, 'M5');
  assert.deepEqual(workspace.get().charts.map((chart) => `${chart.symbol},${chart.timeframe}`), ['EURUSD,M5', 'NZDUSD,H1', 'NZDUSD,H1', 'EURUSD,H4'], 'interval sync is separate');
  setLinkGroup(charts[3].id, 'red');
  assert.equal(workspace.get().charts[3].symbol, 'NZDUSD', 'joining a group takes its symbol');
});

test('growing a layout copies the active chart without its own drawings; closing charts steps the layout down', () => {
  const chart = { ...makeChart('EURUSD', 'M15'), indicators: [{ id: 'ma', kind: 'mt5-ma', params: { period: 20 } }] };
  workspace.set({ charts: [chart], tabs: [makeTab('tab', [chart.id])], activeTabId: 'tab', isChartMaximized: true });
  setTabLayout('tab', '3h');
  const state = workspace.get();
  const [tab] = state.tabs;
  assert.equal(state.isChartMaximized, false);
  assert.equal(tab.chartIds.length, 3);
  const copy = state.charts.find((candidate) => candidate.id === tab.chartIds[2])!;
  assert.deepEqual([copy.symbol, copy.timeframe, copy.drawings], ['EURUSD', 'M15', []]);
  assert.notEqual(copy.indicators[0].id, 'ma');
  closeChart(tab.chartIds[1]);
  assert.equal(workspace.get().tabs[0].layout, '2h');
  closeChart(tab.chartIds[0]);
  closeChart(tab.chartIds[2]);
  assert.deepEqual([workspace.get().tabs, workspace.get().charts, workspace.get().activeTabId], [[], [], '']);
});

test('new tabs follow the last crosshair sync choice', () => {
  const chart = makeChart('EURUSD');
  workspace.set({ charts: [chart], tabs: [makeTab('tab', [chart.id])], activeTabId: 'tab', isCrosshairSyncedByDefault: true });
  toggleLayoutSync('tab', 'crosshair');
  openTab();
  const state = workspace.get();
  assert.equal(state.isCrosshairSyncedByDefault, false);
  assert.deepEqual(state.tabs.at(-1)?.syncs, []);
  assert.equal(state.activeTabId, state.tabs.at(-1)?.id);
});
