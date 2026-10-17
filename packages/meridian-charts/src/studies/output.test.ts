import assert from 'node:assert/strict';
import test from 'node:test';
import type { StudyDefinition, StudyOutput } from '../types';
import { shiftOutput } from './output';
import { defineIndicator, getStudy } from './registry';

const output: StudyOutput = {
  plots: [{ key: 'a', title: 'A', values: [1, 2], color: '#000000', colors: ['#111111', null] }],
  bands: [{ key: 'b', from: 'a', to: 'a', color: '#222222', colors: ['#333333', null] }],
  levels: [{ key: 'l', price: 5, color: '#444444' }],
  markers: [{ index: 1, color: '#555555', size: 'small', location: 'aboveBar' }],
  barColors: [null, '#666666'],
  backgrounds: ['#777777', null],
  objects: {
    lines: [{ width: 1, endIndex: 3, endPrice: 2, startIndex: 0, startPrice: 1, color: '#888888', extend: 'none', lineStyle: 'solid', hasEndArrow: false, hasStartArrow: false }],
    boxes: [],
    labels: [{ index: 1, price: 1, text: 'x', color: '#999999', tooltip: '', textColor: '#000000', size: 'normal', style: 'labelDown', location: 'price', textAlign: 'center' }],
    tables: [],
    polylines: [{ lineWidth: 1, fillColor: 'transparent', lineColor: '#aaaaaa', lineStyle: 'solid', isCurved: false, isClosed: false, points: [{ index: 0, price: 1 }, { index: 2, price: 2 }] }],
  },
};

test('older bars in front move every per-bar value and object index along', () => {
  const shifted = shiftOutput(output, 2);
  assert.deepEqual(shifted.plots[0].values, [null, null, 1, 2]);
  assert.deepEqual(shifted.plots[0].colors, [null, null, '#111111', null]);
  assert.deepEqual(shifted.bands?.[0].colors, [null, null, '#333333', null]);
  assert.deepEqual(shifted.levels, output.levels);
  assert.equal(shifted.markers?.[0].index, 3);
  assert.deepEqual(shifted.barColors, [null, null, null, '#666666']);
  assert.deepEqual(shifted.backgrounds, [null, null, '#777777', null]);
  assert.deepEqual([shifted.objects?.lines[0].startIndex, shifted.objects?.lines[0].endIndex], [2, 5]);
  assert.equal(shifted.objects?.labels[0].index, 3);
  assert.deepEqual(shifted.objects?.polylines[0].points.map((point) => point.index), [2, 4]);
  assert.equal(shiftOutput(output, 0), output);
});

test('a host study can be removed again, but not once another took its type', async () => {
  const definition = (title: string): StudyDefinition => ({ type: 'host-test', title, overlay: true, inputs: [], computeAsync: async () => ({ plots: [] }) });
  const remove = defineIndicator(definition('First'));
  assert.equal(getStudy('host-test')?.title, 'First');
  remove();
  assert.equal(getStudy('host-test'), undefined);
  const removeSecond = defineIndicator(definition('Second'));
  const removeThird = defineIndicator(definition('Third'));
  removeSecond();
  assert.equal(getStudy('host-test')?.title, 'Third');
  removeThird();
});
