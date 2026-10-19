import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregateBars, dealFrom, formatQty, klinePlan, orderTypeOf, ticketOf } from './bybit-models';
import { rawOrder } from './bybit-fixtures';

test('tickets are stable positive safe integers', () => {
  const ticket = ticketOf('1f9c0c3a-8e7d-4d2b-9a55-0c4f2b6c1a11');
  assert.ok(Number.isSafeInteger(ticket) && ticket > 0);
  assert.equal(ticketOf('1f9c0c3a-8e7d-4d2b-9a55-0c4f2b6c1a11'), ticket);
  assert.notEqual(ticketOf('other'), ticket);
});

test('native periods map to Bybit intervals and the rest aggregate from the largest divisor', () => {
  assert.deepEqual(klinePlan('H4'), { interval: '240', seconds: 14400, sourceSeconds: 14400, isAggregated: false });
  assert.deepEqual(klinePlan('M10'), { interval: '5', seconds: 600, sourceSeconds: 300, isAggregated: true });
  assert.deepEqual(klinePlan('H3'), { interval: '60', seconds: 10800, sourceSeconds: 3600, isAggregated: true });
  assert.deepEqual(klinePlan('H8'), { interval: '240', seconds: 28800, sourceSeconds: 14400, isAggregated: true });
});

test('aggregation keeps fractional crypto volume', () => {
  const bars = aggregateBars([{ time: 120, open: 1, high: 2, low: 1, close: 2, volume: 0.25 }, { time: 180, open: 2, high: 3, low: 1.5, close: 2.5, volume: 0.5 }], 120);
  assert.deepEqual(bars, [{ time: 120, open: 1, high: 3, low: 1, close: 2.5, volume: 0.75 }]);
});

test('order types follow the order type and trigger', () => {
  assert.equal(orderTypeOf(rawOrder()), 'buyLimit');
  assert.equal(orderTypeOf(rawOrder({ side: 'Sell', orderType: 'Market', triggerPrice: '58000' })), 'sellStop');
  assert.equal(orderTypeOf(rawOrder({ orderType: 'Limit', triggerPrice: '61000' })), 'buyStopLimit');
});

test('closing fills book the gross profit once per order and fees as commission', () => {
  const closed = { orderId: 'o1', closedPnl: '98', openFee: '1', closeFee: '1' };
  const fill = { execId: 'e1', orderId: 'o1', symbol: 'BTCUSDT', side: 'Sell', execType: 'Trade', execPrice: '61000', execQty: '0.1', execFee: '0.6', execTime: '1760000000000', closedSize: '0.1' };
  const first = dealFrom(fill, closed, true);
  const second = dealFrom({ ...fill, execId: 'e2', execFee: '0.4' }, closed, false);
  assert.deepEqual([first.type, first.entry, first.profit, first.commission], ['sell', 'out', 100, -0.6]);
  assert.deepEqual([second.profit, second.commission], [0, -0.4]);
  assert.equal(dealFrom({ ...fill, closedSize: '0' }, undefined, false).entry, 'in');
});

test('quantities floor to the step without float noise', () => {
  assert.equal(formatQty(0.0129999, 0.001), '0.012');
  assert.equal(formatQty(0.3, 0.1), '0.3');
  assert.equal(formatQty(5, 1), '5');
});
