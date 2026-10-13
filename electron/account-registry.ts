import type { Account, AccountProfile } from '../shared/protocol';
import { parseSettings } from './connection-settings';

interface StoredProfile extends Omit<AccountProfile, 'hasPassword' | 'isPasswordSaved'> {
  readonly encryptedPassword?: string;
}

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
      const { webEndpoint } = parseSettings(item);
      if (!Number.isSafeInteger(login) || login <= 0 || !['demo', 'real', 'contest'].includes(tradeMode) ||
        ![name, label, server, company].every((field) => typeof field === 'string' && field.length <= 512) ||
        !Number.isFinite(lastUsed) || (encryptedPassword !== undefined && typeof encryptedPassword !== 'string')) {
        throw new Error('Invalid saved account.');
      }
      return { id: this.key(webEndpoint, login), login, name, label, server, company, webEndpoint, tradeMode, lastUsed, ...(encryptedPassword ? { encryptedPassword } : {}) };
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
      id, name: account.name, label: label?.trim() || existing?.label || `${account.company} ${account.login}`,
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

  // Keeps a password in memory for background sessions (copier, webhooks) without
  // persisting it; saving remains an explicit choice made at login.
  unlock(id: string, password: string): void {
    this.get(id);
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
}
