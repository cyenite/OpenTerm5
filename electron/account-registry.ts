import { exchangeEnvironment, exchangeEnvironments, isExchangePlatform, platforms, type Account, type AccountProfile, type ExchangeCredentials, type ExchangeEnvironmentInfo, type ExchangePlatform, type Platform } from '../shared/protocol';
import { parseSettings } from './connection-settings';
import type { SessionCredentials } from './session-pool';

interface StoredProfile extends Omit<AccountProfile, 'hasPassword' | 'isPasswordSaved'> {
  readonly encryptedPassword?: string;
}

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
    const profiles = value.map((item): StoredProfile => {
      if (!item || typeof item !== 'object') throw new Error('Invalid saved account.');
      const { login, name, label, server, company, tradeMode, lastUsed, encryptedPassword } = item;
      const platform = platforms.find((candidate) => candidate.key === (item.platform ?? 'mt5'))?.key;
      if (!platform) throw new Error('Invalid saved account.');
      const webEndpoint = isExchangePlatform(platform) ? this.environmentOf(platform, item.webEndpoint).restUrl : parseSettings(item).webEndpoint;
      if (!Number.isSafeInteger(login) || login <= 0 || !['demo', 'real', 'contest'].includes(tradeMode) ||
        ![name, label, server, company].every((field) => typeof field === 'string' && field.length <= 512) ||
        !Number.isFinite(lastUsed) || (encryptedPassword !== undefined && typeof encryptedPassword !== 'string')) {
        throw new Error('Invalid saved account.');
      }
      const id = isExchangePlatform(platform) ? exchangeAccountId(platform, this.environmentOf(platform, webEndpoint).key, login) : this.key(webEndpoint, login);
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
