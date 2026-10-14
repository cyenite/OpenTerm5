import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTemplate, captureProfile, captureTemplate, presetName, restoreProfiles, restoreTemplates } from './presets';
import type { ChartConfig, WorkspaceState } from './workspace';

const chart: ChartConfig = {
  id: 'first', symbol: 'EURUSD', timeframe: 'H1', type: 'candles', isGridShown: true, isVolumeShown: false,
  drawings: [{ id: 'line', kind: 'hline', price: 1.1 }], indicators: [{ id: 'ma', kind: 'ma', params: { period: 14 } }],
};

test('templates retain destination identity and timeframe with independent indicator/drawing IDs', () => {
  const template = captureTemplate(chart, 'greenOnBlack', ' Momentum ');
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
  const state = { charts: [chart], activeChartId: chart.id, scheme: 'greenOnBlack', layout: 'tile', dialog: { kind: 'login' } } as WorkspaceState;
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
  const template = captureTemplate(chart, 'greenOnBlack', 'Valid');
  assert.deepEqual(restoreTemplates([null, {}, { ...template, settings: { ...template.settings, indicators: [{ kind: 'unknown' }] } }, template]), [template]);
  const profile = captureProfile({ charts: [chart], activeChartId: chart.id, scheme: 'greenOnBlack', layout: 'tile' } as WorkspaceState, 'Valid');
  const [restored] = restoreProfiles([{}, { ...profile, charts: [null] }, profile]);
  assert.equal(restored.layout, 'windows');
  assert.deepEqual(restored.charts, [{ ...chart, frame: { left: 0, top: 0, width: 1, height: 1 } }]);
  assert.equal(restoreProfiles([{ ...profile, charts: [{ ...chart, frame: { left: 0, top: 0, width: 4, height: 1 } }] }]).length, 0);
  assert.deepEqual(restoreProfiles('invalid'), []);
});
