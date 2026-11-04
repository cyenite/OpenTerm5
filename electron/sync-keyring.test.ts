import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { PasswordCipher } from './account-registry';
import { deriveKeys, newDeviceKeyPair } from './sync-crypto';
import { FakeRemote } from './sync-engine-fixtures';
import {
  answerPairing, FORMAT_PATH, inspectRepository, KEYRING_PATH, newKeyring, PAIRING_LIFETIME_MS, pairingWords, parseFormat, parseKeyring, parsePairing, requestPairing,
  unlockKeyring, updateKeyring, withDeviceWrap, withNewRecovery,
} from './sync-keyring';
import { pairingWordList } from './sync-words';
import { CredentialStore, EncryptedStateStore } from './sync-storage';

const repoId = 42;
const fastCost = { N: 2 ** 14, r: 8, p: 1 };
const laptop = { id: 'laptop', ...newDeviceKeyPair() };

async function scratch(name: string): Promise<string> {
  return path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'openterm-sync-')), name);
}

const cipher = (canEncrypt = true): PasswordCipher => ({
  canEncrypt: () => canEncrypt,
  encrypt: (value) => Buffer.from(value).reverse().toString('base64'),
  decrypt: (value) => Buffer.from(value, 'base64').reverse().toString(),
});

test('a new keyring unlocks with the recovery code, the passphrase and the creating computer', () => {
  const { rootKey, recoveryCode, keyring, files } = newKeyring(repoId, laptop, 'four words make a phrase', fastCost);
  assert.deepEqual(unlockKeyring(keyring, repoId, { recoveryCode }), rootKey);
  assert.deepEqual(unlockKeyring(keyring, repoId, { passphrase: 'four words make a phrase' }), rootKey);
  assert.deepEqual(unlockKeyring(keyring, repoId, { deviceId: laptop.id, deviceKeys: laptop }), rootKey);
  assert.throws(() => unlockKeyring(keyring, repoId, { passphrase: 'wrong words' }), /Wrong passphrase/);
  assert.deepEqual(parseKeyring(files.get(KEYRING_PATH)!), keyring);
  assert.equal(parseFormat(files.get(FORMAT_PATH)!, repoId).repoId, repoId);
  assert.throws(() => parseFormat(files.get(FORMAT_PATH)!, 7), /copied from another repository/);
  assert.throws(() => unlockKeyring(newKeyring(repoId, laptop).keyring, repoId, { passphrase: 'x' }), /No passphrase/);
});

test('the keyring files hold no key material in the clear', () => {
  const { rootKey, recoveryCode, files } = newKeyring(repoId, laptop);
  const text = [...files.values()].map((content) => content.toString()).join('');
  assert.ok(!text.includes(rootKey.toString('base64')) && !text.includes(rootKey.toString('hex')));
  assert.ok(!text.includes(recoveryCode) && !text.includes(laptop.privateKey));
});

test('a joining computer adds its own wrap, and a new recovery code retires the old one', () => {
  const { rootKey, recoveryCode, keyring } = newKeyring(repoId, laptop);
  const desktop = { id: 'desktop', ...newDeviceKeyPair() };
  const joined = withDeviceWrap(keyring, rootKey, repoId, desktop);
  assert.deepEqual(unlockKeyring(joined, repoId, { deviceId: 'desktop', deviceKeys: desktop }), rootKey);
  assert.equal(withDeviceWrap(joined, rootKey, repoId, desktop).wraps.length, joined.wraps.length);
  const renewed = withNewRecovery(joined, rootKey, repoId);
  assert.deepEqual(unlockKeyring(renewed.keyring, repoId, { recoveryCode: renewed.recoveryCode }), rootKey);
  assert.throws(() => unlockKeyring(renewed.keyring, repoId, { recoveryCode }), /Wrong recovery code/);
});

test('damaged keyrings are refused', () => {
  for (const text of ['nope', '[]', '{"epoch":0,"wraps":[]}', '{"epoch":1,"wraps":[{"kind":"magic","epoch":1,"sealed":"x"}]}', `{"epoch":1,"wraps":${JSON.stringify(Array(65).fill({ kind: 'recovery', epoch: 1, sealed: 'x' }))}}`]) {
    assert.throws(() => parseKeyring(Buffer.from(text)), /damaged/, text);
  }
});

test('a repository reads as empty, set up for sync, or someone else\'s', async () => {
  const remote = new FakeRemote();
  assert.equal((await inspectRepository(remote, repoId)).kind, 'empty');
  const { files, keyring } = newKeyring(repoId, laptop);
  await remote.commit(null, files);
  const setup = await inspectRepository(remote, repoId);
  assert.equal(setup.kind, 'sync');
  assert.deepEqual(setup.kind === 'sync' && setup.keyring, keyring);
  const other = new FakeRemote();
  await other.commit(null, new Map([['src/index.ts', Buffer.from('code')]]));
  assert.equal((await inspectRepository(other, repoId)).kind, 'foreign');
});

test('keyring updates keep a wrap another computer added meanwhile', async () => {
  const remote = new FakeRemote();
  const { files, rootKey } = newKeyring(repoId, laptop);
  await remote.commit(null, files);
  const desktop = { id: 'desktop', ...newDeviceKeyPair() };
  const tablet = { id: 'tablet', ...newDeviceKeyPair() };
  remote.beforeCommit = async () => { await updateKeyring(remote, repoId, (keyring) => withDeviceWrap(keyring, rootKey, repoId, tablet)); };
  const final = await updateKeyring(remote, repoId, (keyring) => withDeviceWrap(keyring, rootKey, repoId, desktop));
  assert.deepEqual(final.wraps.filter((wrap) => wrap.kind === 'device').map((wrap) => wrap.kind === 'device' && wrap.deviceId).sort(), ['desktop', 'laptop', 'tablet']);
});

test('credentials keep the device id, and secrets only go through the keychain', async () => {
  const file = await scratch('sync-credentials.json');
  const store = new CredentialStore(file, cipher());
  const first = await store.load();
  await store.update({ rootKey: Buffer.alloc(32, 7), tokens: { accessToken: 'ghu_x', refreshToken: 'ghr_x', expiresAt: 1, refreshExpiresAt: 2 }, login: 'octotrader' });
  const raw = await fs.readFile(file, 'utf8');
  assert.ok(!raw.includes('ghu_x') && !raw.includes(Buffer.alloc(32, 7).toString('base64')));
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const reloaded = await new CredentialStore(file, cipher()).load();
  assert.equal(reloaded.deviceId, first.deviceId);
  assert.equal(reloaded.tokens?.accessToken, 'ghu_x');
  assert.deepEqual(reloaded.rootKey, Buffer.alloc(32, 7));

  const noKeychain = new CredentialStore(file, cipher(false));
  await noKeychain.load();
  await noKeychain.update({ rootKey: Buffer.alloc(32, 9) });
  assert.ok(!(await fs.readFile(file, 'utf8')).includes('"secrets": "'));
  assert.equal((await new CredentialStore(file, cipher(false)).load()).rootKey, null);
  assert.equal((await store.clear()).deviceId, first.deviceId);
});

test('engine state is sealed on disk and unreadable with another key', async () => {
  const file = await scratch('sync-state.json');
  const keys = deriveKeys(Buffer.alloc(32, 1));
  const store = new EncryptedStateStore(file, keys.state, { epoch: 1, repoId });
  const state = { head: 'c1', clock: null, highWater: 3, isApplying: false, manifest: null, bases: { 'layout:L1': { entries: { name: { hlc: '0000000000001.0000.a', value: 'Gold scalping' } } } }, pending: {} };
  await store.save(state);
  assert.ok(!(await fs.readFile(file, 'utf8')).includes('Gold'));
  assert.deepEqual(await store.load(), state);
  assert.equal(await new EncryptedStateStore(file, deriveKeys(Buffer.alloc(32, 2)).state, { epoch: 1, repoId }).load(), null);
  await store.remove();
  assert.equal(await store.load(), null);
});

test('pairing words are six list words, stable per key and different between keys', async () => {
  const words = pairingWords(laptop.publicKey);
  assert.equal(words.length, 6);
  assert.ok(words.every((word) => (pairingWordList as readonly string[]).includes(word)));
  assert.deepEqual(pairingWords(laptop.publicKey), words);
  assert.notDeepEqual(pairingWords(newDeviceKeyPair().publicKey), words);
});

test('approving a pairing request wraps the key to that computer and removes the request', async () => {
  const remote = new FakeRemote();
  const { files, rootKey } = newKeyring(repoId, laptop);
  await remote.commit(null, files);
  const desktop = { id: 'desktop', ...newDeviceKeyPair() };
  const tablet = { id: 'tablet', ...newDeviceKeyPair() };
  await requestPairing(remote, repoId, desktop, 1000);
  await requestPairing(remote, repoId, tablet, 1000);
  let setup = await inspectRepository(remote, repoId);
  assert.deepEqual(setup.kind === 'sync' && setup.pairing.map((request) => request.deviceId), ['desktop', 'tablet']);
  assert.ok(!(await remote.read(remote.current!, ['pairing.json'])).get('pairing.json')!.toString().includes('Office'), 'no names in the clear');

  await answerPairing(remote, repoId, 'desktop', { rootKey }, 2000);
  await answerPairing(remote, repoId, 'tablet', null, 2000);
  setup = await inspectRepository(remote, repoId);
  assert.equal(setup.kind === 'sync' && setup.pairing.length, 0);
  assert.equal((await remote.read(remote.current!, ['pairing.json'])).get('pairing.json'), null);
  assert.deepEqual(setup.kind === 'sync' && unlockKeyring(setup.keyring, repoId, { deviceId: 'desktop', deviceKeys: desktop }), rootKey);
  assert.throws(() => setup.kind === 'sync' && unlockKeyring(setup.keyring, repoId, { deviceId: 'tablet', deviceKeys: tablet }), /no key/);
});

test('an expired pairing request cannot be approved, and damaged requests are refused', async () => {
  const remote = new FakeRemote();
  const { files, rootKey } = newKeyring(repoId, laptop);
  await remote.commit(null, files);
  await requestPairing(remote, repoId, { id: 'desktop', publicKey: newDeviceKeyPair().publicKey }, 0);
  await assert.rejects(answerPairing(remote, repoId, 'desktop', { rootKey }, PAIRING_LIFETIME_MS + 1), /expired/);
  for (const text of ['{"requests":{}}', '{"requests":[{"deviceId":"Bad Id","publicKey":"x","createdAt":1}]}']) assert.throws(() => parsePairing(Buffer.from(text)), /damaged/);
});
