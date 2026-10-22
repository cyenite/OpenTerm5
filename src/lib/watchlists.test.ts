import assert from 'node:assert/strict';
import test from 'node:test';
import type { AccountProfile, TerminalApi } from '../../shared/protocol';

const stored = new Map<string, string>();
const storage = {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { stored.set(key, value); },
  removeItem: (key: string) => { stored.delete(key); },
};
const fake = { platform: 'linux', on: () => () => undefined, request: () => Promise.resolve([]), link: async () => ({ url: '', state: 'idle' }) } as unknown as TerminalApi;
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
Object.defineProperty(globalThis, 'window', { configurable: true, value: { terminal: fake, automation: fake, journaling: fake, localStorage: storage } });

// The modules read window and localStorage when they load, so they are imported after the fakes.
const loaded = Promise.all([import('./session'), import('./watchlists'), import('./watchlist-model')]);

const profile = (id: string, platform: AccountProfile['platform']): AccountProfile => ({
  id, platform, name: id, label: id, server: '', company: '', webEndpoint: '', tradeMode: 'demo', login: 1, lastUsed: 0, hasPassword: false, isPasswordSaved: false,
});

const names = (list: { entries: readonly { kind: string; name?: string }[] }) => list.entries.filter((entry) => entry.kind === 'symbol').map((entry) => entry.name);

test('each platform keeps its own watchlists, and an exchange starts from crypto contracts', async () => {
  const [{ session }, { watchlists, startWatchlists, addToWatchlist }, { activeWatchlist, defaultSymbols }] = await loaded;
  const accounts = [profile('mt5|1', 'mt5'), profile('bybit:demo|1', 'bybit')];
  startWatchlists();
  assert.deepEqual(names(activeWatchlist(watchlists.get())), defaultSymbols.mt5);
  session.set({ accounts, profileId: 'bybit:demo|1' });
  assert.deepEqual(names(activeWatchlist(watchlists.get())), defaultSymbols.bybit);
  addToWatchlist(['LINKUSDT']);
  session.set({ profileId: 'mt5|1' });
  assert.deepEqual(names(activeWatchlist(watchlists.get())), defaultSymbols.mt5);
  session.set({ profileId: null });
  assert.deepEqual(names(activeWatchlist(watchlists.get())), defaultSymbols.mt5, 'logged out keeps the last lists');
  session.set({ profileId: 'bybit:demo|1' });
  assert.deepEqual(names(activeWatchlist(watchlists.get())), [...defaultSymbols.bybit, 'LINKUSDT']);
  assert.ok(stored.has('openterm.watchlists.v2') && stored.has('openterm.watchlists.bybit.v1'));
});
