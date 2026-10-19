import { bybitEnvironment, bybitEnvironments, type Account, type AccountProfile, type BybitEnvironment, type Platform } from '../shared/protocol';
import { parseSettings } from './connection-settings';
import type { SessionCredentials } from './session-pool';

interface StoredProfile extends Omit<AccountProfile, 'hasPassword' | 'isPasswordSaved'> {
  readonly encryptedPassword?: string;
}

export const exchangeAccountId = (environment: BybitEnvironment, login: number) => `bybit:${environment}|${login}`;

export const platformOf = (accountId: string): Platform => accountId.startsWith('bybit:') ? 'bybit' : 'mt5';

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
    const profiles = value.map((item): StoredProfile => {
      if (!item || typeof item !== 'object') throw new Error('Invalid saved account.');
      const { login, name, label, server, company, tradeMode, lastUsed, encryptedPassword } = item;
      const platform = item.platform ?? 'mt5';
      if (platform !== 'mt5' && platform !== 'bybit') throw new Error('Invalid saved account.');
      const webEndpoint = platform === 'mt5' ? parseSettings(item).webEndpoint : this.environmentOf(item.webEndpoint).restUrl;
      if (!Number.isSafeInteger(login) || login <= 0 || !['demo', 'real', 'contest'].includes(tradeMode) ||
        ![name, label, server, company].every((field) => typeof field === 'string' && field.length <= 512) ||
        !Number.isFinite(lastUsed) || (encryptedPassword !== undefined && typeof encryptedPassword !== 'string')) {
        throw new Error('Invalid saved account.');
      }
      const id = platform === 'mt5' ? this.key(webEndpoint, login) : this.exchangeKey(this.environmentOf(webEndpoint).key, login);
      return { id, platform, login, name, label, server, company, webEndpoint, tradeMode, lastUsed, ...(encryptedPassword ? { encryptedPassword } : {}) };
    });
    if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) throw new Error('Duplicate saved accounts.');
    this.profiles = profiles;
  }

  canSavePasswords(): boolean { return this.cipher.canEncrypt(); }

  list(): AccountProfile[] {
    return this.profiles.map(({ encryptedPassword, ...profile }) => ({
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
      ...(isPasswordSaved ? { encryptedPassword: this.cipher.encrypt(password) } : {}),
    };
    const profiles = [...this.profiles.filter((item) => item.id !== id), profile];
    await this.persist(profiles);
    this.profiles = profiles;
    this.passwords.set(id, password);
    return this.get(id);
  }

  // The API key and secret are kept together as the profile's secret, under the same storage
  // rules as an MT5 password.
  async rememberExchange(account: Account, environment: BybitEnvironment, key: { apiKey: string; apiSecret: string }, label?: string, isPasswordSaved = false): Promise<AccountProfile> {
    const { restUrl, key: environmentKey } = this.environmentOf(bybitEnvironment(environment)?.restUrl);
    const id = this.exchangeKey(environmentKey, account.login);
    if (isPasswordSaved && !this.cipher.canEncrypt()) throw new Error('Secure storage is unavailable. The API secret was not saved.');
    const secret = JSON.stringify({ apiKey: key.apiKey, apiSecret: key.apiSecret });
    const existing = this.profiles.find((profile) => profile.id === id);
    const profile: StoredProfile = {
      id, platform: 'bybit', name: account.name, label: label?.trim() || existing?.label || `${account.server} ${account.login}`,
      server: account.server, company: account.company, webEndpoint: restUrl, tradeMode: account.tradeMode,
      login: account.login, lastUsed: Date.now(),
      ...(isPasswordSaved ? { encryptedPassword: this.cipher.encrypt(secret) } : {}),
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
    if (profile.platform === 'mt5') return { platform: 'mt5', login: profile.login, password: secret, endpoint: profile.webEndpoint };
    const { apiKey, apiSecret } = JSON.parse(secret) as { apiKey: string; apiSecret: string };
    return { platform: 'bybit', environment: this.environmentOf(profile.webEndpoint).key, apiKey, apiSecret };
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

  private exchangeKey(environment: BybitEnvironment, login: number): string { return exchangeAccountId(environment, login); }

  private environmentOf(restUrl: unknown) {
    const environment = bybitEnvironments.find((item) => item.restUrl === restUrl);
    if (!environment) throw new Error('Invalid saved account.');
    return environment;
  }
}
