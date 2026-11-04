import { createHash, createHmac, hkdfSync } from 'node:crypto';
import {
  newRecoveryCode, newRootKey, unwrapForDevice, unwrapWithPassphrase, unwrapWithRecovery, wrapForDevice, wrapWithPassphrase, wrapWithRecovery,
  type DeviceKeyPair, type KeyWrap,
} from './sync-crypto';
import type { SyncRemote } from './sync-engine';
import { pairingWordList } from './sync-words';

// The two plaintext files that make a repository a sync repository. Neither holds anything
// readable: format.json names the format and repository, keyring.json holds only wrapped keys.
export const FORMAT_PATH = 'format.json';
export const KEYRING_PATH = 'keyring.json';
// A new computer asks to join here; a linked computer approves by wrapping the key to it. Only ids,
// public keys and times: no names, since this file is not encrypted.
export const PAIRING_PATH = 'pairing.json';
export const PAIRING_LIFETIME_MS = 15 * 60_000;
const MAX_PAIRING_REQUESTS = 8;
const FORMAT_NAME = 'openterm5-sync';
const FORMAT_VERSION = 1;
const MAX_WRAPS = 64;
const MAX_ATTEMPTS = 5;

export interface SyncFormat {
  readonly format: typeof FORMAT_NAME;
  readonly version: number;
  readonly repoId: number;
  readonly createdAt: string;
}

export interface Keyring {
  readonly epoch: number;
  readonly wraps: readonly KeyWrap[];
}

export interface PairingRequest {
  readonly deviceId: string;
  readonly publicKey: string;
  readonly createdAt: number;
}

export type Unlock = { readonly recoveryCode: string } | { readonly passphrase: string } | { readonly deviceId: string; readonly deviceKeys: DeviceKeyPair };

export type RepositorySetup =
  | { readonly kind: 'empty'; readonly head: string | null }
  | { readonly kind: 'sync'; readonly head: string; readonly format: SyncFormat; readonly keyring: Keyring; readonly pairing: readonly PairingRequest[] }
  | { readonly kind: 'foreign'; readonly head: string };

export class SyncSetupError extends Error {}

const isText = (value: unknown, max = 4096): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;

function parseJson(content: Buffer, what: string): Record<string, unknown> {
  try {
    const value = JSON.parse(content.toString('utf8')) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* reported below */ }
  throw new SyncSetupError(`The repository's ${what} is damaged.`);
}

export function parseFormat(content: Buffer, repoId: number): SyncFormat {
  const value = parseJson(content, FORMAT_PATH);
  if (value.format !== FORMAT_NAME || !Number.isSafeInteger(value.version) || !isText(value.createdAt, 64)) throw new SyncSetupError(`The repository's ${FORMAT_PATH} is damaged.`);
  if ((value.version as number) > FORMAT_VERSION) throw new SyncSetupError('This repository was set up by a newer OpenTerm5. Update to sync with it.');
  if (value.repoId !== repoId) throw new SyncSetupError('This repository holds sync data copied from another repository. Choose an empty one.');
  return value as unknown as SyncFormat;
}

function parseWrap(value: unknown): KeyWrap {
  const wrap = (value ?? {}) as Record<string, unknown>;
  const isCommon = Number.isSafeInteger(wrap.epoch) && (wrap.epoch as number) >= 1 && isText(wrap.sealed);
  if (wrap.kind === 'recovery' && isCommon) return { kind: 'recovery', epoch: wrap.epoch as number, sealed: wrap.sealed as string };
  const cost = (wrap.cost ?? {}) as Record<string, unknown>;
  if (wrap.kind === 'passphrase' && isCommon && isText(wrap.salt, 64) && [cost.N, cost.r, cost.p].every(Number.isSafeInteger)) {
    return { kind: 'passphrase', epoch: wrap.epoch as number, salt: wrap.salt as string, cost: { N: cost.N as number, r: cost.r as number, p: cost.p as number }, sealed: wrap.sealed as string };
  }
  if (wrap.kind === 'device' && isCommon && isText(wrap.deviceId, 32) && isText(wrap.ephemeralKey, 64)) {
    return { kind: 'device', epoch: wrap.epoch as number, deviceId: wrap.deviceId as string, ephemeralKey: wrap.ephemeralKey as string, sealed: wrap.sealed as string };
  }
  throw new SyncSetupError(`The repository's ${KEYRING_PATH} is damaged.`);
}

export function parseKeyring(content: Buffer): Keyring {
  const value = parseJson(content, KEYRING_PATH);
  if (!Number.isSafeInteger(value.epoch) || (value.epoch as number) < 1 || !Array.isArray(value.wraps) || value.wraps.length > MAX_WRAPS) throw new SyncSetupError(`The repository's ${KEYRING_PATH} is damaged.`);
  return { epoch: value.epoch as number, wraps: value.wraps.map(parseWrap) };
}

export function parsePairing(content: Buffer | null | undefined): PairingRequest[] {
  if (!content) return [];
  const value = parseJson(content, PAIRING_PATH);
  if (!Array.isArray(value.requests) || value.requests.length > MAX_PAIRING_REQUESTS * 2) throw new SyncSetupError(`The repository's ${PAIRING_PATH} is damaged.`);
  return value.requests.map((item: unknown) => {
    const request = (item ?? {}) as Record<string, unknown>;
    if (typeof request.deviceId !== 'string' || !/^[a-z0-9]{1,32}$/.test(request.deviceId) || typeof request.publicKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(request.publicKey) || !Number.isSafeInteger(request.createdAt)) {
      throw new SyncSetupError(`The repository's ${PAIRING_PATH} is damaged.`);
    }
    return { deviceId: request.deviceId, publicKey: request.publicKey, createdAt: request.createdAt as number };
  });
}

// Six words from the hash of the public key the key would be wrapped to. The new computer shows
// them and the approving computer shows them for the request it found: matching words mean the
// request really is that computer's, not one someone holding the GitHub token slipped in.
export function pairingWords(publicKey: string): string[] {
  return [...createHash('sha256').update(`openterm5-pair|${publicKey}`).digest().subarray(0, 6)].map((byte) => pairingWordList[byte]);
}

// Three words only the real sync key yields for this request. The approving computer shows them
// and the new computer must type them before it trusts the key it was sent: someone holding the
// GitHub token can wrap a key of their own to the new computer, but cannot know these words.
export function pairingConfirmation(rootKey: Buffer, repoId: number, request: { deviceId: string; publicKey: string }): string[] {
  const key = Buffer.from(hkdfSync('sha256', rootKey, 'openterm5-sync/v1', 'pairing-confirmation', 32));
  return [...createHmac('sha256', key).update(`${repoId}|${request.deviceId}|${request.publicKey}`).digest().subarray(0, 3)].map((byte) => pairingWordList[byte]);
}

const encode = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

export function newKeyring(repoId: number, device: { id: string; publicKey: string }, passphrase?: string, cost?: { N: number; r: number; p: number }) {
  const rootKey = newRootKey();
  const { code, secret } = newRecoveryCode();
  const wraps: KeyWrap[] = [wrapWithRecovery(rootKey, secret, 1, repoId), wrapForDevice(rootKey, device.id, device.publicKey, 1, repoId)];
  if (passphrase) wraps.push(wrapWithPassphrase(rootKey, passphrase, 1, repoId, cost));
  const format: SyncFormat = { format: FORMAT_NAME, version: FORMAT_VERSION, repoId, createdAt: new Date().toISOString() };
  const keyring: Keyring = { epoch: 1, wraps };
  return { rootKey, recoveryCode: code, keyring, files: new Map([[FORMAT_PATH, encode(format)], [KEYRING_PATH, encode(keyring)]]) };
}

export function unlockKeyring(keyring: Keyring, repoId: number, unlock: Unlock): Buffer {
  const current = keyring.wraps.filter((wrap) => wrap.epoch === keyring.epoch);
  if ('recoveryCode' in unlock) {
    const wrap = current.find((item) => item.kind === 'recovery');
    if (!wrap) throw new SyncSetupError('This repository has no recovery code set.');
    return unwrapWithRecovery(wrap, unlock.recoveryCode, repoId);
  }
  if ('passphrase' in unlock) {
    const wrap = current.find((item) => item.kind === 'passphrase');
    if (!wrap) throw new SyncSetupError('No passphrase was set for this sync. Use the recovery code.');
    return unwrapWithPassphrase(wrap, unlock.passphrase, repoId);
  }
  const wrap = current.find((item) => item.kind === 'device' && item.deviceId === unlock.deviceId);
  if (!wrap) throw new SyncSetupError('This computer has no key in this repository.');
  return unwrapForDevice(wrap, unlock.deviceKeys, repoId);
}

export function withDeviceWrap(keyring: Keyring, rootKey: Buffer, repoId: number, device: { id: string; publicKey: string }): Keyring {
  const others = keyring.wraps.filter((wrap) => wrap.kind !== 'device' || wrap.deviceId !== device.id);
  return { ...keyring, wraps: [...others, wrapForDevice(rootKey, device.id, device.publicKey, keyring.epoch, repoId)] };
}

// A new recovery code replaces the old one, which stops working.
export function withNewRecovery(keyring: Keyring, rootKey: Buffer, repoId: number): { keyring: Keyring; recoveryCode: string } {
  const { code, secret } = newRecoveryCode();
  const others = keyring.wraps.filter((wrap) => wrap.kind !== 'recovery' || wrap.epoch !== keyring.epoch);
  return { keyring: { ...keyring, wraps: [...others, wrapWithRecovery(rootKey, secret, keyring.epoch, repoId)] }, recoveryCode: code };
}

export async function inspectRepository(remote: SyncRemote, repoId: number): Promise<RepositorySetup> {
  const head = await remote.head();
  if (head === null) return { kind: 'empty', head };
  const files = await remote.read(head, [FORMAT_PATH, KEYRING_PATH, PAIRING_PATH]);
  const [format, keyring] = [files.get(FORMAT_PATH), files.get(KEYRING_PATH)];
  if (!format) return { kind: 'foreign', head };
  if (!keyring) throw new SyncSetupError(`The repository has ${FORMAT_PATH} but no ${KEYRING_PATH}.`);
  return { kind: 'sync', head, format: parseFormat(format, repoId), keyring: parseKeyring(keyring), pairing: parsePairing(files.get(PAIRING_PATH)) };
}

type SetupChange = { readonly keyring?: Keyring; readonly pairing?: readonly PairingRequest[] };

// Rewrites keyring.json and pairing.json with compare-and-swap, re-reading them after a lost race so
// a wrap or request another computer added meanwhile is kept.
export async function updateSetup(remote: SyncRemote, repoId: number, change: (keyring: Keyring, pairing: readonly PairingRequest[]) => SetupChange): Promise<SetupChange> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const setup = await inspectRepository(remote, repoId);
    if (setup.kind !== 'sync') throw new SyncSetupError('This repository is not set up for sync.');
    const next = change(setup.keyring, setup.pairing);
    const writes = new Map<string, Buffer | null>();
    if (next.keyring) writes.set(KEYRING_PATH, encode(next.keyring));
    if (next.pairing) writes.set(PAIRING_PATH, next.pairing.length ? encode({ requests: next.pairing }) : null);
    if (!writes.size || await remote.commit(setup.head, writes)) return next;
  }
  throw new SyncSetupError('Another computer kept changing the sync key. Try again.');
}

export async function updateKeyring(remote: SyncRemote, repoId: number, change: (keyring: Keyring) => Keyring): Promise<Keyring> {
  return (await updateSetup(remote, repoId, (keyring) => ({ keyring: change(keyring) }))).keyring!;
}

const freshRequests = (pairing: readonly PairingRequest[], now: number) => pairing.filter((request) => now - request.createdAt < PAIRING_LIFETIME_MS);

export async function requestPairing(remote: SyncRemote, repoId: number, device: { id: string; publicKey: string }, now: number): Promise<void> {
  await updateSetup(remote, repoId, (_keyring, pairing) => {
    const others = freshRequests(pairing, now).filter((request) => request.deviceId !== device.id);
    if (others.length >= MAX_PAIRING_REQUESTS) throw new SyncSetupError('Too many computers are waiting to join. Try again in a few minutes.');
    return { pairing: [...others, { deviceId: device.id, publicKey: device.publicKey, createdAt: now }] };
  });
}

// Approving wraps the key to the requesting computer and removes its request in the same commit,
// and returns the request so its confirmation words can be shown.
// Approval names the public key whose words the user checked, so a request swapped in afterwards
// for the same computer is refused rather than approved.
export async function answerPairing(remote: SyncRemote, repoId: number, deviceId: string, approval: { rootKey: Buffer; publicKey: string } | null, now: number): Promise<PairingRequest | null> {
  let answered: PairingRequest | null = null;
  await updateSetup(remote, repoId, (keyring, pairing) => {
    const request = freshRequests(pairing, now).find((item) => item.deviceId === deviceId);
    answered = request ?? null;
    const rest = pairing.filter((item) => item.deviceId !== deviceId && now - item.createdAt < PAIRING_LIFETIME_MS);
    if (!approval) return { pairing: rest };
    if (!request) throw new SyncSetupError('That request to join has expired. Ask the other computer to try again.');
    if (request.publicKey !== approval.publicKey) throw new SyncSetupError('That request changed after its words were shown. Nothing was approved. Check the words again.');
    return { keyring: withDeviceWrap(keyring, approval.rootKey, repoId, { id: request.deviceId, publicKey: request.publicKey }), pairing: rest };
  });
  return answered;
}
