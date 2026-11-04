import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveKeys, newRootKey } from '../../electron/sync-crypto';
import { SyncEngine, type SyncSource } from '../../electron/sync-engine';
import { FakeRemote, MemoryStore, REPO_ID } from '../../electron/sync-engine-fixtures';
import type { Json } from '../../shared/sync';
import { makeTab, type ChartTab } from './chart-tabs';
import type { Drawing } from './chart-model';
import {
  applyPreferencesChange, applyWorkspaceChange, checkWorkspacePreferences, checkWorkspaceRecord, orderedItems, orderedMap, ORDER, workspaceKinds, workspaceRecords, type WorkspaceKind,
} from './sync-model';
import { makeChart, workspace, type ChartConfig, type WorkspaceState } from './workspace';

const line = (id: string, price = 1.1): Drawing => ({
  id, type: 'horizontal-line', paneId: 'price', anchors: [{ time: 1_700_000_000_000, price }], style: { lineColor: '#2962ff', lineWidth: 1, lineStyle: 'solid' }, locked: false, visible: true, zIndex: 0, createdAt: 1,
});

function chart(id: string, symbol: string, drawings: Drawing[] = []): ChartConfig {
  return { ...makeChart(symbol), id, drawings };
}

function stateWith(tabs: ChartTab[], charts: ChartConfig[]): WorkspaceState {
  return { ...workspace.get(), tabs, charts, activeTabId: tabs[0]?.id ?? '', profiles: [], templates: [] };
}

const empty = () => stateWith([], []);

const allRecords = (state: WorkspaceState) => Object.fromEntries(workspaceKinds.map((kind) => [kind, workspaceRecords(state, kind)]));

// Applies every kind's records in sync order, as the engine does for a computer that has none yet.
function applyAll(state: WorkspaceState, records: ReturnType<typeof allRecords>): WorkspaceState {
  let next = state;
  for (const kind of workspaceKinds) next = { ...next, ...applyWorkspaceChange(next, kind, { upserts: records[kind], deletes: [] }) };
  return next;
}

function sample(): WorkspaceState {
  const charts = [chart('c1', 'EURUSD', [line('d1'), line('d2', 1.2)]), { ...chart('c2', 'XAUUSD'), theme: 'meridian-light', linkGroup: 'red' as const }, chart('c3', 'BTCUSDT')];
  const tabs = [
    { ...makeTab('t1', ['c1', 'c2'], '2h', ['crosshair', 'symbol'], 'fx'), drawings: { EURUSD: [line('s1')] } },
    makeTab('t2', ['c3'], 's', ['crosshair'], 'crypto'),
  ];
  return stateWith(tabs, charts);
}

test('records applied to an empty workspace read back the same', () => {
  const state = sample();
  const records = allRecords(state);
  const applied = applyAll(empty(), records);
  assert.deepEqual(allRecords(applied), records);
  assert.deepEqual(applied.charts.find((item) => item.id === 'c1')!.drawings.map((drawing) => drawing.id), ['d1', 'd2']);
  assert.deepEqual(applied.tabs.find((tab) => tab.id === 't1')!.drawings, { EURUSD: [line('s1')] });
  for (const kind of workspaceKinds) for (const [id, value] of Object.entries(records[kind])) checkWorkspaceRecord(kind, id, value);
});

test('items an order does not list follow it, so two racing orders lose nothing', () => {
  const map = { ...orderedMap([{ id: 'b' }, { id: 'a' }]), c: { id: 'c' }, [ORDER]: ['b', 'missing', 'b', 'a'] };
  assert.deepEqual(orderedItems(map).map(([id]) => id), ['b', 'a', 'c']);
});

test('a removed chart leaves its layout, and a reordered market keeps the other market\'s tabs in place', () => {
  const state = sample();
  const removed = { ...state, ...applyWorkspaceChange(state, 'chart', { upserts: {}, deletes: ['c2'] }) };
  assert.deepEqual(removed.tabs.find((tab) => tab.id === 't1')!.chartIds, ['c1']);
  const withThird = { ...state, tabs: [...state.tabs, makeTab('t3', ['c1'], 's', [], 'fx')] };
  const reordered = applyWorkspaceChange(withThird, 'layoutOrder', { upserts: { fx: ['t3', 't1'] }, deletes: [] });
  assert.deepEqual(reordered.tabs!.map((tab) => tab.id), ['t3', 't2', 't1']);
});

test('broken records are refused before anything applies them', () => {
  const bad: [WorkspaceKind, string, Json][] = [
    ['chart', 'c1', { symbol: 'EURUSD', type: 'nope', timeframe: 'H1', indicators: [], isGridShown: true, isVolumeShown: false }],
    ['chartDrawings', 'c1', { d1: { id: 'other', type: 'horizontal-line', anchors: [], style: {} } }],
    ['layout', 't1', { layout: 'zz', market: 'fx', syncs: [], sizes: {} }],
    ['layoutCharts', 't1', ['c1', 2]],
    ['layoutOrder', 'stocks', []],
    ['chartTemplate', ' padded ', { settings: {} }],
  ];
  for (const [kind, id, value] of bad) assert.throws(() => checkWorkspaceRecord(kind, id, value), undefined, `${kind} ${id}`);
});

test('workspace preferences check what they know and keep what a newer build added', () => {
  assert.throws(() => checkWorkspacePreferences({ drawingSync: 'everywhere' }));
  checkWorkspacePreferences({ theme: 'meridian-light', futureSetting: 3 });
  const state = workspace.get();
  const patch = applyPreferencesChange(state, { theme: 'meridian-light', defaultChartTheme: null, activeProfile: 'Missing here', futureSetting: 3 });
  assert.equal(patch.theme, 'meridian-light');
  assert.ok('defaultChartTheme' in patch && patch.defaultChartTheme === undefined);
  assert.ok(!('activeProfile' in patch));
});

// Two computers whose engines read and write the workspace model, as the renderer does.
function computer(id: string, remote: FakeRemote, rootKey: Buffer, clock: { now: number }, state: WorkspaceState) {
  const holder = { state };
  const sources: SyncSource[] = workspaceKinds.map((kind) => ({
    kind,
    snapshot: async () => structuredClone(workspaceRecords(holder.state, kind)),
    validate: (value, recordId) => checkWorkspaceRecord(kind, recordId, value),
    apply: async (change) => { holder.state = { ...holder.state, ...applyWorkspaceChange(holder.state, kind, change) }; },
  }));
  const engine = new SyncEngine({
    epoch: 1, repoId: REPO_ID, keys: deriveKeys(rootKey), remote, store: new MemoryStore(), sources, now: () => clock.now, pause: async () => undefined,
    device: { id, name: id, platform: 'linux', publicKey: 'x', appVersion: '1.0.0' },
  });
  return { holder, engine };
}

test('layouts, charts and drawings edited on two computers end the same on both', async () => {
  const remote = new FakeRemote();
  const rootKey = newRootKey();
  const clock = { now: 1_800_000_000_000 };
  const a = computer('a', remote, rootKey, clock, sample());
  const b = computer('b', remote, rootKey, clock, empty());
  await a.engine.sync();
  await b.engine.sync({ isLocalDiscarded: true });
  assert.deepEqual(allRecords(b.holder.state), allRecords(a.holder.state));

  // A moves one drawing and clears a chart's theme; B adds a drawing to the same chart and a layout.
  clock.now += 1000;
  a.holder.state = { ...a.holder.state, charts: a.holder.state.charts.map((item) => item.id === 'c1' ? { ...item, drawings: [line('d1', 1.15), item.drawings[1]] } : item.id === 'c2' ? { ...item, theme: undefined } : item) };
  b.holder.state = {
    ...b.holder.state,
    charts: [...b.holder.state.charts.map((item) => item.id === 'c1' ? { ...item, drawings: [...item.drawings, line('d3', 1.3)] } : item), chart('c4', 'GBPUSD')],
    tabs: [...b.holder.state.tabs, makeTab('t4', ['c4'], 's', ['crosshair'], 'fx')],
  };
  await a.engine.sync();
  await b.engine.sync();
  await a.engine.sync();
  assert.deepEqual(allRecords(a.holder.state), allRecords(b.holder.state));
  const c1 = a.holder.state.charts.find((item) => item.id === 'c1')!;
  assert.deepEqual(c1.drawings.map((drawing) => [drawing.id, drawing.anchors[0].price]), [['d1', 1.15], ['d2', 1.2], ['d3', 1.3]]);
  assert.equal(b.holder.state.charts.find((item) => item.id === 'c2')!.theme, undefined);
  assert.deepEqual(a.holder.state.tabs.filter((tab) => tab.market === 'fx').map((tab) => tab.id), ['t1', 't4']);

  // B closes the new layout with its chart; A loses both, and nothing is left behind.
  clock.now += 1000;
  b.holder.state = { ...b.holder.state, tabs: b.holder.state.tabs.filter((tab) => tab.id !== 't4'), charts: b.holder.state.charts.filter((item) => item.id !== 'c4') };
  await b.engine.sync();
  await a.engine.sync();
  assert.deepEqual(a.holder.state.tabs.map((tab) => tab.id), ['t1', 't2']);
  assert.ok(!a.holder.state.charts.some((item) => item.id === 'c4'));
  for (const { engine } of [a, b]) {
    const settled = await engine.sync();
    assert.equal(settled.status === 'synced' && settled.pulled + settled.pushed, 0);
  }
});
