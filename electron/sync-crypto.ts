import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, scryptSync } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { canonicalJson, type Json } from '../shared/sync';

// Envelope: "OT5S", version, epoch (u32), 12-byte nonce, AES-256-GCM ciphertext, 16-byte tag.
const MAGIC = Buffer.from('OT5S');
const VERSION = 1;
const HEADER_BYTES = MAGIC.length + 1 + 4 + 12;
const TAG_BYTES = 16;
const HKDF_SALT = 'openterm5-sync/v1';
const MAX_PLAINTEXT_BYTES = 4 * 1024 * 1024;

// Phase 0 found a push of small content takes about 2 s and a 1.3 MB object 4.9 s.
export const MAX_ENVELOPE_BYTES = 256 * 1024;

// Electron's BoringSSL has no Argon2 (Phase 0), so passphrases go through scrypt. 128 MiB took
// 0.5 s on the development machine. The bounds stop a crafted keyring from asking for gigabytes.
export const SCRYPT_COST = { N: 2 ** 17, r: 8, p: 1 } as const;
const MIN_LOG_N = 14;
const MAX_LOG_N = 20;

export type SealContext = { readonly epoch: number } & { readonly [key: string]: string | number };

export interface SyncKeys {
  readonly state: Buffer;
  readonly record: Buffer;
  readonly manifest: Buffer;
}

export interface DeviceKeyPair {
  readonly publicKey: string;
  readonly privateKey: string;
}

export type KeyWrap =
  | { readonly kind: 'recovery'; readonly epoch: number; readonly sealed: string }
  | { readonly kind: 'passphrase'; readonly epoch: number; readonly salt: string; readonly cost: { readonly N: number; readonly r: number; readonly p: number }; readonly sealed: string }
  | { readonly kind: 'device'; readonly epoch: number; readonly deviceId: string; readonly ephemeralKey: string; readonly sealed: string };

export class SyncCryptoError extends Error {}

const derive = (key: Buffer, info: string) => Buffer.from(hkdfSync('sha256', key, HKDF_SALT, info, 32));

export function deriveKeys(rootKey: Buffer): SyncKeys {
  if (rootKey.length !== 32) throw new SyncCryptoError('The sync key must be 32 bytes.');
  return { state: derive(rootKey, 'state'), record: derive(rootKey, 'record'), manifest: derive(rootKey, 'manifest') };
}

export const newRootKey = () => randomBytes(32);

// One key per record spreads AES-GCM's random-nonce budget over many keys.
export const recordCipherKey = (keys: SyncKeys, key: string) => derive(keys.record, `record|${key}`);

export function seal(key: Buffer, plaintext: Buffer, context: SealContext): Buffer {
  const nonce = randomBytes(12);
  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header, 0);
  header.writeUInt8(VERSION, MAGIC.length);
  header.writeUInt32BE(context.epoch, MAGIC.length + 1);
  nonce.copy(header, MAGIC.length + 5);
  const cipher = createCipheriv('aes-256-gcm', key, nonce).setAAD(Buffer.from(canonicalJson(context)));
  return Buffer.concat([header, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}

export function open(key: Buffer, envelope: Buffer, context: SealContext, maxBytes = MAX_ENVELOPE_BYTES): Buffer {
  if (envelope.length < HEADER_BYTES + TAG_BYTES || envelope.length > maxBytes ||!envelope.subarray(0, MAGIC.length).equals(MAGIC)) throw new SyncCryptoError('Not a sync envelope.');
  if (envelope.readUInt8(MAGIC.length) !== VERSION) throw new SyncCryptoError('Unsupported sync envelope version.');
  if (envelope.readUInt32BE(MAGIC.length + 1) !== context.epoch) throw new SyncCryptoError('Sync envelope is from another key epoch.');
  const nonce = envelope.subarray(MAGIC.length + 5, HEADER_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce).setAAD(Buffer.from(canonicalJson(context)));
  decipher.setAuthTag(envelope.subarray(envelope.length - TAG_BYTES));
  try { return Buffer.concat([decipher.update(envelope.subarray(HEADER_BYTES, envelope.length - TAG_BYTES)), decipher.final()]); }
  catch { throw new SyncCryptoError('Sync envelope failed authentication.'); }
}

export const envelopeHash = (envelope: Buffer) => createHash('sha256').update(envelope).digest('hex');

export const objectPath = (hash: string) => `objects/${hash.slice(0, 2)}/${hash.slice(2)}`;

// Padded to a size bucket so an object's size says little about how many drawings or accounts it holds.
export function paddedSize(bytes: number): number {
  if (bytes <= 1024) return 1024;
  if (bytes <= 64 * 1024) return 2 ** Math.ceil(Math.log2(bytes));
  return Math.ceil(bytes / (64 * 1024)) * 64 * 1024;
}

export function encodePayload(value: Json): Buffer {
  const compressed = deflateRawSync(Buffer.from(canonicalJson(value)));
  const payload = Buffer.alloc(paddedSize(4 + compressed.length));
  payload.writeUInt32BE(compressed.length, 0);
  compressed.copy(payload, 4);
  return payload;
}

export function decodePayload(payload: Buffer): Json {
  const length = payload.length >= 4 ? payload.readUInt32BE(0) : -1;
  if (length < 0 || 4 + length > payload.length) throw new SyncCryptoError('Sync payload is malformed.');
  try { return JSON.parse(inflateRawSync(payload.subarray(4, 4 + length), { maxOutputLength: MAX_PLAINTEXT_BYTES }).toString('utf8')) as Json; }
  catch { throw new SyncCryptoError('Sync payload is malformed.'); }
}

// Crockford base32: no I, L, O or U, so the code survives being read aloud or copied by hand.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_DIGITS = 26;
const CHECK_DIGITS = 2;

function base32(value: bigint, digits: number): string {
  let text = '';
  for (let index = 0; index < digits; index++, value >>= 5n) text = ALPHABET[Number(value & 31n)] + text;
  return text;
}

const checkDigits = (secret: Buffer) => base32(BigInt(`0x${createHash('sha256').update(secret).digest('hex').slice(0, 4)}`) >> 6n, CHECK_DIGITS);

export function newRecoveryCode(): { code: string; secret: Buffer } {
  const secret = randomBytes(16);
  const text = base32(BigInt(`0x${secret.toString('hex')}`), CODE_DIGITS) + checkDigits(secret);
  return { code: text.match(/.{4}/g)!.join('-'), secret };
}

export function parseRecoveryCode(code: string): Buffer {
  const text = code.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (text.length !== CODE_DIGITS + CHECK_DIGITS || [...text].some((character) => !ALPHABET.includes(character))) throw new SyncCryptoError('That recovery code has the wrong length or characters.');
  let value = 0n;
  for (const character of text.slice(0, CODE_DIGITS)) value = (value << 5n) | BigInt(ALPHABET.indexOf(character));
  if (value >> 128n) throw new SyncCryptoError('That recovery code is mistyped.');
  const secret = Buffer.from(value.toString(16).padStart(32, '0'), 'hex');
  if (checkDigits(secret) !== text.slice(CODE_DIGITS)) throw new SyncCryptoError('That recovery code is mistyped.');
  return secret;
}

const wrapContext = (kind: KeyWrap['kind'], epoch: number, repoId: number, deviceId = '') => ({ purpose: 'keyring', kind, epoch, repoId, deviceId });

function unwrapWith(kek: Buffer, wrap: KeyWrap, repoId: number): Buffer {
  try { return open(kek, Buffer.from(wrap.sealed, 'base64'), wrapContext(wrap.kind, wrap.epoch, repoId, wrap.kind === 'device' ? wrap.deviceId : '')); }
  catch { throw new SyncCryptoError(wrap.kind === 'device' ? 'This computer cannot unlock the sync key.' : `Wrong ${wrap.kind === 'recovery' ? 'recovery code' : 'passphrase'}.`); }
}

const recoveryKek = (secret: Buffer, repoId: number) => derive(secret, `recovery|${repoId}`);

export function wrapWithRecovery(rootKey: Buffer, secret: Buffer, epoch: number, repoId: number): KeyWrap {
  return { kind: 'recovery', epoch, sealed: seal(recoveryKek(secret, repoId), rootKey, wrapContext('recovery', epoch, repoId)).toString('base64') };
}

export function unwrapWithRecovery(wrap: KeyWrap, code: string, repoId: number): Buffer {
  if (wrap.kind !== 'recovery') throw new SyncCryptoError('Not a recovery code wrap.');
  return unwrapWith(recoveryKek(parseRecoveryCode(code), repoId), wrap, repoId);
}

function passphraseKek(phrase: string, salt: Buffer, cost: { N: number; r: number; p: number }): Buffer {
  const logN = Math.log2(cost.N);
  if (!Number.isInteger(logN) || logN < MIN_LOG_N || logN > MAX_LOG_N || cost.r !== 8 || !Number.isInteger(cost.p) || cost.p < 1 || cost.p > 4) throw new SyncCryptoError('Passphrase settings are out of range.');
  return scryptSync(phrase.normalize('NFKC'), salt, 32, { ...cost, maxmem: 256 * cost.N * cost.r * cost.p });
}

export function wrapWithPassphrase(rootKey: Buffer, phrase: string, epoch: number, repoId: number, cost: { N: number; r: number; p: number } = SCRYPT_COST): KeyWrap {
  const salt = randomBytes(16);
  const sealed = seal(passphraseKek(phrase, salt, cost), rootKey, wrapContext('passphrase', epoch, repoId)).toString('base64');
  return { kind: 'passphrase', epoch, salt: salt.toString('base64'), cost: { N: cost.N, r: cost.r, p: cost.p }, sealed };
}

export function unwrapWithPassphrase(wrap: KeyWrap, phrase: string, repoId: number): Buffer {
  if (wrap.kind !== 'passphrase') throw new SyncCryptoError('Not a passphrase wrap.');
  return unwrapWith(passphraseKek(phrase, Buffer.from(wrap.salt, 'base64'), wrap.cost), wrap, repoId);
}

const publicKeyObject = (x: string) => createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x }, format: 'jwk' });

export function newDeviceKeyPair(): DeviceKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return { publicKey: publicKey.export({ format: 'jwk' }).x!, privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') };
}

function deviceKek(shared: Buffer, ephemeralKey: string, devicePublicKey: string): Buffer {
  return Buffer.from(hkdfSync('sha256', shared, `${ephemeralKey}|${devicePublicKey}`, 'openterm5-sync/device-wrap', 32));
}

export function wrapForDevice(rootKey: Buffer, deviceId: string, devicePublicKey: string, epoch: number, repoId: number): KeyWrap {
  const ephemeral = generateKeyPairSync('x25519');
  const ephemeralKey = ephemeral.publicKey.export({ format: 'jwk' }).x!;
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: publicKeyObject(devicePublicKey) });
  const sealed = seal(deviceKek(shared, ephemeralKey, devicePublicKey), rootKey, wrapContext('device', epoch, repoId, deviceId)).toString('base64');
  return { kind: 'device', epoch, deviceId, ephemeralKey, sealed };
}

export function unwrapForDevice(wrap: KeyWrap, keys: DeviceKeyPair, repoId: number): Buffer {
  if (wrap.kind !== 'device') throw new SyncCryptoError('Not a device wrap.');
  const privateKey = createPrivateKey({ key: Buffer.from(keys.privateKey, 'base64'), format: 'der', type: 'pkcs8' });
  const shared = diffieHellman({ privateKey, publicKey: publicKeyObject(wrap.ephemeralKey) });
  return unwrapWith(deviceKek(shared, wrap.ephemeralKey, keys.publicKey), wrap, repoId);
}
