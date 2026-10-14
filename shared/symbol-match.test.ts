import assert from 'node:assert/strict';
import { test } from 'node:test';
import { instrumentKey, isListedSymbol, matchSymbol, symbolCore } from './symbol-match';

test('broker decorations reduce to the instrument', () => {
  for (const name of ['EURUSD', 'EURUSD.m', 'EURUSDm', 'mEURUSD', '#EURUSD', 'EURUSD-STD', 'EURUSD_i', 'EURUSD+', 'EURUSDpro', 'FXEURUSD', 'EURUSDSB']) {
    assert.equal(symbolCore(name), 'EURUSD', name);
  }
  assert.equal(symbolCore('US30.cash'), 'US30');
  assert.equal(symbolCore('USTECm'), 'USTEC');
  assert.equal(symbolCore('Bitcoin'), 'BITCOIN');
  assert.equal(symbolCore('GER40'), 'GER40');
});

test('a plain name finds the decorated symbol on a prefixed or suffixed account', () => {
  assert.equal(matchSymbol('EURUSD', ['GBPUSD.m', 'EURUSD.m', 'XAUUSD.m']), 'EURUSD.m');
  assert.equal(matchSymbol('XAUUSD', ['mEURUSD', 'mXAUUSD']), 'mXAUUSD');
  assert.equal(matchSymbol('EURUSD.m', ['EURUSDc', 'GBPUSDc']), 'EURUSDc');
  assert.equal(matchSymbol('EURUSD', ['EURUSD', 'EURUSD.m']), 'EURUSD');
  assert.equal(matchSymbol('USDJPY', ['EURUSD.m']), null);
});

test('among several decorations the request decoration wins, then the account standard', () => {
  const names = ['EURUSD.pro', 'GBPUSD.pro', 'USDJPY.pro', 'EURUSD.m', 'GBPUSD.m'];
  assert.equal(matchSymbol('EURUSD', [...names, 'XAUUSD.pro']), 'EURUSD.pro');
  assert.equal(matchSymbol('EURUSD.m', names), 'EURUSD.m');
  assert.equal(matchSymbol('BRK.B', ['BRK.A', 'BRK.B']), 'BRK.B');
});

test('list entries admit their exact symbol or, written plainly, any decoration of it', () => {
  assert.equal(isListedSymbol('EURUSD', 'EURUSD.m'), true);
  assert.equal(isListedSymbol('EURUSD', 'mEURUSD'), true);
  assert.equal(isListedSymbol('EURUSD.m', 'EURUSD.m'), true);
  assert.equal(isListedSymbol('EURUSD.m', 'EURUSD.pro'), false);
  assert.equal(isListedSymbol('BRK.A', 'BRK.B'), false);
  assert.equal(isListedSymbol('EURUSD', 'EURGBP'), false);
});

test('share classes are part of the instrument, not decoration', () => {
  assert.equal(symbolCore('BRK.B'), 'BRK.B');
  assert.equal(symbolCore('BRK-B'), 'BRK.B');
  assert.equal(symbolCore('EURUSD.m'), 'EURUSD');
  assert.equal(matchSymbol('BRK.B', ['BRK.A']), null);
  assert.equal(matchSymbol('BRK.B', ['BRK-A', 'BRK-B']), 'BRK-B');
  assert.equal(isListedSymbol('BRK.B', 'BRK-B'), true);
});

test('another name for the same instrument is used only when its own name is missing', () => {
  assert.equal(instrumentKey('GOLD.m'), 'XAUUSD');
  assert.equal(instrumentKey('USTECm'), 'NAS100');
  assert.equal(matchSymbol('XAUUSD', ['GOLD', 'SILVER']), 'GOLD');
  assert.equal(matchSymbol('GOLD', ['XAUUSD.m', 'XAGUSD.m']), 'XAUUSD.m');
  assert.equal(matchSymbol('DE40', ['GER40.cash', 'UK100.cash']), 'GER40.cash');
  assert.equal(matchSymbol('XAUUSD', ['GOLD', 'XAUUSD.pro']), 'XAUUSD.pro');
  assert.equal(matchSymbol('GOLD.m', ['XAUUSD.pro', 'XAUUSD.m', 'EURUSD.m']), 'XAUUSD.m');
  assert.equal(isListedSymbol('XAUUSD', 'GOLD'), false);
});
