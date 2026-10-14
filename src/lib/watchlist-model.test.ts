import assert from 'node:assert/strict';
import test from 'node:test';
import { matchSymbol } from '../../shared/symbol-match';
import {
  activeWatchlist, addSection, addSymbols, createWatchlist, defaultWatchlists, deleteWatchlist, duplicateWatchlist, hasSymbol, importLegacySets,
  moveEntry, removeSection, removeSymbols, renameWatchlist, resolvedSymbols, restoreWatchlists, sortSymbols, toggleSection, watchRows, type Watchlist,
} from './watchlist-model';

const broker = ['EURUSD.m', 'GBPUSD.m', 'XAUUSD.m', 'US30.cash'];
const resolve = (name: string) => matchSymbol(name, broker);
const none = () => null;
let counter = 0;
const newId = () => `id${++counter}`;
const list = (...names: string[]): Watchlist => ({ id: 'w', name: 'Main', entries: names.map((name) => ({ name, kind: 'symbol' as const })) });
const names = (watchlist: Watchlist) => watchlist.entries.map((entry) => (entry.kind === 'symbol' ? entry.name : `[${entry.name}]`));

test('symbols saved on one broker resolve to the decorated names of another', () => {
  const rows = watchRows(list('EURUSD', 'GOLD', 'USDJPY'), resolve);
  assert.deepEqual(rows.map((row) => row.kind === 'symbol' && row.symbol), ['EURUSD.m', 'XAUUSD.m', null]);
  assert.deepEqual(resolvedSymbols(list('EURUSD', 'EURUSD.m', 'USDJPY'), resolve), ['EURUSD.m']);
});

test('adding skips symbols already listed under another decoration', () => {
  const next = addSymbols(list('EURUSD'), ['EURUSD.m', 'GBPUSD.m', 'GBPUSD.m'], resolve);
  assert.deepEqual(names(next), ['EURUSD', 'GBPUSD.m']);
  assert.equal(hasSymbol(next, 'EURUSD.m', resolve), true);
  assert.equal(hasSymbol(next, 'EURUSD.m', none), false);
  assert.deepEqual(names(removeSymbols(next, ['EURUSD.m'], resolve)), ['GBPUSD.m']);
});

test('sections group the symbols below them, collapse and move as a block', () => {
  let watchlist = addSection(list('EURUSD', 'GBPUSD'), 's1', 'Metals');
  watchlist = addSymbols(watchlist, ['XAUUSD'], resolve, 's1');
  watchlist = addSymbols(watchlist, ['US30'], resolve, null);
  assert.deepEqual(names(watchlist), ['EURUSD', 'GBPUSD', 'US30', '[Metals]', 'XAUUSD']);
  const collapsed = toggleSection(watchlist, 's1');
  assert.deepEqual(watchRows(collapsed, resolve).map((row) => (row.kind === 'section' ? `${row.entry.name}:${row.count}` : row.name)), ['EURUSD', 'GBPUSD', 'US30', 'Metals:1']);
  assert.deepEqual(names(moveEntry(watchlist, 3, 0)), ['[Metals]', 'XAUUSD', 'EURUSD', 'GBPUSD', 'US30']);
  assert.deepEqual(names(moveEntry(watchlist, 0, 5)), ['GBPUSD', 'US30', '[Metals]', 'XAUUSD', 'EURUSD']);
  assert.deepEqual(names(moveEntry(watchlist, 0, 1)), names(watchlist));
  assert.deepEqual(names(removeSection(watchlist, 's1', false)), ['EURUSD', 'GBPUSD', 'US30', 'XAUUSD']);
  assert.deepEqual(names(removeSection(watchlist, 's1', true)), ['EURUSD', 'GBPUSD', 'US30']);
  assert.deepEqual(names(sortSymbols(list('US30', 'EURUSD'))), ['EURUSD', 'US30']);
});

test('lists are created, renamed uniquely, duplicated and deleted down to an empty one', () => {
  let state = defaultWatchlists('a');
  state = createWatchlist(state, 'b', 'Watchlist');
  assert.equal(activeWatchlist(state).name, 'Watchlist (2)');
  assert.throws(() => renameWatchlist(state, 'b', ' '));
  state = duplicateWatchlist(state, 'a', 'c', newId);
  assert.equal(activeWatchlist(state).name, 'Watchlist copy');
  state = deleteWatchlist(deleteWatchlist(deleteWatchlist(state, 'c'), 'b'), 'a');
  assert.deepEqual(state, { activeId: 'a', lists: [{ id: 'a', name: 'Watchlist', entries: [] }] });
});

test('storage is validated and legacy Market Watch sets become lists', () => {
  assert.equal(restoreWatchlists({ lists: [] }), null);
  const restored = restoreWatchlists({ activeId: 'gone', lists: [{ id: 'a', name: 'Main', entries: [{ kind: 'symbol', name: 'EURUSD' }, { kind: 'bogus' }, { kind: 'section', id: 's', name: 'FX' }] }, { id: 'a', name: 'Dup', entries: [] }] });
  assert.deepEqual(restored, { activeId: 'a', lists: [{ id: 'a', name: 'Main', entries: [{ kind: 'symbol', name: 'EURUSD' }, { kind: 'section', id: 's', name: 'FX', isCollapsed: false }] }] });
  const imported = importLegacySets(defaultWatchlists('a'), [{ scope: 'x', name: 'Watchlist', symbols: ['EURUSD.m', 'EURUSD.m'] }, { name: 'Empty', symbols: [] }], newId);
  assert.deepEqual(imported.lists.map((item) => item.name), ['Watchlist', 'Watchlist (2)']);
  assert.deepEqual(names(imported.lists[1]), ['EURUSD.m']);
});
