import assert from 'node:assert/strict';
import { test } from 'node:test';
import { crossLiquidation, floorLeverage, initialMargin, isLiquidationClose, isolatedLiquidation, isStopBeforeLiquidation, safeLeverage } from './leverage';

test('initial margin is notional over leverage', () => {
  assert.equal(initialMargin(60000, 0.1, 1, 10), 600);
  assert.ok(Number.isNaN(initialMargin(60000, 0.1, 1, 0)));
});

test('isolated liquidation sits one margin minus maintenance away from the entry', () => {
  assert.equal(isolatedLiquidation('buy', 100, 10, 0.005), 100 * (1 - 0.095));
  assert.equal(isolatedLiquidation('sell', 100, 10, 0.005), 100 * (1 + 0.095));
});

test('cross liquidation spends the free margin', () => {
  assert.equal(crossLiquidation('buy', 100, 10, 1, 500, 0.005), 100 - (500 - 5) / 10);
  assert.equal(crossLiquidation('buy', 100, 1, 1, 1000, 0), 0);
});

test('the stop must come before liquidation', () => {
  assert.equal(isStopBeforeLiquidation('buy', 95, 90.5), true);
  assert.equal(isStopBeforeLiquidation('buy', 90, 90.5), false);
  assert.equal(isStopBeforeLiquidation('sell', 105, 109.5), true);
  assert.equal(isStopBeforeLiquidation('sell', 110, 109.5), false);
  assert.equal(isStopBeforeLiquidation('buy', 0, 90.5), true, 'no stop, nothing to compare');
});

test('safe leverage keeps liquidation one and a half stop distances away', () => {
  const leverage = safeLeverage(100, 98, 0.005);
  assert.equal(Number(leverage.toFixed(6)), Number((1 / 0.035).toFixed(6)));
  const liquidation = isolatedLiquidation('buy', 100, leverage, 0.005);
  assert.equal(Number((100 - liquidation).toFixed(9)), 3);
  assert.equal(isLiquidationClose(100, 98, liquidation + 0.01), true);
  assert.equal(isLiquidationClose(100, 98, liquidation - 0.01), false);
});

test('leverage floors to the step and stays inside the symbol limits', () => {
  assert.equal(floorLeverage(28.5714, 1, 100, 0.01), 28.57);
  assert.equal(floorLeverage(250, 1, 100, 0.01), 100);
  assert.equal(floorLeverage(0.5, 1, 100, 0.01), null);
});
