import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deriveKeys, newRootKey, seal } from './sync-crypto';
import {
  acquireLease, canOpenTrades, emptyManifest, leaseHolder, leaseTiming, openManifest, parseManifest, presentElsewhere, releaseLease, renewLease, sealManifest,
  SyncIntegrityError, withPresence, type Manifest,
} from './sync-manifest';

const keys = deriveKeys(newRootKey());
const manifest: Manifest = { ...emptyManifest(2, 9), seq: 5, writer: 'a', hlc: '0000000000005.0000.a' };
const expected = { epoch: 2, repoId: 9, highWater: 5 };
const reason = (value: string) => (error: unknown) => error instanceof SyncIntegrityError && error.reason === value;

test('a sealed manifest opens with the same key, repository and epoch', () => {
  assert.deepEqual(openManifest(keys, sealManifest(keys, manifest), expected), manifest);
  assert.throws(() => openManifest(deriveKeys(newRootKey()), sealManifest(keys, manifest), expected), reason('tampered'));
  assert.throws(() => openManifest(keys, sealManifest(keys, manifest), { ...expected, repoId: 10 }), reason('tampered'));
  assert.throws(() => openManifest(keys, sealManifest(keys, manifest), { ...expected, epoch: 3 }), reason('epoch'));
});

test('an older sequence is a rollback and a newer format is refused', () => {
  assert.throws(() => openManifest(keys, sealManifest(keys, manifest), { ...expected, highWater: 6 }), reason('rollback'));
  assert.throws(() => openManifest(keys, sealManifest(keys, { ...manifest, minReader: 2 }), expected), reason('tooNew'));
});

test('a manifest sealed for one repository cannot be relabelled for another', () => {
  const foreign = seal(keys.manifest, Buffer.from(JSON.stringify({ ...manifest, repoId: 10 })), { purpose: 'manifest', epoch: 2, repoId: 9 });
  assert.throws(() => openManifest(keys, foreign, expected), reason('tampered'));
});

test('malformed manifests are refused field by field', () => {
  const bad: unknown[] = [
    null, { ...manifest, v: 2 }, { ...manifest, seq: -1 }, { ...manifest, hlc: 'x' }, { ...manifest, writer: 'Bad Id' }, { ...manifest, devices: {} },
    { ...manifest, records: { 'layout:L1': { hash: 'zz', hlc: manifest.hlc, schema: 1, generation: 1 } } },
    { ...manifest, leases: { copier: { fence: 1, deviceId: 'a', expiresAt: 'soon', renewedAt: 1 } } },
    { ...manifest, presence: { a: { accounts: [5], expiresAt: 1 } } },
    { ...manifest, devices: [{ id: 'a', name: 'x', platform: 'linux', publicKey: 'k', appVersion: '1', lastSeen: 1, firstSeen: 1 }] },
    { ...manifest, handoffs: { 'mt5|1': { from: 'a', to: ['Not An Id'], createdAt: 1, expiresAt: 2 } } },
    { ...manifest, handoffs: { 'mt5|1': { from: 'a', to: ['b'], expiresAt: 2 } } },
    JSON.parse(JSON.stringify({ ...manifest, records: {} }).replace('"records":{}', '"records":{"__proto__":{}}')),
  ];
  assert.ok(parseManifest({ ...manifest, handoffs: { 'mt5|1': { from: 'a', to: ['b'], createdAt: 1, expiresAt: 2 } } }).handoffs);
  for (const value of bad) assert.throws(() => parseManifest(value), reason('tampered'), JSON.stringify(value));
});

test('a lease is taken once, renewed by its holder and fenced before anyone else may take it', () => {
  const start = 1_000_000;
  const leases = acquireLease({}, 'copier:c1', 'a', start);
  assert.equal(leases['copier:c1'].fence, 1);
  assert.equal(leaseHolder(leases, 'copier:c1', start), 'a');
  assert.throws(() => acquireLease(leases, 'copier:c1', 'b', start + 1000), /Another computer is running/);
  assert.ok(canOpenTrades(leases, 'copier:c1', 'a', start + leaseTiming.fenceAfterMs - 1));
  assert.ok(!canOpenTrades(leases, 'copier:c1', 'a', start + leaseTiming.fenceAfterMs));
  assert.ok(!canOpenTrades(leases, 'copier:c1', 'b', start));
  assert.ok(leaseTiming.fenceAfterMs < leaseTiming.lifetimeMs + leaseTiming.takeoverMarginMs);

  const renewed = renewLease(leases, 'copier:c1', 'a', start + leaseTiming.renewEveryMs);
  assert.ok(canOpenTrades(renewed, 'copier:c1', 'a', start + leaseTiming.fenceAfterMs));
  assert.throws(() => renewLease(renewed, 'copier:c1', 'b', start), /no longer runs/);
});

test('an expired lease needs confirmation to take over, and the fence rises', () => {
  const leases = acquireLease({}, 'copier:c1', 'a', 0);
  const late = leaseTiming.lifetimeMs + leaseTiming.takeoverMarginMs;
  assert.throws(() => acquireLease(leases, 'copier:c1', 'b', late - 1), /Another computer is running/);
  assert.throws(() => acquireLease(leases, 'copier:c1', 'b', late), /may still be running/);
  const taken = acquireLease(leases, 'copier:c1', 'b', late, true);
  assert.deepEqual([taken['copier:c1'].deviceId, taken['copier:c1'].fence], ['b', 2]);
  assert.ok(!canOpenTrades(taken, 'copier:c1', 'a', late));
});

test('a released lease is free for the next computer without confirmation', () => {
  const leases = releaseLease(acquireLease({}, 'copier:c1', 'a', 0), 'copier:c1', 'a');
  assert.equal(leaseHolder(leases, 'copier:c1', 1), null);
  assert.equal(acquireLease(leases, 'copier:c1', 'b', 1)['copier:c1'].deviceId, 'b');
  assert.equal(releaseLease(acquireLease({}, 'copier:c1', 'a', 0), 'copier:c1', 'b')['copier:c1'].deviceId, 'a');
});

test('presence shows where an account is open and expires on its own', () => {
  let presence = withPresence({}, 'a', ['mt5|123'], 0);
  presence = withPresence(presence, 'b', ['mt5|456'], 10);
  assert.deepEqual(presentElsewhere(presence, 'mt5|123', 'b', 20), ['a']);
  assert.deepEqual(presentElsewhere(presence, 'mt5|123', 'a', 20), []);
  assert.deepEqual(presentElsewhere(presence, 'mt5|123', 'b', 400_000), ['a']);
  assert.deepEqual(presentElsewhere(presence, 'mt5|123', 'b', 2_000_000), []);
  assert.deepEqual(Object.keys(withPresence(presence, 'a', [], 30)), ['b']);
});
