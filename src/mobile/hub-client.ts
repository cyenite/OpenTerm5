import type { HubApiKey, HubEventMessage, HubReady, HubReply, HubScope } from '../../shared/hub';
import { fromBase64Url, HubChannel, HubHandshakeError, startDeviceHandshake, toBase64Url, type HubCrypto, type HubKeyPair } from '../../shared/hub-session';

// What the phone keeps about the computer it paired with. The device key never leaves the phone.
export interface StoredPairing {
  readonly hubKey: string;
  readonly hubName: string;
  readonly scope: HubScope;
  readonly addresses: readonly string[];
  readonly devicePublicKey: string;
  readonly devicePrivateKey: string;
  readonly deviceId?: string;
}

export const hubStates = [
  { key: 'connecting', label: 'Connecting to the computer' },
  { key: 'ready', label: 'Connected' },
  { key: 'offline', label: 'Computer unreachable' },
  { key: 'refused', label: 'Not paired' },
] as const;

export type HubState = (typeof hubStates)[number]['key'];

export interface HubClientOptions {
  readonly name: string;
  readonly crypto: HubCrypto;
  readonly pairing: StoredPairing;
  readonly token?: Uint8Array;
  onState(state: HubState, detail: string | null): void;
  onEvent(message: HubEventMessage): void;
  onReady(ready: HubReady): void;
  createSocket?: (url: string) => WebSocket;
}

const REQUEST_MS = 30_000;
const CONNECT_MS = 8_000;
const backoff = [1_000, 2_000, 5_000, 10_000, 15_000];

export function deviceKeyPair(pairing: StoredPairing): HubKeyPair {
  return { publicKey: fromBase64Url(pairing.devicePublicKey), privateKey: fromBase64Url(pairing.devicePrivateKey) };
}

export async function newPairing(crypto: HubCrypto, hub: { key: string; name: string; scope: HubScope; addresses: readonly string[] }): Promise<StoredPairing> {
  const keys = await crypto.generateKeyPair();
  return { hubKey: hub.key, hubName: hub.name, scope: hub.scope, addresses: hub.addresses, devicePublicKey: toBase64Url(keys.publicKey), devicePrivateKey: toBase64Url(keys.privateKey) };
}

class Refused extends Error {}

// A lockout passes; an unknown phone, a spent code or a version mismatch does not.
const isFinal = (error: HubHandshakeError) => error.reason === 'unknown' || error.reason === 'expired' || error.reason === 'version';

// One encrypted connection to the computer at a time, reconnecting until the computer says the
// phone is no longer paired. Requests made while disconnected fail rather than wait.
export class HubClient {
  private socket?: WebSocket;
  private channel?: HubChannel;
  private timer?: ReturnType<typeof setTimeout>;
  private token?: Uint8Array;
  private nextId = 0;
  private attempt = 0;
  private isClosed = false;
  private preferred: string | null = null;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();

  constructor(private readonly options: HubClientOptions) {
    this.token = options.token;
  }

  get isReady(): boolean { return !!this.channel; }

  start(): void {
    this.isClosed = false;
    void this.connect();
  }

  close(): void {
    this.isClosed = true;
    clearTimeout(this.timer);
    this.socket?.close();
    this.fail('Disconnected');
  }

  // Reconnects now instead of waiting out the backoff, as when the app returns to the foreground.
  retry(): void {
    if (this.isClosed || this.socket) return;
    clearTimeout(this.timer);
    this.attempt = 0;
    void this.connect();
  }

  request(api: HubApiKey, method: string, params: unknown): Promise<unknown> {
    const channel = this.channel;
    if (!channel) return Promise.reject(new Error('Not connected to the computer'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('The computer did not answer in time'));
      }, REQUEST_MS);
      this.pending.set(id, { resolve, reject, timer });
      channel.send({ kind: 'request', id, api, method, params }).catch((error: Error) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private addresses(): string[] {
    const { addresses } = this.options.pairing;
    const here = typeof location !== 'undefined' && location.protocol === 'http:' ? [location.host] : [];
    return [...new Set([...(this.preferred ? [this.preferred] : []), ...here, ...addresses])];
  }

  private async connect(): Promise<void> {
    this.options.onState('connecting', null);
    let detail: string | null = null;
    for (const address of this.addresses()) {
      if (this.isClosed) return;
      try {
        await this.open(address);
        this.preferred = address;
        this.attempt = 0;
        return;
      } catch (error) {
        if (error instanceof Refused) {
          this.options.onState('refused', error.message);
          return;
        }
        detail = (error as Error).message;
      }
    }
    if (this.isClosed) return;
    this.options.onState('offline', detail);
    this.timer = setTimeout(() => void this.connect(), backoff[Math.min(this.attempt++, backoff.length - 1)]);
  }

  private open(address: string): Promise<void> {
    const { crypto, pairing } = this.options;
    return new Promise((resolve, reject) => {
      const socket = this.options.createSocket?.(`ws://${address}/hub`) ?? new WebSocket(`ws://${address}/hub`);
      socket.binaryType = 'arraybuffer';
      let channel: HubChannel | undefined;
      let isOpen = false;
      let finish: ((reply: string) => Promise<{ sendKey: Uint8Array; receiveKey: Uint8Array }>) | undefined;
      const deadline = setTimeout(() => {
        socket.close();
        reject(new Error(`No answer from ${address}`));
      }, CONNECT_MS);
      const settle = (error: Error | null) => {
        clearTimeout(deadline);
        if (error) {
          socket.close();
          reject(error);
        } else resolve();
      };
      socket.onopen = () => void startDeviceHandshake(crypto, deviceKeyPair(pairing), fromBase64Url(pairing.hubKey), this.token).then((handshake) => {
        finish = handshake.finish;
        socket.send(handshake.hello);
      }).catch((error: Error) => settle(error));
      socket.onmessage = (event) => {
        if (typeof event.data === 'string') {
          if (channel || !finish) return settle(new Error('Unexpected reply'));
          const reply = event.data;
          void finish(reply).then((keys) => {
            channel = new HubChannel(crypto, keys, (frame) => socket.send(frame as Uint8Array<ArrayBuffer>));
            return channel.send({ kind: 'auth', name: this.options.name });
          }).catch((error: Error) => settle(error instanceof HubHandshakeError && isFinal(error) ? new Refused(error.message) : error));
          return;
        }
        if (!channel) return settle(new Error('Unexpected frame'));
        const current = channel;
        void current.receive(new Uint8Array(event.data as ArrayBuffer)).then((message) => {
          if (!isOpen) {
            if ((message as HubReady)?.kind !== 'ready') return settle(new Error('Unexpected first message'));
            isOpen = true;
            this.token = undefined;
            this.socket = socket;
            this.channel = current;
            settle(null);
            this.options.onState('ready', null);
            this.options.onReady(message as HubReady);
            return;
          }
          this.receive(message);
        }).catch(() => socket.close());
      };
      socket.onerror = () => { if (!isOpen) settle(new Error(`Cannot reach ${address}`)); };
      socket.onclose = (event) => {
        if (!isOpen) {
          // A computer that cannot open the frames sealed with its pinned key closes during the handshake.
          return settle(channel && event.code === 4001 ? new Refused(this.token ? 'The pairing code was not accepted. Show a new code on the computer.' : 'This phone is no longer paired with the computer. Pair it again.') : new Error(`Cannot reach ${address}`));
        }
        this.socket = undefined;
        this.channel = undefined;
        this.fail('Connection to the computer was lost');
        if (this.isClosed) return;
        if (event.code === 4003) return this.options.onState('refused', 'This phone was unpaired on the computer.');
        this.options.onState('offline', null);
        this.timer = setTimeout(() => void this.connect(), backoff[0]);
      };
    });
  }

  private receive(message: unknown): void {
    const value = message as HubReply | HubEventMessage;
    if (value?.kind === 'event') return this.options.onEvent(value);
    if (value?.kind !== 'reply') return;
    const pending = this.pending.get(value.id);
    if (!pending) return;
    this.pending.delete(value.id);
    clearTimeout(pending.timer);
    if ('error' in value) pending.reject(new Error(value.error));
    else pending.resolve(value.result);
  }

  private fail(message: string): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(message));
      this.pending.delete(id);
    }
  }
}

export function deviceName(userAgent: string): string {
  const model = /iPad/.test(userAgent) ? 'iPad' : /iPhone/.test(userAgent) ? 'iPhone' : /Android/.test(userAgent) ? 'Android phone' : 'Browser';
  const browser = /EdgA?\//.test(userAgent) ? 'Edge' : /Firefox|FxiOS/.test(userAgent) ? 'Firefox' : /CriOS|Chrome/.test(userAgent) ? 'Chrome' : /Safari/.test(userAgent) ? 'Safari' : '';
  return [model, browser].filter(Boolean).join(' · ');
}
