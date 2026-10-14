import assert from 'node:assert/strict';
import test from 'node:test';
import { chartTimeframes, fromChartTimeframe, isChartTimeframe, isSecondsTimeframe, toChartTimeframe } from './mt5-timeframes';

test('every chart timeframe maps to a Meridian timeframe and back', () => {
  assert.equal(toChartTimeframe('S1'), '1s');
  assert.equal(toChartTimeframe('S30'), '30s');
  assert.equal(toChartTimeframe('M1'), '1');
  assert.equal(toChartTimeframe('H4'), '240');
  assert.equal(toChartTimeframe('D1'), '1D');
  assert.equal(toChartTimeframe('W1'), '1W');
  assert.equal(toChartTimeframe('MN1'), '1M');
  for (const timeframe of chartTimeframes) assert.equal(fromChartTimeframe(toChartTimeframe(timeframe.label)), timeframe.label);
  assert.equal(fromChartTimeframe('7'), null);
});

test('seconds timeframes are told apart from broker timeframes', () => {
  assert.equal(isSecondsTimeframe('S5'), true);
  assert.equal(isSecondsTimeframe('M5'), false);
  assert.equal(isChartTimeframe('S15'), true);
  assert.equal(isChartTimeframe('S2'), false);
});
