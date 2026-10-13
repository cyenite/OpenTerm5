import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignalError, mapSymbol, normalizeSignal, parseSignalBody } from './webhook-signal';

test('parses a full JSON signal', () => {
  const signal = normalizeSignal(parseSignalBody(JSON.stringify({ id: 'a1', action: 'Buy', symbol: 'EURUSD', risk: 1, sl_pips: 20, tp_r: [1, 2], trailing_points: 150, comment: 'tv' })));
  assert.equal(signal.action, 'buy');
  assert.deepEqual(signal.stop, { unit: 'pips', value: 20 });
  assert.deepEqual(signal.targetR, [1, 2]);
  assert.equal(signal.riskPercent, 1);
  assert.deepEqual(signal.trailing, { distancePoints: 150, startPoints: 150, stepPoints: 10 });
});

test('accepts TradingView-style aliases, numeric strings and the text form', () => {
  assert.equal(normalizeSignal({ action: 'long', ticker: 'OANDA:XAUUSD', qty: '0.5' }).lots, 0.5);
  assert.equal(normalizeSignal({ side: 'flat', symbol: 'EURUSD' }).action, 'close');
  const signal = normalizeSignal(parseSignalBody('sell GBPUSD risk_money=50 sl=1.2650 tp=1.25,1.24'));
  assert.equal(signal.action, 'sell');
  assert.equal(signal.riskMoney, 50);
  assert.deepEqual(signal.stop, { unit: 'price', value: 1.265 });
  assert.equal(signal.targets.length, 2);
});

test('rejects malformed and dangerous input with a clear reason', () => {
  assert.throws(() => normalizeSignal({ action: 'launch', symbol: 'EURUSD' }), /Unknown action/);
  assert.throws(() => normalizeSignal({ action: 'buy' }), /symbol/);
  assert.throws(() => normalizeSignal({ action: 'buy', symbol: 'EURUSD', volume: -1 }), SignalError);
  assert.throws(() => normalizeSignal({ action: 'buy', symbol: 'EURUSD', risk: 250 }), /percentage/);
  assert.throws(() => normalizeSignal({ action: 'buy', symbol: 'EURUSD', tp: 1.2, tp_r: 2 }), /either/);
  assert.throws(() => normalizeSignal({ action: 'buy', symbol: 'EURUSD', tp: '1,2,3,4,5,6' }), /at most/);
  assert.throws(() => parseSignalBody('{not json'), /valid JSON/);
  assert.throws(() => parseSignalBody('[1,2]'), /JSON object/);
  assert.equal(normalizeSignal({ action: 'close_all' }).symbol, '');
});

test('maps exchange prefixes, explicit names and broker suffixes', () => {
  assert.equal(mapSymbol('OANDA:EURUSD', {}, ''), 'EURUSD');
  assert.equal(mapSymbol('EURUSD', {}, '.m'), 'EURUSD.m');
  assert.equal(mapSymbol('EURUSD.m', {}, '.m'), 'EURUSD.m');
  assert.equal(mapSymbol('XAUUSD', { XAUUSD: 'GOLD' }, '.m'), 'GOLD');
  assert.equal(mapSymbol('BINANCE:BTCUSDT.P', {}, ''), 'BTCUSDT');
});
