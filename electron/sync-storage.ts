import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { PasswordCipher } from './account-registry';
import type { GitHubTokens } from './github-auth';
import type { RepositoryInfo } from './github-remote';
import { isDeviceId } from './sync-clock';
import { open, seal, type DeviceKeyPair } from './sync-crypto';
import type { SyncState, SyncStateStore } from './sync-engine';
import { JsonStore } from './json-store';

const MAX_STATE_BYTES = 256 * 1024 * 1024;

// Where this computer's sync lives: a GitHub repository, or a sync file for people without GitHub.
export type SyncTarget =
  | { readonly kind: 'github'; readonly repository: RepositoryInfo }
  | { readonly kind: 'file'; readonly path: string; readonly groupId: number };

export interface SyncCredentials {
  readonly epoch: number;
  readonly deviceId: string;
  readonly login: string | null;
  readonly rootKey: Buffer | null;
  readonly tokens: GitHubTokens | null;
  readonly deviceKeys: DeviceKeyPair | null;
  readonly target: SyncTarget | null;
  readonly isRecoveryConfirmed: boolean;
  // This computer's opt-ins: saved passwords, API keys and webhook secrets; one CID for all.
  readonly isSecretsSynced: boolean;
  readonly isIdentitySynced: boolean;
  // Set when turning on one CID chose the synced one: this computer offers none until it arrives.
  readonly isIdentityAdopting: boolean;
  // A first join into synced content: 'ask' until the user chooses, then the choice until a
  // sync with it succeeds, so a restart in between neither skips the question nor the choice.
  readonly pendingJoin: PendingJoin | null;
}

export type PendingJoin = 'ask' | 'merge' | 'useSynced';

const pendingJoins: readonly PendingJoin[] = ['ask', 'merge', 'useSynced'];

interface StoredCredentials {
  readonly epoch: number;
  readonly deviceId: string;
  readonly login: string | null;
  readonly secrets: string | null;
  readonly target: SyncTarget | null;
  readonly isRecoveryConfirmed: boolean;
  readonly isSecretsSynced: boolean;
  readonly isIdentitySynced: boolean;
  readonly isIdentityAdopting: boolean;
  readonly pendingJoin: PendingJoin | null;
}

interface Secrets {
  readonly rootKey: string | null;
  readonly tokens: GitHubTokens | null;
  readonly deviceKeys: DeviceKeyPair | null;
}

const newDeviceId = () => randomBytes(8).toString('hex');

function parseTarget(value: unknown): SyncTarget | null {
  const target = (value ?? {}) as Record<string, unknown>;
  const repository = (target.repository ?? {}) as Partial<RepositoryInfo>;
  if (target.kind === 'github' && Number.isSafeInteger(repository.id) && typeof repository.fullName === 'string' && typeof repository.branch === 'string') {
    return { kind: 'github', repository: { id: repository.id!, fullName: repository.fullName, branch: repository.branch, isPrivate: repository.isPrivate === true } };
  }
  if (target.kind === 'file' && typeof target.path === 'string' && Number.isSafeInteger(target.groupId)) return { kind: 'file', path: target.path, groupId: target.groupId as number };
  return null;
}

function parseStored(value: unknown): StoredCredentials {
  const stored = (value ?? {}) as Partial<StoredCredentials>;
  return {
    epoch: Number.isSafeInteger(stored.epoch) && stored.epoch! >= 1 ? stored.epoch! : 1,
    deviceId: isDeviceId(stored.deviceId) ? stored.deviceId : newDeviceId(),
    login: typeof stored.login === 'string' ? stored.login : null,
    secrets: typeof stored.secrets === 'string' ? stored.secrets : null,
    target: parseTarget(stored.target),
    isRecoveryConfirmed: stored.isRecoveryConfirmed !== false,
    isSecretsSynced: stored.isSecretsSynced === true,
    isIdentitySynced: stored.isIdentitySynced === true,
    isIdentityAdopting: stored.isIdentityAdopting === true,
    pendingJoin: pendingJoins.find((join) => join === stored.pendingJoin) ?? null,
  };
}

// The sync key, this computer's private key and the GitHub tokens are kept only through the OS
// keychain. Where it cannot encrypt (Linux without a keyring), they stay in memory for this run.
export class CredentialStore {
  private current: SyncCredentials | null = null;
  private readonly store: JsonStore<StoredCredentials>;

  constructor(file: string, private readonly cipher: PasswordCipher, private readonly journal: (message: string) => void = () => undefined) {
    this.store = new JsonStore(file, parseStored, () => parseStored(null));
  }

  get canKeepSecrets(): boolean {
    return this.cipher.canEncrypt();
  }

  async load(): Promise<SyncCredentials> {
    let stored: StoredCredentials;
    try { stored = await this.store.load(); }
    catch (error) {
      this.journal(`${(error as Error).message}. Sync starts over.`);
      stored = parseStored(null);
    }
    let secrets: Secrets = { rootKey: null, tokens: null, deviceKeys: null };
    if (stored.secrets && this.cipher.canEncrypt()) {
      try { secrets = JSON.parse(this.cipher.decrypt(stored.secrets)) as Secrets; }
      catch { this.journal('The sync key could not be read from the system keychain. Connect sync again.'); }
    }
    const { secrets: _sealed, ...rest } = stored;
    this.current = { ...rest, rootKey: secrets.rootKey ? Buffer.from(secrets.rootKey, 'base64') : null, tokens: secrets.tokens, deviceKeys: secrets.deviceKeys };
    if (!stored.secrets) await this.write(this.current);
    return this.current;
  }

  get(): SyncCredentials {
    if (!this.current) throw new Error('Sync credentials have not been loaded.');
    return this.current;
  }

  async update(change: Partial<SyncCredentials>): Promise<SyncCredentials> {
    this.current = { ...this.get(), ...change };
    await this.write(this.current);
    return this.current;
  }

  // Forgets everything but this computer's id, so it stays one device to the repository.
  async clear(): Promise<SyncCredentials> {
    const { deviceId } = this.get();
    this.current = {
      epoch: 1, deviceId, login: null, rootKey: null, tokens: null, deviceKeys: null, target: null, isRecoveryConfirmed: true,
      isSecretsSynced: false, isIdentitySynced: false, isIdentityAdopting: false, pendingJoin: null,
    };
    await this.write(this.current);
    return this.current;
  }

  private write(credentials: SyncCredentials): Promise<void> {
    const { rootKey, tokens, deviceKeys, ...rest } = credentials;
    const secrets: Secrets = { rootKey: rootKey?.toString('base64') ?? null, tokens, deviceKeys };
    const isEmpty = !rootKey && !tokens && !deviceKeys;
    return this.store.save({ ...rest, secrets: isEmpty || !this.cipher.canEncrypt() ? null : this.cipher.encrypt(JSON.stringify(secrets)) });
  }
}

// The engine's state holds merge bases, secrets included, so it is sealed with the state key.
// An unreadable file (another key, damage) starts the state over, which a sync then rebuilds.
export class EncryptedStateStore implements SyncStateStore {
  private readonly store: JsonStore<string | null>;

  constructor(private readonly file: string, private readonly key: Buffer, private readonly context: { readonly epoch: number; readonly repoId: number }) {
    this.store = new JsonStore(file, (value) => typeof value === 'string' ? value : null, () => null);
  }

  async load(): Promise<SyncState | null> {
    const sealed = await this.store.load().catch(() => null);
    if (!sealed) return null;
    try { return JSON.parse(open(this.key, Buffer.from(sealed, 'base64'), { purpose: 'state', ...this.context }, MAX_STATE_BYTES).toString('utf8')) as SyncState; }
    catch { return null; }
  }

  save(state: SyncState): Promise<void> {
    return this.store.save(seal(this.key, Buffer.from(JSON.stringify(state)), { purpose: 'state', ...this.context }).toString('base64'));
  }

  async remove(): Promise<void> {
    await fs.rm(this.file, { force: true });
  }
}
