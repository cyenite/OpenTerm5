import type { SerializedDrawing } from '@meridian/charts';
import { fromTradingViewLineTool, tradingViewDrawingId } from '@meridian/charts/interop/tradingview';
import type { TradingViewStreamStatus, TradingViewSymbol, TradingViewWatchedLayout } from '../../shared/tradingview';
import { brokerClock } from './broker-clock';
import { serverOffsetAt, type ServerClock } from './server-clock';
import { log, session, terminal } from './session';
import { Store } from './store';
import { drawingsForSymbol, setSymbolDrawings, symbolDrawings } from './symbol-drawings';
import { tickSize } from './tradingview';
import type { SkippedDrawings } from './tradingview-model';
import { applyRemote, eventsOf, eventsOfReload, outgoing, restoreLinks, restoreSyncedDrawing, syncedFrom, type RemoteEvent, type RemoteResult, type SyncedDrawing, type SyncLink, type SyncOptions } from './tradingview-sync-model';
import { loadLedger, saveLedger } from './tradingview-sync-storage';

// Keeps linked symbols' drawings in step with TradingView: its change stream and reloads bring
// TradingView's edits in, and edits here are saved there shortly after they are made.

export type LinkState = 'starting' | 'live' | 'saving' | 'waiting' | 'paused' | 'error';

export interface LinkStatus {
  state: LinkState;
  message?: string;
  heldDeletions?: number;
}

export interface TradingViewSyncState {
  links: readonly SyncLink[];
  // By account symbol.
  statuses: Readonly<Record<string, LinkStatus>>;
  // By layout id.
  streams: Readonly<Record<string, TradingViewStreamStatus>>;
}

export interface SyncStartSummary {
  synced: number;
  // Drawings saved inside an older layout: copied, but they can't sync.
  copiedOnly: number;
  skipped: SkippedDrawings[];
  skippedLayouts: readonly { layoutName: string; reason: string }[];
}

const LINKS_KEY = 'openterm.tradingview-sync.v1';

const PUSH_DELAY_MS = 800;
const RETRY_MS = 60_000;
// TradingView's own chart stops saving this long after it is told to slow down.
const COOLDOWN_MS = 5 * 60_000;

function loadLinks(): SyncLink[] {
  try {
    return restoreLinks(JSON.parse(localStorage.getItem(LINKS_KEY) ?? 'null'));
  } catch {
    return [];
  }
}

export const tradingViewSync = new Store<TradingViewSyncState>({ links: loadLinks(), statuses: {}, streams: {} });

const ledger = new Map<string, SyncedDrawing>();
const inFlight = new Set<string>();
const rerun = new Set<string>();
const allowMassDelete = new Set<string>();
const reported = new Set<string>();

let isLedgerReady = false;
let isFollowing = false;
let cooldownUntil = 0;
let clock: { key: string; value: Promise<ServerClock> } | null = null;
let pushTimer: ReturnType<typeof setTimeout> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

const setStatus = (symbol: string, status: LinkStatus) => tradingViewSync.set((state) => ({ statuses: { ...state.statuses, [symbol]: status } }));

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const isRateLimited = (error: unknown) => /limiting requests|\b429\b/.test(messageOf(error));

// A save TradingView refuses outright is not retried on a timer: it would only be refused again.
const isRefused = (error: unknown) => /refused access|\b40[13]\b/.test(messageOf(error));

function saveLinks(links: readonly SyncLink[]): void {
  tradingViewSync.set({ links });
  try {
    localStorage.setItem(LINKS_KEY, JSON.stringify(links));
  } catch (error) {
    log(`TradingView sync links could not be saved: ${messageOf(error)}`, 'TradingView');
  }
}

// Deletion tombstones stay in memory only: the undo history they serve does not outlive the session.
function persist(upserts: readonly SyncedDrawing[], removals: readonly string[]): void {
  for (const entry of upserts) ledger.set(entry.drawing.id, entry);
  for (const id of removals) ledger.delete(id);
  const kept = upserts.filter((entry) => !entry.isDeleted);
  const dropped = [...removals, ...upserts.filter((entry) => entry.isDeleted).map((entry) => entry.drawing.id)];
  saveLedger(kept.map((entry) => [entry.drawing.id, entry]), dropped).catch((error) => log(`The TradingView sync record could not be saved: ${messageOf(error)}`, 'TradingView'));
}

// The trading account, once its symbols have loaded: positions need their price step, and the
// broker clock reads a forex major's history.
const accountKey = () => {
  const { account, symbols } = session.get();
  return account && Object.keys(symbols).length ? `${account.server}|${account.login}` : null;
};

// Times are placed with the broker's server clock, read once per trading account.
async function syncOptions(symbol: string): Promise<SyncOptions> {
  const key = accountKey();
  if (!key) throw new Error('Log in to a trading account and wait for its symbols to load: synced drawings are placed on its bars using the broker\'s server clock.');
  if (clock?.key !== key) {
    const value = brokerClock().then(({ clock: read }) => read);
    value.catch(() => { if (clock?.value === value) clock = null; });
    clock = { key, value };
  }
  const read = await clock.value;
  return { now: Date.now(), tickSize: tickSize(symbol), serverOffsetAt: (utcMs) => serverOffsetAt(read, utcMs) };
}

function commit(link: SyncLink, result: RemoteResult): void {
  persist(result.upserts, result.removals);
  const current = drawingsForSymbol(symbolDrawings.get(), link.symbol);
  if (result.drawings.length !== current.length || result.drawings.some((drawing, index) => drawing !== current[index])) setSymbolDrawings(link.symbol, result.drawings);
  for (const note of result.notes) log(note, 'TradingView');
}

async function applyEvents(link: SyncLink, events: readonly RemoteEvent[]): Promise<void> {
  if (!events.length) return;
  const options = await syncOptions(link.symbol);
  commit(link, applyRemote(ledger, link, drawingsForSymbol(symbolDrawings.get(), link.symbol), events, options));
}

// Reads the links' drawings afresh in one request, catching up on what the change stream did not
// deliver, then saves what changed here meanwhile.
async function reload(links: readonly SyncLink[]): Promise<void> {
  if (!links.length) return;
  for (const link of links) setStatus(link.symbol, { state: 'starting', message: 'Reading TradingView.' });
  try {
    const { sets, skippedLayouts } = await terminal.request('tradingview.drawings', { symbols: links.map((link) => link.tradingView) });
    const refused = new Set(skippedLayouts.map((layout) => layout.layoutName));
    for (const link of links) {
      const isTargetRead = (source: SyncedDrawing['source']) => !refused.has(source.scope === 'synced' ? 'Drawings synced to all layouts' : source.layoutName) && link.tradingView.sources.some((known) => known.layoutId === source.layoutId && known.scope === source.scope && known.chartId === source.chartId);
      const tools = sets.find((set) => set.symbol === link.tradingView.symbol)?.tools ?? [];
      await applyEvents(link, eventsOfReload(tools, link, ledger, isTargetRead));
      setStatus(link.symbol, { state: 'live' });
    }
    pushSoon(0);
  } catch (error) {
    for (const link of links) setStatus(link.symbol, { state: 'error', message: messageOf(error) });
  }
}

const layoutsOf = (links: readonly SyncLink[]): TradingViewWatchedLayout[] => [...new Map(links.flatMap((link) => link.tradingView.sources).map((source) => [source.layoutId, { layoutId: source.layoutId, layoutUrl: source.layoutUrl, layoutName: source.layoutName }])).values()];

let watching = '';

// Follows the layouts the links draw from, once a trading account gives the clock, and catches
// up on links it was not following yet (the main process keeps its streams across a page reload,
// so a stream coming up cannot be relied on for that).
async function follow(): Promise<void> {
  const { links } = tradingViewSync.get();
  const layouts = isLedgerReady && accountKey() ? layoutsOf(links) : [];
  const key = JSON.stringify(layouts.map((layout) => layout.layoutId));
  if (key === watching) return;
  watching = key;
  if (!layouts.length) {
    isFollowing = false;
    for (const link of links) setStatus(link.symbol, { state: 'waiting', message: isLedgerReady ? 'Log in to a trading account to sync.' : 'Starting.' });
    await terminal.request('tradingview.watch', { layouts: [] }).catch(() => undefined);
    return;
  }
  try {
    await terminal.request('tradingview.watch', { layouts });
    isFollowing = true;
    await reload(links);
  } catch (error) {
    watching = '';
    isFollowing = false;
    for (const link of links) setStatus(link.symbol, { state: 'error', message: messageOf(error) });
  }
}

// A stream that comes back after dropping may have missed changes.
function onStream(status: TradingViewStreamStatus): void {
  const before = tradingViewSync.get().streams[status.layoutId]?.state;
  tradingViewSync.set((state) => ({ streams: { ...state.streams, [status.layoutId]: status } }));
  const links = tradingViewSync.get().links.filter((link) => link.tradingView.sources.some((source) => source.layoutId === status.layoutId));
  if (status.state === 'live' && before === 'down') void reload(links);
  if (status.state === 'down') for (const link of links) setStatus(link.symbol, { state: 'error', message: `${status.reason ?? 'TradingView\'s change stream dropped.'} Reconnecting.` });
}

function report(key: string, message: string): void {
  if (reported.has(key)) return;
  reported.add(key);
  log(message, 'TradingView');
}

async function pushLink(link: SyncLink): Promise<void> {
  if (inFlight.has(link.symbol)) {
    rerun.add(link.symbol);
    return;
  }
  inFlight.add(link.symbol);
  try {
    const options = await syncOptions(link.symbol);
    const plan = outgoing(ledger, link, drawingsForSymbol(symbolDrawings.get(), link.symbol), { ...options, isMassDeleteAllowed: allowMassDelete.delete(link.symbol) });
    if (plan.edited.length) persist(plan.edited, []);
    for (const { drawing, reason } of plan.unwritable) report(`${drawing.id}|${reason}`, `${link.symbol}: a ${drawing.type} edited here can't be saved to TradingView: ${reason}.`);
    for (const { drawing, keys } of plan.unwritten) report(`${drawing.id}|${keys.join()}`, `${link.symbol}: TradingView has no place for these settings of a ${drawing.type}, so they stay here only: ${keys.join(', ')}.`);
    const held = plan.heldDeletions.length;
    const settled = (): LinkStatus => {
      if (held) return { state: 'paused', heldDeletions: held, message: `${held} drawings were deleted here at once.` };
      const [stuck] = plan.unwritable;
      return stuck ? { state: 'error', message: `${plan.unwritable.length} edit${plan.unwritable.length === 1 ? '' : 's'} here can't be saved to TradingView: ${stuck.reason}.` } : { state: 'live' };
    };
    if (!plan.pushes.length) {
      setStatus(link.symbol, settled());
      return;
    }
    setStatus(link.symbol, { state: 'saving' });
    for (const push of plan.pushes) {
      const { serverUpdateTime } = await terminal.request('tradingview.push', { source: push.source, records: push.records });
      persist(push.entries.map(({ entry }) => ({ ...entry, serverUpdateTime, record: { ...entry.record, serverUpdateTime } })), []);
    }
    setStatus(link.symbol, settled());
  } catch (error) {
    if (isRateLimited(error)) {
      cooldownUntil = Date.now() + COOLDOWN_MS;
      setStatus(link.symbol, { state: 'waiting', message: 'TradingView asked to slow down; saving again in 5 minutes.' });
      retrySoon(COOLDOWN_MS);
    } else if (isRefused(error)) {
      setStatus(link.symbol, { state: 'error', message: `TradingView refused the save, so edits here are not being saved there. ${messageOf(error)}` });
    } else {
      setStatus(link.symbol, { state: 'error', message: messageOf(error) });
      retrySoon(RETRY_MS);
    }
  } finally {
    inFlight.delete(link.symbol);
    if (rerun.delete(link.symbol)) void pushLink(link);
  }
}

function retrySoon(ms: number): void {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => pushSoon(0), ms);
}

function pushSoon(delay = PUSH_DELAY_MS): void {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    if (!isFollowing) return;
    const wait = cooldownUntil - Date.now();
    if (wait > 0) return retrySoon(wait);
    for (const link of tradingViewSync.get().links) void pushLink(link);
  }, delay);
}

// Starts syncing the chosen symbols. TradingView's current drawings replace earlier copies here,
// so syncing starts from what TradingView has.
export async function startSyncing(choices: readonly { symbol: TradingViewSymbol; target: string }[]): Promise<SyncStartSummary> {
  if (!isLedgerReady) throw new Error('TradingView sync is still starting. Try again in a moment.');
  const { sets, skippedLayouts } = await terminal.request('tradingview.drawings', { symbols: choices.map((choice) => choice.symbol) });
  const skipped = new Map<string, number>();
  let synced = 0;
  let copiedOnly = 0;
  const links = [...tradingViewSync.get().links];
  for (const choice of choices) {
    const options = await syncOptions(choice.target);
    const tools = sets.find((set) => set.symbol === choice.symbol.symbol)?.tools ?? [];
    const link: SyncLink = { symbol: choice.target, tradingView: choice.symbol };
    const incoming = new Set(tools.map((tool) => tradingViewDrawingId(tool.id)));
    const stale = [...ledger.values()].filter((entry) => entry.symbol === choice.target).map((entry) => entry.drawing.id);
    const replaced = new Set([...incoming, ...stale]);
    const kept = drawingsForSymbol(symbolDrawings.get(), choice.target).filter((drawing) => !replaced.has(drawing.id));
    const entries: SyncedDrawing[] = [];
    const copies: SerializedDrawing[] = [];
    const skip = (type: string, reason: string) => {
      const key = `${type.replace(/^LineTool/, '')}: ${reason}`;
      skipped.set(key, (skipped.get(key) ?? 0) + 1);
    };
    for (const tool of tools) {
      // Tools saved inside an older layout can only be copied: writing them means saving the layout.
      if (!tool.origin && tool.isOnPrice) {
        const copy = fromTradingViewLineTool(tool, options);
        if (copy.kind === 'drawing') copies.push(copy.drawing);
        else skip(tool.type, copy.reason);
        continue;
      }
      const entry = syncedFrom(tool, choice.target, undefined, options);
      if (typeof entry === 'string') skip(tool.type, entry);
      else entries.push(entry);
    }
    persist(entries, stale.filter((id) => !entries.some((entry) => entry.drawing.id === id)));
    setSymbolDrawings(choice.target, [...kept, ...copies, ...entries.map((entry) => entry.drawing)]);
    synced += entries.length;
    copiedOnly += copies.length;
    const index = links.findIndex((candidate) => candidate.symbol === choice.target || candidate.tradingView.symbol === choice.symbol.symbol);
    if (index >= 0) links.splice(index, 1);
    links.push(link);
  }
  saveLinks(links);
  log(`Syncing ${synced} drawing${synced === 1 ? '' : 's'} with TradingView for ${choices.map((choice) => choice.target).join(', ')}.`, 'TradingView');
  watching = '';
  await follow();
  return { synced, copiedOnly, skipped: [...skipped].map(([reason, count]) => ({ reason, count })).sort((left, right) => right.count - left.count), skippedLayouts };
}

// Stops syncing a symbol; its drawings stay here as plain copies.
export async function stopSyncing(symbol: string): Promise<void> {
  saveLinks(tradingViewSync.get().links.filter((link) => link.symbol !== symbol));
  persist([], [...ledger.values()].filter((entry) => entry.symbol === symbol).map((entry) => entry.drawing.id));
  tradingViewSync.set((state) => ({ statuses: Object.fromEntries(Object.entries(state.statuses).filter(([key]) => key !== symbol)) }));
  await follow();
}

export function confirmDeletions(symbol: string): void {
  allowMassDelete.add(symbol);
  pushSoon(0);
}

// Brings back drawings whose deletion is held, as TradingView still has them.
export function restoreDeletions(symbol: string): void {
  const held = [...ledger.values()].filter((entry) => entry.symbol === symbol && !entry.isDeleted && !drawingsForSymbol(symbolDrawings.get(), symbol).some((drawing) => drawing.id === entry.drawing.id));
  setSymbolDrawings(symbol, [...drawingsForSymbol(symbolDrawings.get(), symbol), ...held.map((entry) => entry.drawing)]);
  persist(held.map((entry) => ({ ...entry, editedAt: undefined })), []);
}

export function syncNow(symbol: string): void {
  if (isFollowing) void reload(tradingViewSync.get().links.filter((link) => link.symbol === symbol));
}

export const syncedCount = (symbol: string) => [...ledger.values()].filter((entry) => entry.symbol === symbol && !entry.isDeleted).length;

export function startTradingViewSync(): void {
  terminal.on('tradingViewStream', onStream);
  terminal.on('tradingViewChanges', ({ changes }) => {
    for (const link of tradingViewSync.get().links) {
      const events = changes.flatMap((change) => eventsOf(change, link, ledger));
      applyEvents(link, events).catch((error) => setStatus(link.symbol, { state: 'error', message: messageOf(error) }));
    }
  });
  symbolDrawings.subscribe(() => { if (tradingViewSync.get().links.length) pushSoon(); });
  let account = accountKey();
  session.subscribe(() => {
    if (accountKey() === account) return;
    account = accountKey();
    void follow();
  });
  loadLedger().then((entries) => {
    for (const [id, value] of entries) {
      const entry = restoreSyncedDrawing(value);
      if (entry && entry.drawing.id === id) ledger.set(id, entry);
    }
  }, (error) => log(`The TradingView sync record could not be read: ${messageOf(error)}`, 'TradingView')).finally(() => {
    isLedgerReady = true;
    void follow();
  });
}
