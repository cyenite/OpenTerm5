import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FakeTimers } from './sync-engine-fixtures';
import { SyncScheduler, syncTiming, type RunResult } from './sync-scheduler';

function harness(results: RunResult[] = []) {
  const timers = new FakeTimers();
  const runs: number[] = [];
  const stamps: number[] = [];
  const scheduler = new SyncScheduler({
    timers, now: () => timers.time,
    stamp: async () => { stamps.push(timers.time); },
    run: async () => { runs.push(timers.time); return results.shift() ?? { kind: 'ok' }; },
  });
  return { timers, runs, stamps, scheduler };
}

test('starting runs at once, then polls every 15 s while focused and every 2 min in the background', async () => {
  const { timers, runs, scheduler } = harness();
  scheduler.start();
  await timers.advance(31_000);
  assert.deepEqual(runs, [0, 15_000, 30_000]);
  scheduler.setFocused(false);
  await timers.advance(300_000);
  assert.deepEqual(runs.slice(3), [45_000, 165_000, 285_000]);
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

test('edits are stamped a second after they settle and pushed three seconds later', async () => {
  const { timers, runs, stamps, scheduler } = harness();
  scheduler.start();
  await timers.advance(0);
  scheduler.localChange();
  await timers.advance(500);
  scheduler.localChange();
  await timers.advance(5000);
  assert.deepEqual(stamps, [1500]);
  assert.deepEqual(runs, [0, 4500]);
});

test('edits are still stamped while sync is stopped, but nothing runs', async () => {
  const { timers, runs, stamps, scheduler } = harness();
  scheduler.localChange();
  await timers.advance(10_000);
  assert.deepEqual([stamps, runs], [[1000], []]);
});

test('constant editing is held to the push budget', async () => {
  const { timers, runs, scheduler } = harness();
  scheduler.setFocused(false);
  scheduler.start();
  await timers.advance(0);
  for (let minute = 0; minute < 60; minute++) {
    scheduler.localChange();
    await timers.advance(60_000);
  }
  assert.ok(runs.length <= 1 + syncTiming.pushesPerHour + syncTiming.pushBurst + 30, `${runs.length} runs in an hour`);
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
