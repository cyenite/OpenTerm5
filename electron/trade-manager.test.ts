import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AccountGuard } from '../shared/automation';
import { defaultGuard } from '../shared/automation';
import type { NewsEvent } from '../shared/news';
import { FakeLink, account, memoryStore, position } from './automation-fixtures';
import { SessionPool } from './session-pool';
import { TradeManager, type ManagerState, type NewsSource } from './trade-manager';

const ACCOUNT = 'wss://fake|1';
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

async function setup(time = Date.UTC(2026, 9, 13, 12), news?: NewsSource) {
  const link = new FakeLink();
  const pool = new SessionPool(link, () => undefined, () => new FakeLink());
  pool.afterUiChange(ACCOUNT, null);
  const store = memoryStore<ManagerState>({ rules: [], guards: [], guardStates: [], requestCounts: [] });
  const messages: string[] = [];
  const clock = { time };
  const manager = new TradeManager(pool, store, (message) => messages.push(message), () => clock.time, news);
  await manager.init();
  pool.setAdmission((accountId, request) => manager.admit(accountId, request));
  const tick = async () => {
    pool.emit('trade', ACCOUNT, { account: link.info, orders: link.orders, positions: link.positions });
    await settle();
  };
  return { link, pool, manager, messages, tick, clock, store };
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
  manager.setGuard({ ...defaultGuard(ACCOUNT), action: 'closeAll', lossBasis: 'equity', dailyLossPercent: 5, isEnabled: true });
  link.positions = [position()];
  await tick();
  link.info = account({ equity: 9400 });
  await tick();
  await settle();
  assert.equal(link.positions.length, 0);
  assert.match(await manager.canOpen(ACCOUNT) ?? '', /tripped/);
  clock.time += 86_400_000;
  await tick();
  assert.equal(await manager.canOpen(ACCOUNT), null);
});

test('drawdown trips persist across days until reset', async () => {
  const { link, manager, tick, clock } = await setup();
  manager.setGuard({ ...defaultGuard(ACCOUNT), action: 'blockNew', resetHour: 0, maxDrawdownPercent: 10, isEnabled: true });
  await tick();
  link.info = account({ equity: 8900 });
  await tick();
  assert.match(await manager.canOpen(ACCOUNT) ?? '', /drawdown/);
  clock.time += 86_400_000;
  await tick();
  assert.match(await manager.canOpen(ACCOUNT) ?? '', /drawdown/);
  manager.resetGuard(ACCOUNT);
  assert.equal(await manager.canOpen(ACCOUNT), null);
});

test('position and lot caps block new trades', async () => {
  const { link, manager, tick } = await setup();
  manager.setGuard({ ...defaultGuard(ACCOUNT), action: 'blockNew', resetHour: 0, maxOpenPositions: 2, maxLotsPerSymbol: 1.5, isEnabled: true });
  link.positions = [position({ volume: 1 })];
  await tick();
  assert.match(await manager.canOpen(ACCOUNT, 'EURUSD', 1) ?? '', /1.5 lots/);
  assert.equal(await manager.canOpen(ACCOUNT, 'EURUSD', 0.5), null);
  link.positions.push(position({ ticket: 101 }));
  await tick();
  assert.match(await manager.canOpen(ACCOUNT) ?? '', /2 open positions/);
});

test('bulk close filters by profit and side', async () => {
  const { link, manager } = await setup();
  link.positions = [position({ ticket: 1, profit: 10 }), position({ ticket: 2, profit: -5 }), position({ ticket: 3, side: 'sell', profit: 3 })];
  const outcomes = await manager.bulk({ kind: 'closeProfitable' });
  assert.deepEqual(outcomes.map((outcome) => outcome.ticket), [1, 3]);
  assert.deepEqual(link.positions.map((item) => item.ticket), [2]);
});

test('a bulk request with a symbol only touches that symbol', async () => {
  const { link, manager } = await setup();
  link.positions = [position({ ticket: 1, profit: 10 }), position({ ticket: 2, symbol: 'GBPUSD', profit: 4 }), position({ ticket: 3, side: 'sell', profit: -2 })];
  const profitable = await manager.bulk({ kind: 'closeProfitable', symbol: 'EURUSD' });
  assert.deepEqual(profitable.map((outcome) => outcome.ticket), [1]);
  const sells = await manager.bulk({ kind: 'closeSells', symbol: 'GBPUSD' });
  assert.equal(sells.length, 0);
  assert.deepEqual(link.positions.map((item) => item.ticket), [2, 3]);
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
  manager.setGuard({ ...defaultGuard(ACCOUNT), action: 'blockNew', resetHour: 0, maxOpenPositions: 1, isEnabled: true });
  link.positions = [position()];
  await tick();
  await assert.rejects(manager.placeRisk({ type: 'sell', mode: 'money', value: 50, symbol: 'EURUSD', stopLoss: { unit: 'points', value: 200 } }), /open positions/);
});

test('the daily loss reference follows the chosen basis', async () => {
  const cases: { basis: AccountGuard['lossBasis']; start: { balance: number; equity: number }; trips: number; holds: number }[] = [
    { basis: 'balance', start: { balance: 10_000, equity: 9_800 }, trips: 9_500, holds: 9_501 },
    { basis: 'equity', start: { balance: 10_000, equity: 9_800 }, trips: 9_310, holds: 9_311 },
    { basis: 'higher', start: { balance: 10_000, equity: 10_300 }, trips: 9_785, holds: 9_786 },
  ];
  for (const { basis, start, trips, holds } of cases) {
    const { link, manager, tick } = await setup();
    manager.setGuard({ ...defaultGuard(ACCOUNT), lossBasis: basis, dailyLossPercent: 5, isEnabled: true });
    link.info = account(start);
    await tick();
    link.info = account({ balance: start.balance, equity: holds });
    await tick();
    assert.equal(await manager.canOpen(ACCOUNT), null, `${basis} holds at ${holds}`);
    link.info = account({ balance: start.balance, equity: trips });
    await tick();
    assert.match(await manager.canOpen(ACCOUNT) ?? '', /tripped/, `${basis} trips at ${trips}`);
  }
});

test('the trading day starts at midnight broker server time', async () => {
  const { link, manager, tick, clock } = await setup(Date.UTC(2026, 9, 15, 20, 30));
  manager.setGuard({ ...defaultGuard(ACCOUNT), dailyLossMoney: 500, isEnabled: true });
  link.info = account({ utcOffsetSeconds: 10_800 });
  await tick();
  assert.equal(manager.state().guardStates[0].dayKey, '2026-10-15');
  link.info = account({ utcOffsetSeconds: 10_800, balance: 9_700, equity: 9_700 });
  clock.time += 45 * 60_000;
  await tick();
  const state = manager.state().guardStates[0];
  assert.equal(state.dayKey, '2026-10-16');
  assert.equal(state.dayStartBalance, 9_700);
  assert.equal(state.dayStartedAt, clock.time);
});

test('guards saved before reset zones keep local time and equity', async () => {
  const { manager } = await setup();
  const legacy = { accountId: ACCOUNT, action: 'blockNew', resetHour: 0, isEnabled: true } as AccountGuard;
  manager.setGuard(legacy);
  const guard = manager.state().guards[0];
  assert.equal(guard.resetZone, 'local');
  assert.equal(guard.lossBasis, 'equity');
});

test('the daily request limit blocks new requests but never a close', async () => {
  const { link, manager, tick, clock, messages } = await setup();
  manager.setGuard({ ...defaultGuard(ACCOUNT), maxDailyRequests: 5, isEnabled: true });
  await tick();
  for (let index = 0; index < 4; index++) await link.request('order.send', { action: 'deal', type: 'buy', symbol: 'EURUSD', volume: 0.1 });
  assert.ok(messages.some((message) => /4 of 5 daily trade requests/.test(message)));
  await link.request('order.send', { action: 'deal', type: 'buy', symbol: 'EURUSD', volume: 0.1 });
  await assert.rejects(link.request('order.send', { action: 'deal', type: 'buy', symbol: 'EURUSD', volume: 0.1 }), /Daily limit of 5/);
  await assert.rejects(link.request('order.send', { action: 'sltp', symbol: 'EURUSD', position: link.positions[0].ticket, sl: 1.09 }), /Daily limit/);
  assert.match(await manager.canOpen(ACCOUNT, 'EURUSD', 0.1) ?? '', /Daily limit of 5/);
  const close = await link.request('order.send', { action: 'deal', type: 'sell', symbol: 'EURUSD', position: link.positions[0].ticket, volume: 0.1 });
  assert.equal(close.isSuccess, true);
  assert.equal(manager.state().requestCounts[0].count, 6);
  clock.time += 86_400_000;
  assert.equal(await manager.canOpen(ACCOUNT, 'EURUSD', 0.1), null, 'a new trading day starts a new count');
});

test('requests are counted without a guard so a limit added later sees the whole day', async () => {
  const { link, manager, tick } = await setup();
  await tick();
  await link.request('order.send', { action: 'deal', type: 'buy', symbol: 'EURUSD', volume: 0.1 });
  manager.setGuard({ ...defaultGuard(ACCOUNT), maxDailyRequests: 1, isEnabled: true });
  assert.match(await manager.canOpen(ACCOUNT, 'EURUSD', 0.1) ?? '', /Daily limit of 1/);
});

test('a news blackout blocks opening trades on affected currencies', async () => {
  const release = Date.UTC(2026, 9, 13, 12, 1);
  const seen: string[][] = [];
  const news: NewsSource = {
    isCovering: () => true,
    blackout: (currencies, time, beforeMs, afterMs) => {
      seen.push([...currencies]);
      const event: NewsEvent = { time: release, impact: 'high', title: 'CPI m/m', currency: 'USD' };
      return currencies.includes('USD') && time >= release - beforeMs && time <= release + afterMs ? event : undefined;
    },
  };
  const { manager, tick } = await setup(Date.UTC(2026, 9, 13, 12), news);
  manager.setGuard({ ...defaultGuard(ACCOUNT), isEnabled: true });
  await tick();
  assert.equal(await manager.canOpen(ACCOUNT, 'EURUSD', 0.1), null, 'no window configured');
  manager.setGuard({ ...defaultGuard(ACCOUNT), newsMinutesBefore: 2, newsMinutesAfter: 2, isEnabled: true });
  assert.match(await manager.canOpen(ACCOUNT, 'EURUSD', 0.1) ?? '', /News blackout for EURUSD: USD CPI m\/m/);
  assert.deepEqual(seen.at(-1), ['EUR', 'USD'], 'currencies come from the symbol record');
});

async function exchangeSetup() {
  const link = new FakeLink();
  const pool = new SessionPool(link, () => undefined, () => new FakeLink());
  pool.afterUiChange('bybit:demo|1', null);
  const manager = new TradeManager(pool, memoryStore<ManagerState>({ rules: [], guards: [], guardStates: [], requestCounts: [] }), () => {}, () => Date.UTC(2026, 9, 13, 12));
  await manager.init();
  const check = { retcode: 0, isSuccess: true, comment: '', margin: 120, equity: 10000, balance: 10000, marginFree: 9000, marginLevel: 0, hasMarginEstimate: true, leverage: 10, maintenanceRate: 0.005 };
  return { link, manager, check };
}

test('exchange risk orders report margin and refuse a stop beyond liquidation', async () => {
  const { link, manager, check } = await exchangeSetup();
  link.check = { ...check, liquidationPrice: 1.05 };
  const preview = await manager.placeRisk({ accountId: 'bybit:demo|1', type: 'buy', mode: 'money', value: 50, symbol: 'EURUSD', stopLoss: { unit: 'pips', value: 50 }, isDryRun: true });
  assert.deepEqual([preview.margin, preview.leverage, preview.liquidationPrice], [120, 10, 1.05]);
  assert.equal(Number(preview.safeLeverage!.toFixed(2)), Number((1 / (1.5 * 0.005 / 1.1001 + 0.005)).toFixed(2)));
  assert.equal(preview.warnings.length, 0);
  link.check = { ...check, liquidationPrice: 0 };
  const none = await manager.placeRisk({ accountId: 'bybit:demo|1', type: 'buy', mode: 'money', value: 50, symbol: 'EURUSD', stopLoss: { unit: 'pips', value: 50 }, isDryRun: true });
  assert.deepEqual([none.liquidationPrice, none.warnings], [0, []], 'no liquidation at this size passes as 0, without a warning');
  link.check = { ...check, liquidationPrice: 1.094 };
  const close = await manager.placeRisk({ accountId: 'bybit:demo|1', type: 'buy', mode: 'money', value: 50, symbol: 'EURUSD', stopLoss: { unit: 'pips', value: 50 }, isDryRun: true });
  assert.match(close.warnings.join(' '), /close behind the stop/);
  link.check = { ...check, liquidationPrice: 1.098 };
  await assert.rejects(manager.placeRisk({ accountId: 'bybit:demo|1', type: 'buy', mode: 'money', value: 50, symbol: 'EURUSD', stopLoss: { unit: 'pips', value: 50 } }), /liquidation price 1.09800 comes before the stop loss 1.09510. Use \d+(\.\d+)?x or less/);
  link.check = { ...check, isSuccess: false, comment: 'Not enough free margin' };
  await assert.rejects(manager.placeRisk({ accountId: 'bybit:demo|1', type: 'buy', mode: 'money', value: 50, symbol: 'EURUSD', stopLoss: { unit: 'pips', value: 50 } }), /Not enough free margin/);
  assert.equal(link.sent.length, 0);
});

test('legs that land in one netted position share one management rule sized to their sum', async () => {
  const { link, manager, check } = await exchangeSetup();
  link.check = check;
  link.respond = () => ({ retcode: 10009, isSuccess: true, comment: 'Done', order: 900 + link.sent.length, position: 77 });
  await manager.placeRisk({ accountId: 'bybit:demo|1', type: 'buy', mode: 'percentBalance', value: 1, symbol: 'EURUSD', stopLoss: { unit: 'pips', value: 50 }, takeProfitR: [1, 2], management: { breakEvenR: 1 } });
  const rules = manager.state().rules;
  assert.equal(rules.length, 1);
  assert.deepEqual([rules[0].ticket, rules[0].initialVolume], [77, 0.2]);
});
