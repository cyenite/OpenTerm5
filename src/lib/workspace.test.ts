import assert from 'node:assert/strict';
import test from 'node:test';
import { closeChart, loadProfile, makeChart, openDialog, toggleAnalysisMode, removeProfile, saveProfile, updateActiveChart, workspace } from './workspace';

test('profile switches retain current edits and persist them without transient UI state', () => {
  const writes = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem: (key: string, value: string) => writes.set(key, value) } });
  const chart = makeChart('EURUSD');
  workspace.set({ charts: [chart], activeChartId: chart.id, activeProfile: 'Default', profiles: [] });
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
