import assert from 'node:assert/strict';
import test from 'node:test';
import type { TradingViewDrawingSet } from '../../shared/tradingview';
import { convertDrawingSets, plainSymbol, restoreThemePatches, suggestedSymbol, themeIdentity } from './tradingview-model';

const HOUR = 3_600_000;
const NOW = 1_760_000_000_000;

test('TradingView symbols lose their exchange and find the account\'s symbol', () => {
  assert.equal(plainSymbol('OANDA:EURUSD'), 'EURUSD');
  assert.equal(plainSymbol('EURUSD'), 'EURUSD');
  assert.equal(suggestedSymbol('OANDA:EURUSD', ['EURUSDm', 'GBPUSDm']), 'EURUSDm');
  assert.equal(suggestedSymbol('TVC:GOLD', ['XAUUSD']), 'XAUUSD');
  assert.equal(suggestedSymbol('NASDAQ:AAPL', []), 'AAPL');
});

test('drawings convert per target symbol and report what was skipped', () => {
  const trend = { id: 't1', type: 'LineToolTrendLine', points: [{ time_t: 100, price: 1 }, { time_t: 200, price: 2 }], state: {}, isOnPrice: true };
  const sets: TradingViewDrawingSet[] = [
    { symbol: 'OANDA:EURUSD', tools: [trend, { ...trend, id: 't2', isOnPrice: false }, { ...trend, id: 'e', type: 'LineToolEmoji' }, { ...trend, id: 'e2', type: 'LineToolEmoji' }] },
    { symbol: 'FX:GBPUSD', tools: [trend] },
  ];
  const result = convertDrawingSets(sets, new Map([['OANDA:EURUSD', 'EURUSDm']]), { now: NOW, tickSize: () => undefined, serverOffsetAt: () => 2 * HOUR });
  assert.deepEqual(result.converted.map((entry) => [entry.target, entry.drawings.map((drawing) => [drawing.id, drawing.anchors[0].time])]), [['EURUSDm', [['tv-t1', 100_000 + 2 * HOUR]]]]);
  assert.deepEqual(result.skipped.map((entry) => entry.count), [2, 1]);
  assert.match(result.skipped[1].reason, /indicator/);
});

test('theme ids are stable and readable', () => {
  assert.deepEqual(themeIdentity('My Night Theme'), { id: 'tradingview-my-night-theme', label: 'My Night Theme (TradingView)' });
  assert.match(themeIdentity('夜').id, /^tradingview-[0-9a-z]+$/);
});

test('imported themes restore only valid, unique entries with hex colours', () => {
  const restored = restoreThemePatches([
    { id: 'tradingview-a', label: 'A', mode: 'dark', chart: { background: '#000000', up: 'rgba(0,0,0,1)', fontFamily: 'x' } },
    { id: 'tradingview-a', label: 'Again', mode: 'dark', chart: {} },
    { id: 'meridian-dark', label: 'Built-in', mode: 'dark', chart: {} },
    { id: 'tradingview-b', label: 'B', mode: 'sepia', chart: {} },
  ]);
  assert.deepEqual(restored, [{ id: 'tradingview-a', label: 'A', mode: 'dark', chart: { background: '#000000' } }]);
});
