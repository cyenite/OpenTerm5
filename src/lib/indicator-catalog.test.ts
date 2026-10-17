import assert from 'node:assert/strict';
import test from 'node:test';
import type { StudyInfo } from '@meridian/charts';
import { entryLabel, indicatorEntries, searchEntries, sectionEntries } from './indicator-catalog';
import type { PineScript } from './pine/pine-scripts';

const catalogue: StudyInfo[] = [
  { type: 'rsi', title: 'Relative Strength Index', shortTitle: 'RSI', overlay: false },
  { type: 'mt5-ma', title: 'Moving Average (MT5)', overlay: true },
  { type: 'sma', title: 'Moving Average', overlay: true },
  { type: 'aroon', title: 'Aroon', overlay: false },
  // Registered Pine scripts are listed from the script store instead.
  { type: 'pine-abc', title: 'Should not show twice', overlay: true },
];

const script = (id: string, name: string, origin: PineScript['origin'], extra: Partial<PineScript> = {}): PineScript => ({
  id, name, shortName: '', author: 'LuxAlgo', license: 'MPL-2.0', importedAt: 0, overlay: true, origin, inputs: [], ...extra,
});

const scripts = [
  script('p2', 'Smart Money Concepts', { kind: 'tradingview', rank: 2, version: 1, url: 'u', author: 'a', scriptId: 'PUB;2' }),
  script('p1', 'Supertrend Pro', { kind: 'tradingview', rank: 1, version: 1, url: 'u', author: 'a', scriptId: 'PUB;1' }),
  script('m1', 'My RSI', { kind: 'pasted' }, { author: null, license: null }),
  script('l1', 'Linked Script', { kind: 'tradingview', version: 3, url: 'u', author: 'a', scriptId: 'PUB;3' }),
];

const entries = indicatorEntries(catalogue, scripts);

test('every source lands in one list, sectioned by where it came from', () => {
  assert.deepEqual(entries.map((entry) => [entry.type, entry.section]), [
    ['aroon', 'technicals'], ['sma', 'technicals'], ['mt5-ma', 'technicals'], ['rsi', 'technicals'],
    ['pine-p2', 'popular'], ['pine-p1', 'popular'], ['pine-m1', 'scripts'], ['pine-l1', 'scripts'],
  ]);
  const mt5 = entries.find((entry) => entry.type === 'mt5-ma')!;
  assert.equal(mt5.title, 'Moving Average');
  assert.equal(entryLabel(mt5), 'Moving Average (MT5)');
  assert.equal(entries.find((entry) => entry.type === 'pine-p2')?.license, 'MPL-2.0');
});

test('sections order popular scripts by rank, others by name, favourites across sources', () => {
  assert.deepEqual(sectionEntries(entries, 'popular', new Set()).map((entry) => entry.title), ['Supertrend Pro', 'Smart Money Concepts']);
  assert.deepEqual(sectionEntries(entries, 'scripts', new Set()).map((entry) => entry.title), ['Linked Script', 'My RSI']);
  assert.deepEqual(sectionEntries(entries, 'favorites', new Set(['pine-p2', 'rsi', 'mt5-ma', 'gone'])).map(entryLabel), ['Moving Average (MT5)', 'Relative Strength Index', 'Smart Money Concepts']);
});

test('search covers every source, best matches first', () => {
  assert.deepEqual(searchEntries(entries, 'rsi').map((entry) => entry.title), ['My RSI']);
  assert.deepEqual(searchEntries(entries, 'moving').map(entryLabel), ['Moving Average', 'Moving Average (MT5)']);
  assert.deepEqual(searchEntries(entries, 'mt5').map(entryLabel), ['Moving Average (MT5)']);
  assert.deepEqual(searchEntries(entries, 'luxalgo smart').map((entry) => entry.title), ['Smart Money Concepts']);
  assert.deepEqual(searchEntries(entries, 's').map((entry) => entry.title), ['Smart Money Concepts', 'Supertrend Pro', 'Relative Strength Index', 'Linked Script', 'My RSI']);
  assert.deepEqual(searchEntries(entries, '  '), []);
});
