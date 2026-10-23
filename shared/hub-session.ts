// The hub's encrypted channel, shared by the desktop and the phone. Each end supplies the
// primitives (node:crypto on the desktop, a pure JavaScript library on the phone, which may run
// outside a secure context where WebCrypto is unavailable). The channel only needs an ordered
// transport, so a relay can carry its frames later without being able to read them.

export interface HubKeyPair {
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
}

export interface HubCrypto {
  random(length: number): Uint8Array;
  sha256(data: Uint8Array): Promise<Uint8Array>;
  generateKeyPair(): Promise<HubKeyPair>;
  dh(privateKey: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array>;
  hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array>;
  seal(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array>;
  open(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array>;
}

export interface HubKeys {
  readonly sendKey: Uint8Array;
  readonly receiveKey: Uint8Array;
}

export interface HubHello {
  readonly t: 'hello';
  readonly v: 1;
  readonly device: string;
  readonly ephemeral: string;
  readonly isPairing: boolean;
}

export interface HubWelcome {
  readonly t: 'welcome';
  readonly v: 1;
  readonly ephemeral: string;
}

export interface HubRefusal {
  readonly t: 'refused';
  readonly reason: string;
}

export const hubRefusals = [
  { key: 'unknown', message: 'This phone is no longer paired with the computer. Pair it again.' },
  { key: 'expired', message: 'The pairing code has expired or was already used. Show a new code on the computer.' },
  { key: 'locked', message: 'Too many failed attempts. Try again in a few minutes.' },
  { key: 'version', message: 'Update OpenTerm5 on the computer and on this phone to the same version.' },
] as const;

export type HubRefusalKey = (typeof hubRefusals)[number]['key'];

export const refusalMessage = (reason: string) => hubRefusals.find((item) => item.key === reason)?.message ?? 'The computer refused the connection.';

export class HubHandshakeError extends Error {
  constructor(message: string, readonly reason?: HubRefusalKey) {
    super(message);
  }
}

const KEY_BYTES = 32;
const MAX_FRAMES = 2 ** 31;
const info = new TextEncoder().encode('openterm5 hub v1');
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  if (!/^[\w-]*$/.test(text)) throw new HubHandshakeError('Malformed key');
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

function publicKey(text: unknown): Uint8Array {
  const key = typeof text === 'string' ? fromBase64Url(text) : new Uint8Array();
  if (key.length !== KEY_BYTES) throw new HubHandshakeError('Malformed key');
  return key;
}

// A low-order peer key gives an all-zero secret that an attacker could predict.
async function agree(crypto: HubCrypto, privateKey: Uint8Array, peer: Uint8Array): Promise<Uint8Array> {
  const secret = await crypto.dh(privateKey, peer);
  if (secret.every((byte) => byte === 0)) throw new HubHandshakeError('Weak key');
  return secret;
}

async function deriveKeys(crypto: HubCrypto, hello: string, welcome: string, secrets: readonly Uint8Array[]): Promise<{ toHub: Uint8Array; toDevice: Uint8Array }> {
  const transcript = await crypto.sha256(concat(encoder.encode(hello), new Uint8Array([0]), encoder.encode(welcome)));
  const keys = await crypto.hkdf(concat(...secrets), transcript, info, KEY_BYTES * 2);
  return { toHub: keys.slice(0, KEY_BYTES), toDevice: keys.slice(KEY_BYTES) };
}

export function parseHello(text: string): HubHello {
  let value: Partial<HubHello>;
  try { value = JSON.parse(text) as Partial<HubHello>; }
  catch { throw new HubHandshakeError('Malformed hello'); }
  if (value?.t !== 'hello') throw new HubHandshakeError('Malformed hello');
  if (value.v !== 1) throw new HubHandshakeError('Unsupported version', 'version');
  publicKey(value.device);
  publicKey(value.ephemeral);
  return { t: 'hello', v: 1, device: value.device!, ephemeral: value.ephemeral!, isPairing: value.isPairing === true };
}

export interface DeviceHandshake {
  readonly hello: string;
  finish(reply: string): Promise<HubKeys>;
}

// The phone's half: it proves it holds its device key, checks the computer holds the key the
// pairing link named, and on first contact mixes in the link's token.
export async function startDeviceHandshake(crypto: HubCrypto, device: HubKeyPair, hubKey: Uint8Array, token?: Uint8Array): Promise<DeviceHandshake> {
  const ephemeral = await crypto.generateKeyPair();
  const hello = JSON.stringify({ t: 'hello', v: 1, device: toBase64Url(device.publicKey), ephemeral: toBase64Url(ephemeral.publicKey), isPairing: !!token } satisfies HubHello);
  return {
    hello,
    async finish(reply) {
      let value: { t?: unknown; v?: unknown; reason?: unknown; ephemeral?: unknown } | null;
      try { value = JSON.parse(reply) as typeof value; }
      catch { throw new HubHandshakeError('The computer sent an unreadable reply.'); }
      if (value?.t === 'refused') throw new HubHandshakeError(refusalMessage(String(value.reason)), hubRefusals.find((item) => item.key === value.reason)?.key);
      if (value?.t !== 'welcome' || value.v !== 1) throw new HubHandshakeError('The computer sent an unreadable reply.');
      const hubEphemeral = publicKey(value.ephemeral);
      const secrets = [
        await agree(crypto, ephemeral.privateKey, hubEphemeral),
        await agree(crypto, device.privateKey, hubEphemeral),
        await agree(crypto, ephemeral.privateKey, hubKey),
        ...(token ? [token] : []),
      ];
      const { toHub, toDevice } = await deriveKeys(crypto, hello, reply, secrets);
      return { sendKey: toHub, receiveKey: toDevice };
    },
  };
}

export interface HubAcceptance {
  readonly reply: string;
  readonly keys: HubKeys;
  readonly deviceKey: Uint8Array;
}

// The computer's half. `token` is the open pairing offer's token for a pairing hello, or null for a
// returning device (whose key the caller has already found among the paired devices). The
// transcript is the hello exactly as received, not a re-serialisation of it.
export async function acceptDevice(crypto: HubCrypto, hub: HubKeyPair, helloText: string, token: Uint8Array | null): Promise<HubAcceptance> {
  const hello = parseHello(helloText);
  const deviceKey = publicKey(hello.device);
  const deviceEphemeral = publicKey(hello.ephemeral);
  const ephemeral = await crypto.generateKeyPair();
  const reply = JSON.stringify({ t: 'welcome', v: 1, ephemeral: toBase64Url(ephemeral.publicKey) } satisfies HubWelcome);
  const secrets = [
    await agree(crypto, ephemeral.privateKey, deviceEphemeral),
    await agree(crypto, ephemeral.privateKey, deviceKey),
    await agree(crypto, hub.privateKey, deviceEphemeral),
    ...(token ? [token] : []),
  ];
  const { toHub, toDevice } = await deriveKeys(crypto, helloText, reply, secrets);
  return { reply, deviceKey, keys: { sendKey: toDevice, receiveKey: toHub } };
}

export const refusal = (reason: HubRefusalKey) => JSON.stringify({ t: 'refused', reason } satisfies HubRefusal);

// The nonce is the frame's position in its direction, so a replayed, dropped or reordered frame
// fails to open and the connection ends.
function nonce(counter: number): Uint8Array {
  const bytes = new Uint8Array(12);
  new DataView(bytes.buffer).setBigUint64(4, BigInt(counter));
  return bytes;
}

export class HubChannel {
  private sent = 0;
  private received = 0;
  private sending: Promise<void> = Promise.resolve();
  private receiving: Promise<void> = Promise.resolve();

  constructor(private readonly crypto: HubCrypto, private readonly keys: HubKeys, private readonly transmit: (frame: Uint8Array) => void) {}

  // Frames are sealed and sent in call order even though sealing may be asynchronous.
  send(message: unknown): Promise<void> {
    const counter = this.sent++;
    if (counter >= MAX_FRAMES) return Promise.reject(new Error('Connection used up its keys; reconnect.'));
    const plaintext = encoder.encode(JSON.stringify(message));
    const next = this.sending.then(async () => this.transmit(await this.crypto.seal(this.keys.sendKey, nonce(counter), plaintext)));
    this.sending = next.catch(() => undefined);
    return next;
  }

  // Resolves in arrival order; a frame that fails to open rejects, and the caller must close.
  receive(frame: Uint8Array): Promise<unknown> {
    const counter = this.received++;
    const next = this.receiving.then(async () => {
      if (counter >= MAX_FRAMES) throw new Error('Connection used up its keys');
      return JSON.parse(decoder.decode(await this.crypto.open(this.keys.receiveKey, nonce(counter), frame))) as unknown;
    });
    this.receiving = next.then(() => undefined, () => undefined);
    return next;
  }
}
