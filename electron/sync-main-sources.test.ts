import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Account } from '../shared/protocol';
import { AccountRegistry } from './account-registry';
import { DeviceIdentity } from './device-identity';
import { deriveKeys, newRootKey } from './sync-crypto';
import { SyncEngine } from './sync-engine';
import { FakeRemote, MemoryStore, REPO_ID } from './sync-engine-fixtures';
import { mainSyncSources } from './sync-main-sources';

const account: Account = { name: 'Fixture', server: 'Demo', company: 'Broker', currency: 'USD', tradeMode: 'demo', login: 1234, credit: 0, margin: 0, equity: 1000, profit: 0, balance: 1000, leverage: 100, marginFree: 1000, marginLevel: 0, isHedging: true, isTradeAllowed: true };
const endpoint = 'wss://broker.example/terminal';
const cipher = { canEncrypt: () => true, encrypt: (value: string) => `encrypted:${Buffer.from(value).toString('base64')}`, decrypt: (value: string) => Buffer.from(value.slice(10), 'base64').toString() };
const traits = () => ({ scale: 1, width: 1920, height: 1080, platform: 'Linux x86_64', language: 'en-US' });

async function computer(id: string, remote: FakeRemote, rootKey: Buffer, kinds: readonly string[]) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'openterm-sync-main-'));
  const registry = new AccountRegistry(cipher, async () => {});
  const device = new DeviceIdentity(path.join(dir, 'device.json'), traits);
  await device.load();
  const journal: string[] = [];
  let changed = 0;
  const sources = mainSyncSources({ accounts: () => registry, automation: () => undefined, device, onAccountsChanged: () => { changed += 1; }, journal: (message) => journal.push(message) })
    .filter((source) => kinds.includes(source.kind));
  const engine = new SyncEngine({
    epoch: 1, repoId: REPO_ID, keys: deriveKeys(rootKey), remote, store: new MemoryStore(), sources, pause: async () => undefined,
    device: { id, name: id, platform: 'linux', publicKey: 'x', appVersion: '1.0.0' },
  });
  return { registry, device, engine, journal, changed: () => changed };
}

test('accounts sync everywhere; their passwords only between computers that opted in', async () => {
  const remote = new FakeRemote();
  const rootKey = newRootKey();
  const office = await computer('aaaaaaaaaaaaaaaa', remote, rootKey, ['account', 'accountSecret']);
  const laptop = await computer('bbbbbbbbbbbbbbbb', remote, rootKey, ['account', 'accountSecret']);
  const kiosk = await computer('cccccccccccccccc', remote, rootKey, ['account']);
  const profile = await office.registry.remember(account, endpoint, 'broker-password', 'Demo', true);
  await office.engine.sync();
  for (const content of remote.files().values()) assert.ok(!content.includes('broker-password'));
  // The password is checked before its account arrives, so it applies on the next sync.
  await laptop.engine.sync();
  await laptop.engine.sync();
  await kiosk.engine.sync();
  assert.equal(laptop.registry.get(profile.id).label, 'Demo');
  assert.equal(laptop.registry.password(profile.id), 'broker-password');
  assert.ok(laptop.changed() > 0);
  assert.equal(kiosk.registry.get(profile.id).isPasswordSaved, false);

  // A password changed later on the laptop reaches the office; the kiosk still never gets one.
  await new Promise((resolve) => setTimeout(resolve, 5));
  await laptop.registry.remember(account, endpoint, 'changed-password', 'Demo', true);
  await laptop.engine.sync();
  await office.engine.sync();
  await kiosk.engine.sync();
  assert.equal(office.registry.password(profile.id), 'changed-password');
  assert.equal(kiosk.registry.password(profile.id), undefined);
});

test('one CID for all: the synced CID replaces this computer\'s and applies from the next login', async () => {
  const remote = new FakeRemote();
  const rootKey = newRootKey();
  const office = await computer('aaaaaaaaaaaaaaaa', remote, rootKey, ['identity']);
  const laptop = await computer('bbbbbbbbbbbbbbbb', remote, rootKey, ['identity']);
  assert.notDeepEqual(laptop.device.clientId, office.device.clientId);
  await office.engine.sync();
  await laptop.engine.sync({ isRemotePreferred: true });
  assert.deepEqual(laptop.device.clientId, office.device.clientId);
  assert.match(laptop.journal.join(' '), /next login/);
  await office.device.regenerate();
  await office.engine.sync();
  await laptop.engine.sync();
  assert.deepEqual(laptop.device.clientId, office.device.clientId);
});
