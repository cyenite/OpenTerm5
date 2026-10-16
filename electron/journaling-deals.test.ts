import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closingPositions, dealBatches, ingestPayload } from './journaling-deals';
import { account, deal } from './journaling-fixtures';

test('deals map to the contract fields only', () => {
  const [[mapped]] = dealBatches([deal(9001, 1_790_790_000_000)]);
  assert.deepEqual(mapped, {
    type: 'buy', entry: 'in', symbol: 'EURUSD', comment: '', fee: 0, swap: 0, time: 1_790_790_000_000, order: 8001, price: 1.1008,
    ticket: 9001, volume: 1, profit: 0, positionId: 7001, commission: -3.5,
  });
});

test('the payload carries the account, the integer offset and the deals', () => {
  const payload = ingestPayload(account, 180, []);
  assert.deepEqual(payload, {
    account: { name: 'Aaron Rono', server: 'MetaQuotes-Demo', company: 'MetaQuotes Ltd.', currency: 'USD', tradeMode: 'demo', login: 5012345, isHedging: true },
    serverTimeOffsetMinutes: 180,
    deals: [],
  });
  assert.equal(Object.keys(JSON.parse(JSON.stringify(payload))).join(), 'account,serverTimeOffsetMinutes,deals');
});

test('deals are sent oldest first in batches of at most 200, balance deals included', () => {
  const deals = Array.from({ length: 450 }, (_, index) => deal(10_000 + index, 1_000_000 - index * 1000, index === 5 ? { type: 'balance', symbol: '' } : {}));
  const batches = dealBatches(deals);
  assert.deepEqual(batches.map((batch) => batch.length), [200, 200, 50]);
  const times = batches.flat().map((item) => item.time);
  assert.deepEqual(times, [...times].sort((left, right) => left - right));
  assert.ok(batches.flat().some((item) => item.type === 'balance'));
  assert.ok(JSON.stringify(ingestPayload(account, 180, batches[0])).length < 64 * 1024);
});

test('equal times keep ticket order', () => {
  const [batch] = dealBatches([deal(3, 100), deal(1, 100), deal(2, 100)]);
  assert.deepEqual(batch.map((item) => item.ticket), [1, 2, 3]);
});

test('closing positions are trade exits after the cursor', () => {
  const [batch] = dealBatches([
    deal(1, 100, { entry: 'out', positionId: 1 }),
    deal(2, 300, { entry: 'out', positionId: 2, symbol: 'GBPUSD' }),
    deal(3, 300, { entry: 'in', positionId: 3 }),
    deal(4, 300, { entry: 'out', type: 'balance', positionId: 4 }),
  ]);
  assert.deepEqual([...closingPositions(batch, 200)], [[2, 'GBPUSD']]);
});
