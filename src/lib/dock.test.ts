import assert from 'node:assert/strict';
import test from 'node:test';
import { clampDockWidth, clampToolboxHeight, defaultDockLayout, dockItems, dockLimits, resizePair, restoreDockLayout, withoutWeights } from './dock';

const shown = {
  dock: defaultDockLayout,
  depthSymbol: null,
  isAnalysisMode: false,
  isNavigatorShown: true,
  isDataWindowShown: false,
  isMarketWatchShown: true,
  isTradeAssistantShown: true,
};

test('panels stack in declaration order on their own side, with Depth of Market last on the right', () => {
  assert.deepEqual(dockItems(shown, 'left'), ['marketWatch', 'navigator']);
  assert.deepEqual(dockItems(shown, 'right'), ['tradeAssistant']);
  const moved = { ...shown, depthSymbol: 'EURUSD', dock: { ...defaultDockLayout, sides: { ...defaultDockLayout.sides, marketWatch: 'right' as const } } };
  assert.deepEqual(dockItems(moved, 'left'), ['navigator']);
  assert.deepEqual(dockItems(moved, 'right'), ['marketWatch', 'tradeAssistant', 'depthOfMarket']);
});

test('analysis mode keeps the watchlist on the right and withdraws the trading panels', () => {
  const analysis = { ...shown, isAnalysisMode: true, isDataWindowShown: true, depthSymbol: 'EURUSD' };
  assert.deepEqual(dockItems(analysis, 'left'), []);
  assert.deepEqual(dockItems(analysis, 'right'), ['marketWatch', 'dataWindow']);
});

test('restoring a saved layout keeps valid values and replaces the rest', () => {
  assert.deepEqual(restoreDockLayout(undefined), defaultDockLayout);
  const restored = restoreDockLayout({
    sides: { marketWatch: 'right', navigator: 'top', unknown: 'left' },
    widths: { left: 90, right: 'wide' },
    weights: { marketWatch: 2, navigator: -1, depthOfMarket: 0.5, toolbox: 3 },
    toolboxHeight: 12,
  });
  assert.equal(restored.sides.marketWatch, 'right');
  assert.equal(restored.sides.navigator, 'left');
  assert.equal('unknown' in restored.sides, false);
  assert.deepEqual(restored.widths, { left: dockLimits.minWidth, right: defaultDockLayout.widths.right });
  assert.deepEqual(restored.weights, { marketWatch: 2, depthOfMarket: 0.5 });
  assert.equal(restored.toolboxHeight, dockLimits.minToolbox);
});

test('widths and the Toolbox height stay inside their limits', () => {
  assert.equal(clampDockWidth(10), dockLimits.minWidth);
  assert.equal(clampDockWidth(5000), dockLimits.maxWidth);
  assert.equal(clampDockWidth(300.6), 301);
  assert.equal(clampToolboxHeight(40), dockLimits.minToolbox);
  assert.equal(clampToolboxHeight(700, 600), 600 - dockLimits.minChart);
  assert.equal(clampToolboxHeight(500, 100), dockLimits.minToolbox);
});

test('resizing two neighbours moves only their boundary and keeps their combined share', () => {
  const weights = resizePair({ navigator: 2 }, 'marketWatch', 'navigator', 100, 300, 300);
  assert.deepEqual(weights, { marketWatch: 2, navigator: 1 });
  const limited = resizePair({}, 'marketWatch', 'navigator', 1000, 200, 200);
  assert.equal(limited.marketWatch! + limited.navigator!, 2);
  assert.equal(limited.navigator, Number((2 * dockLimits.minPanel / 400).toFixed(4)));
  assert.deepEqual(withoutWeights({ marketWatch: 2, navigator: 1, depthOfMarket: 3 }, ['marketWatch', 'navigator']), { depthOfMarket: 3 });
});
