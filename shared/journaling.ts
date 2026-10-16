// The Journaling page's contract with the main process, and the parts of Tradescribe's public API
// the page shows. The renderer never sees the API secret: every request is made and signed in main.

export const defaultPlatformUrl = 'https://tradescribe.io';

export const syncStates = [
  { key: 'off', label: 'Off', status: 'off for this account', tone: 'neutral' },
  { key: 'idle', label: 'Syncs when this account is active', status: 'connected', tone: 'neutral' },
  { key: 'waiting', label: 'Waiting for live prices to read the server clock', status: 'waiting for prices', tone: 'warn' },
  { key: 'syncing', label: 'Syncing', status: 'syncing', tone: 'warn' },
  { key: 'synced', label: 'Synced', status: 'synced', tone: 'good' },
  { key: 'held', label: 'Paused: monthly limit', status: 'paused: monthly limit', tone: 'warn' },
  { key: 'limited', label: 'Rate limited, retrying', status: 'rate limited', tone: 'warn' },
  { key: 'failed', label: 'Sync failed', status: 'sync failed', tone: 'bad' },
] as const;

export type SyncState = (typeof syncStates)[number]['key'];

export const syncState = (key: SyncState) => syncStates.find((state) => state.key === key)!;

export const journalPlans = [
  { key: 'free', label: 'Free' },
  { key: 'pro', label: 'Pro' },
] as const;

export type JournalPlan = (typeof journalPlans)[number]['key'];

export interface JournalUser {
  readonly id: string;
  readonly name: string;
  readonly plan: JournalPlan;
  readonly email: string;
}

export interface MonthlyTradeUsage {
  readonly used: number;
  readonly limit: number | null;
  readonly resetsAt: string;
}

export interface JournalUsage {
  readonly monthlyTrades: MonthlyTradeUsage;
}

// One MT5 account's sync, keyed by `<login>@<server>` so a changed web endpoint keeps its cursor.
export interface AccountSync {
  readonly key: string;
  readonly server: string;
  readonly state: SyncState;
  readonly login: number;
  // Server-clock epoch ms up to which every deal has been delivered; null before the first sync.
  readonly cursor: number | null;
  readonly retryAt: number | null;
  readonly lastSyncAt: number | null;
  readonly message: string | null;
  readonly isActive: boolean;
  readonly isEnabled: boolean;
}

export interface PendingLink {
  readonly code: string;
  readonly name: string;
  readonly email: string;
  readonly platform: string;
  readonly expiresAt: string;
}

export const connectFlows = [
  { key: 'idle', label: '' },
  { key: 'browser', label: 'Waiting for you to allow OpenTerm5 in your browser' },
  { key: 'exchanging', label: 'Connecting' },
] as const;

export type ConnectFlow = (typeof connectFlows)[number]['key'];

export interface JournalingView {
  readonly flow: ConnectFlow;
  readonly user: JournalUser | null;
  readonly usage: JournalUsage | null;
  readonly error: string | null;
  readonly features: readonly string[];
  readonly accounts: readonly AccountSync[];
  readonly platformUrl: string;
  readonly pendingLink: PendingLink | null;
  readonly isConnected: boolean;
  // False when the OS keychain is unavailable: the connection then lasts until OpenTerm5 closes.
  readonly isStored: boolean;
  readonly isReconnectNeeded: boolean;
}

export const verifiedSources = [
  { key: 'mt5', label: 'Verified', detail: 'From MetaTrader 5' },
  { key: 'broker', label: 'Verified', detail: 'From broker sync' },
] as const;

export type VerifiedSource = (typeof verifiedSources)[number]['key'];

export interface JournalTrade {
  readonly key: string;
  readonly url: string | null;
  readonly symbol: string;
  readonly status: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly direction: 'long' | 'short';
  readonly accountId: string;
  readonly playbookId: string | null;
  readonly verifiedBy: VerifiedSource | null;
  readonly fees: number;
  readonly quantity: number;
  readonly avgEntry: number | null;
  readonly avgExit: number | null;
  readonly netPnl: number | null;
  readonly rating: number | null;
  readonly tags: readonly string[];
  readonly mistakes: readonly string[];
  readonly reviewed: boolean;
}

export interface JournalTradeDetail extends JournalTrade {
  readonly etag: string | null;
  readonly notes: string;
}

export interface Playbook {
  readonly id: string;
  readonly name: string;
}

export interface JournalDay {
  readonly date: string;
  readonly note: string;
  readonly etag: string | null;
  readonly updatedAt: string | null;
}

export interface JournalToday {
  readonly date: string;
  readonly timeZone: string;
  readonly day: JournalDay;
  readonly trades: readonly JournalTrade[];
}

export interface TradeReview {
  readonly notes?: string;
  readonly playbookId?: string | null;
  readonly rating?: number | null;
  readonly tags?: readonly string[];
  readonly mistakes?: readonly string[];
  readonly reviewed?: boolean;
}

export interface ClosedTrade {
  readonly key: string;
  readonly url: string | null;
  readonly symbol: string;
  readonly netPnl: number;
}

export const journalLinks = [
  { key: 'calendar', label: 'Calendar', path: '/calendar', feature: null },
  { key: 'reports', label: 'Reports', path: '/reports', feature: null },
  { key: 'ai', label: 'Ask AI about your journal', path: '/reports', feature: 'ai' },
] as const;

export type JournalLink = (typeof journalLinks)[number]['key'];

export type OpenTarget =
  | { kind: 'link'; link: JournalLink }
  | { kind: 'trade'; url: string }
  | { kind: 'day'; date: string }
  | { kind: 'upgrade'; url?: string };

export interface JournalingMethods {
  'journaling.view': [Record<string, never>, JournalingView];
  'journaling.connect': [Record<string, never>, JournalingView];
  'journaling.cancelConnect': [Record<string, never>, JournalingView];
  'journaling.redeem': [{ code: string }, JournalingView];
  'journaling.confirmLink': [Record<string, never>, JournalingView];
  'journaling.dismissLink': [Record<string, never>, JournalingView];
  'journaling.disconnect': [Record<string, never>, JournalingView];
  'journaling.setPlatform': [{ url: string }, JournalingView];
  'journaling.setEnabled': [{ key: string; isEnabled: boolean }, JournalingView];
  'journaling.syncNow': [Record<string, never>, JournalingView];
  'journaling.today': [Record<string, never>, JournalToday];
  'journaling.trade': [{ key: string }, JournalTradeDetail];
  'journaling.review': [{ key: string; review: TradeReview; etag: string | null }, JournalTradeDetail];
  'journaling.playbooks': [Record<string, never>, Playbook[]];
  'journaling.saveNote': [{ date: string; note: string; etag: string | null }, JournalDay];
  'journaling.open': [OpenTarget, boolean];
}

export type JournalingMethod = keyof JournalingMethods;

export interface JournalingEvents {
  view: JournalingView;
  closed: ClosedTrade[];
  // A protocol link arrived: the renderer shows the Journaling page so the user sees the prompt.
  link: { error: string | null };
}

export type JournalingEvent = keyof JournalingEvents;

export interface JournalingApi {
  request<M extends JournalingMethod>(method: M, params: JournalingMethods[M][0]): Promise<JournalingMethods[M][1]>;
  on<E extends JournalingEvent>(event: E, listener: (data: JournalingEvents[E]) => void): () => void;
}

const loopbackHosts = ['localhost', '127.0.0.1', '[::1]'];

// The journaling platform's origin. Self-hosters may use plain http only on this computer.
export function parsePlatformUrl(input: string): string {
  let url: URL;
  try { url = new URL(input.trim()); }
  catch { throw new Error('Enter the journaling platform address, for example https://tradescribe.io.'); }
  if (url.username || url.password) throw new Error('The platform address must not contain a user name or password.');
  if (url.protocol === 'http:' && !loopbackHosts.includes(url.hostname)) throw new Error('Use https. Plain http is allowed only for localhost and 127.0.0.1.');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The platform address must start with https://.');
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('Enter only the platform address, without a path, for example https://tradescribe.io.');
  return url.origin;
}

export function isSamePlatform(left: string, right: string): boolean {
  try { return new URL(left).origin === new URL(right).origin; }
  catch { return false; }
}

const codeAlphabet = /^[A-Z0-9]{8}$/;

// Codes are shown as XXXX-XXXX; people paste them with or without the hyphen, in any case.
export function normalizeCode(input: string): string | null {
  const compact = input.replace(/[\s-]/g, '').toUpperCase();
  return codeAlphabet.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4)}` : null;
}
