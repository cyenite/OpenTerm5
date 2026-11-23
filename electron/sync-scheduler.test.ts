import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeTimers } from './sync-engine-fixtures';
import { SyncScheduler, syncTiming, type RunResult } from './sync-scheduler';

function harness(results: RunResult[] = []) {
  const timers = new FakeTimers();
  const runs: number[] = [];
  const fullRuns: number[] = [];
  const stamps: number[] = [];
  const scheduler = new SyncScheduler({
    timers, now: () => timers.time,
    stamp: async () => { stamps.push(timers.time); },
    run: async ({ isFull }) => {
      runs.push(timers.time);
      if (isFull) fullRuns.push(timers.time);
      return results.shift() ?? { kind: 'ok' };
    },
  });
  return { timers, runs, fullRuns, stamps, scheduler };
}

test('starting runs in full at once, then polls every 5 s while focused and every 15 s in the background', async () => {
  const { timers, runs, fullRuns, scheduler } = harness();
  scheduler.start();
  await timers.advance(11_000);
  assert.deepEqual(runs, [0, 5000, 10_000]);
  assert.deepEqual(fullRuns, [0]);
  scheduler.setFocused(false);
  await timers.advance(40_000);
  assert.deepEqual(runs.slice(3), [15_000, 30_000, 45_000]);
});

test('a poll reads every store again every two minutes', async () => {
  const { timers, fullRuns, scheduler } = harness();
  scheduler.start();
  await timers.advance(250_000);
  assert.deepEqual(fullRuns, [0, 120_000, 240_000]);
});

test('focus, wake and unlock run at once', async () => {
  const { timers, runs, scheduler } = harness();
  scheduler.start();
  await timers.advance(1000);
  scheduler.setFocused(false);
  await timers.advance(1000);
  scheduler.setFocused(true);
  await timers.advance(0);
  assert.deepEqual(runs, [0, 2000]);
  scheduler.wake();
  await timers.advance(0);
  assert.deepEqual(runs, [0, 2000, 2000]);
});

test('edits are stamped a second after they settle and pushed in full a second and a half later', async () => {
  const { timers, fullRuns, stamps, scheduler } = harness();
  scheduler.start();
  await timers.advance(0);
  scheduler.localChange();
  await timers.advance(500);
  scheduler.localChange();
  await timers.advance(3500);
  assert.deepEqual(stamps, [1500]);
  assert.deepEqual(fullRuns, [0, 3000]);
});

test('edits that settle while a push is due ride along with it', async () => {
  const { timers, fullRuns, stamps, scheduler } = harness();
  scheduler.start();
  await timers.advance(0);
  scheduler.localChange();
  await timers.advance(1200);
  scheduler.localChange();
  await timers.advance(1200);
  scheduler.localChange();
  await timers.advance(4000);
  assert.deepEqual(stamps, [1000, 2200, 3400]);
  assert.deepEqual(fullRuns, [0, 2500, 4900], 'the third edit came after the first push ran');
});

test('edits are still stamped while sync is stopped, but nothing runs', async () => {
  const { timers, runs, stamps, scheduler } = harness();
  scheduler.localChange();
  await timers.advance(10_000);
  assert.deepEqual([stamps, runs], [[1000], []]);
});

test('constant editing is held to the push budget', async () => {
  const { timers, fullRuns, scheduler } = harness();
  scheduler.setFocused(false);
  scheduler.start();
  await timers.advance(0);
  for (let second = 0; second < 3600; second += 2) {
    scheduler.localChange();
    await timers.advance(2000);
  }
  const periodic = 3_600_000 / syncTiming.fullRunMs;
  assert.ok(fullRuns.length <= 1 + syncTiming.pushesPerHour + syncTiming.pushBurst + periodic, `${fullRuns.length} full runs in an hour`);
});

test('a failed poll is retried in full', async () => {
  const { timers, runs, fullRuns, scheduler } = harness([{ kind: 'ok' }, { kind: 'retry' }]);
  scheduler.start();
  await timers.advance(40_000);
  assert.deepEqual(runs.slice(0, 3), [0, 5000, 35_000]);
  assert.deepEqual(fullRuns.slice(0, 2), [0, 35_000]);
});

test('failures back off, a stated retry time is honoured, and a stop ends polling', async () => {
  const { timers, runs, scheduler } = harness([{ kind: 'retry' }, { kind: 'retry' }, { kind: 'retry', at: 500_000 }, { kind: 'stop' }]);
  scheduler.start();
  await timers.advance(1_000_000);
  assert.deepEqual(runs, [0, 30_000, 90_000, 500_000]);
  assert.equal(scheduler.isActive, false);
  scheduler.wake();
  await timers.advance(100_000);
  assert.equal(runs.length, 4);
});

test('a run requested while one is running happens right after it', async () => {
  const timers = new FakeTimers();
  const runs: number[] = [];
  let release: () => void = () => undefined;
  const scheduler = new SyncScheduler({
    timers, now: () => timers.time, stamp: async () => undefined,
    run: () => { runs.push(timers.time); return runs.length === 1 ? new Promise((resolve) => { release = () => resolve({ kind: 'ok' }); }) : Promise.resolve({ kind: 'ok' }); },
  });
  scheduler.start();
  await timers.advance(0);
  scheduler.wake();
  await timers.advance(0);
  assert.equal(runs.length, 1);
  release();
  for (let index = 0; index < 10; index++) await Promise.resolve();
  await timers.advance(0);
  assert.equal(runs.length, 2);
});
