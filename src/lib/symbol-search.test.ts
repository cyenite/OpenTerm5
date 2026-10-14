import assert from 'node:assert/strict';
import test from 'node:test';
import type { SymbolSpec } from '../../shared/protocol';
import { searchSymbols, symbolCategories, symbolCategory } from './symbol-search';

const spec = (name: string, description: string, path: string) => ({ name, description, path: `${path}\\${name}` }) as SymbolSpec;
const symbols = Object.fromEntries([
  spec('EURUSDm', 'Euro vs US Dollar', 'Forex\\Majors'),
  spec('EURGBPm', 'Euro vs Great Britain Pound', 'Forex\\Crosses'),
  spec('XEURUSD', 'Synthetic', 'Forex\\Exotic'),
  spec('XAUUSDm', 'Gold vs US Dollar', 'Metals'),
  spec('USTECm', 'US Tech 100 Index', 'Indices'),
  spec('BRK.B', 'Berkshire Hathaway Class B', 'Stocks\\US'),
].map((item) => [item.name, item]));
const find = (query: string, category?: string) => searchSymbols(symbols, query, { category }).map((item) => item.name);

test('lowercase and plain names find decorated broker symbols first', () => {
  assert.deepEqual(find('eurusdm'), ['EURUSDm', 'XEURUSD']);
  assert.deepEqual(find('eurusd')[0], 'EURUSDm');
  assert.deepEqual(find('EUR'), ['EURGBPm', 'EURUSDm', 'XEURUSD']);
});

test('other names for an instrument and descriptions match', () => {
  assert.deepEqual(find('gold'), ['XAUUSDm']);
  assert.deepEqual(find('nas100'), ['USTECm']);
  assert.deepEqual(find('great britain'), ['EURGBPm']);
  assert.deepEqual(find('brk.b'), ['BRK.B']);
  assert.deepEqual(find('zzz'), []);
});

test('categories come from the first path folder, largest first', () => {
  assert.equal(symbolCategory('EURUSD'), 'Other');
  assert.deepEqual(symbolCategories(symbols), ['Forex', 'Indices', 'Metals', 'Stocks']);
  assert.deepEqual(find('', 'Metals'), ['XAUUSDm']);
  assert.deepEqual(find('eur', 'Metals'), []);
});
