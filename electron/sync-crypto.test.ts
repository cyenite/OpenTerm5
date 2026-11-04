import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  decodePayload, deriveKeys, encodePayload, envelopeHash, newDeviceKeyPair, newRecoveryCode, newRootKey, objectPath, open, paddedSize, parseRecoveryCode,
  recordCipherKey, seal, unwrapForDevice, unwrapWithPassphrase, unwrapWithRecovery, wrapForDevice, wrapWithPassphrase, wrapWithRecovery, type KeyWrap,
} from './sync-crypto';

const repoId = 1445256142;
const fastCost = { N: 2 ** 14, r: 8, p: 1 };
const context = { epoch: 3, repoId, kind: 'chart', id: 'abc', generation: 7 };

test('an envelope opens only with its key and its exact context', () => {
  const key = newRootKey();
  const envelope = seal(key, Buffer.from('secret'), context);
  assert.equal(open(key, envelope, context).toString(), 'secret');
  assert.throws(() => open(newRootKey(), envelope, context), /authentication/);
  for (const changed of [{ id: 'abd' }, { kind: 'layout' }, { generation: 8 }, { repoId: 1 }]) assert.throws(() => open(key, envelope, { ...context, ...changed }), /authentication/);
  assert.throws(() => open(key, envelope, { ...context, epoch: 4 }), /another key epoch/);
});

test('flipping any single byte of an envelope is refused', () => {
  const key = newRootKey();
  const envelope = seal(key, Buffer.from('x'.repeat(40)), context);
  for (let index = 0; index < envelope.length; index++) {
    const tampered = Buffer.from(envelope);
    tampered[index] ^= 0x01;
    assert.throws(() => open(key, tampered, context), Error, `byte ${index}`);
  }
});

test('envelopes past the size limit are refused before decryption', () => {
  const key = newRootKey();
  const envelope = seal(key, Buffer.alloc(300 * 1024), context);
  assert.throws(() => open(key, envelope, context), /Not a sync envelope/);
  assert.equal(open(key, envelope, context, 4 * 1024 * 1024).length, 300 * 1024);
});

test('nonces never repeat', () => {
  const key = newRootKey();
  const nonces = new Set<string>();
  for (let index = 0; index < 20_000; index++) nonces.add(seal(key, Buffer.alloc(0), context).subarray(9, 21).toString('hex'));
  assert.equal(nonces.size, 20_000);
});

test('derived keys differ from each other and per record', () => {
  const keys = deriveKeys(newRootKey());
  const all = [keys.state, keys.record, keys.manifest, recordCipherKey(keys, 'chart:a'), recordCipherKey(keys, 'chart:b')].map((key) => key.toString('hex'));
  assert.equal(new Set(all).size, all.length);
  assert.deepEqual(recordCipherKey(keys, 'chart:a'), recordCipherKey(keys, 'chart:a'));
  assert.throws(() => deriveKeys(Buffer.alloc(16)), /32 bytes/);
});

test('payloads round-trip and are padded to size buckets', () => {
  const value = { b: [1, 2, { z: null, a: 'x' }], a: true };
  const payload = encodePayload(value);
  assert.deepEqual(decodePayload(payload), value);
  assert.equal(payload.length, 1024);
  assert.equal(encodePayload({ a: 'é'.repeat(10) }).length, encodePayload({ a: 'e' }).length);
  assert.deepEqual([paddedSize(1), paddedSize(1025), paddedSize(64 * 1024), paddedSize(64 * 1024 + 1)], [1024, 2048, 65536, 131072]);
  assert.throws(() => decodePayload(Buffer.from([0, 0, 0, 9, 1])), /malformed/);
});

test('object paths are the envelope hash, split for directory size', () => {
  const hash = envelopeHash(Buffer.from('a'));
  assert.equal(objectPath(hash), `objects/${hash.slice(0, 2)}/${hash.slice(2)}`);
  assert.equal(hash.length, 64);
});

test('recovery codes round-trip, forgive look-alike letters and catch typos', () => {
  const { code, secret } = newRecoveryCode();
  assert.match(code, /^([0-9A-HJKMNP-TV-Z]{4}-){6}[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.deepEqual(parseRecoveryCode(code), secret);
  assert.deepEqual(parseRecoveryCode(code.toLowerCase().replace(/-/g, ' ')), secret);
  assert.deepEqual(parseRecoveryCode(code.replace(/1/g, 'l').replace(/0/g, 'O')), secret);
  let caught = 0;
  for (let index = 0; index < 26; index++) {
    const characters = code.replace(/-/g, '').split('');
    characters[index] = characters[index] === 'A' ? 'B' : 'A';
    try { parseRecoveryCode(characters.join('')); } catch { caught += 1; }
  }
  assert.ok(caught >= 24, `caught ${caught} of 26 single-character typos`);
  assert.throws(() => parseRecoveryCode('ABCD'), /wrong length/);
});

test('the root key unwraps with the recovery code and not with another', () => {
  const rootKey = newRootKey();
  const { code, secret } = newRecoveryCode();
  const wrap = wrapWithRecovery(rootKey, secret, 1, repoId);
  assert.deepEqual(unwrapWithRecovery(wrap, code, repoId), rootKey);
  assert.throws(() => unwrapWithRecovery(wrap, newRecoveryCode().code, repoId), /Wrong recovery code/);
  assert.throws(() => unwrapWithRecovery(wrap, code, repoId + 1), /Wrong recovery code/);
  assert.throws(() => unwrapWithRecovery({ ...wrap, epoch: 2 }, code, repoId));
});

test('the root key unwraps with the passphrase, whatever its Unicode form', () => {
  const rootKey = newRootKey();
  const wrap = wrapWithPassphrase(rootKey, 'Café horse battery', 1, repoId, fastCost);
  assert.deepEqual(unwrapWithPassphrase(wrap, 'Café horse battery', repoId), rootKey);
  assert.throws(() => unwrapWithPassphrase(wrap, 'cafe horse battery', repoId), /Wrong passphrase/);
});

test('passphrase settings from a keyring are bounded', () => {
  const wrap = wrapWithPassphrase(newRootKey(), 'pass phrase words', 1, repoId, fastCost) as Extract<KeyWrap, { kind: 'passphrase' }>;
  for (const cost of [{ N: 2 ** 24, r: 8, p: 1 }, { N: 2 ** 10, r: 8, p: 1 }, { N: 3 * 2 ** 14, r: 8, p: 1 }, { N: 2 ** 14, r: 64, p: 1 }, { N: 2 ** 14, r: 8, p: 9 }]) {
    assert.throws(() => unwrapWithPassphrase({ ...wrap, cost }, 'pass phrase words', repoId), /out of range/);
  }
});

test('a device wrap opens only with that device key pair', () => {
  const rootKey = newRootKey();
  const device = newDeviceKeyPair();
  const wrap = wrapForDevice(rootKey, 'dev1', device.publicKey, 2, repoId);
  assert.deepEqual(unwrapForDevice(wrap, device, repoId), rootKey);
  assert.throws(() => unwrapForDevice(wrap, newDeviceKeyPair(), repoId), /cannot unlock/);
  assert.throws(() => unwrapForDevice({ ...wrap, deviceId: 'dev2' } as KeyWrap, device, repoId), /cannot unlock/);
  assert.throws(() => unwrapForDevice(wrap, device, repoId + 1), /cannot unlock/);
});
