import type { Platform } from '../../shared/protocol';
import { presetName } from './presets';

export type WatchEntry =
  | { readonly kind: 'symbol'; readonly name: string }
  | { readonly kind: 'section'; readonly id: string; readonly name: string; readonly isCollapsed: boolean };

export interface Watchlist {
  readonly id: string;
  readonly name: string;
  readonly entries: readonly WatchEntry[];
}

export interface WatchlistsState {
  readonly activeId: string;
  readonly lists: readonly Watchlist[];
}

export type WatchRow =
  | { readonly kind: 'section'; readonly index: number; readonly entry: Extract<WatchEntry, { kind: 'section' }>; readonly count: number }
  | { readonly kind: 'symbol'; readonly index: number; readonly name: string; readonly symbol: string | null };

export type Resolve = (name: string) => string | null;

export const defaultSymbols: Record<Platform, readonly string[]> = {
  mt5: ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCHF', 'USDCAD', 'XAUUSD'],
  bybit: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'DOGEUSDT'],
};

const MAX_LISTS = 100;
const MAX_ENTRIES = 1000;

const symbolEntry = (name: string): WatchEntry => ({ name, kind: 'symbol' });

export function defaultWatchlists(id: string, platform: Platform = 'mt5'): WatchlistsState {
  return { activeId: id, lists: [{ id, name: 'Watchlist', entries: defaultSymbols[platform].map(symbolEntry) }] };
}

export function activeWatchlist(state: WatchlistsState): Watchlist {
  return state.lists.find((list) => list.id === state.activeId) ?? state.lists[0];
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 128;
}

function restoreEntry(value: unknown): WatchEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  if (entry.kind === 'symbol' && isName(entry.name)) return symbolEntry(entry.name);
  if (entry.kind === 'section' && isName(entry.name) && isName(entry.id)) return { kind: 'section', id: entry.id, name: entry.name, isCollapsed: entry.isCollapsed === true };
  return null;
}

// Storage is user data from an older build or a hand edit; anything malformed is dropped, not fatal.
export function restoreWatchlists(value: unknown): WatchlistsState | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as { activeId?: unknown; lists?: unknown };
  if (!Array.isArray(raw.lists)) return null;
  const lists: Watchlist[] = [];
  for (const item of raw.lists.slice(0, MAX_LISTS)) {
    if (!item || typeof item !== 'object') continue;
    const list = item as Record<string, unknown>;
    if (!isName(list.id) || !isName(list.name) || !Array.isArray(list.entries) || lists.some((other) => other.id === list.id)) continue;
    const entries = list.entries.slice(0, MAX_ENTRIES).map(restoreEntry).filter((entry): entry is WatchEntry => entry !== null);
    lists.push({ entries, id: list.id, name: list.name });
  }
  if (!lists.length) return null;
  const activeId = typeof raw.activeId === 'string' && lists.some((list) => list.id === raw.activeId) ? raw.activeId : lists[0].id;
  return { activeId, lists };
}

// Saved Market Watch sets from earlier builds were per account; watchlists follow the instrument
// across brokers, so each set becomes a list of its own.
export function importLegacySets(state: WatchlistsState, value: unknown, newId: () => string): WatchlistsState {
  if (!Array.isArray(value)) return state;
  let next = state;
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const preset = item as { name?: unknown; symbols?: unknown };
    if (!isName(preset.name) || !Array.isArray(preset.symbols)) continue;
    const names = [...new Set(preset.symbols.filter(isName))];
    if (!names.length) continue;
    const list: Watchlist = { id: newId(), name: uniqueName(next, preset.name.trim()), entries: names.map(symbolEntry) };
    next = { ...next, lists: [...next.lists, list] };
  }
  return next;
}

function uniqueName(state: WatchlistsState, wanted: string, except?: string): string {
  const taken = new Set(state.lists.filter((list) => list.id !== except).map((list) => list.name.toLowerCase()));
  if (!taken.has(wanted.toLowerCase())) return wanted;
  for (let suffix = 2; ; suffix++) {
    const name = `${wanted} (${suffix})`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

function replaceList(state: WatchlistsState, id: string, change: (list: Watchlist) => Watchlist): WatchlistsState {
  return { ...state, lists: state.lists.map((list) => (list.id === id ? change(list) : list)) };
}

export function createWatchlist(state: WatchlistsState, id: string, name: string, entries: readonly WatchEntry[] = []): WatchlistsState {
  if (state.lists.length >= MAX_LISTS) throw new Error(`At most ${MAX_LISTS} watchlists can be kept.`);
  return { activeId: id, lists: [...state.lists, { id, entries, name: uniqueName(state, presetName(name)) }] };
}

export function renameWatchlist(state: WatchlistsState, id: string, name: string): WatchlistsState {
  const checked = uniqueName(state, presetName(name), id);
  return replaceList(state, id, (list) => ({ ...list, name: checked }));
}

export function duplicateWatchlist(state: WatchlistsState, id: string, copyId: string, newId: () => string): WatchlistsState {
  const source = state.lists.find((list) => list.id === id);
  if (!source) return state;
  const entries = source.entries.map((entry) => (entry.kind === 'section' ? { ...entry, id: newId() } : entry));
  return createWatchlist(state, copyId, `${source.name.slice(0, 59)} copy`, entries);
}

// The last list is emptied rather than removed so Market Watch always has a list to show.
export function deleteWatchlist(state: WatchlistsState, id: string): WatchlistsState {
  const lists = state.lists.filter((list) => list.id !== id);
  if (!lists.length) return { activeId: id, lists: [{ id, name: 'Watchlist', entries: [] }] };
  return { lists, activeId: state.activeId === id ? lists[0].id : state.activeId };
}

function isSameSymbol(left: string, right: string, resolve: Resolve): boolean {
  if (left === right) return true;
  const resolved = resolve(left);
  return resolved !== null && resolved === resolve(right);
}

export function hasSymbol(list: Watchlist, name: string, resolve: Resolve): boolean {
  return list.entries.some((entry) => entry.kind === 'symbol' && isSameSymbol(entry.name, name, resolve));
}

// Section ends at the next section header; `null` means the symbols above the first section.
function sectionEnd(entries: readonly WatchEntry[], sectionId: string | null): number {
  const start = sectionId === null ? 0 : entries.findIndex((entry) => entry.kind === 'section' && entry.id === sectionId) + 1;
  if (sectionId !== null && start === 0) return entries.length;
  const next = entries.findIndex((entry, index) => index >= start && entry.kind === 'section');
  return next < 0 ? entries.length : next;
}

export function addSymbols(list: Watchlist, names: readonly string[], resolve: Resolve, sectionId?: string | null): Watchlist {
  const added: WatchEntry[] = [];
  for (const name of names) {
    const isKnown = hasSymbol(list, name, resolve) || added.some((entry) => entry.kind === 'symbol' && isSameSymbol(entry.name, name, resolve));
    if (!isKnown) added.push(symbolEntry(name));
  }
  if (!added.length) return list;
  if (list.entries.length + added.length > MAX_ENTRIES) throw new Error(`A watchlist holds at most ${MAX_ENTRIES} rows.`);
  const at = sectionId === undefined ? list.entries.length : sectionEnd(list.entries, sectionId);
  return { ...list, entries: [...list.entries.slice(0, at), ...added, ...list.entries.slice(at)] };
}

export function removeSymbols(list: Watchlist, names: readonly string[], resolve: Resolve): Watchlist {
  const entries = list.entries.filter((entry) => entry.kind !== 'symbol' || !names.some((name) => isSameSymbol(entry.name, name, resolve)));
  return entries.length === list.entries.length ? list : { ...list, entries };
}

export function addSection(list: Watchlist, id: string, name: string, at = list.entries.length): Watchlist {
  const section: WatchEntry = { id, kind: 'section', name: presetName(name), isCollapsed: false };
  return { ...list, entries: [...list.entries.slice(0, at), section, ...list.entries.slice(at)] };
}

function changeSection(list: Watchlist, id: string, change: (entry: Extract<WatchEntry, { kind: 'section' }>) => WatchEntry): Watchlist {
  return { ...list, entries: list.entries.map((entry) => (entry.kind === 'section' && entry.id === id ? change(entry) : entry)) };
}

export function renameSection(list: Watchlist, id: string, name: string): Watchlist {
  const checked = presetName(name);
  return changeSection(list, id, (entry) => ({ ...entry, name: checked }));
}

export function toggleSection(list: Watchlist, id: string): Watchlist {
  return changeSection(list, id, (entry) => ({ ...entry, isCollapsed: !entry.isCollapsed }));
}

// Without its symbols the section's rows join the section above it.
export function removeSection(list: Watchlist, id: string, isWithSymbols: boolean): Watchlist {
  const start = list.entries.findIndex((entry) => entry.kind === 'section' && entry.id === id);
  if (start < 0) return list;
  const end = isWithSymbols ? sectionEnd(list.entries, id) : start + 1;
  return { ...list, entries: [...list.entries.slice(0, start), ...list.entries.slice(end)] };
}

// `to` is the entry index the moved row should land before, counted before the move. A section
// header carries its symbols with it.
export function moveEntry(list: Watchlist, from: number, to: number): Watchlist {
  const entry = list.entries[from];
  if (!entry) return list;
  const end = entry.kind === 'section' ? sectionEnd(list.entries, entry.id) : from + 1;
  if (to >= from && to <= end) return list;
  const block = list.entries.slice(from, end);
  const rest = [...list.entries.slice(0, from), ...list.entries.slice(end)];
  const at = to > from ? to - block.length : to;
  return { ...list, entries: [...rest.slice(0, at), ...block, ...rest.slice(at)] };
}

export function sortSymbols(list: Watchlist): Watchlist {
  const entries: WatchEntry[] = [];
  let run: Extract<WatchEntry, { kind: 'symbol' }>[] = [];
  const flush = () => {
    entries.push(...run.sort((left, right) => left.name.localeCompare(right.name)));
    run = [];
  };
  for (const entry of list.entries) {
    if (entry.kind === 'symbol') run.push(entry);
    else {
      flush();
      entries.push(entry);
    }
  }
  flush();
  return { ...list, entries };
}

export function watchRows(list: Watchlist, resolve: Resolve): WatchRow[] {
  const rows: WatchRow[] = [];
  let header = -1;
  let isCollapsed = false;
  list.entries.forEach((entry, index) => {
    if (entry.kind === 'section') {
      header = rows.length;
      isCollapsed = entry.isCollapsed;
      rows.push({ entry, index, kind: 'section', count: 0 });
      return;
    }
    const row = rows[header];
    if (row?.kind === 'section') rows[header] = { ...row, count: row.count + 1 };
    if (!isCollapsed) rows.push({ index, kind: 'symbol', name: entry.name, symbol: resolve(entry.name) });
  });
  return rows;
}

// Every symbol the list names that this account offers, in list order, including collapsed ones.
export function resolvedSymbols(list: Watchlist, resolve: Resolve): string[] {
  const names = new Set<string>();
  for (const entry of list.entries) {
    const symbol = entry.kind === 'symbol' ? resolve(entry.name) : null;
    if (symbol) names.add(symbol);
  }
  return [...names];
}
