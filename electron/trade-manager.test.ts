import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeLink, account, memoryStore, position } from './automation-fixtures';
import { SessionPool } from './session-pool';
import { TradeManager, type ManagerState } from './trade-manager';

const ACCOUNT = 'wss://fake|1';
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

async function setup(time = Date.UTC(2026, 9, 13, 12)) {
  const link = new FakeLink();
  const pool = new SessionPool(link, () => undefined, () => new FakeLink());
  pool.afterUiChange(ACCOUNT, null);
  const store = memoryStore<ManagerState>({ rules: [], guards: [], guardStates: [] });
  const messages: string[] = [];
  const clock = { time };
  const manager = new TradeManager(pool, store, (message) => messages.push(message), () => clock.time);
  await manager.init();
  const tick = async () => {
    pool.emit('trade', ACCOUNT, { account: link.info, orders: link.orders, positions: link.positions });
    await settle();
  };
  return { link, pool, manager, messages, tick, clock };
}

test('trailing stop follows price in steps and never loosens', async () => {
  const { link, manager, tick } = await setup();
  link.positions = [position({ priceCurrent: 1.1 })];
  manager.setRule({ accountId: ACCOUNT, ticket: 100, symbol: 'EURUSD', side: 'buy', partials: [], createdAt: 0, initialVolume: 1, trailing: { startPoints: 100, distancePoints: 50, stepPoints: 10 } });
  link.positions[0].priceCurrent = 1.1005;
  await tick();
  assert.equal(link.sent.length, 0, 'not active before start');
  link.positions[0].priceCurrent = 1.1012;
  await tick();
  assert.equal(link.positions[0].sl, 1.10070);
  link.positions[0].priceCurrent = 1.10125;
  await tick();
  assert.equal(link.sent.length, 1, 'below the step: no modification');
  link.positions[0].priceCurrent = 1.1010;
  await tick();
  assert.equal(link.positions[0].sl, 1.10070, 'never moves back');
});

test('break-even moves the stop once and partials close a share of the initial volume', async () => {
  const { link, manager, tick } = await setup();
  link.positions = [position({ sl: 1.095 })];
  manager.setRule({ accountId: ACCOUNT, ticket: 100, symbol: 'EURUSD', side: 'buy', createdAt: 0, initialVolume: 1, breakEven: { triggerPoints: 200, lockPoints: 10 }, partials: [{ points: 300, percent: 50 }] });
  link.positions[0].priceCurrent = 1.1021;
  await tick();
  assert.equal(link.positions[0].sl, 1.1001);
  link.positions[0].priceCurrent = 1.1031;
  await tick();
  assert.equal(link.positions[0].volume, 0.5);
  await tick();
  assert.equal(link.sent.length, 2, 'each step happens once');
  assert.equal(manager.state().rules[0].partials[0].isDone, true);
});

test('hidden stops close at market without a broker stop', async () => {
  const { link, manager, tick } = await setup();
  link.positions = [position({ side: 'sell', priceOpen: 1.1, priceCurrent: 1.1 })];
  manager.setRule({ accountId: ACCOUNT, ticket: 100, symbol: 'EURUSD', side: 'sell', partials: [], createdAt: 0, initialVolume: 1, virtualStop: 1.102 });
  link.positions[0].priceCurrent = 1.1021;
  await tick();
  assert.equal(link.positions.length, 0);
  assert.equal(link.sent[0].type, 'buy');
});

test('an unknown outcome pauses management instead of retrying', async () => {
  const { link, manager, tick, messages } = await setup();
  link.positions = [position()];
  link.respond = () => { throw new Error('Order outcome is unknown'); };
  manager.setRule({ accountId: ACCOUNT, ticket: 100, symbol: 'EURUSD', side: 'buy', partials: [], createdAt: 0, initialVolume: 1, virtualTarget: 1.1005 });
  link.positions[0].priceCurrent = 1.101;
  await tick();
  await tick();
  assert.equal(link.sent.length, 1);
  assert.equal(manager.state().rules[0].isPaused, true);
  assert.ok(messages.some((message) => message.includes('paused')));
});

test('rules for closed positions are dropped', async () => {
  const { link, manager, tick } = await setup();
  manager.setRule({ accountId: ACCOUNT, ticket: 100, symbol: 'EURUSD', side: 'buy', partials: [], createdAt: Date.now(), initialVolume: 1 });
  link.positions = [];
  await tick();
  assert.equal(manager.state().rules.length, 0);
});

test('daily loss guard trips, closes everything and blocks new trades until the next day', async () => {
  const { link, manager, tick, clock } = await setup();
  manager.setGuard({ accountId: ACCOUNT, action: 'closeAll', resetHour: 0, dailyLossPercent: 5, isEnabled: true });
  link.positions = [position()];
  await tick();
  link.info = account({ equity: 9400 });
  await tick();
  await settle();
  assert.equal(link.positions.length, 0);
  assert.match(manager.canOpen(ACCOUNT) ?? '', /tripped/);
  clock.time += 86_400_000;
  await tick();
  assert.equal(manager.canOpen(ACCOUNT), null);
});

test('drawdown trips persist across days until reset', async () => {
  const { link, manager, tick, clock } = await setup();
  manager.setGuard({ accountId: ACCOUNT, action: 'blockNew', resetHour: 0, maxDrawdownPercent: 10, isEnabled: true });
  await tick();
  link.info = account({ equity: 8900 });
  await tick();
  assert.match(manager.canOpen(ACCOUNT) ?? '', /drawdown/);
  clock.time += 86_400_000;
  await tick();
  assert.match(manager.canOpen(ACCOUNT) ?? '', /drawdown/);
  manager.resetGuard(ACCOUNT);
  assert.equal(manager.canOpen(ACCOUNT), null);
});

test('position and lot caps block new trades', async () => {
  const { link, manager, tick } = await setup();
  manager.setGuard({ accountId: ACCOUNT, action: 'blockNew', resetHour: 0, maxOpenPositions: 2, maxLotsPerSymbol: 1.5, isEnabled: true });
  link.positions = [position({ volume: 1 })];
  await tick();
  assert.match(manager.canOpen(ACCOUNT, 'EURUSD', 1) ?? '', /1.5 lots/);
  assert.equal(manager.canOpen(ACCOUNT, 'EURUSD', 0.5), null);
  link.positions.push(position({ ticket: 101 }));
  await tick();
  assert.match(manager.canOpen(ACCOUNT) ?? '', /2 open positions/);
});

test('bulk close filters by profit and side', async () => {
  const { link, manager } = await setup();
  link.positions = [position({ ticket: 1, profit: 10 }), position({ ticket: 2, profit: -5 }), position({ ticket: 3, side: 'sell', profit: 3 })];
  const outcomes = await manager.bulk({ kind: 'closeProfitable' });
  assert.deepEqual(outcomes.map((outcome) => outcome.ticket), [1, 3]);
  assert.deepEqual(link.positions.map((item) => item.ticket), [2]);
});

test('risk order sizes, splits targets and attaches break-even after the first target', async () => {
  const { link, manager } = await setup();
  const outcome = await manager.placeRisk({
    type: 'buy', mode: 'percentBalance', value: 1, symbol: 'EURUSD',
    stopLoss: { unit: 'pips', value: 50 }, takeProfitR: [1, 2],
    management: { isBreakEvenAfterFirstTarget: true },
  });
  assert.equal(outcome.lots, 0.2);
  assert.equal(link.sent.length, 2);
  assert.deepEqual(link.sent.map((trade) => trade.volume), [0.1, 0.1]);
  assert.deepEqual(link.sent.map((trade) => trade.tp), [1.1051, 1.1101]);
  assert.equal(link.sent[0].sl, 1.0951);
  const rules = manager.state().rules;
  assert.equal(rules.length, 1);
  assert.equal(rules[0].breakEven?.triggerPoints, 500);
});

test('risk orders respect a tripped guard and dry runs send nothing', async () => {
  const { link, manager, tick } = await setup();
  const dry = await manager.placeRisk({ type: 'sell', mode: 'money', value: 50, symbol: 'EURUSD', stopLoss: { unit: 'points', value: 200 }, isDryRun: true });
  assert.equal(dry.lots, 0.25);
  assert.equal(link.sent.length, 0);
  manager.setGuard({ accountId: ACCOUNT, action: 'blockNew', resetHour: 0, maxOpenPositions: 1, isEnabled: true });
  link.positions = [position()];
  await tick();
  await assert.rejects(manager.placeRisk({ type: 'sell', mode: 'money', value: 50, symbol: 'EURUSD', stopLoss: { unit: 'points', value: 200 } }), /open positions/);
});
