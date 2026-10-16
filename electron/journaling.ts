import type { Account, History, TerminalEvent, Tick, TradeSnapshot } from '../shared/protocol';
import {
  journalLinks, journalPlans, normalizeCode, parsePlatformUrl,
  type ClosedTrade, type ConnectFlow, type JournalDay, type JournalingEvent, type JournalingEvents, type JournalingMethod, type JournalingMethods, type JournalingView,
  type JournalToday, type JournalTrade, type JournalTradeDetail, type JournalUsage, type JournalUser, type OpenTarget, type PendingLink, type Playbook, type TradeReview,
} from '../shared/journaling';
import type { PasswordCipher } from './account-registry';
import { JsonStore } from './json-store';
import { ServerClockEstimator } from './journaling-clock';
import { connectUrl, createPkce, createState, startLoopback, ConnectCancelledError, type Loopback } from './journaling-connect';
import type { IngestResult } from './journaling-deals';
import { JournalingApiError, JournalingClient, type ApiCredentials, type ApiReply, type ApiRequest, type Fetch } from './journaling-http';
import { checkConnectLink } from './journaling-links';
import { accountKey, decodeCredentials, emptyJournaling, encodeCredentials, parseJournaling, type StoredAccount, type StoredJournaling } from './journaling-store';
import { syncDeals } from './journaling-sync';

export interface JournalingDeps {
  readonly file: string;
  readonly cipher: PasswordCipher;
  readonly fetch: Fetch;
  readonly deviceName: string;
  send<E extends JournalingEvent>(event: E, data: JournalingEvents[E]): void;
  journal(message: string): void;
  openExternal(url: string): Promise<void>;
  // Deal history, in server-clock seconds, of the account the UI is logged in to; refused when
  // that is no longer the account with this key.
  history(key: string, fromSeconds: number, toSeconds: number): Promise<History>;
  now?(): number;
}

interface ActiveAccount {
  readonly key: string;
  readonly account: Account;
}

const MINUTE = 60_000;
const TRADE_DEBOUNCE_MS = 4_000;
const HELD_RETRY_MS = 60 * MINUTE;
const FAILED_RETRY_MS = 5 * MINUTE;
const LIMITED_RETRY_MS = MINUTE;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const textOr = (value: unknown, fallback: string) => typeof value === 'string' ? value : fallback;
const numberOr = <T>(value: unknown, fallback: T) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export function dateIn(timeZone: string, time: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(time));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function parseTrade(value: unknown): JournalTrade {
  const trade = isRecord(value) ? value : {};
  return {
    key: textOr(trade.key, ''),
    url: typeof trade.url === 'string' ? trade.url : null,
    symbol: textOr(trade.symbol, ''),
    status: textOr(trade.status, 'open'),
    openedAt: textOr(trade.openedAt, ''),
    closedAt: typeof trade.closedAt === 'string' ? trade.closedAt : null,
    direction: trade.direction === 'short' ? 'short' : 'long',
    accountId: textOr(trade.accountId, ''),
    playbookId: typeof trade.playbookId === 'string' ? trade.playbookId : null,
    verifiedBy: trade.verifiedBy === 'mt5' || trade.verifiedBy === 'broker' ? trade.verifiedBy : null,
    fees: numberOr(trade.fees, 0),
    quantity: numberOr(trade.quantity, 0),
    avgEntry: numberOr(trade.avgEntry, null),
    avgExit: numberOr(trade.avgExit, null),
    netPnl: numberOr(trade.netPnl, null),
    rating: numberOr(trade.rating, null),
    tags: strings(trade.tags),
    mistakes: strings(trade.mistakes),
    reviewed: trade.reviewed === true,
  };
}

function parseUsage(value: unknown): JournalUsage | null {
  if (!isRecord(value) || !isRecord(value.monthlyTrades)) return null;
  const { used, limit, resetsAt } = value.monthlyTrades;
  return { monthlyTrades: { used: numberOr(used, 0), limit: numberOr(limit, null), resetsAt: textOr(resetsAt, '') } };
}

function positionsSignature(snapshot: TradeSnapshot): string {
  const positions = snapshot.positions.map((position) => `${position.ticket}:${position.volume}`).sort();
  const orders = snapshot.orders.map((order) => order.ticket).sort((left, right) => left - right);
  return `${positions.join(',')}|${orders.join(',')}`;
}

export class JournalingService {
  private flow: ConnectFlow = 'idle';
  private error: string | null = null;
  private usage: JournalUsage | null = null;
  private active: ActiveAccount | null = null;
  private timeZone: string | null = null;
  private retryAt: number | null = null;
  private loopback: Loopback | null = null;
  private features: readonly string[] = [];
  private signature: string | null = null;
  private pendingLink: PendingLink | null = null;
  private credentials: ApiCredentials | null = null;
  private running: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | undefined;
  private tradeTimer: NodeJS.Timeout | undefined;
  private isDirty = false;
  private isReconnectNeeded = false;
  private clock = new ServerClockEstimator();
  private stored: StoredJournaling = emptyJournaling();
  private readonly store: JsonStore<StoredJournaling>;

  constructor(private readonly deps: JournalingDeps) {
    this.store = new JsonStore(deps.file, parseJournaling, emptyJournaling);
  }

  private get now(): number { return this.deps.now?.() ?? Date.now(); }
  private get isConnected(): boolean { return !!this.credentials && !!this.stored.user; }

  async init(): Promise<void> {
    try { this.stored = await this.store.load(); }
    catch (error) { this.deps.journal(`${(error as Error).message}. Journaling starts disconnected.`); }
    this.clock = new ServerClockEstimator(new Map(Object.entries(this.stored.offsets)));
    try { this.credentials = decodeCredentials(this.deps.cipher, this.stored.credentials); }
    catch { this.credentials = null; }
    if (this.stored.user && !this.credentials) {
      this.isReconnectNeeded = true;
      this.error = this.stored.credentials
        ? 'The saved journaling connection could not be read. Reconnect to keep syncing.'
        : 'This system has no keychain OpenTerm5 can use, so the journaling connection ended when OpenTerm5 closed. Reconnect to keep syncing.';
      this.stored = { ...this.stored, credentials: null };
    }
    await this.persist();
    if (this.isConnected) void this.refreshMe().catch(() => undefined);
  }

  shutdown(): void {
    clearTimeout(this.retryTimer);
    clearTimeout(this.tradeTimer);
    this.loopback?.close();
  }

  view(): JournalingView {
    const accounts = this.stored.accounts.map((account) => ({ ...account, retryAt: account.key === this.active?.key ? this.retryAt : null, isActive: account.key === this.active?.key }));
    return {
      flow: this.flow,
      user: this.stored.user,
      usage: this.usage,
      error: this.error,
      features: this.features,
      accounts,
      platformUrl: this.stored.platformUrl,
      pendingLink: this.pendingLink,
      isConnected: this.isConnected,
      isStored: !!this.stored.credentials || !this.credentials,
      isReconnectNeeded: this.isReconnectNeeded,
    };
  }

  async handle<M extends JournalingMethod>(method: M, params: JournalingMethods[M][0]): Promise<JournalingMethods[M][1]> {
    const result = await this.dispatch(method, params as never);
    return result as JournalingMethods[M][1];
  }

  private async dispatch(method: JournalingMethod, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case 'journaling.view': return this.view();
      case 'journaling.connect': return this.connect();
      case 'journaling.cancelConnect': this.loopback?.close(); return this.view();
      case 'journaling.redeem': {
        const code = normalizeCode(String(params.code ?? ''));
        if (!code) throw new Error('Enter the 8-character code Tradescribe shows, for example ABCD-EFGH.');
        await this.exchange(code, null);
        return this.view();
      }
      case 'journaling.confirmLink': {
        const link = this.pendingLink;
        if (!link) throw new Error('There is no connection waiting to be confirmed.');
        await this.exchange(link.code, null);
        return this.view();
      }
      case 'journaling.dismissLink': this.pendingLink = null; this.error = null; this.emit(); return this.view();
      case 'journaling.disconnect': await this.disconnect(); return this.view();
      case 'journaling.setPlatform': return this.setPlatform(String(params.url ?? ''));
      case 'journaling.setEnabled': return this.setEnabled(String(params.key ?? ''), params.isEnabled === true);
      case 'journaling.syncNow': {
        const entry = this.active && this.entry(this.active.key);
        if (!this.active) throw new Error('Log in to an MT5 account to sync it.');
        if (entry && !entry.isEnabled) throw new Error('Sync is off for this account. Turn it on first.');
        this.requestSync();
        return this.view();
      }
      case 'journaling.today': return this.today();
      case 'journaling.trade': return this.trade(String(params.key ?? ''));
      case 'journaling.review': return this.review(String(params.key ?? ''), params.review as TradeReview, typeof params.etag === 'string' ? params.etag : null);
      case 'journaling.playbooks': return this.playbooks();
      case 'journaling.saveNote': return this.saveNote(String(params.date ?? ''), String(params.note ?? ''), typeof params.etag === 'string' ? params.etag : null);
      case 'journaling.open': return this.open(params as unknown as OpenTarget);
      default: throw new Error(`Unknown journaling request ${method}.`);
    }
  }

  onTerminal(event: TerminalEvent, data: unknown): void {
    if (event === 'trade') this.onTrade(data as TradeSnapshot);
    else if (event === 'tick') this.onTick(data as Tick);
  }

  setActive(account: Account | null): void {
    const key = account ? accountKey(account.login, account.server) : null;
    if (key === (this.active?.key ?? null)) {
      if (account && key) this.active = { key, account };
      return;
    }
    clearTimeout(this.tradeTimer);
    clearTimeout(this.retryTimer);
    this.retryAt = null;
    this.signature = null;
    this.active = account && key ? { key, account } : null;
    if (account && key && !this.entry(key)) this.upsert({ key, login: account.login, server: account.server, state: 'idle', cursor: null, lastSyncAt: null, message: null, isEnabled: true });
    this.emit();
    if (this.active) this.requestSync();
  }

  async receiveLink(url: string): Promise<void> {
    const check = checkConnectLink(url, this.stored.platformUrl);
    if (!check.isAccepted) {
      this.error = check.error;
      this.pendingLink = null;
      this.emit();
      this.deps.send('link', { error: check.error });
      return;
    }
    try {
      const { data } = await this.api<{ user?: { email?: string; name?: string }; expiresAt?: string }>({ method: 'POST', path: '/connect/preview', body: { code: check.link.code }, isPublic: true });
      this.pendingLink = { code: check.link.code, name: textOr(data.user?.name, ''), email: textOr(data.user?.email, ''), platform: check.link.platform, expiresAt: textOr(data.expiresAt, '') };
      this.error = null;
    } catch (error) {
      this.pendingLink = null;
      this.error = error instanceof JournalingApiError && error.status === 404 ? 'This connection code has expired or was already used. Make a new one in Tradescribe.' : (error as Error).message;
    }
    this.emit();
    this.deps.send('link', { error: this.error });
  }

  private onTrade(snapshot: TradeSnapshot): void {
    if (snapshot.account) this.setActive(snapshot.account);
    if (!this.active) return;
    const next = positionsSignature(snapshot);
    const previous = this.signature;
    this.signature = next;
    // The link republishes positions every 250 ms for live P/L; only an opened, closed or resized
    // position or order means new deals.
    if (previous === null || previous === next) return;
    clearTimeout(this.tradeTimer);
    this.tradeTimer = setTimeout(() => this.requestSync(), TRADE_DEBOUNCE_MS);
  }

  private onTick(tick: Tick): void {
    if (!this.active) return;
    const server = this.active.account.server;
    const minutes = this.clock.observe(server, tick.time, this.now);
    if (minutes === null) return;
    this.stored = { ...this.stored, offsets: this.clock.entries() };
    void this.persist();
    if (this.entry(this.active.key)?.state === 'waiting') this.requestSync();
  }

  private entry(key: string): StoredAccount | undefined {
    return this.stored.accounts.find((account) => account.key === key);
  }

  private upsert(account: StoredAccount): void {
    const accounts = this.stored.accounts.some((item) => item.key === account.key)
      ? this.stored.accounts.map((item) => item.key === account.key ? account : item)
      : [...this.stored.accounts, account];
    this.stored = { ...this.stored, accounts };
    void this.persist();
  }

  private patch(key: string, patch: Partial<StoredAccount>): void {
    const current = this.entry(key);
    if (current) this.upsert({ ...current, ...patch });
    this.emit();
  }

  private async persist(): Promise<void> {
    try { await this.store.save(this.stored); }
    catch (error) { this.deps.journal(`Journaling settings could not be saved: ${(error as Error).message}`); }
  }

  private emit(): void {
    this.deps.send('view', this.view());
  }

  private client(): JournalingClient {
    return new JournalingClient(this.stored.platformUrl, () => this.credentials, this.deps.fetch, () => this.now);
  }

  private async api<T>(request: ApiRequest): Promise<ApiReply<T>> {
    try { return await this.client().request<T>(request); }
    catch (error) {
      if (error instanceof JournalingApiError && error.isAuthLost && !request.isPublic && this.credentials) this.loseAuth();
      if (error instanceof JournalingApiError && error.status === 412) throw new Error('This changed in Tradescribe since you opened it. Reload it and apply your change again.');
      throw error;
    }
  }

  private loseAuth(): void {
    this.credentials = null;
    this.isReconnectNeeded = true;
    this.error = 'Tradescribe no longer accepts this connection (the key was revoked or expired). Reconnect to keep syncing.';
    this.stored = { ...this.stored, credentials: null };
    clearTimeout(this.retryTimer);
    void this.persist();
    this.emit();
  }

  private async refreshMe(): Promise<void> {
    const { data } = await this.api<{ user?: { plan?: string }; usage?: unknown; features?: unknown }>({ path: '/me' });
    const plan = journalPlans.find((item) => item.key === data.user?.plan)?.key;
    if (plan && this.stored.user) this.stored = { ...this.stored, user: { ...this.stored.user, plan } };
    this.usage = parseUsage(data.usage) ?? this.usage;
    this.features = Array.isArray(data.features) ? strings(data.features) : plan === 'pro' ? journalLinks.flatMap((link) => link.feature ? [link.feature] : []) : [];
    await this.persist();
    this.emit();
  }

  private async connect(): Promise<JournalingView> {
    if (this.loopback) throw new Error('OpenTerm5 is already waiting for you to allow it in your browser.');
    const pkce = createPkce();
    const state = createState();
    const loopback = await startLoopback(state);
    this.loopback = loopback;
    this.flow = 'browser';
    this.error = null;
    this.emit();
    try {
      await this.deps.openExternal(connectUrl(this.stored.platformUrl, { callback: loopback.callbackUrl, state, challenge: pkce.challenge, device: this.deps.deviceName }));
      const code = await loopback.code;
      await this.exchange(code, pkce.verifier);
    } catch (error) {
      if (!(error instanceof ConnectCancelledError)) throw error;
      if (error.message !== 'Connection cancelled.') this.error = error.message;
    } finally {
      loopback.close();
      this.loopback = null;
      this.flow = 'idle';
      this.emit();
    }
    return this.view();
  }

  private async exchange(code: string, verifier: string | null): Promise<void> {
    this.flow = 'exchanging';
    this.emit();
    try {
      const { data } = await this.api<{ key?: string; secret?: string; user?: Partial<JournalUser> }>({
        method: 'POST', path: '/connect/token', isPublic: true,
        body: { code, ...(verifier ? { verifier } : {}), deviceId: this.stored.deviceId, deviceName: this.deps.deviceName },
      });
      if (typeof data.key !== 'string' || typeof data.secret !== 'string' || typeof data.user?.id !== 'string') throw new Error('Tradescribe sent an incomplete connection. Try again.');
      const user: JournalUser = { id: data.user.id, name: textOr(data.user.name, ''), email: textOr(data.user.email, ''), plan: data.user.plan === 'pro' ? 'pro' : 'free' };
      this.credentials = { key: data.key, secret: data.secret };
      const isNewOwner = this.stored.cursorOwner !== user.id;
      this.stored = {
        ...this.stored,
        user,
        cursorOwner: user.id,
        credentials: encodeCredentials(this.deps.cipher, this.credentials),
        accounts: isNewOwner ? this.stored.accounts.map((account) => ({ ...account, cursor: null, lastSyncAt: null, state: 'idle', message: null })) : this.stored.accounts,
      };
      this.isReconnectNeeded = false;
      this.pendingLink = null;
      this.timeZone = null;
      this.error = null;
      await this.persist();
    } catch (error) {
      if (error instanceof JournalingApiError && (error.status === 404 || error.code === 'invalid_code')) throw new Error('This connection code is not valid, has expired or was already used. Make a new one in Tradescribe.');
      if (error instanceof JournalingApiError && error.code === 'invalid_request') throw new Error(`Tradescribe refused the connection: ${error.message}`);
      throw error;
    } finally {
      this.flow = 'idle';
      this.emit();
    }
    void this.refreshMe().catch(() => undefined);
    if (this.active) this.requestSync();
  }

  private async disconnect(): Promise<void> {
    if (this.credentials) {
      try { await this.client().request({ method: 'DELETE', path: '/keys/current' }); }
      catch (error) {
        if (!(error instanceof JournalingApiError && error.status === 401)) this.deps.journal(`The journaling key could not be revoked (${(error as Error).message}). Revoke "OpenTerm5 on ${this.deps.deviceName}" on Tradescribe's API page.`);
      }
    }
    clearTimeout(this.retryTimer);
    clearTimeout(this.tradeTimer);
    this.credentials = null;
    this.usage = null;
    this.features = [];
    this.retryAt = null;
    this.timeZone = null;
    this.error = null;
    this.pendingLink = null;
    this.isReconnectNeeded = false;
    this.stored = { ...this.stored, user: null, credentials: null };
    await this.persist();
    this.emit();
  }

  private async setPlatform(input: string): Promise<JournalingView> {
    const platformUrl = parsePlatformUrl(input);
    if (platformUrl === this.stored.platformUrl) return this.view();
    if (this.isConnected || this.isReconnectNeeded) await this.disconnect();
    this.stored = { ...this.stored, platformUrl, cursorOwner: null, accounts: this.stored.accounts.map((account) => ({ ...account, cursor: null, lastSyncAt: null, state: 'idle', message: null })) };
    await this.persist();
    this.emit();
    return this.view();
  }

  private setEnabled(key: string, isEnabled: boolean): JournalingView {
    const separator = key.indexOf('@');
    const login = Number(key.slice(0, separator));
    const server = key.slice(separator + 1);
    if (separator < 1 || !Number.isSafeInteger(login) || login <= 0 || !server) throw new Error('Unknown account.');
    const current = this.entry(key) ?? { key, login, server, state: 'idle', cursor: null, lastSyncAt: null, message: null, isEnabled };
    this.upsert({ ...current, isEnabled, state: isEnabled ? 'idle' : 'off', message: null });
    if (key === this.active?.key) {
      clearTimeout(this.retryTimer);
      this.retryAt = null;
      if (isEnabled) this.requestSync();
    }
    this.emit();
    return this.view();
  }

  private requestSync(): void {
    if (this.running) {
      this.isDirty = true;
      return;
    }
    this.running = this.runSync().finally(() => {
      this.running = null;
      if (this.isDirty) {
        this.isDirty = false;
        this.requestSync();
      }
    });
  }

  private scheduleRetry(delay: number): void {
    clearTimeout(this.retryTimer);
    this.retryAt = this.now + delay;
    this.retryTimer = setTimeout(() => { this.retryAt = null; this.requestSync(); }, delay);
  }

  private async runSync(): Promise<void> {
    const active = this.active;
    if (!active || !this.isConnected) return;
    const entry = this.entry(active.key);
    if (!entry?.isEnabled) return;
    const offset = this.clock.offset(active.account.server);
    if (offset === null) {
      this.patch(active.key, { state: 'waiting', message: null });
      return;
    }
    clearTimeout(this.retryTimer);
    this.retryAt = null;
    this.patch(active.key, { state: 'syncing', message: null });
    const isStillActive = () => this.active?.key === active.key;
    try {
      const outcome = await syncDeals({ account: active.account, cursor: entry.cursor, serverNow: this.now + offset * MINUTE, offsetMinutes: offset }, {
        history: async (from, to) => {
          const history = await this.deps.history(active.key, from, to);
          if (!isStillActive()) throw new Error('The account changed during the sync.');
          return history;
        },
        post: async (payload) => (await this.api<IngestResult>({ method: 'POST', path: '/platforms/mt5/deals', body: payload })).data,
        progress: (cursor, result) => {
          this.usage = parseUsage(result.usage) ?? this.usage;
          this.patch(active.key, { cursor });
        },
      });
      if (outcome.held) {
        this.patch(active.key, { cursor: outcome.cursor, state: 'held', message: outcome.held.message || 'The monthly trade limit is reached. Newer trades sync after an upgrade or when the month rolls over.', lastSyncAt: this.now });
        if (isStillActive()) this.scheduleRetry(HELD_RETRY_MS);
      } else {
        this.patch(active.key, { cursor: outcome.cursor, state: 'synced', message: null, lastSyncAt: this.now });
      }
      if (outcome.closed.length) this.deps.send('closed', [...outcome.closed] as ClosedTrade[]);
    } catch (error) {
      if (!isStillActive() && !(error instanceof JournalingApiError)) {
        this.patch(active.key, { state: 'idle', message: null });
        return;
      }
      if (error instanceof JournalingApiError && error.status === 429) {
        this.patch(active.key, { state: 'limited', message: error.message });
        if (isStillActive()) this.scheduleRetry(error.retryAfterMs ?? LIMITED_RETRY_MS);
      } else if (error instanceof JournalingApiError && error.isAuthLost) {
        this.patch(active.key, { state: 'failed', message: 'Reconnect Journaling to keep syncing.' });
      } else {
        this.patch(active.key, { state: 'failed', message: (error as Error).message });
        if (isStillActive()) this.scheduleRetry(FAILED_RETRY_MS);
      }
    }
  }

  private requireConnection(): void {
    if (!this.isConnected) throw new Error(this.isReconnectNeeded ? 'Reconnect Journaling first.' : 'Connect Journaling first.');
  }

  private async journalTimeZone(): Promise<string> {
    if (this.timeZone) return this.timeZone;
    const { data } = await this.api<{ timeZone?: string }>({ path: '/journal', query: { limit: 1 } });
    const timeZone = textOr(data.timeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    try { dateIn(timeZone, this.now); this.timeZone = timeZone; }
    catch { this.timeZone = 'UTC'; }
    return this.timeZone;
  }

  private async today(): Promise<JournalToday> {
    this.requireConnection();
    const timeZone = await this.journalTimeZone();
    const date = dateIn(timeZone, this.now);
    const [trades, day] = await Promise.all([
      this.api<{ trades?: unknown[] }>({ path: '/trades', query: { from: date, to: date, limit: 100 } }),
      this.api<{ note?: string; noteUpdatedAt?: string | null }>({ path: `/journal/${date}` }),
    ]);
    return {
      date, timeZone,
      day: { date, note: textOr(day.data.note, ''), etag: day.etag, updatedAt: day.data.noteUpdatedAt ?? null },
      trades: (trades.data.trades ?? []).map(parseTrade),
    };
  }

  private detail(reply: ApiReply<unknown>): JournalTradeDetail {
    const notes = isRecord(reply.data) ? textOr(reply.data.notes, '') : '';
    return { ...parseTrade(reply.data), etag: reply.etag, notes };
  }

  private async trade(key: string): Promise<JournalTradeDetail> {
    this.requireConnection();
    return this.detail(await this.api({ path: `/trades/${encodeURIComponent(key)}` }));
  }

  private async review(key: string, review: TradeReview, etag: string | null): Promise<JournalTradeDetail> {
    this.requireConnection();
    if (!review || typeof review !== 'object') throw new Error('Nothing to save.');
    const body: Record<string, unknown> = {};
    if (review.rating !== undefined) {
      if (review.rating !== null && (!Number.isInteger(review.rating) || review.rating < 1 || review.rating > 5)) throw new Error('Rate the trade from 1 to 5.');
      body.rating = review.rating;
    }
    if (review.tags !== undefined) body.tags = strings(review.tags).map((tag) => tag.trim()).filter(Boolean);
    if (review.mistakes !== undefined) body.mistakes = strings(review.mistakes).map((mistake) => mistake.trim()).filter(Boolean);
    if (review.playbookId !== undefined) body.playbookId = review.playbookId || null;
    if (review.notes !== undefined) body.notes = String(review.notes);
    if (review.reviewed !== undefined) body.reviewed = review.reviewed === true;
    return this.detail(await this.api({ method: 'PATCH', path: `/trades/${encodeURIComponent(key)}`, body, etag }));
  }

  private async playbooks(): Promise<Playbook[]> {
    this.requireConnection();
    const { data } = await this.api<unknown[]>({ path: '/playbooks' });
    return (Array.isArray(data) ? data : []).filter(isRecord).map((item) => ({ id: textOr(item.id, ''), name: textOr(item.name, '') })).filter((item) => item.id);
  }

  private async saveNote(date: string, note: string, etag: string | null): Promise<JournalDay> {
    this.requireConnection();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid journal date.');
    const reply = await this.api<{ note?: string; updatedAt?: string | null }>({ method: 'PUT', path: `/journal/${date}`, body: { note }, etag });
    return { date, note: textOr(reply.data.note, note), etag: reply.etag, updatedAt: reply.data.updatedAt ?? null };
  }

  // Links open in the system browser, and only on the configured platform.
  private async open(target: OpenTarget): Promise<boolean> {
    const platform = this.stored.platformUrl;
    const url = target.kind === 'link' ? new URL(journalLinks.find((link) => link.key === target.link)?.path ?? '/', platform)
      : target.kind === 'trade' ? new URL(target.url, platform)
        : target.kind === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(target.date) ? new URL(`/journal/${target.date}`, platform)
          : target.kind === 'upgrade' ? new URL(target.url ?? '/billing', platform)
            : null;
    if (!url || url.origin !== new URL(platform).origin) throw new Error('That link is not on the journaling platform.');
    await this.deps.openExternal(url.toString());
    return true;
  }
}
