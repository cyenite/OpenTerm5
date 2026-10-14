import type { SymbolSpec } from '../../shared/protocol';
import { matchSymbol } from '../../shared/symbol-match';
import { log, session, setWatchedSymbols } from './session';
import { Store, useStore } from './store';
import { newId } from './workspace';
import {
  activeWatchlist, addSection, addSymbols, createWatchlist, defaultWatchlists, deleteWatchlist, duplicateWatchlist, hasSymbol, importLegacySets, moveEntry,
  removeSection, removeSymbols, renameSection, renameWatchlist, resolvedSymbols, restoreWatchlists, sortSymbols, toggleSection, watchRows,
  type Resolve, type Watchlist, type WatchlistsState, type WatchRow,
} from './watchlist-model';

const STORAGE_KEY = 'openterm.watchlists.v2';
const LEGACY_KEY = 'openterm.watchlists.v1';

function load(): WatchlistsState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const restored = saved ? restoreWatchlists(JSON.parse(saved)) : null;
    if (restored) return restored;
    if (saved) log('Saved watchlists were unreadable; starting from the default list.', 'Market Watch');
    const legacy = localStorage.getItem(LEGACY_KEY);
    return importLegacySets(defaultWatchlists(newId()), legacy ? JSON.parse(legacy) : null, newId);
  } catch (error) {
    log(`Saved watchlists could not be read: ${(error as Error).message}`, 'Market Watch');
    return defaultWatchlists(newId());
  }
}

export const watchlists = new Store<WatchlistsState>(load());

const resolvers = new WeakMap<Record<string, SymbolSpec>, Resolve>();

// Lists name symbols the way the broker they were added on does; each account resolves them to
// its own decoration (EURUSD.m, mEURUSD) or another name for the instrument (GOLD for XAUUSD).
export function resolverFor(symbols: Record<string, SymbolSpec>): Resolve {
  let found = resolvers.get(symbols);
  if (found) return found;
  const names = Object.keys(symbols);
  const cache = new Map<string, string | null>();
  found = (name) => {
    if (symbols[name]) return name;
    if (!cache.has(name)) cache.set(name, names.length ? matchSymbol(name, names) : null);
    return cache.get(name) ?? null;
  };
  resolvers.set(symbols, found);
  return found;
}

const rowCache = new WeakMap<Watchlist, WeakMap<Record<string, SymbolSpec>, WatchRow[]>>();
const specCache = new WeakMap<Watchlist, WeakMap<Record<string, SymbolSpec>, SymbolSpec[]>>();

function cached<T>(cache: WeakMap<Watchlist, WeakMap<Record<string, SymbolSpec>, T>>, list: Watchlist, symbols: Record<string, SymbolSpec>, build: () => T): T {
  let bySymbols = cache.get(list);
  if (!bySymbols) cache.set(list, bySymbols = new WeakMap());
  let found = bySymbols.get(symbols);
  if (found === undefined) bySymbols.set(symbols, found = build());
  return found;
}

export function rowsOf(list: Watchlist, symbols: Record<string, SymbolSpec>): WatchRow[] {
  return cached(rowCache, list, symbols, () => watchRows(list, resolverFor(symbols)));
}

export function watchedSpecs(list: Watchlist, symbols: Record<string, SymbolSpec>): SymbolSpec[] {
  return cached(specCache, list, symbols, () => resolvedSymbols(list, resolverFor(symbols)).map((name) => symbols[name]));
}

export function useActiveWatchlist(): Watchlist {
  return useStore(watchlists, activeWatchlist);
}

export function useWatchedSpecs(): SymbolSpec[] {
  const list = useActiveWatchlist();
  const symbols = useStore(session, (state) => state.symbols);
  return watchedSpecs(list, symbols);
}

export function currentWatchedSpecs(): SymbolSpec[] {
  return watchedSpecs(activeWatchlist(watchlists.get()), session.get().symbols);
}

const resolveNow = () => resolverFor(session.get().symbols);

function changeActive(change: (list: Watchlist) => Watchlist): void {
  const state = watchlists.get();
  const list = activeWatchlist(state);
  const next = change(list);
  if (next !== list) watchlists.set({ lists: state.lists.map((item) => (item.id === list.id ? next : item)) });
}

export function selectWatchlist(id: string): void {
  watchlists.set({ activeId: id });
}

export function newWatchlist(name: string): void {
  watchlists.set((state) => createWatchlist(state, newId(), name));
}

export function renameActiveWatchlist(name: string): void {
  watchlists.set((state) => renameWatchlist(state, state.activeId, name));
}

export function duplicateActiveWatchlist(): void {
  watchlists.set((state) => duplicateWatchlist(state, state.activeId, newId(), newId));
}

export function deleteActiveWatchlist(): void {
  watchlists.set((state) => deleteWatchlist(state, state.activeId));
}

export function addToWatchlist(names: readonly string[], listId?: string, sectionId?: string | null): void {
  const state = watchlists.get();
  const id = listId ?? activeWatchlist(state).id;
  watchlists.set({ lists: state.lists.map((list) => (list.id === id ? addSymbols(list, names, resolveNow(), sectionId) : list)) });
}

export function removeFromWatchlist(names: readonly string[]): void {
  changeActive((list) => removeSymbols(list, names, resolveNow()));
}

export function isWatched(name: string): boolean {
  return hasSymbol(activeWatchlist(watchlists.get()), name, resolveNow());
}

export function toggleWatched(name: string): void {
  if (isWatched(name)) removeFromWatchlist([name]);
  else addToWatchlist([name]);
}

export function addWatchSection(name: string, at?: number): void {
  changeActive((list) => addSection(list, newId(), name, at));
}

export function renameWatchSection(id: string, name: string): void {
  changeActive((list) => renameSection(list, id, name));
}

export function toggleWatchSection(id: string): void {
  changeActive((list) => toggleSection(list, id));
}

export function removeWatchSection(id: string, isWithSymbols: boolean): void {
  changeActive((list) => removeSection(list, id, isWithSymbols));
}

export function moveWatchEntry(from: number, to: number): void {
  changeActive((list) => moveEntry(list, from, to));
}

export function sortActiveWatchlist(): void {
  changeActive(sortSymbols);
}

let seen: { list: Watchlist; symbols: Record<string, SymbolSpec> } | undefined;

function sync(): void {
  const list = activeWatchlist(watchlists.get());
  const { symbols } = session.get();
  if (seen?.list === list && seen.symbols === symbols) return;
  seen = { list, symbols };
  setWatchedSymbols(watchedSpecs(list, symbols).map((spec) => spec.name));
}

export function startWatchlists(): void {
  let isSaveFailing = false;
  const save = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlists.get()));
      isSaveFailing = false;
    } catch (error) {
      if (!isSaveFailing) log(`Watchlists could not be saved: ${(error as Error).message}`, 'Market Watch');
      isSaveFailing = true;
    }
  };
  save();
  watchlists.subscribe(save);
  watchlists.subscribe(sync);
  session.subscribe(sync);
  sync();
}
