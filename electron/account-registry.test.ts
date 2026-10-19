import test from 'node:test';
import assert from 'node:assert/strict';
import type { Account } from '../shared/protocol';
import { AccountRegistry } from './account-registry';

const account: Account = { name: 'Fixture', server: 'Demo', company: 'Broker', currency: 'USD', tradeMode: 'demo', login: 1234, credit: 0, margin: 0, equity: 1000, profit: 0, balance: 1000, leverage: 100, marginFree: 1000, marginLevel: 0, isHedging: true, isTradeAllowed: true };
const endpoint = 'wss://broker.example/terminal';
const cipher = { canEncrypt: () => true, encrypt: (value: string) => `encrypted:${Buffer.from(value).toString('base64')}`, decrypt: (value: string) => Buffer.from(value.slice(10), 'base64').toString() };

test('profiles never expose passwords, default password lives only in memory and metadata survives restart', async () => {
  let stored: unknown;
  const registry = new AccountRegistry(cipher, async (profiles) => { stored = profiles; });
  const profile = await registry.remember(account, endpoint, 'fixture-secret');
  assert.equal(profile.hasPassword, true);
  assert.equal(profile.isPasswordSaved, false);
  assert.equal(registry.password(profile.id), 'fixture-secret');
  assert.ok(!JSON.stringify(stored).includes('fixture-secret'));
  assert.ok(!JSON.stringify(registry.list()).includes('fixture-secret'));
  const restarted = new AccountRegistry(cipher, async () => {});
  restarted.load(stored);
  assert.equal(restarted.get(profile.id).hasPassword, false);
  assert.equal(restarted.password(profile.id), undefined);
  assert.equal(restarted.get(profile.id).webEndpoint, endpoint);
});

test('same login on distinct endpoints remains distinct and forgetting removes its secret', async () => {
  const registry = new AccountRegistry(cipher, async () => {});
  const first = await registry.remember(account, endpoint, 'first');
  const second = await registry.remember(account, 'wss://other.example/terminal', 'second');
  assert.notEqual(first.id, second.id);
  assert.equal(registry.list().length, 2);
  await registry.remove(first.id);
  assert.throws(() => registry.password(first.id));
  assert.equal(registry.password(second.id), 'second');
});

test('explicit saved passwords encrypt on disk and decrypt after restart without leaking into list', async () => {
  let stored: unknown;
  const registry = new AccountRegistry(cipher, async (profiles) => { stored = profiles; });
  const profile = await registry.remember(account, endpoint, 'fixture-secret', 'Personal demo', true);
  assert.ok(!JSON.stringify(stored).includes('fixture-secret'));
  const restarted = new AccountRegistry(cipher, async () => {});
  restarted.load(stored);
  assert.equal(restarted.password(profile.id), 'fixture-secret');
  assert.equal(restarted.list()[0].isPasswordSaved, true);
  assert.ok(!JSON.stringify(restarted.list()).includes('encryptedPassword'));
});

test('insecure password storage and failed persistence leave previous registry intact', async () => {
  const insecure = new AccountRegistry({ ...cipher, canEncrypt: () => false }, async () => {});
  await assert.rejects(insecure.remember(account, endpoint, 'secret', undefined, true), /unavailable/);
  assert.equal(insecure.list().length, 0);
  const broken = new AccountRegistry(cipher, async () => { throw new Error('disk failure'); });
  await assert.rejects(broken.remember(account, endpoint, 'secret'), /disk failure/);
  assert.equal(broken.list().length, 0);
});

test('loading strips unexpected secrets and rejects corrupt endpoints or duplicate profiles', async () => {
  let stored: any;
  const registry = new AccountRegistry(cipher, async (profiles) => { stored = profiles; });
  await registry.remember(account, endpoint, 'secret');
  registry.load([{ ...stored[0], password: 'plaintext' }]);
  assert.ok(!JSON.stringify(registry.list()).includes('plaintext'));
  assert.throws(() => registry.load([{ ...stored[0], webEndpoint: 'ws://insecure.example' }]));
  assert.throws(() => registry.load([stored[0], stored[0]]));
});

test('Bybit profiles keep the key pair as their secret and rebuild exchange credentials', async () => {
  let stored: unknown;
  const registry = new AccountRegistry(cipher, async (profiles) => { stored = profiles; });
  const bybit = { ...account, login: 4242, server: 'Bybit Demo trading', company: 'Bybit' };
  const profile = await registry.rememberExchange(bybit, 'demo', { apiKey: 'fixture-key', apiSecret: 'fixture-secret' }, 'Crypto', true);
  assert.equal(profile.id, 'bybit:demo|4242');
  assert.equal(profile.platform, 'bybit');
  assert.equal(profile.webEndpoint, 'https://api-demo.bybit.com');
  assert.ok(!JSON.stringify(stored).includes('fixture-secret'));
  const restarted = new AccountRegistry(cipher, async () => {});
  restarted.load(stored);
  assert.deepEqual(restarted.credentials(profile.id), { platform: 'bybit', environment: 'demo', apiKey: 'fixture-key', apiSecret: 'fixture-secret' });
  assert.throws(() => restarted.unlock(profile.id, 'x'), /API key/);
});

test('profiles saved before platforms existed load as MetaTrader 5 accounts', async () => {
  let stored: unknown;
  const registry = new AccountRegistry(cipher, async (profiles) => { stored = profiles; });
  await registry.remember(account, endpoint, 'fixture-secret', undefined, true);
  const legacy = (stored as Record<string, unknown>[]).map(({ platform, ...rest }) => rest);
  const restarted = new AccountRegistry(cipher, async () => {});
  restarted.load(legacy);
  const [profile] = restarted.list();
  assert.equal(profile.platform, 'mt5');
  assert.deepEqual(restarted.credentials(profile.id), { platform: 'mt5', login: 1234, password: 'fixture-secret', endpoint });
});
