import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateDrawing, migrateDrawings, migrateIndicator, migrateIndicators } from './chart-model';

test('MT5 indicators saved before Meridian become the matching MT5 studies', () => {
  assert.deepEqual(migrateIndicator({ id: 'a', kind: 'ichimoku', params: { tenkan: 9, kijun: 26, senkou: 52 } }), { id: 'a', kind: 'mt5-ichimoku', params: { tenkan: 9, kijun: 26, senkou: 52 } });
  assert.deepEqual(migrateIndicator({ id: 'b', kind: 'bollinger-bands', params: { length: 20, source: 'Close' } }), { id: 'b', kind: 'bollinger-bands', params: { length: 20, source: 'Close' } });
  assert.equal(migrateIndicator({ id: 'c', kind: 'rsi', params: { period: Infinity } }), null);
  assert.equal(migrateIndicators([{ id: 'd', kind: '', params: {} }]), null);
});

test('legacy drawings become Meridian drawings with millisecond anchors', () => {
  const now = 1_800_000_000_000;
  assert.deepEqual(migrateDrawing({ id: 'h', kind: 'hline', price: 1.2 }, now)?.anchors, [{ time: now, price: 1.2 }]);
  assert.deepEqual(migrateDrawing({ id: 'v', kind: 'vline', time: 50 }, now)?.anchors, [{ time: 50_000, price: 0 }]);
  const ray = migrateDrawing({ id: 'r', kind: 'ray', from: { time: 10, price: 3 } }, now);
  assert.equal(ray?.type, 'horizontal-ray');
  const box = migrateDrawing({ id: 'b', kind: 'rectangle', from: { time: 1, price: 1 }, to: { time: 2, price: 2 } }, now);
  assert.equal(box?.type, 'rectangle');
  assert.equal(box?.style.fillOpacity, 0.15);
  assert.equal(migrateDrawing({ id: 'f', kind: 'fibonacci', from: { time: 1, price: 1 }, to: { time: 2, price: 2 } }, now)?.type, 'fib-retracement');
  assert.equal(migrateDrawing({ id: 'x', kind: 'ray', from: { time: Infinity, price: 1 } }, now), null);
  assert.equal(migrateDrawing({ id: 'x', kind: 'unknown' }, now), null);
});

test('Meridian drawings pass through unchanged and a single bad drawing rejects the set', () => {
  const drawing = { id: 'p', type: 'pitchfork', paneId: 'price', anchors: [{ time: 1, price: 1 }, { time: 2, price: 2 }, { time: 3, price: 1 }], style: { lineColor: '#fff', lineWidth: 1, lineStyle: 'solid' }, locked: false, visible: true, zIndex: 1, createdAt: 1 };
  assert.deepEqual(migrateDrawing(drawing), drawing);
  assert.equal(migrateDrawing({ ...drawing, type: 'trendline', text: { value: 'Note' } })?.type, 'trend-line');
  assert.equal(migrateDrawing({ ...drawing, type: 'trendline', text: { value: 'Note' } })?.text, 'Note');
  assert.equal(migrateIndicator({ id: 'v', kind: 'average-true-range', params: { length: 14 } })?.kind, 'atr');
  assert.equal(migrateDrawings([drawing, { id: 'bad' }]), null);
});
