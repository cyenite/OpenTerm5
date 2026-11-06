import { exchangeEnvironment, exchangeEnvironments, isExchangePlatform, platforms, type Account, type AccountProfile, type ExchangeCredentials, type ExchangeEnvironmentInfo, type ExchangePlatform, type Platform } from '../shared/protocol';
import { parseSettings } from './connection-settings';
import type { SessionCredentials } from './session-pool';

interface StoredProfile extends Omit<AccountProfile, 'hasPassword' | 'isPasswordSaved'> {
  readonly encryptedPassword?: string;
  // When the saved secret last changed, so the newest password wins between computers.
  readonly secretSavedAt?: number;
}

// A profile as it syncs: everything but the secret, which syncs apart behind its own opt-in.
export type SyncedProfile = Omit<StoredProfile, 'id' | 'encryptedPassword' | 'secretSavedAt'>;

export interface SyncedSecret {
  readonly secret: string;
  readonly savedAt: number;
}

export interface ProfileChange<T> {
  readonly upserts: Readonly<Record<string, T>>;
  readonly deletes: readonly string[];
}

const MAX_SECRET_LENGTH = 8192;

export const exchangeAccountId = (platform: ExchangePlatform, environment: string, login: number) => `${platform}:${environment}|${login}`;

export const platformOf = (accountId: string): Platform => platforms.find((item) => item.key !== 'mt5' && accountId.startsWith(`${item.key}:`))?.key ?? 'mt5';

export interface PasswordCipher {
  canEncrypt(): boolean;
  encrypt(value: string): string;
  decrypt(value: string): string;
}

export class AccountRegistry {
  private profiles: StoredProfile[] = [];
  private readonly passwords = new Map<string, string>();

  constructor(private readonly cipher: PasswordCipher, private readonly persist: (profiles: readonly StoredProfile[]) => Promise<void>) {}

  load(value: unknown): void {
    if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid saved accounts.');
    const profiles = value.map((item) => this.parseProfile(item));
    if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new Error('Duplicate saved accounts.');
    this.profiles = profiles;
  }

  // The id is derived from the fields, never read, so a profile cannot claim another's id.
  private parseProfile(item: unknown): StoredProfile {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid saved account.');
    const { login, name, label, server, company, tradeMode, lastUsed, encryptedPassword, secretSavedAt, ...rest } = item as Record<string, unknown>;
    const platform = platforms.find((candidate) => candidate.key === (rest.platform ?? 'mt5'))?.key;
    if (!platform) throw new Error('Invalid saved account.');
    const webEndpoint = isExchangePlatform(platform) ? this.environmentOf(platform, rest.webEndpoint).restUrl : parseSettings(item as { webEndpoint?: string }).webEndpoint;
    if (!Number.isSafeInteger(login) || (login as number) <= 0 || !['demo', 'real', 'contest'].includes(tradeMode as string) ||
      ![name, label, server, company].every((field) => typeof field === 'string' && field.length <= 512) ||
      !Number.isFinite(lastUsed) || (encryptedPassword !== undefined && typeof encryptedPassword !== 'string') ||
      (secretSavedAt !== undefined && !(Number.isFinite(secretSavedAt) && (secretSavedAt as number) >= 0))) {
      throw new Error('Invalid saved account.');
    }
    const id = isExchangePlatform(platform) ? exchangeAccountId(platform, this.environmentOf(platform, webEndpoint).key, login as number) : this.key(webEndpoint, login as number);
    return {
      id, platform, login: login as number, name: name as string, label: label as string, server: server as string, company: company as string, webEndpoint,
      tradeMode: tradeMode as AccountProfile['tradeMode'], lastUsed: lastUsed as number,
      ...(encryptedPassword ? { encryptedPassword: encryptedPassword as string, ...(secretSavedAt !== undefined ? { secretSavedAt: secretSavedAt as number } : {}) } : {}),
    };
  }

  // Keeps the saved time of a secret that did not change, so logging in again does not make an
  // old password look like the newest one.
  private secretFields(existing: StoredProfile | undefined, secret: string): Pick<StoredProfile, 'encryptedPassword' | 'secretSavedAt'> {
    const isSame = !!existing?.encryptedPassword && this.tryDecrypt(existing.encryptedPassword) === secret;
    return { encryptedPassword: this.cipher.encrypt(secret), secretSavedAt: isSame ? existing!.secretSavedAt ?? 0 : Date.now() };
  }

  private tryDecrypt(value: string): string | null {
    try { return this.cipher.decrypt(value); } catch { return null; }
  }

  syncedProfiles(): Record<string, SyncedProfile> {
    return Object.fromEntries(this.profiles.map(({ id, encryptedPassword, secretSavedAt, ...profile }) => [id, profile]));
  }

  checkSyncedProfile(id: string, value: unknown): void {
    if (this.parseProfile(value).id !== id) throw new Error('The account does not match its id.');
  }

  // Applies profiles from other computers. A profile keeps this computer's saved secret, and the
  // most recent use of either side.
  async applySyncedProfiles(change: ProfileChange<unknown>): Promise<void> {
    const removed = new Set(change.deletes);
    const profiles = this.profiles.filter((profile) => !removed.has(profile.id));
    for (const [id, value] of Object.entries(change.upserts)) {
      const { encryptedPassword, secretSavedAt, ...parsed } = this.parseProfile(value);
      if (parsed.id !== id) throw new Error('The account does not match its id.');
      const index = profiles.findIndex((profile) => profile.id === id);
      const existing = profiles[index];
      const profile: StoredProfile = existing
        ? { ...parsed, lastUsed: Math.max(parsed.lastUsed, existing.lastUsed), ...(existing.encryptedPassword ? { encryptedPassword: existing.encryptedPassword, secretSavedAt: existing.secretSavedAt } : {}) }
        : parsed;
      if (index < 0) profiles.push(profile);
      else profiles[index] = profile;
    }
    await this.persist(profiles);
    this.profiles = profiles;
    for (const id of removed) this.passwords.delete(id);
  }

  // Saved secrets in plain text, for sync to encrypt under its own key. One that no longer
  // decrypts here is listed as unreadable, so it is left alone rather than read as removed.
  syncedSecrets(): Record<string, SyncedSecret | { readonly isUnreadable: true }> {
    return Object.fromEntries(this.profiles.flatMap(({ id, encryptedPassword, secretSavedAt }) => {
      if (!encryptedPassword) return [];
      const secret = this.tryDecrypt(encryptedPassword);
      return [[id, secret === null ? { isUnreadable: true } as const : { secret, savedAt: secretSavedAt ?? 0 }]];
    }));
  }

  // A secret applies only to a profile already here (profiles sync first), and an exchange
  // secret must hold an API key and secret.
  checkSyncedSecret(id: string, value: unknown): void {
    const { secret, savedAt } = (value ?? {}) as Partial<SyncedSecret>;
    const profile = this.profiles.find((candidate) => candidate.id === id);
    if (!profile) throw new Error('The secret belongs to an account this computer does not have yet.');
    if (typeof secret !== 'string' || !secret || secret.length > MAX_SECRET_LENGTH || !Number.isFinite(savedAt) || savedAt! < 0) throw new Error('Invalid synced secret.');
    if (!isExchangePlatform(profile.platform)) return;
    const parsed = (() => { try { return JSON.parse(secret) as unknown; } catch { return null; } })() as { apiKey?: unknown; apiSecret?: unknown } | null;
    if (typeof parsed?.apiKey !== 'string' || typeof parsed.apiSecret !== 'string' || !parsed.apiKey || !parsed.apiSecret) throw new Error('Invalid synced API key.');
  }

  // A secret saved here more recently than the synced one is kept; sync then sends it out, so
  // every computer ends with the newest password.
  async applySyncedSecrets(change: ProfileChange<unknown>): Promise<void> {
    if (!this.cipher.canEncrypt()) throw new Error('Secure storage is unavailable, so synced passwords cannot be kept here.');
    const removed = new Set(change.deletes);
    const profiles = this.profiles.map((profile): StoredProfile => {
      const value = change.upserts[profile.id];
      if (value !== undefined) {
        this.checkSyncedSecret(profile.id, value);
        const { secret, savedAt } = value as SyncedSecret;
        const isLocalNewer = !!profile.encryptedPassword && (profile.secretSavedAt ?? 0) > savedAt && this.tryDecrypt(profile.encryptedPassword) !== null;
        return isLocalNewer ? profile : { ...profile, encryptedPassword: this.cipher.encrypt(secret), secretSavedAt: savedAt };
      }
      if (!removed.has(profile.id) || !profile.encryptedPassword) return profile;
      const { encryptedPassword, secretSavedAt, ...rest } = profile;
      return rest;
    });
    await this.persist(profiles);
    this.profiles = profiles;
    for (const profile of profiles) {
      if (change.upserts[profile.id] !== undefined && profile.encryptedPassword) this.passwords.set(profile.id, this.cipher.decrypt(profile.encryptedPassword));
      if (removed.has(profile.id)) this.passwords.delete(profile.id);
    }
  }

  canSavePasswords(): boolean { return this.cipher.canEncrypt(); }

  list(): AccountProfile[] {
    return this.profiles.map(({ encryptedPassword, secretSavedAt, ...profile }) => ({
      ...profile, hasPassword: this.passwords.has(profile.id) || !!encryptedPassword && this.cipher.canEncrypt(),
      isPasswordSaved: !!encryptedPassword,
    })).sort((left, right) => right.lastUsed - left.lastUsed);
  }

  get(id: string): AccountProfile {
    const profile = this.list().find((item) => item.id === id);
    if (!profile) throw new Error('Saved account no longer exists.');
    return profile;
  }

  password(id: string): string | undefined {
    this.get(id);
    if (this.passwords.has(id)) return this.passwords.get(id);
    const profile = this.profiles.find((item) => item.id === id)!;
    if (!profile.encryptedPassword) return undefined;
    if (!this.cipher.canEncrypt()) throw new Error('Secure password storage is unavailable. Enter your password again.');
    try { return this.cipher.decrypt(profile.encryptedPassword); }
    catch { throw new Error('Saved password cannot be decrypted. Enter your password again.'); }
  }

  async remember(account: Account, endpoint: string, password: string, label?: string, isPasswordSaved = false): Promise<AccountProfile> {
    const { webEndpoint } = parseSettings({ webEndpoint: endpoint });
    const id = this.key(webEndpoint, account.login);
    if (isPasswordSaved && !this.cipher.canEncrypt()) throw new Error('Secure password storage is unavailable. The password was not saved.');
    const existing = this.profiles.find((profile) => profile.id === id);
    const profile: StoredProfile = {
      id, platform: 'mt5', name: account.name, label: label?.trim() || existing?.label || `${account.company} ${account.login}`,
      server: account.server, company: account.company, webEndpoint, tradeMode: account.tradeMode,
      login: account.login, lastUsed: Date.now(),
      ...(isPasswordSaved ? this.secretFields(existing, password) : {}),
    };
    const profiles = [...this.profiles.filter((item) => item.id !== id), profile];
    await this.persist(profiles);
    this.profiles = profiles;
    this.passwords.set(id, password);
    return this.get(id);
  }

  // The API key and secret are kept together as the profile's secret, under the same storage
  // rules as an MT5 password.
  async rememberExchange(account: Account, credentials: ExchangeCredentials, label?: string, isPasswordSaved = false): Promise<AccountProfile> {
    const { platform } = credentials;
    const { restUrl, key: environmentKey } = this.environmentOf(platform, exchangeEnvironment(platform, credentials.environment)?.restUrl);
    const id = exchangeAccountId(platform, environmentKey, account.login);
    if (isPasswordSaved && !this.cipher.canEncrypt()) throw new Error('Secure storage is unavailable. The API secret was not saved.');
    const secret = JSON.stringify({ apiKey: credentials.apiKey, apiSecret: credentials.apiSecret });
    const existing = this.profiles.find((profile) => profile.id === id);
    const profile: StoredProfile = {
      id, platform, name: account.name, label: label?.trim() || existing?.label || `${account.server} ${account.login}`,
      server: account.server, company: account.company, webEndpoint: restUrl, tradeMode: account.tradeMode,
      login: account.login, lastUsed: Date.now(),
      ...(isPasswordSaved ? this.secretFields(existing, secret) : {}),
    };
    const profiles = [...this.profiles.filter((item) => item.id !== id), profile];
    await this.persist(profiles);
    this.profiles = profiles;
    this.passwords.set(id, secret);
    return this.get(id);
  }

  credentials(id: string): SessionCredentials | undefined {
    const profile = this.get(id);
    const secret = this.password(id);
    if (!secret) return undefined;
    if (!isExchangePlatform(profile.platform)) return { platform: 'mt5', login: profile.login, password: secret, endpoint: profile.webEndpoint };
    const { apiKey, apiSecret } = JSON.parse(secret) as { apiKey: string; apiSecret: string };
    return { platform: profile.platform, environment: this.environmentOf(profile.platform, profile.webEndpoint).key, apiKey, apiSecret } as ExchangeCredentials;
  }

  // Keeps a password in memory for background sessions (copier, webhooks) without
  // persisting it; saving remains an explicit choice made at login.
  unlock(id: string, password: string): void {
    if (this.get(id).platform !== 'mt5') throw new Error('Connect this exchange account once from Trading Accounts to enter its API key.');
    if (!password) throw new Error('Enter the account password.');
    this.passwords.set(id, password);
  }

  async remove(id: string): Promise<void> {
    this.get(id);
    const profiles = this.profiles.filter((profile) => profile.id !== id);
    await this.persist(profiles);
    this.profiles = profiles;
    this.passwords.delete(id);
  }

  private key(endpoint: string, login: number): string { return `${endpoint}|${login}`; }

  private environmentOf(platform: ExchangePlatform, restUrl: unknown): ExchangeEnvironmentInfo {
    const environment = (exchangeEnvironments[platform] as readonly ExchangeEnvironmentInfo[]).find((item) => item.restUrl === restUrl);
    if (!environment) throw new Error('Invalid saved account.');
    return environment;
  }
}
