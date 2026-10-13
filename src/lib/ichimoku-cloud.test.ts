import assert from 'node:assert/strict';
import test from 'node:test';
import type { SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import { IchimokuCloud } from '../components/chart/IchimokuCloud';

test('Ichimoku primitive projects future bars logically without creating future timestamps', () => {
  const timestamps = [100, 200, 1000, 1100, 1200];
  const positions: number[] = [];
  const queriedTimes: number[] = [];
  const cloud = new IchimokuCloud({ tenkan: 2, kijun: 3, senkou: 4 }, { upper: 'green', lower: 'red' });
  const chart = { timeScale: () => ({
    timeToIndex: (time: number) => { queriedTimes.push(time); return timestamps.indexOf(time) + 10; },
    logicalToCoordinate: (logical: number) => { positions.push(logical); return logical * 10; },
  }) };
  cloud.attached({ chart, series: { priceToCoordinate: (price: number) => 100 - price }, requestUpdate: () => undefined } as unknown as SeriesAttachedParameter<Time>);
  cloud.update(timestamps.map((time, index) => ({ time, close: index * 2 + 2, high: index * 2 + 3, low: index * 2 + 1 })));
  const context = { save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, fill() {}, stroke() {} };
  const target = { useMediaCoordinateSpace: (draw: (scope: { context: unknown }) => void) => draw({ context }) };
  cloud.draw(target as unknown as CanvasRenderingTarget2D);
  assert.ok(positions.includes(17));
  assert.ok(positions.every((index) => index >= 15 && index <= 17));
  assert.deepEqual(queriedTimes, [100]);
  assert.deepEqual(cloud.valuesAt(1200), []);
  cloud.detached();
  assert.deepEqual(cloud.valuesAt(1200), []);
});
