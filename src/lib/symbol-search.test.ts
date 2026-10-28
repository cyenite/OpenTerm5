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

test('data feed markets match by their own name, after the broker name matches and before description matches', () => {
  const feed = (name: string, description: string, path: string) => ({ name: `HYPERLIQUID:${name}`, description, path: `Hyperliquid\\${path}\\${name}` });
  const mixed = Object.fromEntries([
    ...Object.values(symbols),
    spec('BTCUSD', 'Bitcoin vs US Dollar', 'Crypto'),
    spec('USDCHF', 'US Dollar vs Swiss Franc, BTC hedge', 'Forex\\Majors'),
    feed('BTC', 'BTC-USD perpetual, Hyperliquid', 'Perpetuals'),
    feed('EUR/USDC', 'EUR/USDC spot, Hyperliquid', 'Spot'),
  ].map((item) => [item.name, item]));
  const names = (query: string, category?: string) => searchSymbols(mixed, query, { category }).map((item) => item.name);
  assert.deepEqual(names('btc'), ['BTCUSD', 'HYPERLIQUID:BTC', 'USDCHF']);
  assert.deepEqual(names('eurusd').slice(0, 3), ['EURUSDm', 'XEURUSD', 'HYPERLIQUID:EUR/USDC']);
  assert.deepEqual(names('btc', 'Hyperliquid'), ['HYPERLIQUID:BTC']);
  assert.equal(symbolCategories(mixed).at(-1), 'Hyperliquid');
});
