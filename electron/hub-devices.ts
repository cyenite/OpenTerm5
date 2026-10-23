import { randomUUID } from 'node:crypto';
import { defaultHubSettings, isHubScope, type HubPairingPayload, type HubScope, type HubSettings } from '../shared/hub';
import { bytesEqual, fromBase64Url, toBase64Url, type HubCrypto, type HubKeyPair } from '../shared/hub-session';
import type { PasswordCipher } from './account-registry';

export interface HubDevice {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly scope: HubScope;
  readonly pairedAt: number;
  readonly lastSeenAt: number | null;
}

export interface HubFile {
  readonly settings: HubSettings;
  readonly devices: readonly HubDevice[];
  readonly hubKey: { readonly publicKey: string; readonly privateKey: string } | null;
}

export interface HubFileStore {
  load(): Promise<HubFile>;
  save(value: HubFile): Promise<void>;
}

interface PairingOffer {
  readonly scope: HubScope;
  readonly token: Uint8Array;
  readonly expiresAt: number;
  failures: number;
}

const OFFER_MS = 5 * 60_000;
const MAX_DEVICES = 20;
const MAX_OFFER_FAILURES = 5;

export const emptyHubFile = (): HubFile => ({ settings: defaultHubSettings, devices: [], hubKey: null });

export function parseHubFile(value: unknown): HubFile {
  const raw = (value ?? {}) as Partial<HubFile>;
  const settings = raw.settings ?? defaultHubSettings;
  const port = Number.isInteger(settings.port) && settings.port > 0 && settings.port < 65536 ? settings.port : defaultHubSettings.port;
  const devices = Array.isArray(raw.devices) ? raw.devices.filter((device) => typeof device?.id === 'string' && typeof device.key === 'string' && typeof device.name === 'string' && isHubScope(device.scope)) : [];
  const hubKey = typeof raw.hubKey?.publicKey === 'string' && typeof raw.hubKey.privateKey === 'string' ? raw.hubKey : null;
  return { settings: { port, isEnabled: settings.isEnabled === true }, devices, hubKey };
}

// Paired phones and this computer's hub key. Without secure storage the key is never written to
// disk, so it changes at every start and pairings last only until OpenTerm5 quits.
export class HubDevices {
  private offer: PairingOffer | null = null;
  private keys?: HubKeyPair;
  private file: HubFile = emptyHubFile();

  constructor(private readonly store: HubFileStore, private readonly cipher: PasswordCipher, private readonly crypto: HubCrypto, private readonly now: () => number = Date.now) {}

  get isPersistent(): boolean { return this.cipher.canEncrypt(); }
  get settings(): HubSettings { return this.file.settings; }
  get devices(): readonly HubDevice[] { return this.file.devices; }

  get keyPair(): HubKeyPair {
    if (!this.keys) throw new Error('The hub key has not been loaded');
    return this.keys;
  }

  async init(): Promise<void> {
    const loaded = await this.store.load();
    if (loaded.hubKey && this.isPersistent) {
      try {
        this.keys = { publicKey: fromBase64Url(loaded.hubKey.publicKey), privateKey: fromBase64Url(this.cipher.decrypt(loaded.hubKey.privateKey)) };
        this.file = loaded;
        return;
      } catch { /* an unreadable key means every pairing is void: start over */ }
    }
    this.keys = await this.crypto.generateKeyPair();
    this.file = { settings: loaded.settings, devices: [], hubKey: null };
    await this.persist();
  }

  async saveSettings(settings: HubSettings): Promise<void> {
    this.file = { ...this.file, settings };
    await this.persist();
  }

  createOffer(scope: HubScope, name: string, addresses: readonly string[]): HubPairingPayload & { expiresAt: number } {
    if (this.file.devices.length >= MAX_DEVICES) throw new Error(`Remove a device first: at most ${MAX_DEVICES} can be paired.`);
    const token = this.crypto.random(16);
    const expiresAt = this.now() + OFFER_MS;
    this.offer = { scope, token, expiresAt, failures: 0 };
    return { v: 1, key: toBase64Url(this.keyPair.publicKey), name, token: toBase64Url(token), scope, addresses, expiresAt };
  }

  activeOffer(): { scope: HubScope; token: Uint8Array; expiresAt: number } | null {
    if (this.offer && this.offer.expiresAt <= this.now()) this.offer = null;
    return this.offer;
  }

  cancelOffer(): void {
    this.offer = null;
  }

  // A pairing hello whose keys did not match means someone is guessing; the code stops working soon.
  failOffer(): void {
    if (this.offer && ++this.offer.failures >= MAX_OFFER_FAILURES) this.offer = null;
  }

  find(key: Uint8Array): HubDevice | undefined {
    return this.file.devices.find((device) => bytesEqual(fromBase64Url(device.key), key));
  }

  get(id: string): HubDevice | undefined {
    return this.file.devices.find((device) => device.id === id);
  }

  async pair(key: Uint8Array, name: string): Promise<HubDevice> {
    const offer = this.activeOffer();
    if (!offer) throw new Error('The pairing code has expired');
    this.offer = null;
    const existing = this.find(key);
    const device: HubDevice = { id: existing?.id ?? randomUUID(), key: toBase64Url(key), name: cleanName(name), scope: offer.scope, pairedAt: this.now(), lastSeenAt: this.now() };
    this.file = { ...this.file, devices: [...this.file.devices.filter((item) => item.id !== device.id), device] };
    await this.persist();
    return device;
  }

  async touch(id: string): Promise<void> {
    this.update(id, { lastSeenAt: this.now() });
    await this.persist();
  }

  async setScope(id: string, scope: HubScope): Promise<void> {
    if (!this.get(id)) throw new Error('That device is no longer paired');
    this.update(id, { scope });
    await this.persist();
  }

  async revoke(id: string): Promise<void> {
    this.file = { ...this.file, devices: this.file.devices.filter((device) => device.id !== id) };
    await this.persist();
  }

  private update(id: string, patch: Partial<HubDevice>): void {
    this.file = { ...this.file, devices: this.file.devices.map((device) => device.id === id ? { ...device, ...patch } : device) };
  }

  private persist(): Promise<void> {
    if (!this.isPersistent) return this.store.save({ settings: this.file.settings, devices: [], hubKey: null });
    const hubKey = { publicKey: toBase64Url(this.keyPair.publicKey), privateKey: this.cipher.encrypt(toBase64Url(this.keyPair.privateKey)) };
    return this.store.save({ ...this.file, hubKey });
  }
}

function cleanName(name: string): string {
  const text = name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
  return text || 'Phone';
}
