import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planRiskOrder } from './risk-order';

const limits = { digits: 5, point: 0.00001, volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01 };
const context = { quote: { bid: 1.1, ask: 1.1001 }, limits, balance: 10_000, equity: 10_000, moneyPerUnit: 100_000 };

test('R targets split the volume, and later parts move to break-even at the first target', () => {
  const planned = planRiskOrder({ type: 'buy', mode: 'percentBalance', value: 1, symbol: 'EURUSD', stopLoss: { unit: 'pips', value: 20 }, takeProfitR: [1, 2], management: { isBreakEvenAfterFirstTarget: true } }, context);
  assert.equal(planned.entry, 1.1001);
  assert.equal(planned.stopLoss, 1.0981);
  assert.deepEqual(planned.legs.map((leg) => [leg.lots, leg.takeProfit]), [[0.25, 1.1021], [0.25, 1.1041]]);
  assert.equal(planned.legs[0].rule, null);
  assert.deepEqual(planned.legs[1].rule, { breakEven: { triggerPoints: 200, lockPoints: 1 } });
});

test('hidden stops keep the levels in the rule, and pending orders need a price', () => {
  const planned = planRiskOrder({ type: 'sellLimit', mode: 'money', value: 50, symbol: 'EURUSD', price: 1.102, stopLoss: { unit: 'points', value: 100 }, takeProfitR: [2], management: { isStealth: true, breakEvenR: 1 } }, context);
  assert.equal(planned.isPending, true);
  assert.equal(planned.isStealth, true);
  assert.deepEqual(planned.legs[0].rule, { breakEven: { triggerPoints: 100, lockPoints: 1 }, virtualStop: 1.103, virtualTarget: 1.1 });
  assert.throws(() => planRiskOrder({ type: 'buyStop', mode: 'lots', value: 1, symbol: 'EURUSD' }, context), /need a price/);
  assert.throws(() => planRiskOrder({ type: 'buy', mode: 'lots', value: 1, symbol: 'EURUSD', takeProfitR: [2] }, context), /need a stop loss/);
});

test('an exchange taker fee on the entry and at the stop counts inside the risk unless a commission is given', () => {
  const crypto = { quote: { bid: 60000, ask: 60000 }, limits: { digits: 2, point: 0.01, volumeMin: 0.001, volumeMax: 100, volumeStep: 0.001 }, balance: 10_000, equity: 10_000, moneyPerUnit: 1 };
  const request = { type: 'buy' as const, mode: 'money' as const, value: 100, symbol: 'BTCUSDT', stopLoss: { unit: 'price' as const, value: 59400 } };
  assert.equal(planRiskOrder(request, crypto).plan.lots, 0.166);
  const withFee = planRiskOrder(request, { ...crypto, takerFeeRate: 0.00055 });
  assert.equal(withFee.plan.lots, Math.floor(100 / (600 + 0.00055 * (60000 + 59400)) * 1000) / 1000);
  assert.equal(planRiskOrder({ ...request, commissionPerLot: 0 }, { ...crypto, takerFeeRate: 0.00055 }).plan.lots, 0.166);
});
