import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { History } from '../shared/protocol';
import type { IngestPayload, IngestResult } from './journaling-deals';
import { account, deal } from './journaling-fixtures';
import { BACKFILL_MS, OVERLAP_MS, syncDeals, syncWindow } from './journaling-sync';

const DAY = 86_400_000;
const serverNow = Date.UTC(2026, 9, 15, 15, 0, 0);

const result = (patch: Partial<IngestResult> = {}): IngestResult => ({ accountId: 'mt5-5012345-metaquotes-demo', held: null, trades: [], inserted: 0, skipped: 0, duplicates: 0, ...patch });

function harness(history: History, replies: ((payload: IngestPayload) => IngestResult)[]) {
  const ranges: [number, number][] = [];
  const payloads: IngestPayload[] = [];
  const progress: (number | null)[] = [];
  return {
    ranges, payloads, progress,
    deps: {
      history: async (from: number, to: number) => { ranges.push([from, to]); return history; },
      post: async (payload: IngestPayload) => { payloads.push(payload); const reply = replies.shift(); if (!reply) throw new Error('unexpected post'); return reply(payload); },
      progress: (cursor: number | null) => { progress.push(cursor); },
    },
  };
}

test('the first sync backfills 90 days and later ones start a day before the cursor', () => {
  assert.deepEqual(syncWindow(null, serverNow), { from: serverNow - BACKFILL_MS, to: serverNow + DAY });
  assert.deepEqual(syncWindow(serverNow - 3_600_000, serverNow), { from: serverNow - 3_600_000 - OVERLAP_MS, to: serverNow + DAY });
});

test('history is asked for in server-clock seconds and a clean sync moves the cursor to now', async () => {
  const { ranges, payloads, deps } = harness({ deals: [deal(1, serverNow - 5_000)], orders: [] }, [() => result({ inserted: 1 })]);
  const outcome = await syncDeals({ account, cursor: null, serverNow, offsetMinutes: 180 }, deps);
  assert.deepEqual(ranges, [[(serverNow - BACKFILL_MS) / 1000, (serverNow + DAY) / 1000]]);
  assert.equal(payloads[0].serverTimeOffsetMinutes, 180);
  assert.equal(outcome.cursor, serverNow);
  assert.equal(outcome.held, null);
});

test('no deals still records the sync, with nothing posted', async () => {
  const { payloads, deps } = harness({ deals: [], orders: [] }, []);
  const outcome = await syncDeals({ account, cursor: null, serverNow, offsetMinutes: 0 }, deps);
  assert.equal(payloads.length, 0);
  assert.equal(outcome.cursor, serverNow);
});

test('a held batch leaves the cursor at held.fromTime and sends nothing after it', async () => {
  const deals = Array.from({ length: 450 }, (_, index) => deal(1000 + index, serverNow - DAY + index * 1000));
  const fromTime = deals[230].time;
  const { payloads, progress, deps } = harness({ deals, orders: [] }, [
    () => result({ inserted: 200 }),
    () => result({ inserted: 30, held: { fromTime, message: 'Monthly limit reached' } }),
  ]);
  const outcome = await syncDeals({ account, cursor: serverNow - 2 * DAY, serverNow, offsetMinutes: 180 }, deps);
  assert.equal(payloads.length, 2);
  assert.equal(outcome.cursor, fromTime);
  assert.deepEqual(outcome.held, { fromTime, message: 'Monthly limit reached' });
  assert.deepEqual(progress, [deals[199].time, fromTime]);
  assert.equal(outcome.batches, 2);
});

test('a retry after a hold starts from the held cursor minus the overlap', async () => {
  const fromTime = serverNow - 3 * DAY;
  const { ranges, deps } = harness({ deals: [], orders: [] }, []);
  await syncDeals({ account, cursor: fromTime, serverNow, offsetMinutes: 180 }, deps);
  assert.equal(ranges[0][0], (fromTime - OVERLAP_MS) / 1000);
});

test('progress survives a failure in a later batch', async () => {
  const deals = Array.from({ length: 250 }, (_, index) => deal(1000 + index, serverNow - DAY + index * 1000));
  const { progress, deps } = harness({ deals, orders: [] }, [() => result(), () => { throw new Error('429'); }]);
  await assert.rejects(syncDeals({ account, cursor: null, serverNow, offsetMinutes: 0 }, deps), /429/);
  assert.deepEqual(progress, [deals[199].time]);
});

test('only trades this sync closed are reported for review, and none on the first backfill', async () => {
  const cursor = serverNow - 3_600_000;
  const history: History = {
    orders: [],
    deals: [
      deal(1, cursor - 10_000, { entry: 'out', positionId: 11, symbol: 'USDJPY' }),
      deal(2, cursor + 10_000, { entry: 'in', positionId: 12 }),
      deal(3, cursor + 20_000, { entry: 'out', positionId: 12, profit: 42.1 }),
      deal(4, cursor + 30_000, { entry: 'out', positionId: 13, symbol: 'XAUUSD' }),
    ],
  };
  const trades = [
    { positionId: 11, key: 'k11', status: 'win', netPnl: 5, isOpen: false, verifiedBy: 'mt5', url: 'https://tradescribe.io/trades/k11' },
    { positionId: 12, key: 'k12', status: 'win', netPnl: 42.1, isOpen: false, verifiedBy: 'mt5', url: 'https://tradescribe.io/trades/k12' },
    { positionId: 13, key: 'k13', status: 'open', netPnl: -1, isOpen: true, verifiedBy: 'mt5', url: null },
  ];
  const live = harness(history, [() => result({ trades })]);
  const outcome = await syncDeals({ account, cursor, serverNow, offsetMinutes: 0 }, live.deps);
  assert.deepEqual(outcome.closed, [{ key: 'k12', url: 'https://tradescribe.io/trades/k12', symbol: 'EURUSD', netPnl: 42.1 }]);
  const backfill = harness(history, [() => result({ trades })]);
  assert.deepEqual((await syncDeals({ account, cursor: null, serverNow, offsetMinutes: 0 }, backfill.deps)).closed, []);
});

test('the first backfill keeps exits of positions that opened before its window out of the journal', async () => {
  const deals = [deal(1, serverNow - 9_000, { entry: 'out', positionId: 40 }), deal(2, serverNow - 8_000, { positionId: 41 }), deal(3, serverNow - 7_000, { entry: 'out', positionId: 41 }), deal(4, serverNow - 6_000, { type: 'balance', positionId: 0 })];
  const { payloads, deps } = harness({ deals, orders: [] }, [() => result({ inserted: 2 })]);
  await syncDeals({ account, cursor: null, serverNow, offsetMinutes: 0 }, deps);
  assert.deepEqual(payloads[0].deals.map((sent) => sent.ticket), [2, 3, 4]);
});
