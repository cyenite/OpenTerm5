import assert from 'node:assert/strict';
import test from 'node:test';
import { assistantRequest, defaultAssistantPreferences, orderTypeFor, parseTargets, partialVolume, restoreAssistantPreferences, stopForPrice, targetsForPrice } from './trade-assistant';

const risk = { mode: 'percentEquity', value: 1, commissionPerLot: 0 } as const;

test('a market order carries the stop in the chosen unit and targets as R multiples', () => {
  const request = assistantRequest({ side: 'sell', symbol: 'EURUSD', risk, preferences: { ...defaultAssistantPreferences, targets: '1, 2, x, -1', comment: '  scalp ' }, price: 1.2 });
  assert.equal(request.type, 'sell');
  assert.equal(request.price, undefined);
  assert.deepEqual(request.stopLoss, { unit: 'pips', value: 20 });
  assert.deepEqual(request.takeProfitR, [1, 2]);
  assert.equal(request.comment, 'scalp');
  assert.equal(request.commissionPerLot, undefined);
  assert.equal(request.management?.isBreakEvenAfterFirstTarget, true);
});

test('pending entries use the entry price, and no stop means no targets', () => {
  const preferences = { ...defaultAssistantPreferences, entry: 'limit' as const, stop: 0, trailing: 30, breakEvenR: 1 };
  const request = assistantRequest({ side: 'buy', symbol: 'XAUUSD', risk: { ...risk, commissionPerLot: 7 }, preferences, price: 2400.5 });
  assert.equal(request.type, 'buyLimit');
  assert.equal(request.price, 2400.5);
  assert.equal(request.stopLoss, undefined);
  assert.equal(request.takeProfitR, undefined);
  assert.equal(request.commissionPerLot, 7);
  assert.deepEqual(request.management?.trailing, { startPoints: 30, distancePoints: 30, stepPoints: 10 });
  assert.equal(request.management?.breakEvenR, 1);
  assert.equal(orderTypeFor('sell', 'stop'), 'sellStop');
});

test('targets keep at most five positive multiples', () => {
  assert.deepEqual(parseTargets('1,2,3,4,5,6'), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseTargets(''), []);
});

test('partial closes follow the volume step and never leave less than the minimum open', () => {
  const limits = { volumeMin: 0.01, volumeStep: 0.01 };
  assert.equal(partialVolume(1, 50, limits), 0.5);
  assert.equal(partialVolume(0.03, 50, limits), 0.01);
  assert.equal(partialVolume(0.02, 99, limits), 0.01);
  assert.equal(partialVolume(0.01, 50, limits), null);
  assert.equal(partialVolume(0.01, 100, limits), 0.01);
  assert.equal(partialVolume(1, 30, { volumeMin: 0.1, volumeStep: 0.1 }), 0.3);
});

test('saved preferences are checked field by field', () => {
  const restored = restoreAssistantPreferences({ tab: 'close', unit: 'furlongs', stop: -5, closePercent: 250, targets: '3', isStealth: 'yes', chartSide: 'sell' });
  assert.equal(restored.tab, 'close');
  assert.equal(restored.chartSide, 'sell');
  assert.equal(restoreAssistantPreferences({ chartSide: 'both' }).chartSide, 'buy');
  assert.equal(restored.unit, defaultAssistantPreferences.unit);
  assert.equal(restored.stop, defaultAssistantPreferences.stop);
  assert.equal(restored.closePercent, defaultAssistantPreferences.closePercent);
  assert.equal(restored.targets, '3');
  assert.equal(restored.isStealth, false);
  assert.deepEqual(restoreAssistantPreferences(null), defaultAssistantPreferences);
});

test('dragging the plan stop gives the stop in the chosen unit, only on the losing side', () => {
  const limits = { digits: 5, point: 0.00001 };
  assert.equal(stopForPrice('buy', 1.1, 1.0975, 'pips', limits), 25);
  assert.equal(stopForPrice('buy', 1.1, 1.0975, 'points', limits), 250);
  assert.equal(stopForPrice('sell', 1.1, 1.1012, 'pips', limits), 12);
  assert.equal(stopForPrice('sell', 1.1, 1.1012, 'price', limits), 1.1012);
  assert.equal(stopForPrice('buy', 1.1, 1.1012, 'pips', limits), null);
  assert.equal(stopForPrice('sell', 1.1, 1.0975, 'price', limits), null);
});

test('dragging a plan target rewrites only that target as an R multiple', () => {
  assert.equal(targetsForPrice('1, 2', 1, 1.1, 1.099, 1.103), '1, 3');
  assert.equal(targetsForPrice('2', 0, 1.1, 1.101, 1.0985), '1.5');
  assert.equal(targetsForPrice('2', 0, 1.1, 1.099, 1.0985), null, 'a buy target below entry');
  assert.equal(targetsForPrice('2', 1, 1.1, 1.099, 1.103), null);
});
