import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTemplate, captureProfile, captureTemplate, presetName, restoreProfiles, restoreTemplates } from './presets';
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
  const state = { charts: [chart], activeChartId: chart.id, layout: 'tile', dialog: { kind: 'login' } } as WorkspaceState;
  const profile = captureProfile(state, 'London');
  assert.equal(profile.layout, 'tile');
  assert.equal('dialog' in profile, false);
  profile.charts[0].drawings.length = 0;
  assert.equal(chart.drawings.length, 1);
});

test('preset names reject empty, oversized and control characters', () => {
  for (const name of ['', '  ', 'x'.repeat(65), 'test\nname']) assert.throws(() => presetName(name));
  assert.equal(presetName(' Default '), 'Default');
});

test('persisted presets discard corrupt shapes instead of breaking chart rendering', () => {
  const template = captureTemplate(chart, 'Valid');
  assert.deepEqual(restoreTemplates([null, {}, { ...template, settings: { ...template.settings, indicators: [{ kind: 'rsi' }] } }, template]), [template]);
  const profile = captureProfile({ charts: [chart], activeChartId: chart.id, layout: 'tile' } as WorkspaceState, 'Valid');
  const [restored] = restoreProfiles([{}, { ...profile, charts: [null] }, profile]);
  assert.equal(restored.layout, 'windows');
  assert.deepEqual(restored.charts, [{ ...chart, frame: { left: 0, top: 0, width: 1, height: 1 } }]);
  assert.equal(restoreProfiles([{ ...profile, charts: [{ ...chart, frame: { left: 0, top: 0, width: 4, height: 1 } }] }]).length, 0);
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
