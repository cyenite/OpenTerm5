import { randomInt } from 'node:crypto';
import path from 'node:path';
import {
  isSameJson, normalizeCodeGroup, passphraseProblem, recordKey, rendererSyncKinds, splitRecordKey, syncKindInfo, type SyncSharing, type SyncAttention, type SyncAttentionReason, type SyncDeviceView, type SyncMassChange, type SyncMethod, type SyncMethods,
  type SyncPage, type SyncPairingRequest, type SyncPhase, type SyncRepositoryChoice, type SyncResolution, type SyncStatus, type SyncView,
} from '../shared/sync';
import type { PasswordCipher } from './account-registry';
import { FileRemote, SyncFileDamagedError, SyncFileUnavailableError } from './file-remote';
import { GITHUB_APP_SLUG, GITHUB_WEB, GitHubAuth, GitHubAuthError, type DeviceCode, type Fetch } from './github-auth';
import { GitHubApi, GitHubNetworkError, GitHubRateLimitError, GitHubRemote, GitHubRequestError } from './github-remote';
import { deriveKeys, newDeviceKeyPair, SyncCryptoError } from './sync-crypto';
import { SyncEngine, SyncSourceUnavailableError, type SyncOptions, type SyncRemote, type SyncSource } from './sync-engine';
import {
  answerPairing, FORMAT_PATH, inspectRepository, newKeyring, PAIRING_LIFETIME_MS, pairingConfirmation, pairingWords, requestPairing, SyncSetupError, unlockKeyring, updateKeyring, withDeviceWrap,
  withNewRecovery, type RepositorySetup,
} from './sync-keyring';
import { IDENTITY_ID } from './sync-main-sources';
import {
  HANDOFF_LIFETIME_MS, isPresenceDue, liveHandoffs, MANIFEST_PATH, openManifest, presentElsewhere, SyncIntegrityError, withPresence, type Manifest,
} from './sync-manifest';
import { realTimers, SyncScheduler, type RunResult, type Timers } from './sync-scheduler';
import { CredentialStore, EncryptedStateStore, type PendingJoin, type SyncTarget } from './sync-storage';

const REPOSITORY_CHECK_MS = 3_600_000;
const PAIRING_POLL_MS = 5000;
const PAIRING_ATTEMPTS = 3;
const CODE_GROUPS = 7;
// A sync file has no repository id, so it gets a random one that binds its data the same way.
const MAX_GROUP_ID = 2 ** 47;
const PRESENCE_DELAY_MS = 2000;
const PEEK_TIMEOUT_MS = 5000;
const HANDOFF_POLL_MS = 3000;
const HANDOFF_POLLS = 20;

// An account with a live session here, and since when (local time). Background sessions report
// Infinity: they are not handed over until copiers and signals have leases.
export interface LiveAccount {
  readonly id: string;
  readonly since: number;
}

export interface SyncServiceDeps {
  readonly dir: string;
  readonly fetch: Fetch;
  readonly cipher: PasswordCipher;
  readonly platform: string;
  readonly appVersion: string;
  readonly deviceName: string;
  readonly send: (view: SyncView) => void;
  readonly journal: (message: string) => void;
  readonly openExternal: (url: string) => Promise<void>;
  readonly revealFile?: (file: string) => void;
  readonly chooseFile?: (mode: 'new' | 'open') => Promise<string | null>;
  readonly sources?: () => readonly SyncSource[];
  readonly liveAccounts?: () => readonly LiveAccount[];
  // Another computer moved these accounts to itself: log out of them here.
  readonly releaseAccounts?: (accountIds: readonly string[], to: string) => Promise<void>;
  readonly now?: () => number;
  readonly timers?: Timers;
  readonly pause?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly passphraseCost?: { readonly N: number; readonly r: number; readonly p: number };
}

const heldMessage = (changes: readonly SyncMassChange[]) => changes.some((change) => change.side === 'local')
  ? 'Much of the data on this computer would be deleted from every computer. Choose whether to delete it everywhere or restore it from sync.'
  : 'Another computer deleted much of the synced data. Choose whether to delete it here too.';

const joinMessage = 'This computer has layouts, drawings and lists of its own, and the synced data has some too. Merge adds this computer\'s to the synced ones on every computer; Use synced data replaces this computer\'s with the synced ones.';

// A joining computer's first merge: the synced value wins where both hold one. Use synced data
// replaces layouts and lists; saved accounts and their passwords always merge.
const joinOptions: Record<Exclude<PendingJoin, 'ask'>, SyncOptions> = {
  merge: { isRemotePreferred: true },
  useSynced: { isRemotePreferred: true, isLocalDiscarded: true, isMassChangeAllowed: true, discardedKinds: rendererSyncKinds },
};

const groupIdOf = (target: SyncTarget) => target.kind === 'github' ? target.repository.id : target.groupId;

const labelOf = (target: SyncTarget) => target.kind === 'github' ? target.repository.fullName : target.path;

export class SyncService {
  private phase: SyncPhase = 'off';
  private status: SyncStatus = 'idle';
  private error: string | null = null;
  private attention: SyncAttention | null = null;
  private userCode: string | null = null;
  private recoveryCode: string | null = null;
  private recoveryCheck: number[] = [];
  private conflicts = 0;
  private checkedAt = 0;
  private changedAt = 0;
  private pushedAt = 0;
  private pairingSince = 0;
  private lastSyncedAt: number | null = null;
  private choice: SyncTarget | null = null;
  private devices: SyncDeviceView[] = [];
  private pairingWords: string[] = [];
  private pairingRequests: SyncPairingRequest[] = [];
  private pairingConfirmation: string[] = [];
  private pairingAttempts = 0;
  private isIdentityChoiceNeeded = false;
  private presenceTimer: unknown = null;
  private hasPresence = false;
  private readonly answeredHandoffs = new Set<string>();
  // A key that arrived for this computer, held until the confirmation words prove it is the real one.
  private pairedKey: { readonly rootKey: Buffer; readonly epoch: number } | null = null;
  // The public key behind each request whose words were shown, so approval binds to what was checked.
  private shownRequests = new Map<string, string>();
  private repositories: SyncRepositoryChoice[] = [];
  private pairingTimer: unknown = null;
  private signIn: AbortController | null = null;
  private engine: SyncEngine | null = null;
  private stateStore: EncryptedStateStore | null = null;
  private verificationUri: string | null = null;
  private running: Promise<RunResult> | null = null;
  private readonly now: () => number;
  private readonly api: GitHubApi;
  private readonly auth: GitHubAuth;
  private readonly timers: Timers;
  private readonly scheduler: SyncScheduler;
  private readonly credentials: CredentialStore;

  constructor(private readonly deps: SyncServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.timers = deps.timers ?? realTimers;
    this.credentials = new CredentialStore(path.join(deps.dir, 'sync-credentials.json'), deps.cipher, deps.journal);
    this.auth = new GitHubAuth({
      fetch: deps.fetch, now: this.now, pause: deps.pause,
      load: () => this.credentials.get().tokens, save: async (tokens) => { await this.credentials.update({ tokens }); },
    });
    this.api = new GitHubApi(deps.fetch, () => this.auth.accessToken(), this.now);
    this.scheduler = new SyncScheduler({ stamp: () => this.stamp(), run: () => this.run({}), now: this.now, timers: this.timers });
  }

  async init(): Promise<void> {
    const { target, rootKey } = await this.credentials.load();
    if (target && rootKey) {
      this.phase = 'on';
      this.startEngine(target);
      if (target.kind === 'github' && !this.auth.isSignedIn) this.attend('reconnect', 'Reconnect GitHub to keep syncing.');
      else if (this.credentials.get().pendingJoin === 'ask') this.attend('join', joinMessage);
      else this.scheduler.start();
    } else if (target && (target.kind === 'file' || this.auth.isSignedIn)) {
      [this.choice, this.phase] = [target, 'joining'];
    } else if (this.auth.isSignedIn) {
      this.phase = 'choosingRepository';
      void this.loadRepositories().catch((error: Error) => { this.error = error.message; }).finally(() => this.emit());
    }
    this.emit();
  }

  shutdown(): void {
    this.scheduler.stop();
    this.timers.clear(this.presenceTimer);
    this.stopPairingPoll();
    this.signIn?.abort();
  }

  // Store adapters call this whenever their data changes.
  noteLocalChange(): void {
    this.changedAt = this.now();
    this.scheduler.localChange();
  }

  // A session started or ended here; presence is written shortly after, without the stores.
  presenceChanged(): void {
    if (!this.engine || this.presenceTimer) return;
    this.presenceTimer = this.timers.set(() => {
      this.presenceTimer = null;
      void this.writePresence();
    }, PRESENCE_DELAY_MS);
  }

  // Names of the other computers with a live session on the account, from the remote when it
  // answers in time, else from the last sync.
  async whereOpen(accountId: string): Promise<string[]> {
    const manifest = await this.currentManifest();
    if (!manifest || !this.engine) return [];
    const ids = presentElsewhere(manifest.presence, accountId, this.credentials.get().deviceId, this.engine.serverNow());
    return ids.map((id) => manifest.devices.find((device) => device.id === id)?.name || 'another computer');
  }

  // Asks the computers holding the account to log out of it, and waits a minute for them to.
  async moveHere(accountId: string): Promise<boolean> {
    const engine = this.engine;
    if (!engine) return true;
    const { deviceId } = this.credentials.get();
    const manifest = await this.currentManifest();
    const holders = manifest ? presentElsewhere(manifest.presence, accountId, deviceId, engine.serverNow()) : [];
    if (!holders.length) return true;
    await engine.editManifest((current, now) => ({
      ...current, handoffs: { ...liveHandoffs(current.handoffs, now), [accountId]: { from: deviceId, to: holders, createdAt: now, expiresAt: now + HANDOFF_LIFETIME_MS } },
    }));
    const pause = this.deps.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let poll = 0; poll < HANDOFF_POLLS; poll++) {
      await pause(HANDOFF_POLL_MS);
      const latest = await engine.peekManifest().catch(() => null);
      if (latest && !presentElsewhere(latest.presence, accountId, deviceId, engine.serverNow()).length) return true;
    }
    return false;
  }

  // At quit: edits pushed, and this computer no longer listed as holding any account.
  async leave(): Promise<void> {
    if (this.hasUnpushedChanges) await this.flush();
    if (this.hasPresence) await this.writePresence([]);
  }

  get isLeaveNeeded(): boolean {
    return this.hasUnpushedChanges || this.hasPresence;
  }

  get hasUnpushedChanges(): boolean {
    return !!this.engine && !this.attention && this.changedAt > 0 && this.changedAt >= this.pushedAt;
  }

  // At quit: stamp and push what is left. The caller bounds the wait.
  async flush(): Promise<void> {
    if (!this.engine || this.attention) return;
    this.scheduler.stop();
    await this.engine.recordLocalChanges().catch(() => undefined);
    // Closing the window on macOS leaves the app running, so syncing carries on afterwards.
    if ((await this.run({})).kind !== 'stop') this.scheduler.start();
  }

  setFocused(isFocused: boolean): void {
    this.scheduler.setFocused(isFocused);
  }

  wake(): void {
    this.scheduler.wake();
  }

  async handle<M extends SyncMethod>(method: M, params: SyncMethods[M][0]): Promise<SyncMethods[M][1]> {
    const run = async (): Promise<SyncMethods[SyncMethod][1]> => {
      if (method === 'sync.view') return this.view();
      if (method === 'sync.open') return this.open((params as SyncMethods['sync.open'][0]).page);
      this.error = null;
      if (method === 'sync.connect') await this.connect();
      else if (method === 'sync.cancel') await this.cancel();
      else if (method === 'sync.refreshRepositories') await this.loadRepositories();
      else if (method === 'sync.chooseRepository') await this.chooseRepository((params as SyncMethods['sync.chooseRepository'][0]).id);
      else if (method === 'sync.useFile') await this.useFile((params as SyncMethods['sync.useFile'][0]).mode);
      else if (method === 'sync.create') await this.create((params as SyncMethods['sync.create'][0]).passphrase);
      else if (method === 'sync.confirmRecovery') await this.confirmRecovery((params as SyncMethods['sync.confirmRecovery'][0]).answers);
      else if (method === 'sync.join') await this.join(params as SyncMethods['sync.join'][0]);
      else if (method === 'sync.requestPairing') await this.requestPairing();
      else if (method === 'sync.cancelPairing') await this.cancelPairing();
      else if (method === 'sync.answerPairing') await this.answerPairing(params as SyncMethods['sync.answerPairing'][0]);
      else if (method === 'sync.confirmPairing') await this.confirmPairing((params as SyncMethods['sync.confirmPairing'][0]).words);
      else if (method === 'sync.dismissConfirmation') this.pairingConfirmation = [];
      else if (method === 'sync.syncNow') this.syncNow();
      else if (method === 'sync.resolve') await this.resolve((params as SyncMethods['sync.resolve'][0]).choice);
      else if (method === 'sync.newRecoveryCode') await this.newRecoveryCode();
      else if (method === 'sync.setSharing') await this.setSharing(params as SyncMethods['sync.setSharing'][0]);
      else if (method === 'sync.disconnect') await this.disconnect();
      else throw new Error(`Unknown sync method ${method}`);
      this.emit();
      return this.view();
    };
    try { return await run() as SyncMethods[M][1]; }
    catch (error) {
      this.emit();
      throw error;
    }
  }

  view(): SyncView {
    const credentials = this.credentials.get();
    const target = this.choice ?? credentials.target;
    return {
      phase: this.phase, backend: target?.kind ?? null, status: this.phase === 'on' || this.phase === 'savingCode' ? this.status : 'idle', error: this.error,
      login: credentials.login, userCode: this.userCode, repository: target ? labelOf(target) : null, attention: this.attention, recoveryCode: this.recoveryCode,
      recoveryCheck: this.recoveryCheck, conflicts: this.conflicts, nextRunAt: this.scheduler.nextRunAt, lastSyncedAt: this.lastSyncedAt, devices: this.devices,
      repositories: this.repositories, pairingWords: this.pairingWords, pairingRequests: this.pairingRequests, canKeepSecrets: this.credentials.canKeepSecrets,
      isPairingApproved: !!this.pairedKey, pairingConfirmation: this.pairingConfirmation,
      isRecoveryConfirmed: credentials.isRecoveryConfirmed,
      isSecretsSynced: credentials.isSecretsSynced && this.credentials.canKeepSecrets, isIdentitySynced: credentials.isIdentitySynced,
      isIdentityChoiceNeeded: this.isIdentityChoiceNeeded,
    };
  }

  private emit(): void {
    this.deps.send(this.view());
  }

  private target(): SyncTarget {
    const target = this.choice ?? this.credentials.get().target;
    if (!target) throw new Error('Choose a repository or a sync file first.');
    return target;
  }

  private remoteFor(target: SyncTarget, isNew = false): SyncRemote {
    return target.kind === 'github' ? new GitHubRemote(this.api, target.repository, this.now) : new FileRemote(target.path, isNew);
  }

  private async open(page: SyncPage): Promise<boolean> {
    const target = this.choice ?? this.credentials.get().target;
    if (page === 'repository' && target?.kind === 'file') {
      this.deps.revealFile?.(target.path);
      return true;
    }
    const urls: Record<SyncPage, string | null> = {
      install: `${GITHUB_WEB}/apps/${GITHUB_APP_SLUG}/installations/new`,
      verification: this.verificationUri ?? `${GITHUB_WEB}/login/device`,
      authorizations: `${GITHUB_WEB}/settings/apps/authorizations`,
      repository: target?.kind === 'github' ? `${GITHUB_WEB}/${target.repository.fullName}` : null,
      newRepository: `${GITHUB_WEB}/new?name=openterm5-sync&visibility=private`,
    };
    const url = urls[page];
    if (!url) return false;
    await this.deps.openExternal(url);
    return true;
  }

  // The browser shows GitHub's own page: OpenTerm5 never sees the GitHub password.
  private async connect(): Promise<void> {
    this.signIn?.abort();
    const abort = new AbortController();
    this.signIn = abort;
    const code = await this.auth.start();
    [this.userCode, this.verificationUri] = [code.userCode, code.verificationUri];
    if (this.phase === 'off') this.phase = 'signingIn';
    void this.deps.openExternal(code.verificationUri).catch(() => undefined);
    void this.finishSignIn(code, abort);
  }

  private async finishSignIn(code: DeviceCode, abort: AbortController): Promise<void> {
    try {
      await this.auth.poll(code, abort.signal);
      await this.credentials.update({ login: await this.api.login() });
      this.userCode = null;
      const { target, rootKey } = this.credentials.get();
      if (target && rootKey) {
        this.attention = null;
        this.scheduler.start();
      } else {
        this.phase = 'choosingRepository';
        await this.loadRepositories();
      }
    } catch (error) {
      if (abort.signal.aborted) return;
      this.userCode = null;
      this.error = (error as Error).message;
      if (this.phase === 'signingIn') this.phase = 'off';
    } finally {
      if (this.signIn === abort) this.signIn = null;
      this.emit();
    }
  }

  // Leaving setup before it finished forgets the sign-in too; once sync is on, cancel only stops a reconnect.
  private async cancel(): Promise<void> {
    this.signIn?.abort();
    this.signIn = null;
    this.userCode = null;
    if (this.phase === 'on' || this.phase === 'savingCode') return;
    if (this.phase === 'pairing') await this.cancelPairing();
    await this.credentials.clear();
    [this.phase, this.choice, this.repositories] = ['off', null, []];
  }

  private async loadRepositories(): Promise<void> {
    this.repositories = (await this.api.repositories()).map(({ id, fullName, isPrivate }) => ({ id, fullName, isPrivate }));
  }

  private async chooseRepository(id: number): Promise<void> {
    const repository = await this.api.repository(id);
    if (!repository) throw new Error('OpenTerm5 Sync cannot reach that repository. Install the app on it first.');
    if (!repository.isPrivate) throw new Error('That repository is public. Choose a private repository.');
    await this.choose({ kind: 'github', repository });
  }

  // A new sync file gets a fresh group id; choosing an existing one (from either dialog) joins it.
  private async useFile(mode: 'new' | 'open'): Promise<void> {
    if (this.phase !== 'off') throw new Error('Disconnect first to use a sync file.');
    const file = await this.deps.chooseFile?.(mode);
    if (!file) return;
    const existing = new FileRemote(file, true);
    const head = await existing.head().catch((error: Error) => { if (mode === 'open') throw error; return null; });
    if (head === null) {
      if (mode === 'open') throw new Error('That sync file is empty. Create a new one instead.');
      await this.choose({ kind: 'file', path: file, groupId: randomInt(1, MAX_GROUP_ID) });
      return;
    }
    const format = (await existing.read(head, [FORMAT_PATH])).get(FORMAT_PATH);
    let groupId: unknown;
    try { groupId = (JSON.parse(format?.toString('utf8') ?? 'null') as { repoId?: unknown } | null)?.repoId; } catch { groupId = null; }
    if (!Number.isSafeInteger(groupId)) throw new SyncFileDamagedError('That file is not an OpenTerm5 sync file, or it is damaged.');
    await this.choose({ kind: 'file', path: file, groupId: groupId as number });
  }

  private async choose(target: SyncTarget): Promise<void> {
    const setup = await inspectRepository(this.remoteFor(target, true), groupIdOf(target));
    if (setup.kind === 'foreign') throw new Error('That repository already holds other files. Choose an empty private repository made for sync.');
    this.choice = target;
    this.phase = setup.kind === 'empty' ? 'creating' : 'joining';
  }

  private async create(passphrase: string | null): Promise<void> {
    const target = this.target();
    if (this.phase !== 'creating') throw new Error('Choose a repository first.');
    const problem = passphrase ? passphraseProblem(passphrase) : null;
    if (problem) throw new Error(problem);
    const remote = this.remoteFor(target, true);
    const setup = await inspectRepository(remote, groupIdOf(target));
    const lost = () => {
      this.phase = 'joining';
      return new Error('Another computer set this up a moment ago. Unlock it with that computer\'s recovery code.');
    };
    if (setup.kind === 'sync') throw lost();
    if (setup.kind === 'foreign') throw new Error('That repository already holds other files.');
    const { deviceId } = this.credentials.get();
    const deviceKeys = this.credentials.get().deviceKeys ?? newDeviceKeyPair();
    const created = newKeyring(groupIdOf(target), { id: deviceId, publicKey: deviceKeys.publicKey }, passphrase ?? undefined, this.deps.passphraseCost);
    if (!await remote.commit(setup.head, created.files)) throw lost();
    await this.credentials.update({ target, rootKey: created.rootKey, deviceKeys, epoch: 1, isRecoveryConfirmed: false });
    this.showRecovery(created.recoveryCode);
  }

  private showRecovery(code: string): void {
    const first = randomInt(1, CODE_GROUPS + 1);
    let second = randomInt(1, CODE_GROUPS);
    if (second >= first) second += 1;
    [this.recoveryCode, this.recoveryCheck, this.phase] = [code, [first, second].sort((left, right) => left - right), 'savingCode'];
  }

  // Sync starts only once two groups of the code are typed back, which shows it was kept.
  private async confirmRecovery(answers: readonly string[]): Promise<void> {
    if (!this.recoveryCode) throw new Error('There is no recovery code to confirm.');
    const groups = this.recoveryCode.split('-');
    if (!this.recoveryCheck.every((group, index) => normalizeCodeGroup(answers[index] ?? '') === groups[group - 1])) {
      throw new Error('Those groups do not match. Check the code you saved and type them again.');
    }
    await this.credentials.update({ isRecoveryConfirmed: true });
    [this.recoveryCode, this.recoveryCheck, this.phase] = [null, [], 'on'];
    if (!this.engine) this.startEngine(this.target());
    this.scheduler.start();
  }

  private async join(unlock: SyncMethods['sync.join'][0]): Promise<void> {
    const target = this.target();
    if (this.phase !== 'joining') throw new Error('Choose a repository first.');
    const setup = await this.syncSetup(target);
    await this.finishJoin(target, unlockKeyring(setup.keyring, groupIdOf(target), unlock), setup.keyring.epoch);
  }

  private async syncSetup(target: SyncTarget): Promise<Extract<RepositorySetup, { kind: 'sync' }>> {
    const setup = await inspectRepository(this.remoteFor(target), groupIdOf(target));
    if (setup.kind !== 'sync') throw new Error('That repository is not set up for sync yet.');
    return setup;
  }

  // Joining always leaves this computer's own wrap in the keyring, ready for re-keying.
  private async finishJoin(target: SyncTarget, rootKey: Buffer, epoch: number): Promise<void> {
    const { deviceId } = this.credentials.get();
    const deviceKeys = this.credentials.get().deviceKeys ?? newDeviceKeyPair();
    await updateKeyring(this.remoteFor(target), groupIdOf(target), (keyring) => withDeviceWrap(keyring, rootKey, groupIdOf(target), { id: deviceId, publicKey: deviceKeys.publicKey }));
    await this.credentials.update({ target, rootKey, deviceKeys, epoch, isRecoveryConfirmed: true });
    [this.phase, this.pairingWords] = ['on', []];
    this.startEngine(target);
    if (await this.hasSyncedContent(target, rootKey, epoch)) {
      await this.credentials.update({ pendingJoin: 'ask' });
      this.attend('join', joinMessage);
    } else this.scheduler.start();
  }

  // A computer joining for the first time asks before its own data meets the synced data. When the
  // repository cannot be read now it asks anyway, so nothing merges without a choice.
  private async hasSyncedContent(target: SyncTarget, rootKey: Buffer, epoch: number): Promise<boolean> {
    if (await this.stateStore?.load()) return false;
    try {
      const remote = this.remoteFor(target);
      const head = await remote.head();
      const envelope = head === null ? null : (await remote.read(head, [MANIFEST_PATH])).get(MANIFEST_PATH);
      if (!envelope) return false;
      const manifest = openManifest(deriveKeys(rootKey), envelope, { epoch, repoId: groupIdOf(target), highWater: 0 });
      const kinds = new Set<string>(rendererSyncKinds);
      return Object.entries(manifest.records).some(([key, entry]) => entry.hash !== null && kinds.has(splitRecordKey(key).kind));
    } catch {
      return true;
    }
  }

  // The new computer posts its public key and waits for a linked computer to wrap the key to it.
  // Its key pair is saved first, so an approval that lands after a restart still works.
  private async requestPairing(): Promise<void> {
    const target = this.target();
    if (this.phase !== 'joining') throw new Error('Choose a repository first.');
    const deviceKeys = this.credentials.get().deviceKeys ?? newDeviceKeyPair();
    await this.credentials.update({ deviceKeys });
    if (await this.tryPairedUnlock(target)) return;
    const { deviceId } = this.credentials.get();
    await requestPairing(this.remoteFor(target), groupIdOf(target), { id: deviceId, publicKey: deviceKeys.publicKey }, this.now());
    [this.phase, this.pairingWords, this.pairingSince] = ['pairing', pairingWords(deviceKeys.publicKey), this.now()];
    this.schedulePairingPoll();
  }

  // A key wrapped to this computer is not trusted yet: anyone holding the GitHub token can wrap a
  // key of their own to it. It must open the existing manifest, and then the user types the
  // confirmation words the approving computer shows, which only the real key yields.
  private async tryPairedUnlock(target: SyncTarget): Promise<boolean> {
    const { deviceId, deviceKeys } = this.credentials.get();
    const setup = await this.syncSetup(target);
    const isWrapped = setup.keyring.wraps.some((wrap) => wrap.kind === 'device' && wrap.deviceId === deviceId && wrap.epoch === setup.keyring.epoch);
    if (!isWrapped || !deviceKeys) return false;
    let rootKey: Buffer;
    try { rootKey = unlockKeyring(setup.keyring, groupIdOf(target), { deviceId, deviceKeys }); }
    catch (error) {
      // A wrap left from an earlier join, made for a key pair this computer no longer has.
      if (error instanceof SyncCryptoError) return false;
      throw error;
    }
    const manifest = (await this.remoteFor(target).read(setup.head, [MANIFEST_PATH])).get(MANIFEST_PATH);
    if (manifest) {
      try { openManifest(deriveKeys(rootKey), manifest, { epoch: setup.keyring.epoch, repoId: groupIdOf(target), highWater: 0 }); }
      catch { throw new SyncSetupError('The key sent to this computer does not open the synced data, so it was refused. Someone other than your computers may have changed the repository.'); }
    }
    this.stopPairingPoll();
    [this.pairedKey, this.pairingAttempts] = [{ rootKey, epoch: setup.keyring.epoch }, 0];
    return true;
  }

  private async confirmPairing(words: string): Promise<void> {
    const target = this.choice;
    const { deviceId, deviceKeys } = this.credentials.get();
    if (!this.pairedKey || !target || !deviceKeys) throw new Error('Nothing is waiting for confirmation.');
    const expected = pairingConfirmation(this.pairedKey.rootKey, groupIdOf(target), { deviceId, publicKey: deviceKeys.publicKey }).join(' ');
    if (words.trim().toLowerCase().split(/\s+/).join(' ') === expected) {
      const { rootKey, epoch } = this.pairedKey;
      this.pairedKey = null;
      await this.finishJoin(target, rootKey, epoch);
      return;
    }
    this.pairingAttempts += 1;
    if (this.pairingAttempts < PAIRING_ATTEMPTS) throw new Error('Those words do not match what the other computer shows. Check them and try again.');
    this.pairedKey = null;
    await this.cancelPairing();
    throw new Error('The words did not match three times, so the key sent to this computer was refused. Use the recovery code, or ask to join again.');
  }

  private schedulePairingPoll(): void {
    this.stopPairingPoll();
    this.pairingTimer = this.timers.set(() => void this.pollPairing(), PAIRING_POLL_MS);
  }

  private stopPairingPoll(): void {
    this.timers.clear(this.pairingTimer);
    this.pairingTimer = null;
  }

  private async pollPairing(): Promise<void> {
    this.pairingTimer = null;
    if (this.phase !== 'pairing' || !this.choice || this.pairedKey) return;
    try {
      if (await this.tryPairedUnlock(this.choice)) return;
      if (this.now() - this.pairingSince > PAIRING_LIFETIME_MS) {
        [this.phase, this.pairingWords, this.error] = ['joining', [], 'Nobody approved this computer in time. Ask again, or use the recovery code.'];
        return;
      }
    } catch (error) {
      if (!(error instanceof SyncFileUnavailableError || error instanceof GitHubNetworkError)) this.error = (error as Error).message;
    } finally {
      // Once a key is held the poll stops, or each poll would reset the three tries.
      if (this.phase === 'pairing' && !this.pairedKey) this.schedulePairingPoll();
      this.emit();
    }
  }

  private async cancelPairing(): Promise<void> {
    this.stopPairingPoll();
    const target = this.choice;
    [this.phase, this.pairingWords, this.pairedKey] = ['joining', [], null];
    if (target) await answerPairing(this.remoteFor(target), groupIdOf(target), this.credentials.get().deviceId, null, this.now()).catch(() => undefined);
  }

  // Run on a linked computer, after the user checked the six words match the new computer's.
  private async answerPairing({ deviceId, isApproved }: SyncMethods['sync.answerPairing'][0]): Promise<void> {
    const { target, rootKey } = this.credentials.get();
    if (!target || !rootKey) throw new Error('Sync is not set up on this computer.');
    const publicKey = this.shownRequests.get(deviceId);
    if (isApproved && !publicKey) throw new Error('That request is no longer shown. Sync again and check its words.');
    const request = await answerPairing(this.remoteFor(target), groupIdOf(target), deviceId, isApproved ? { rootKey, publicKey: publicKey! } : null, this.now());
    await this.refreshPairing(target);
    if (!isApproved || !request) return;
    this.pairingConfirmation = pairingConfirmation(rootKey, groupIdOf(target), request);
    this.deps.journal('Another computer was allowed to join sync.');
  }

  private async refreshPairing(target: SyncTarget): Promise<void> {
    const setup = await inspectRepository(this.remoteFor(target), groupIdOf(target));
    const { deviceId } = this.credentials.get();
    const requests = setup.kind !== 'sync' ? [] : setup.pairing.filter((request) => request.deviceId !== deviceId && this.now() - request.createdAt < PAIRING_LIFETIME_MS);
    this.shownRequests = new Map(requests.map((request) => [request.deviceId, request.publicKey]));
    this.pairingRequests = requests.map((request) => ({ deviceId: request.deviceId, createdAt: request.createdAt, words: pairingWords(request.publicKey) }));
  }

  private async newRecoveryCode(): Promise<void> {
    const { target, rootKey } = this.credentials.get();
    if (!target || !rootKey) throw new Error('Sync is not set up on this computer.');
    let code = '';
    await updateKeyring(this.remoteFor(target), groupIdOf(target), (keyring) => {
      const renewed = withNewRecovery(keyring, rootKey, groupIdOf(target));
      code = renewed.recoveryCode;
      return renewed.keyring;
    });
    await this.credentials.update({ isRecoveryConfirmed: false });
    this.showRecovery(code);
  }

  private syncNow(): void {
    if (!this.engine) throw new Error('Sync is not set up on this computer.');
    if (this.attention?.reason === 'reconnect') throw new Error('Reconnect GitHub first.');
    this.attention = null;
    this.status = 'syncing';
    this.scheduler.start();
  }

  private async resolve(choice: SyncResolution): Promise<void> {
    if (this.attention?.reason === 'join' || this.credentials.get().pendingJoin === 'ask') {
      await this.credentials.update({ pendingJoin: choice === 'useSynced' ? 'useSynced' : 'merge' });
      this.attention = null;
      if ((await this.run({})).kind !== 'stop') this.scheduler.start();
      return;
    }
    const options: Record<SyncResolution, SyncOptions> = {
      merge: {},
      allowDeletions: { isMassChangeAllowed: true },
      useSynced: { isLocalDiscarded: true, isMassChangeAllowed: true },
      acceptHistory: { isHistoryAccepted: true, isLocalDiscarded: true, isMassChangeAllowed: true },
    };
    this.attention = null;
    if ((await this.run(options[choice])).kind !== 'stop') this.scheduler.start();
  }

  // Leaves the repository as it is: other computers keep syncing, and this one can join again. A
  // sync still running is waited for, or it could write its state back after the file is removed.
  private async disconnect(): Promise<void> {
    this.signIn?.abort();
    this.scheduler.stop();
    this.stopPairingPoll();
    await this.running?.catch(() => undefined);
    await this.stateStore?.remove();
    await this.credentials.clear();
    [this.engine, this.stateStore, this.choice, this.attention, this.userCode, this.recoveryCode] = [null, null, null, null, null, null];
    [this.phase, this.status, this.devices, this.repositories, this.recoveryCheck, this.lastSyncedAt, this.conflicts] = ['off', 'idle', [], [], [], null, 0];
    [this.pairingWords, this.pairingRequests, this.pairingConfirmation, this.pairedKey] = [[], [], [], null];
    this.shownRequests.clear();
  }

  private startEngine(target: SyncTarget): void {
    const { rootKey, epoch, deviceId, deviceKeys } = this.credentials.get();
    const keys = deriveKeys(rootKey!);
    const repoId = groupIdOf(target);
    this.choice = null;
    this.stateStore = new EncryptedStateStore(path.join(this.deps.dir, 'sync-state.json'), keys.state, { epoch, repoId });
    this.engine = new SyncEngine({
      epoch, repoId, keys, remote: this.remoteFor(target), store: this.stateStore, sources: this.engineSources(), now: this.now,
      device: { id: deviceId, name: this.deps.deviceName.slice(0, 256), platform: this.deps.platform, publicKey: deviceKeys?.publicKey ?? '', appVersion: this.deps.appVersion },
    });
  }

  // Kinds this computer opted into. Secret kinds also need the keychain; while the synced CID is
  // being adopted, this computer offers none of its own, so the synced one is taken as it is.
  private engineSources(): SyncSource[] {
    const { isSecretsSynced, isIdentitySynced, isIdentityAdopting } = this.credentials.get();
    return (this.deps.sources?.() ?? []).flatMap((source): SyncSource[] => {
      if (source.kind === 'identity') {
        if (!isIdentitySynced) return [];
        return [isIdentityAdopting ? { kind: source.kind, snapshot: async () => ({}), validate: (value, id) => source.validate(value, id), apply: (change) => source.apply(change) } : source];
      }
      return syncKindInfo(source.kind).isSecret && !(isSecretsSynced && this.credentials.canKeepSecrets) ? [] : [source];
    });
  }

  // Turning on one CID when another one is already synced asks which to keep, unless the choice
  // came with the request. Each change restarts the engine with the kinds now chosen.
  private async setSharing({ isSecretsSynced, isIdentitySynced, identityChoice }: SyncSharing): Promise<void> {
    if (!this.engine) throw new Error('Sync is not set up on this computer.');
    if (isSecretsSynced && !this.credentials.canKeepSecrets) throw new Error('This computer has no secure storage for passwords, so they cannot sync here.');
    const current = this.credentials.get();
    let isIdentityAdopting = current.isIdentityAdopting && isIdentitySynced;
    if (isIdentitySynced && !current.isIdentitySynced) {
      const source = this.deps.sources?.().find((candidate) => candidate.kind === 'identity');
      if (!source) throw new Error('This computer cannot sync its CID.');
      const synced = await this.engine.peek(recordKey('identity', IDENTITY_ID));
      const own = (await source.snapshot())[IDENTITY_ID];
      const isDifferent = synced !== undefined && !isSameJson(synced, own);
      if (isDifferent && !identityChoice) {
        this.isIdentityChoiceNeeded = true;
        return;
      }
      isIdentityAdopting = isDifferent && identityChoice === 'synced';
    }
    this.isIdentityChoiceNeeded = false;
    this.scheduler.stop();
    await this.running?.catch(() => undefined);
    await this.credentials.update({ isSecretsSynced, isIdentitySynced, isIdentityAdopting });
    this.startEngine(this.target());
    if (!this.attention) this.scheduler.start();
  }

  // The synced CID has arrived once it is a merge base; from then on this computer's CID syncs.
  private async finishAdopting(): Promise<void> {
    if (!this.credentials.get().isIdentityAdopting) return;
    const state = await this.stateStore?.load();
    if (!state?.bases[recordKey('identity', IDENTITY_ID)]) return;
    await this.credentials.update({ isIdentityAdopting: false });
    this.startEngine(this.target());
  }

  private async currentManifest(): Promise<Manifest | null> {
    if (!this.engine) return null;
    const late = new Promise<null>((resolve) => this.timers.set(() => resolve(null), PEEK_TIMEOUT_MS));
    const fresh = await Promise.race([this.engine.peekManifest().catch(() => null), late]);
    return fresh ?? (await this.stateStore?.load())?.manifest ?? null;
  }

  private async writePresence(accounts = (this.deps.liveAccounts?.() ?? []).map((account) => account.id)): Promise<void> {
    if (!this.engine || this.attention) return;
    const { deviceId } = this.credentials.get();
    const isWritten = await this.engine.editManifest((manifest, now) =>
      isPresenceDue(manifest.presence, deviceId, accounts, now) ? { ...manifest, presence: withPresence(manifest.presence, deviceId, accounts, now) } : null).catch(() => false);
    if (isWritten || !accounts.length) this.hasPresence = accounts.length > 0;
  }

  // Requests from computers that moved an account to themselves after this one logged in to it.
  // A login here made after the request was a choice to come back, so it stays.
  private async answerHandoffs(): Promise<void> {
    const engine = this.engine;
    const manifest = (await this.stateStore?.load())?.manifest;
    if (!engine || !manifest || !this.deps.releaseAccounts) return;
    const { deviceId } = this.credentials.get();
    const offset = engine.serverNow() - this.now();
    const live = new Map((this.deps.liveAccounts?.() ?? []).map((account) => [account.id, account.since + offset]));
    const byComputer = new Map<string, string[]>();
    for (const [account, request] of Object.entries(liveHandoffs(manifest.handoffs, engine.serverNow()))) {
      const key = `${account}|${request.from}|${request.createdAt}`;
      if (!request.to.includes(deviceId) || !(live.get(account)! < request.createdAt) || this.answeredHandoffs.has(key)) continue;
      this.answeredHandoffs.add(key);
      const name = manifest.devices.find((device) => device.id === request.from)?.name || 'another computer';
      byComputer.set(name, [...byComputer.get(name) ?? [], account]);
    }
    for (const [name, released] of byComputer) await this.deps.releaseAccounts(released, name);
    if (byComputer.size) await this.writePresence();
  }

  private async stamp(): Promise<void> {
    await this.engine?.recordLocalChanges();
  }

  private run(options: SyncOptions): Promise<RunResult> {
    const running = this.runOnce(options);
    this.running = running;
    void running.finally(() => { if (this.running === running) this.running = null; });
    return running;
  }

  private async runOnce(options: SyncOptions): Promise<RunResult> {
    if (!this.engine) return { kind: 'stop' };
    const join = this.credentials.get().pendingJoin;
    if (join === 'ask') return this.attend('join', joinMessage);
    const startedAt = this.now();
    const target = this.target();
    this.status = 'syncing';
    this.emit();
    try {
      const problem = await this.checkRepository(target);
      if (problem) return this.attend(problem.reason, problem.message);
      const outcome = await this.engine.sync(join ? { ...options, ...joinOptions[join] } : options);
      if (outcome.status === 'held') return this.attend('held', heldMessage(outcome.changes), outcome.changes);
      if (outcome.status === 'busy') {
        this.status = 'idle';
        return { kind: 'retry' };
      }
      if (join) await this.credentials.update({ pendingJoin: null });
      await this.answerHandoffs();
      await this.writePresence();
      await this.refreshDevices();
      await this.refreshPairing(target);
      await this.finishAdopting();
      this.pushedAt = startedAt + 1;
      [this.status, this.attention, this.error, this.conflicts, this.lastSyncedAt] = ['idle', null, null, outcome.conflicts.length, this.now()];
      if (outcome.conflicts.length) this.deps.journal(`${outcome.conflicts.length} edit(s) made on two computers at once were settled in favour of the newer one.`);
      if (outcome.skipped.length) this.deps.journal(`${outcome.skipped.length} item(s) were too large or not readable by this version and were left out of sync.`);
      return { kind: 'ok' };
    } catch (error) {
      return this.failed(error as Error);
    } finally {
      this.emit();
    }
  }

  private async checkRepository(target: SyncTarget): Promise<{ reason: SyncAttentionReason; message: string } | null> {
    if (target.kind !== 'github' || this.now() - this.checkedAt < REPOSITORY_CHECK_MS) return null;
    const repository = await this.api.repository(target.repository.id);
    if (!repository) return { reason: 'repositoryMissing', message: 'The sync repository was deleted, or OpenTerm5 Sync was removed from it.' };
    if (!repository.isPrivate) return { reason: 'repositoryPublic', message: `${repository.fullName} was made public. Sync stopped. The data in it is encrypted, but make it private again.` };
    if (repository.fullName !== target.repository.fullName || repository.branch !== target.repository.branch) {
      const renamed: SyncTarget = { kind: 'github', repository };
      await this.credentials.update({ target: renamed });
      this.startEngine(renamed);
    }
    this.checkedAt = this.now();
    return null;
  }

  private async refreshDevices(): Promise<void> {
    const state = await this.stateStore?.load();
    const { deviceId } = this.credentials.get();
    this.devices = (state?.manifest?.devices ?? []).map(({ id, name, platform, lastSeen, isRevoked }) => ({ id, name, platform, lastSeen, isRevoked, isThisComputer: id === deviceId }))
      .sort((left, right) => right.lastSeen - left.lastSeen);
  }

  private attend(reason: SyncAttentionReason, message: string, changes: readonly SyncMassChange[] = []): RunResult {
    [this.attention, this.status] = [{ reason, message, changes }, 'attention'];
    this.scheduler.stop();
    this.deps.journal(message);
    return { kind: 'stop' };
  }

  private failed(error: Error): RunResult {
    if (error instanceof SyncIntegrityError) return this.attend(error.reason, error.message);
    if (error instanceof SyncSourceUnavailableError) {
      [this.status, this.error] = ['loading', error.message];
      return { kind: 'retry' };
    }
    if (error instanceof GitHubAuthError && error.reason === 'reconnect') return this.attend('reconnect', error.message);
    if (error instanceof GitHubRateLimitError) {
      [this.status, this.error] = ['waiting', error.message];
      return { kind: 'retry', at: error.until };
    }
    if (error instanceof GitHubNetworkError || error instanceof GitHubRequestError || error instanceof SyncFileUnavailableError || (error instanceof GitHubAuthError && error.reason === 'network')) {
      [this.status, this.error] = ['offline', error.message];
      return { kind: 'retry' };
    }
    if (error instanceof SyncSetupError || error instanceof SyncFileDamagedError) return this.attend('failed', error.message);
    return this.attend('failed', `Sync stopped: ${error.message}`);
  }
}
