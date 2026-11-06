import { isDeviceId, isHlc } from './sync-clock';
import { open, seal, SyncCryptoError, type SyncKeys } from './sync-crypto';

// The highest manifest format this build reads. A manifest whose `minReader` is above it was
// written by a newer build that changed something this one would misread.
export const FORMAT_VERSION = 1;
export const MANIFEST_PATH = 'manifest';
export const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

// Lease times are on GitHub's clock (its Date header). The holder stops opening trades after
// `fenceAfterMs` without a renewal, before anyone else may take the lease at `lifetimeMs` plus
// the margin, so two computers never both have the right to open.
export const leaseTiming = { renewEveryMs: 120_000, fenceAfterMs: 420_000, lifetimeMs: 600_000, takeoverMarginMs: 60_000 } as const;
// Presence costs a commit per renewal, and each commit keeps a new copy of the manifest in the
// repository's history, so it lasts half an hour and renews when less than half is left. A
// computer that logs out removes it at once; one that crashed is covered by "Log in anyway".
export const PRESENCE_LIFETIME_MS = 1_800_000;
export const PRESENCE_RENEW_MS = 900_000;
// A request to move an account stays open long enough for a computer that was asleep to see it
// when it wakes; it then logs out only if its own login is older than the request.
export const HANDOFF_LIFETIME_MS = 12 * 3_600_000;

export interface ManifestEntry {
  // null for a deleted record.
  readonly hash: string | null;
  readonly hlc: string;
  readonly schema: number;
  readonly generation: number;
}

export interface ManifestDevice {
  readonly id: string;
  readonly name: string;
  readonly platform: string;
  readonly publicKey: string;
  readonly appVersion: string;
  readonly lastSeen: number;
  readonly firstSeen: number;
  readonly isRevoked: boolean;
}

export interface Lease {
  readonly fence: number;
  readonly deviceId: string;
  readonly expiresAt: number;
  readonly renewedAt: number;
}

export interface Presence {
  readonly accounts: readonly string[];
  readonly expiresAt: number;
}

// A computer asking the ones that hold an account to log out of it, so it can log in alone.
export interface Handoff {
  readonly from: string;
  readonly to: readonly string[];
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface Manifest {
  readonly v: 1;
  readonly seq: number;
  readonly hlc: string;
  readonly epoch: number;
  readonly repoId: number;
  readonly writer: string;
  readonly minReader: number;
  readonly tombstonesPrunedBefore: string | null;
  readonly devices: readonly ManifestDevice[];
  readonly leases: Readonly<Record<string, Lease>>;
  readonly records: Readonly<Record<string, ManifestEntry>>;
  readonly presence: Readonly<Record<string, Presence>>;
  // By account id. Missing in manifests written before login handoff; older builds keep it as is.
  readonly handoffs?: Readonly<Record<string, Handoff>>;
}

export type IntegrityReason = 'tampered' | 'rollback' | 'epoch' | 'tooNew' | 'stale' | 'revoked';

export class SyncIntegrityError extends Error {
  constructor(readonly reason: IntegrityReason, message: string) { super(message); }
}

export class LeaseError extends Error {
  constructor(readonly reason: 'held' | 'needsConfirmation' | 'lost', readonly holder: string | null, message: string) { super(message); }
}

export function emptyManifest(epoch: number, repoId: number): Manifest {
  return { v: 1, seq: 0, hlc: '0000000000000.0000.0', epoch, repoId, writer: '0', minReader: 1, tombstonesPrunedBefore: null, devices: [], leases: {}, records: {}, presence: {} };
}

const manifestContext = (epoch: number, repoId: number) => ({ purpose: 'manifest', epoch, repoId });

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const isText = (value: unknown, max = 256): value is string => typeof value === 'string' && value.length <= max;
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function parseManifest(value: unknown): Manifest {
  const fail = (what: string): never => { throw new SyncIntegrityError('tampered', `Sync manifest is malformed (${what}).`); };
  if (!isObject(value) || value.v !== 1) return fail('version');
  const { seq, hlc, epoch, repoId, writer, minReader, tombstonesPrunedBefore, devices, leases, records, presence } = value;
  if (!isCount(seq) || !isHlc(hlc) || !isCount(epoch) || !isCount(repoId) || !(writer === '0' || isDeviceId(writer)) || !isCount(minReader)) fail('header');
  if (tombstonesPrunedBefore !== null && !isHlc(tombstonesPrunedBefore)) fail('pruning');
  if (!Array.isArray(devices) || !isObject(leases) || !isObject(records) || !isObject(presence)) fail('sections');
  for (const device of devices as unknown[]) {
    if (!isObject(device) || !isDeviceId(device.id) || !isText(device.name) || !isText(device.platform) || !isText(device.publicKey) || !isText(device.appVersion) ||
      !isCount(device.lastSeen) || !isCount(device.firstSeen) || typeof device.isRevoked !== 'boolean') fail('device');
  }
  // Keys are assigned into plain objects all through the engine, so none may be `__proto__`.
  if ([...Object.keys(records as object), ...Object.keys(leases as object)].some((key) => key === '__proto__' || key.endsWith(':__proto__'))) fail('keys');
  for (const entry of Object.values(records as Record<string, unknown>)) {
    if (!isObject(entry) || !(entry.hash === null || (typeof entry.hash === 'string' && /^[0-9a-f]{64}$/.test(entry.hash))) || !isHlc(entry.hlc) ||
      !isCount(entry.schema) || !isCount(entry.generation)) fail('record');
  }
  for (const lease of Object.values(leases as Record<string, unknown>)) {
    if (!isObject(lease) || !isCount(lease.fence) || !isDeviceId(lease.deviceId) || !isCount(lease.expiresAt) || !isCount(lease.renewedAt)) fail('lease');
  }
  for (const [deviceId, entry] of Object.entries(presence as Record<string, unknown>)) {
    if (!isDeviceId(deviceId) || !isObject(entry) || !Array.isArray(entry.accounts) || !entry.accounts.every((account) => isText(account, 512)) || !isCount(entry.expiresAt)) fail('presence');
  }
  const { handoffs } = value;
  if (handoffs !== undefined) {
    if (!isObject(handoffs)) fail('handoffs');
    for (const [account, entry] of Object.entries(handoffs as Record<string, unknown>)) {
      if (account === '__proto__' || !isText(account, 512) || !isObject(entry) || !isDeviceId(entry.from) || !Array.isArray(entry.to) || !entry.to.every(isDeviceId) || !isCount(entry.createdAt) || !isCount(entry.expiresAt)) fail('handoff');
    }
  }
  return value as unknown as Manifest;
}

export function sealManifest(keys: SyncKeys, manifest: Manifest): Buffer {
  return seal(keys.manifest, Buffer.from(JSON.stringify(manifest)), manifestContext(manifest.epoch, manifest.repoId));
}

// `highWater` is the highest sequence this device has accepted; a lower one means someone put an
// older repository state back.
export function openManifest(keys: SyncKeys, envelope: Buffer, expected: { epoch: number; repoId: number; highWater: number }): Manifest {
  let text: string;
  try { text = open(keys.manifest, envelope, manifestContext(expected.epoch, expected.repoId), MAX_MANIFEST_BYTES).toString('utf8'); }
  catch (error) {
    if (error instanceof SyncCryptoError && /another key epoch/.test(error.message)) throw new SyncIntegrityError('epoch', 'The sync data was re-keyed by another computer.');
    throw new SyncIntegrityError('tampered', 'The sync manifest failed authentication.');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new SyncIntegrityError('tampered', 'Sync manifest is malformed (JSON).'); }
  const manifest = parseManifest(parsed);
  if (manifest.epoch !== expected.epoch || manifest.repoId !== expected.repoId) throw new SyncIntegrityError('tampered', 'The sync manifest belongs to another repository or key.');
  if (manifest.minReader > FORMAT_VERSION) throw new SyncIntegrityError('tooNew', 'The sync data was written by a newer OpenTerm5. Update to keep syncing.');
  if (manifest.seq < expected.highWater) throw new SyncIntegrityError('rollback', `The sync data went back from version ${expected.highWater} to ${manifest.seq}.`);
  return manifest;
}

export function leaseHolder(leases: Manifest['leases'], key: string, serverNow: number): string | null {
  const lease = leases[key];
  return lease && serverNow < lease.expiresAt + leaseTiming.takeoverMarginMs ? lease.deviceId : null;
}

export function canOpenTrades(leases: Manifest['leases'], key: string, deviceId: string, serverNow: number): boolean {
  const lease = leases[key];
  return !!lease && lease.deviceId === deviceId && serverNow - lease.renewedAt < leaseTiming.fenceAfterMs;
}

// An expired lease is never taken over silently: the old holder may have lost GitHub but kept its
// broker connection, so the user has to confirm.
export function acquireLease(leases: Manifest['leases'], key: string, deviceId: string, serverNow: number, isConfirmed = false): Manifest['leases'] {
  const existing = leases[key];
  if (existing && existing.deviceId !== deviceId) {
    if (serverNow < existing.expiresAt + leaseTiming.takeoverMarginMs) throw new LeaseError('held', existing.deviceId, 'Another computer is running this.');
    if (!isConfirmed) throw new LeaseError('needsConfirmation', existing.deviceId, 'Another computer ran this until recently and may still be running it.');
  }
  const fence = existing?.deviceId === deviceId ? existing.fence : (existing?.fence ?? 0) + 1;
  return { ...leases, [key]: { fence, deviceId, expiresAt: serverNow + leaseTiming.lifetimeMs, renewedAt: serverNow } };
}

export function renewLease(leases: Manifest['leases'], key: string, deviceId: string, serverNow: number): Manifest['leases'] {
  const existing = leases[key];
  if (!existing || existing.deviceId !== deviceId) throw new LeaseError('lost', existing?.deviceId ?? null, 'This computer no longer runs this.');
  return { ...leases, [key]: { ...existing, expiresAt: serverNow + leaseTiming.lifetimeMs, renewedAt: serverNow } };
}

export function releaseLease(leases: Manifest['leases'], key: string, deviceId: string): Manifest['leases'] {
  if (leases[key]?.deviceId !== deviceId) return leases;
  const { [key]: _released, ...rest } = leases;
  return rest;
}

export function withPresence(presence: Manifest['presence'], deviceId: string, accounts: readonly string[], serverNow: number): Manifest['presence'] {
  const live = Object.fromEntries(Object.entries(presence).filter(([id, entry]) => id !== deviceId && entry.expiresAt > serverNow));
  return accounts.length ? { ...live, [deviceId]: { accounts: [...accounts].sort(), expiresAt: serverNow + PRESENCE_LIFETIME_MS } } : live;
}

// Whether this computer's presence should be written: its accounts changed, or it runs out soon.
export function isPresenceDue(presence: Manifest['presence'], deviceId: string, accounts: readonly string[], serverNow: number): boolean {
  const own = presence[deviceId];
  if (!accounts.length) return !!own;
  return !own || own.expiresAt - serverNow < PRESENCE_RENEW_MS || own.accounts.join('\n') !== [...accounts].sort().join('\n');
}

// Open requests, expired ones dropped.
export function liveHandoffs(handoffs: Manifest['handoffs'], serverNow: number): Record<string, Handoff> {
  return Object.fromEntries(Object.entries(handoffs ?? {}).filter(([, entry]) => entry.expiresAt > serverNow));
}

export function presentElsewhere(presence: Manifest['presence'], account: string, deviceId: string, serverNow: number): string[] {
  return Object.entries(presence).filter(([id, entry]) => id !== deviceId && entry.expiresAt > serverNow && entry.accounts.includes(account)).map(([id]) => id).sort();
}
