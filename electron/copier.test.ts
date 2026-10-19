import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CopierConfig, CopierLogEntry, FollowerConfig } from '../shared/automation';
import { defaultEquityProtection } from '../shared/automation';
import { FakeLink, account, order, position } from './automation-fixtures';
import { Copier, type CopierState } from './copier';
import { defaultFollower } from './copier-math';
import { SessionPool } from './session-pool';

const MASTER = 'wss://fake|1';
const FOLLOWER = 'wss://fake|2';

async function setup(followerPatch: Partial<FollowerConfig> = {}, configPatch: Partial<CopierConfig> = {}, prepare?: (master: FakeLink) => void) {
  const master = new FakeLink();
  const follower = new FakeLink();
  follower.info = account({ balance: 5000, equity: 5000 });
  prepare?.(master);
  const pool = new SessionPool(master, () => ({ platform: 'mt5', login: 2, password: 'x', endpoint: 'wss://fake' }), () => follower);
  pool.afterUiChange(MASTER, null);
  let state: CopierState = { configs: [], mappings: [], baselines: [], protections: [] };
  const logs: CopierLogEntry[] = [];
  const blocked = { reason: null as string | null };
  const copier = new Copier(pool, {
    load: async () => state, save: async (next) => { state = next; }, append: (entry) => logs.push(entry),
    canOpen: async () => blocked.reason, sleep: async () => {}, random: () => 0,
  });
  await copier.init();
  const config: CopierConfig = { id: 'c1', name: 'Main', status: 'enabled', masterId: MASTER, followers: [{ ...defaultFollower('f1', FOLLOWER), ...followerPatch }], createdAt: 0, ...configPatch };
  await copier.save(config);
  const tick = async () => {
    pool.emit('trade', MASTER, { account: master.info, orders: master.orders, positions: master.positions });
    pool.emit('trade', FOLLOWER, { account: follower.info, orders: follower.orders, positions: follower.positions });
    await copier.settle();
    pool.emit('trade', FOLLOWER, { account: follower.info, orders: follower.orders, positions: follower.positions });
    await copier.settle();
  };
  for (let index = 0; index < 20 && !pool.link(FOLLOWER); index++) await new Promise((resolve) => setTimeout(resolve, 5));
  await tick();
  return { master, follower, copier, logs, tick, blocked, pool, state: () => state };
}

test('copies a new master position and closes it when the master closes', async () => {
  const { master, follower, tick, logs } = await setup({ riskValue: 50 });
  master.positions = [position({ ticket: 7, volume: 0.4, sl: 1.095, tp: 1.11 })];
  await tick();
  assert.equal(follower.positions.length, 1);
  assert.equal(follower.sent[0].volume, 0.2);
  assert.equal(follower.sent[0].sl, 1.095);
  assert.ok(logs.some((entry) => entry.event === 'open' && entry.status === 'ok' && entry.latencyMs !== undefined));
  master.positions = [];
  await tick();
  assert.equal(follower.positions.length, 0);
});

test('existing master positions are ignored unless copying existing trades', async () => {
  const prepare = (master: FakeLink) => { master.positions = [position({ ticket: 3 })]; };
  const ignored = await setup({}, {}, prepare);
  assert.equal(ignored.follower.sent.length, 0);
  const copied = await setup({ isExistingCopied: true }, {}, prepare);
  assert.equal(copied.follower.sent.length, 1);
});

test('partial closes and stop changes follow the master', async () => {
  const { master, follower, tick } = await setup();
  master.positions = [position({ ticket: 7, volume: 1, sl: 1.095 })];
  await tick();
  master.positions = [{ ...master.positions[0], volume: 0.4 }];
  await tick();
  assert.equal(follower.positions[0].volume, 0.4);
  master.positions = [{ ...master.positions[0], sl: 1.098, tp: 1.12 }];
  await tick();
  assert.equal(follower.positions[0].sl, 1.098);
  assert.equal(follower.positions[0].tp, 1.12);
  await tick();
  assert.equal(follower.sent.length, 3, 'no repeated modifications');
});

test('strict close leaves the copy to its own stops', async () => {
  const { master, follower, tick } = await setup({ isStrictClose: true });
  master.positions = [position({ ticket: 7, sl: 1.09 })];
  await tick();
  master.positions = [];
  await tick();
  assert.equal(follower.positions.length, 1);
});

test('reverse copies open the opposite side without the master stops', async () => {
  const { master, follower, tick } = await setup({ isReversed: true });
  master.positions = [position({ ticket: 7, sl: 1.09, tp: 1.12 })];
  await tick();
  assert.equal(follower.sent[0].type, 'sell');
  assert.equal(follower.sent[0].sl, undefined);
});

test('an unknown outcome is never re-sent and is adopted when the position shows up', async () => {
  const { master, follower, tick, logs, state } = await setup();
  follower.respond = () => { throw new Error('connection lost'); };
  master.positions = [position({ ticket: 7 })];
  await tick();
  await tick();
  assert.equal(follower.sent.length, 1);
  assert.equal(state().mappings[0].status, 'unknown');
  follower.positions = [position({ ticket: 55, time: Date.now() })];
  await tick();
  assert.equal(state().mappings[0].status, 'open');
  assert.equal(state().mappings[0].followerTicket, 55);
  assert.ok(logs.some((entry) => entry.event === 'reconcile' && entry.status === 'ok'));
});

test('transient rejections are retried and permanent ones are not', async () => {
  const { master, follower, tick, state } = await setup();
  let calls = 0;
  follower.respond = (request) => {
    calls++;
    if (calls < 3) return { retcode: 10004, isSuccess: false, comment: 'Requote' };
    follower.applyTrade(request);
    return { retcode: 10009, isSuccess: true, comment: 'Done', order: 900 + follower.sent.length };
  };
  master.positions = [position({ ticket: 7 })];
  await tick();
  assert.equal(calls, 3);
  assert.equal(state().mappings[0].status, 'open');
  follower.respond = () => ({ retcode: 10019, isSuccess: false, comment: 'No money' });
  master.positions.push(position({ ticket: 8 }));
  await tick();
  assert.equal(state().mappings.find((mapping) => mapping.masterTicket === 8)!.status, 'failed');
});

test('a copy closed on the follower is not reopened while the master stays open', async () => {
  const { master, follower, tick } = await setup();
  master.positions = [position({ ticket: 7 })];
  await tick();
  follower.positions = [];
  await tick();
  await tick();
  assert.equal(follower.sent.length, 1);
});

test('pending orders are copied, synced on fill and removed when cancelled', async () => {
  const { master, follower, tick } = await setup({ isPendingCopied: true });
  master.orders = [order({ ticket: 20, priceOpen: 1.09 })];
  await tick();
  assert.equal(follower.orders.length, 1);
  master.orders = [{ ...master.orders[0], priceOpen: 1.091 }];
  await tick();
  assert.equal(follower.orders[0].priceOpen, 1.091);
  master.orders = [];
  await tick();
  assert.equal(follower.orders.length, 0);
});

test('filters, monitor-existing and guards stop new copies but not closes', async () => {
  const { master, follower, tick, copier, blocked } = await setup({ side: 'sell' });
  master.positions = [position({ ticket: 7, side: 'buy' })];
  await tick();
  assert.equal(follower.sent.length, 0);
  const config = copier.configs()[0];
  await copier.save({ ...config, followers: [{ ...config.followers[0], side: 'all' }] });
  master.positions = [position({ ticket: 8 })];
  await tick();
  assert.equal(follower.positions.length, 1);
  await copier.save({ ...copier.configs()[0], status: 'monitorExisting' });
  master.positions = [master.positions[0], position({ ticket: 9 })];
  await tick();
  assert.equal(follower.positions.length, 1);
  await copier.save({ ...copier.configs()[0], status: 'enabled' });
  blocked.reason = 'Equity guard tripped';
  master.positions = [master.positions[0], position({ ticket: 10 })];
  await tick();
  assert.equal(follower.positions.length, 1);
  master.positions = [];
  await tick();
  assert.equal(follower.positions.length, 0);
});

test('equity protection closes copied trades', async () => {
  const { master, follower, tick } = await setup({ equityProtection: { ...defaultEquityProtection, minEquity: 4000, action: 'closeAll' } });
  master.positions = [position({ ticket: 7 })];
  await tick();
  assert.equal(follower.positions.length, 1);
  follower.info = account({ balance: 5000, equity: 3900 });
  await tick();
  assert.equal(follower.positions.length, 0);
  master.positions.push(position({ ticket: 8 }));
  await tick();
  assert.equal(follower.positions.length, 0);
});

test('configuration validation rejects self-copy, duplicates and loops', async () => {
  const { copier } = await setup();
  const base = copier.configs()[0];
  assert.throws(() => copier.validate({ ...base, followers: [defaultFollower('x', MASTER)] }), /itself/);
  assert.throws(() => copier.validate({ ...base, followers: [defaultFollower('x', FOLLOWER), defaultFollower('y', FOLLOWER)] }), /only once/);
  assert.throws(() => copier.validate({ ...base, id: 'c2', masterId: FOLLOWER, followers: [defaultFollower('z', MASTER)] }), /loop/);
});

test('equity protection can measure the daily loss from the balance at day start', async () => {
  const { master, follower, tick, logs } = await setup({ equityProtection: { ...defaultEquityProtection, maxDailyLossPercent: 5, lossBasis: 'balance' } });
  follower.info = account({ balance: 5000, equity: 4760 });
  master.positions = [position({ ticket: 7 })];
  await tick();
  assert.equal(follower.positions.length, 1, 'a 4.8% loss is inside the limit');
  follower.info = account({ balance: 5000, equity: 4740 });
  await tick();
  master.positions.push(position({ ticket: 8 }));
  await tick();
  assert.equal(follower.positions.length, 1, 'a 5.2% loss blocks new copies');
  assert.ok(logs.filter((entry) => entry.followerId === 'f1').every((entry) => entry.accountId === FOLLOWER), 'log entries name the follower account');
});

test('followers saved before reset settings keep local midnight on equity', async () => {
  const { copier } = await setup();
  const config = copier.configs()[0];
  const legacy = { minEquity: 0, maxDailyLossPercent: 3, action: 'blockNew' } as FollowerConfig['equityProtection'];
  const saved = await copier.save({ ...config, followers: [{ ...config.followers[0], equityProtection: legacy }] });
  assert.deepEqual(saved.followers[0].equityProtection, { ...defaultEquityProtection, maxDailyLossPercent: 3, resetZone: 'local', lossBasis: 'equity' });
});
