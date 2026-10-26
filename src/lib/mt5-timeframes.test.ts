import assert from 'node:assert/strict';
import test from 'node:test';
import { chartTimeframes, fromChartTimeframe, isChartTimeframe, isSecondsTimeframe, parseTimeframe, timeframeDescription, toChartTimeframe } from './mt5-timeframes';

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

test('typed intervals are read the TradingView and the MetaTrader way', () => {
  assert.equal(parseTimeframe('1'), 'M1');
  assert.equal(parseTimeframe('15'), 'M15');
  assert.equal(parseTimeframe('60'), 'H1');
  assert.equal(parseTimeframe('240'), 'H4');
  assert.equal(parseTimeframe('15m'), 'M15');
  assert.equal(parseTimeframe('4h'), 'H4');
  assert.equal(parseTimeframe('4H'), 'H4');
  assert.equal(parseTimeframe('5s'), 'S5');
  assert.equal(parseTimeframe('1D'), 'D1');
  assert.equal(parseTimeframe('d'), 'D1');
  assert.equal(parseTimeframe('W'), 'W1');
  assert.equal(parseTimeframe('h'), 'H1');
  assert.equal(parseTimeframe('1M'), 'MN1');
  assert.equal(parseTimeframe('M'), 'MN1');
  assert.equal(parseTimeframe('M15'), 'M15');
  assert.equal(parseTimeframe('m30'), 'M30');
  assert.equal(parseTimeframe('H4'), 'H4');
  assert.equal(parseTimeframe('MN1'), 'MN1');
  assert.equal(parseTimeframe(' 1 h '), 'H1');
});

test('typed intervals the terminal does not offer are refused', () => {
  assert.equal(parseTimeframe(''), null);
  assert.equal(parseTimeframe('0'), null);
  assert.equal(parseTimeframe('7'), null);
  assert.equal(parseTimeframe('1440'), null);
  assert.equal(parseTimeframe('2D'), null);
  assert.equal(parseTimeframe('3W'), null);
  assert.equal(parseTimeframe('1x'), null);
});

test('timeframes are described in words', () => {
  assert.equal(timeframeDescription('M1'), '1 minute');
  assert.equal(timeframeDescription('M15'), '15 minutes');
  assert.equal(timeframeDescription('H4'), '4 hours');
  assert.equal(timeframeDescription('S5'), '5 seconds');
  assert.equal(timeframeDescription('MN1'), '1 month');
});
