import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DeviceIdentity, deriveClientId, navigatorPlatform, parseClientId, type DeviceTraits } from './device-identity';

const traits: DeviceTraits = { scale: 1.25, width: 1080, height: 1920, platform: 'Linux x86_64', language: 'en-GB' };

async function scratch(): Promise<string> {
  return path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'openterm-cid-')), 'device.json');
}

test('client ID follows the official recipe with the screen as larger x smaller', () => {
  const expected = createHash('sha1').update('Linux x86_64;1.25;en-GB;1920x1080;482113').digest().subarray(0, 16);
  assert.deepEqual(deriveClientId(traits, '482113'), expected);
});

test('platform names match what browsers report', () => {
  assert.equal(navigatorPlatform('win32', 'x64'), 'Win32');
  assert.equal(navigatorPlatform('darwin', 'arm64'), 'MacIntel');
  assert.equal(navigatorPlatform('linux', 'x64'), 'Linux x86_64');
  assert.equal(navigatorPlatform('linux', 'arm64'), 'Linux aarch64');
});

test('client ID is created once and survives a restart', async () => {
  const file = await scratch();
  const first = await new DeviceIdentity(file, () => traits).load();
  const second = await new DeviceIdentity(file, () => traits).load();
  assert.equal(first.length, 16);
  assert.deepEqual(second, first);
  // Windows has no POSIX permission bits; stat always reports 0o666 there.
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
});

test('regenerating replaces the stored ID without changing buffers already handed out', async () => {
  const file = await scratch();
  const identity = new DeviceIdentity(file, () => traits);
  const first = await identity.load();
  const copy = Buffer.from(first);
  const next = await identity.regenerate();
  assert.notDeepEqual(next, copy);
  assert.deepEqual(first, copy);
  assert.deepEqual(identity.clientId, next);
  assert.deepEqual(await new DeviceIdentity(file, () => traits).load(), next);
});

test('a corrupt file is replaced and malformed IDs are refused', async () => {
  const file = await scratch();
  await fs.writeFile(file, '{"cid":"zz"}');
  const original = console.error;
  console.error = () => undefined;
  try { assert.equal((await new DeviceIdentity(file, () => traits).load()).length, 16); }
  finally { console.error = original; }
  for (const value of [null, {}, { cid: 'ab' }, { cid: 'A'.repeat(32) }, { cid: 5 }]) assert.throws(() => parseClientId(value));
  assert.throws(() => new DeviceIdentity(file, () => traits).clientId, /not been loaded/);
});

test('IDs from the narrow seed are flagged until a new one is generated', async () => {
  const file = await scratch();
  await fs.writeFile(file, JSON.stringify({ cid: 'ab'.repeat(16) }));
  const identity = new DeviceIdentity(file, () => traits);
  await identity.load();
  assert.equal(identity.hasWeakSeed, true);
  await identity.regenerate();
  assert.equal(identity.hasWeakSeed, false);
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).version, 2);
  const reloaded = new DeviceIdentity(file, () => traits);
  await reloaded.load();
  assert.equal(reloaded.hasWeakSeed, false);
});

test('new IDs differ even on identical machines', async () => {
  const ids = await Promise.all([1, 2, 3].map(async () => (await new DeviceIdentity(await scratch(), () => traits).load()).toString('hex')));
  assert.equal(new Set(ids).size, 3);
});

test('ensuring a unique ID replaces a narrow-seed ID once and then keeps it', async () => {
  const file = await scratch();
  await fs.writeFile(file, JSON.stringify({ cid: 'ab'.repeat(16) }));
  const identity = new DeviceIdentity(file, () => traits);
  await identity.load();
  assert.equal(await identity.ensureUnique(), true);
  const upgraded = identity.clientId.toString('hex');
  assert.notEqual(upgraded, 'ab'.repeat(16));
  assert.equal(await identity.ensureUnique(), false);
  assert.equal(identity.clientId.toString('hex'), upgraded, 'later logins keep the same device');
});
