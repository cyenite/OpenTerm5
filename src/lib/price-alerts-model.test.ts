import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAlert, restoreAlerts, type PriceAlert } from './price-alerts-model';

const alert: PriceAlert = { id: 'one', symbol: 'EURUSD', profileId: 'demo', condition: 'bidAbove', price: 1.1, createdAt: 1000, triggeredAt: null, isEnabled: true };
const tick = { symbol: 'EURUSD', bid: 1.1, ask: 1.2, last: 0, volume: 1, time: 1001 };

test('alerts use their chosen side and inclusive threshold', () => {
  assert.equal(evaluateAlert(alert, tick, 'demo'), true);
  assert.equal(evaluateAlert({ ...alert, condition: 'bidBelow', price: 1.09 }, tick, 'demo'), false);
  assert.equal(evaluateAlert({ ...alert, condition: 'askAbove', price: 1.15 }, tick, 'demo'), true);
  assert.equal(evaluateAlert({ ...alert, condition: 'askBelow', price: 1.15 }, tick, 'demo'), false);
});

test('alerts ignore other accounts, symbols, stale quotes and previously fired state', () => {
  assert.equal(evaluateAlert(alert, tick, 'other'), false);
  assert.equal(evaluateAlert(alert, { ...tick, symbol: 'GBPUSD' }, 'demo'), false);
  assert.equal(evaluateAlert(alert, { ...tick, time: 999 }, 'demo'), false);
  assert.equal(evaluateAlert({ ...alert, triggeredAt: 1001 }, tick, 'demo'), false);
  assert.equal(evaluateAlert({ ...alert, isEnabled: false }, tick, 'demo'), false);
  assert.equal(evaluateAlert(alert, { ...tick, bid: NaN }, 'demo'), false);
});

test('restore filters corrupt or invalid alert records', () => {
  assert.deepEqual(restoreAlerts([alert, { ...alert, condition: 'unknown' }, { ...alert, price: -1 }, { ...alert, triggeredAt: undefined }, null]), [alert]);
});
