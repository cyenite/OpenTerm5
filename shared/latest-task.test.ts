import assert from 'node:assert/strict';
import test from 'node:test';
import { LatestTask } from './latest-task';

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('starts immediately, coalesces changing inputs and only publishes the latest result', async () => {
  const calls: number[] = [];
  const results: number[] = [];
  let release!: (value: number) => void;
  const gate = new Promise<number>((resolve) => { release = resolve; });
  const runner = new LatestTask(async (value: number) => {
    calls.push(value);
    return value === 1 ? gate : value;
  }, () => assert.fail('Unexpected error'), (value) => results.push(value));
  runner.submit(1);
  assert.deepEqual(calls, [1]);
  runner.submit(2);
  runner.submit(3);
  release(1);
  await settle();
  assert.deepEqual(calls, [1, 3]);
  assert.deepEqual(results, [3]);
});

test('cancellation suppresses outstanding results and later submissions still run', async () => {
  const results: number[] = [];
  let release!: (value: number) => void;
  const gate = new Promise<number>((resolve) => { release = resolve; });
  const runner = new LatestTask(async (value: number) => value === 1 ? gate : value, () => assert.fail('Unexpected error'), (value) => results.push(value));
  runner.submit(1);
  runner.cancel();
  release(1);
  await settle();
  assert.deepEqual(results, []);
  runner.submit(2);
  await settle();
  assert.deepEqual(results, [2]);
});

test('reports a current failure without preventing recovery', async () => {
  const errors: unknown[] = [];
  const results: number[] = [];
  const runner = new LatestTask(async (value: number) => {
    if (value === 1) throw new Error('unavailable');
    return value;
  }, (error) => errors.push(error), (value) => results.push(value));
  runner.submit(1);
  await settle();
  assert.match(String(errors[0]), /unavailable/);
  runner.submit(2);
  await settle();
  assert.deepEqual(results, [2]);
});
