import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentToolCall } from '../shared/agent';
import { AgentBridge } from './agent-bridge';

const call: AgentToolCall = { name: 'chart_state', args: {} };

function bridge(options: { isOpen?: boolean; timeoutMs?: number } = {}) {
  const sent: { id: number; call: AgentToolCall }[] = [];
  const instance = new AgentBridge({ send: (id, sentCall) => { sent.push({ id, call: sentCall }); return options.isOpen ?? true; }, timeoutMs: options.timeoutMs ?? 1000 });
  return { instance, sent };
}

test('a call waits for the window and resolves with its result', async () => {
  const { instance, sent } = bridge();
  instance.setReady(true);
  const pending = instance.call(call);
  assert.deepEqual(sent.map((item) => item.call), [call]);
  instance.receive(sent[0].id, { result: { symbol: 'EURUSD' } });
  assert.deepEqual(await pending, { symbol: 'EURUSD' });
});

test('an error from the window rejects the call with its message', async () => {
  const { instance, sent } = bridge();
  instance.setReady(true);
  const pending = instance.call(call);
  instance.receive(sent[0].id, { error: 'No chart is open.' });
  await assert.rejects(pending, /No chart is open/);
});

test('a malformed answer rejects', async () => {
  const { instance, sent } = bridge();
  instance.setReady(true);
  const pending = instance.call(call);
  instance.receive(sent[0].id, 'nonsense');
  await assert.rejects(pending, /malformed/);
});

test('calls before the window is ready are refused without being sent', async () => {
  const { instance, sent } = bridge();
  await assert.rejects(instance.call(call), /not open yet/);
  assert.equal(sent.length, 0);
});

test('a closed window fails the call at once', async () => {
  const { instance } = bridge({ isOpen: false });
  instance.setReady(true);
  await assert.rejects(instance.call(call), /not open/);
});

test('a reload fails calls still waiting', async () => {
  const { instance } = bridge();
  instance.setReady(true);
  const pending = instance.call(call);
  instance.setReady(false);
  await assert.rejects(pending, /closed or reloaded/);
});

test('a call nobody answers times out, and a late answer is ignored', async () => {
  const { instance, sent } = bridge({ timeoutMs: 10 });
  instance.setReady(true);
  await assert.rejects(instance.call(call), /did not answer in time/);
  instance.receive(sent[0].id, { result: 1 });
});
