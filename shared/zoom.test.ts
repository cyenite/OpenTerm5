import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreZoom, steppedZoom, zoomFactors, zoomStepForKey } from './zoom';

const key = (patch: Partial<Parameters<typeof zoomStepForKey>[0]>) => ({ key: '', code: '', type: 'keyDown', alt: false, meta: false, control: true, ...patch });

test('zoom steps through the levels and stops at either end', () => {
  assert.equal(steppedZoom(1, 'in'), 1.1);
  assert.equal(steppedZoom(1, 'out'), 0.9);
  assert.equal(steppedZoom(zoomFactors[zoomFactors.length - 1], 'in'), 2);
  assert.equal(steppedZoom(0.5, 'out'), 0.5);
  assert.equal(steppedZoom(1.75, 'reset'), 1);
});

test('saved zoom snaps to the nearest level and falls back to 100%', () => {
  assert.equal(restoreZoom(1.27), 1.25);
  assert.equal(restoreZoom(9), 2);
  assert.equal(restoreZoom('big'), 1);
  assert.equal(restoreZoom(Number.NaN), 1);
});

test('Ctrl with plus, minus or zero zooms; Cmd on macOS', () => {
  assert.equal(zoomStepForKey(key({ key: '=' }), false), 'in');
  assert.equal(zoomStepForKey(key({ key: '+' }), false), 'in');
  assert.equal(zoomStepForKey(key({ key: '-' }), false), 'out');
  assert.equal(zoomStepForKey(key({ key: '_' }), false), 'out');
  assert.equal(zoomStepForKey(key({ code: 'NumpadAdd', key: '+' }), false), 'in');
  assert.equal(zoomStepForKey(key({ key: '0' }), false), 'reset');
  assert.equal(zoomStepForKey(key({ key: '-', control: false }), false), null, 'plain minus stays the chart zoom');
  assert.equal(zoomStepForKey(key({ key: '-', alt: true }), false), null);
  assert.equal(zoomStepForKey(key({ key: '-', type: 'keyUp' }), false), null);
  assert.equal(zoomStepForKey(key({ key: '=', control: false, meta: true }), true), 'in');
  assert.equal(zoomStepForKey(key({ key: '=' }), true), null);
});
