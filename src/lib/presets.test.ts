import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTemplate, captureProfile, captureTemplate, presetName, restoreProfiles, restoreTemplates, restoreWorkspaceCharts } from './presets';
import { makeTab } from './chart-tabs';
import type { ChartConfig, WorkspaceState } from './workspace';

const chart: ChartConfig = {
  id: 'first', symbol: 'EURUSD', timeframe: 'H1', type: 'candles', isGridShown: true, isVolumeShown: false,
  drawings: [{ id: 'line', type: 'horizontal-line', paneId: 'price', anchors: [{ time: 1_700_000_000_000, price: 1.1 }], style: { lineColor: '#2962ff', lineWidth: 1, lineStyle: 'solid' }, locked: false, visible: true, zIndex: 0, createdAt: 1 }],
  indicators: [{ id: 'ma', kind: 'mt5-ma', params: { period: 14, isExponential: false } }],
};

test('templates retain destination identity and timeframe with independent indicator/drawing IDs', () => {
  const template = captureTemplate(chart, ' Momentum ');
  let nextId = 0;
  const target = { ...chart, id: 'second', symbol: 'GBPUSD', timeframe: 'M5' as const };
  const result = applyTemplate(target, template, () => String(++nextId));
  assert.equal(template.name, 'Momentum');
  assert.equal(result.id, 'second');
  assert.equal(result.symbol, 'GBPUSD');
  assert.equal(result.timeframe, 'M5');
  assert.notEqual(result.drawings[0].id, chart.drawings[0].id);
  result.indicators[0].params.period = 50;
  assert.equal(chart.indicators[0].params.period, 14);
  assert.equal(template.settings.indicators[0].params.period, 14);
});

test('profiles capture chart state without account credentials or transient dialogs', () => {
  const tab = { ...makeTab('tab', [chart.id], '2h'), syncs: ['symbol' as const] };
  const state = { charts: [chart], tabs: [tab], activeTabId: tab.id, dialog: { kind: 'login' } } as WorkspaceState;
  const profile = captureProfile(state, 'London');
  assert.equal(profile.tabs[0].layout, '2h');
  assert.equal(profile.activeTabId, 'tab');
  assert.equal('dialog' in profile, false);
  profile.charts[0].drawings.length = 0;
  profile.tabs[0].syncs.length = 0;
  assert.equal(chart.drawings.length, 1);
  assert.deepEqual(tab.syncs, ['symbol']);
});

test('preset names reject empty, oversized and control characters', () => {
  for (const name of ['', '  ', 'x'.repeat(65), 'test\nname']) assert.throws(() => presetName(name));
  assert.equal(presetName(' Default '), 'Default');
});

test('persisted presets discard corrupt shapes instead of breaking chart rendering', () => {
  const template = captureTemplate(chart, 'Valid');
  assert.deepEqual(restoreTemplates([null, {}, { ...template, settings: { ...template.settings, indicators: [{ kind: 'rsi' }] } }, template]), [template]);
  const profile = captureProfile({ charts: [chart], tabs: [makeTab('tab', [chart.id])], activeTabId: 'tab' } as WorkspaceState, 'Valid');
  const [restored] = restoreProfiles([{}, { ...profile, charts: [null] }, profile]);
  assert.deepEqual(restored, profile);
  assert.deepEqual(restoreProfiles('invalid'), []);
});

test('presets saved before Meridian keep their studies and drawings and drop the MT5 colour scheme', () => {
  const legacy = {
    name: 'Old', scheme: 'greenOnBlack', layout: 'tabs', activeChartId: 'first',
    charts: [{ ...chart, drawings: [{ id: 'trend', kind: 'trend', from: { time: 100, price: 1 }, to: { time: 200, price: 2 } }], indicators: [{ id: 'rsi', kind: 'rsi', params: { period: 9 } }] }],
  };
  const [profile] = restoreProfiles([legacy]);
  assert.equal('scheme' in profile, false);
  assert.deepEqual(profile.charts[0].indicators, [{ id: 'rsi', kind: 'mt5-rsi', params: { period: 9 } }]);
  assert.equal(profile.charts[0].drawings[0].type, 'trend-line');
  assert.deepEqual(profile.charts[0].drawings[0].anchors, [{ time: 100_000, price: 1 }, { time: 200_000, price: 2 }]);
  const [template] = restoreTemplates([{ name: 'Old', scheme: 'colorOnWhite', settings: { ...captureTemplate(chart, 'Old').settings, type: 'heikinashi' } }]);
  assert.equal('scheme' in template, false);
  assert.equal(template.settings.type, 'heikinashi');
});

test('chart settings and hollow candles survive a save and restore, cleaned of bad values', () => {
  const saved = { ...chart, type: 'hollow', settings: { upColor: '#00ff00', scaleMode: 'log', isScaleInverted: 'yes' } };
  const [restored] = restoreProfiles([{ name: 'Mine', layout: 'tabs', activeChartId: 'first', charts: [saved] }])[0].charts;
  assert.equal(restored.type, 'hollow');
  assert.equal(restored.settings?.upColor, '#00ff00');
  assert.equal(restored.settings?.scaleMode, 'log');
  assert.equal(restored.settings?.isScaleInverted, false);
  const [withoutSettings] = restoreProfiles([{ name: 'Old', layout: 'tabs', activeChartId: 'first', charts: [chart] }])[0].charts;
  assert.equal('settings' in withoutSettings, false);
  const template = restoreTemplates([captureTemplate({ ...chart, settings: restored.settings }, 'Log scale')])[0];
  assert.equal(template.settings.settings?.scaleMode, 'log');
});

test('MT5 tabbed charts become a tab each, keeping the active chart in front', () => {
  const second = { ...chart, id: 'second', symbol: 'GBPUSD' };
  const restored = restoreWorkspaceCharts({ layout: 'tabs', activeChartId: 'second', charts: [chart, second] });
  assert.deepEqual(restored.tabs.map((tab) => [tab.layout, tab.chartIds]), [['s', ['first']], ['s', ['second']]]);
  assert.equal(restored.tabs.find((tab) => tab.id === restored.activeTabId)?.chartIds[0], 'second');
  assert.deepEqual(restored.tabs[0].syncs, ['crosshair']);
});

test('MT5 floating windows become one tab in reading order, minimized windows hidden after them', () => {
  const at = (id: string, top: number, left: number, isMinimized = false) => ({ ...chart, id, frame: { top, left, width: 0.5, height: 0.5 }, isMinimized });
  const restored = restoreWorkspaceCharts({ layout: 'windows', activeChartId: 'icon', charts: [at('lower', 0.5, 0), at('icon', 0, 0, true), at('right', 0, 0.5), at('left', 0, 0)] });
  const [tab] = restored.tabs;
  assert.equal(restored.tabs.length, 1);
  assert.deepEqual(tab.chartIds, ['left', 'right', 'lower', 'icon']);
  assert.equal(tab.layout, '3h');
  assert.equal(tab.activeChartId, 'left', 'a minimized window is hidden, so it cannot stay active');
  assert.ok(restored.charts.every((restoredChart) => !('frame' in restoredChart) && !('isMinimized' in restoredChart)));
});

test('saved tabs drop unknown ids and claim each chart once; unclaimed charts get their own tab', () => {
  const second = { ...chart, id: 'second', linkGroup: 'blue' };
  const third = { ...chart, id: 'third', linkGroup: 'plaid' };
  const restored = restoreWorkspaceCharts({
    activeTabId: 'missing',
    charts: [chart, second, third],
    tabs: [
      { id: 'grid', layout: '4', syncs: ['symbol', 'teleport'], chartIds: ['first', 'ghost', 'second'], activeChartId: 'ghost', sizes: { '2h': [{ fraction: 3 }, { fraction: 1 }], bogus: [] }, drawings: { EURUSD: chart.drawings, broken: [{}] } },
      { id: 'copy', layout: 's', chartIds: ['first'] },
      { id: 'future', layout: '11x', chartIds: [] },
    ],
  });
  assert.deepEqual(restored.tabs.map((tab) => [tab.id, tab.layout, tab.chartIds]), [['grid', '2h', ['first', 'second']], ['tab-third', 's', ['third']]]);
  const [grid] = restored.tabs;
  assert.deepEqual(grid.syncs, ['symbol']);
  assert.equal(grid.activeChartId, 'first');
  assert.deepEqual(grid.sizes, { '2h': [{ fraction: 0.75 }, { fraction: 0.25 }] });
  assert.deepEqual(Object.keys(grid.drawings), ['EURUSD']);
  assert.equal(restored.activeTabId, 'grid');
  assert.deepEqual(restored.charts.map((restoredChart) => restoredChart.linkGroup), [undefined, 'blue', undefined]);
});

test('templates leave the sync group with the chart', () => {
  const template = captureTemplate({ ...chart, linkGroup: 'red' }, 'Grouped');
  assert.equal('linkGroup' in template.settings, false);
});
