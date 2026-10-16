import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isAffected, meetsImpact, symbolCurrencies } from './news';

test('symbol currencies come from the broker record when there is one', () => {
  assert.deepEqual(symbolCurrencies('US30', { currencyBase: 'USD', currencyProfit: 'USD' }), ['USD']);
  assert.deepEqual(symbolCurrencies('GER40.cash', { currencyBase: 'EUR', currencyProfit: 'EUR' }), ['EUR']);
  assert.deepEqual(symbolCurrencies('XAUUSD', { currencyBase: 'XAU', currencyProfit: 'USD' }), ['XAU', 'USD']);
});

test('without a broker record, currency codes in the name are used', () => {
  assert.deepEqual(symbolCurrencies('eurusd.r'), ['USD', 'EUR']);
  assert.deepEqual(symbolCurrencies('US30'), []);
});

test('impact thresholds include everything more severe', () => {
  assert.equal(meetsImpact('high', 'medium'), true);
  assert.equal(meetsImpact('medium', 'medium'), true);
  assert.equal(meetsImpact('low', 'medium'), false);
});

test('events marked All affect every symbol', () => {
  const event = { time: 0, title: 'G7 Meetings', impact: 'high' as const, currency: 'All' };
  assert.equal(isAffected(event, ['JPY']), true);
  assert.equal(isAffected({ ...event, currency: 'USD' }, ['JPY']), false);
});
