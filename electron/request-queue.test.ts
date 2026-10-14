import assert from 'node:assert/strict';
import test from 'node:test';
import { RequestQueue } from './request-queue';

test('urgent requests keep FIFO order and cannot cross a login barrier', async () => {
  const queue = new RequestQueue();
  const calls: string[] = [];
  const run = async (name: string) => { calls.push(name); return name; };
  const pending = [
    queue.enqueue(() => run('chart-before-login')),
    queue.enqueue(() => run('login'), false, true),
    queue.enqueue(() => run('chart-after-login')),
    queue.enqueue(() => run('first-order'), true),
    queue.enqueue(() => run('second-order'), true),
  ];
  await Promise.all(pending);
  assert.deepEqual(calls, ['chart-before-login', 'login', 'first-order', 'second-order', 'chart-after-login']);
});

test('a failed request does not stop draining or prevent later enqueues', async () => {
  const queue = new RequestQueue();
  const failed = queue.enqueue(async () => { throw new Error('request failed'); });
  const next = queue.enqueue(async () => 7);
  await assert.rejects(failed, /request failed/);
  assert.equal(await next, 7);
  assert.equal(await queue.enqueue(async () => 8), 8);
});
