import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccountSignIn, TerminalApi } from '../../shared/protocol';

type Listener = (data: unknown) => void;

const listeners = new Map<string, Listener[]>();
const pending: Array<() => void> = [];
const replies: Record<string, unknown> = {
  'accounts.signIn': null,
  'accounts.list': [],
  'terminal.status': { mode: 'mt5-web', isConnected: true },
  'symbols.list': [],
  'trade.snapshot': { account: null, orders: [], positions: [] },
  'ticks.subscribe': [],
};
const delayed = new Set(['terminal.status', 'symbols.list', 'trade.snapshot']);
const fake = {
  platform: 'linux',
  link: async () => ({ url: '', state: 'connecting' }),
  on: (event: string, listener: Listener) => {
    listeners.set(event, [...listeners.get(event) ?? [], listener]);
    return () => undefined;
  },
  request: (method: string) => delayed.has(method)
    ? new Promise((resolve) => pending.push(() => resolve(replies[method])))
    : Promise.resolve(replies[method]),
} as unknown as TerminalApi;
Object.defineProperty(globalThis, 'window', { configurable: true, value: { terminal: fake } });

// The module reads window.terminal when it loads, so it is imported after the fake is in place.
const loaded = import('./session').then((module) => {
  module.startSession();
  return module;
});

function emit(event: string, data: unknown): void {
  for (const listener of listeners.get(event) ?? []) listener(data);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const target: AccountSignIn = { id: 'wss://example.test/terminal|42', label: 'Demo', server: 'Example-Demo', state: 'signing-in', login: 42 };

test('the sign-in stays shown until the synchronisation main started for it settles', async () => {
  const { session, signingIn } = await loaded;
  await flush();
  emit('signIn', target);
  assert.equal(signingIn(session.get()), target);
  emit('link', { url: 'wss://example.test/terminal', state: 'open' });
  emit('signIn', null);
  assert.equal(signingIn(session.get()), target);
  for (const resolve of pending.splice(0)) resolve();
  await flush();
  assert.equal(session.get().signIn, null);
});

test('a failure replaces the sign-in at once, and only an attempt in progress counts as signing in', async () => {
  const { session, signingIn } = await loaded;
  emit('signIn', target);
  const failed: AccountSignIn = { ...target, state: 'failed', error: 'Invalid account' };
  emit('signIn', failed);
  assert.equal(session.get().signIn, failed);
  assert.equal(signingIn(session.get()), null);
});
