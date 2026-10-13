import assert from 'node:assert/strict';
import test from 'node:test';
import type { Deal, Order } from '../../shared/protocol';
import { historyCsv } from './history-export';

test('history export includes broker deals and orders with UTC millisecond timestamps', () => {
  const deal: Deal = { type: 'buy', entry: 'out', symbol: 'EURUSD', comment: '=SUM(A1:A2),"test"', fee: -1, swap: -2, time: 1700000000123, order: 4, price: 1.1, ticket: 3, volume: 0.01, profit: -5, positionId: 2, commission: -3 };
  const order = { ticket: 4, time: deal.time, symbol: 'EURUSD', type: 'buyLimit', state: 4, volumeInitial: 0.02, priceOpen: 1, positionId: 2, comment: 'ok' } as Order;
  const text = historyCsv({ deals: [deal], orders: [order] });
  assert.ok(text.startsWith('\ufeff"Record"'));
  assert.ok(text.includes('2023-11-14T22:13:20.123Z'));
  assert.ok(text.includes('"\'=SUM(A1:A2),""test"""'));
  assert.ok(text.includes('"-5"'));
  assert.ok(text.includes('"Order","4"'));
  assert.equal(text.split('\r\n').length, 4);
});

test('empty history still exports a valid header', () => {
  assert.equal(historyCsv({ deals: [], orders: [] }).split('\r\n').length, 2);
});
