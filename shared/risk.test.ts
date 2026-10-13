import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distanceToPrice, floorToStep, planRisk, type RiskInput } from './risk';
import { conversionCandidates, conversionRate, floatingProfit, moneyPerUnit } from './valuation';

const eurusd = { digits: 5, point: 0.00001, volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01 };
const base: RiskInput = {
  side: 'buy', mode: 'percentBalance', limits: eurusd, takeProfits: [], value: 1,
  entry: 1.1, equity: 10000, balance: 10000, stopLoss: 1.095, moneyPerUnit: 100000,
};

test('floorToStep never rounds volume up', () => {
  assert.equal(floorToStep(0.199999, 0.01), 0.19);
  assert.equal(floorToStep(0.2, 0.01), 0.2);
  assert.equal(floorToStep(1.29, 0.1), 1.2);
});

test('one percent of 10k with a 50 pip stop on EURUSD is 0.20 lots', () => {
  const plan = planRisk(base);
  assert.equal(plan.isValid, true);
  assert.equal(plan.lots, 0.2);
  assert.ok(Math.abs(plan.riskMoney - 100) < 1e-6);
  assert.ok(Math.abs(plan.riskPercent - 1) < 1e-9);
});

test('commission is part of the risk budget', () => {
  const plan = planRisk({ ...base, commissionPerLot: 7 });
  assert.equal(plan.lots, 0.19);
  assert.ok(plan.riskMoney <= 100);
});

test('rejects stops on the wrong side and missing stops for risk modes', () => {
  assert.equal(planRisk({ ...base, stopLoss: 1.2 }).isValid, false);
  assert.equal(planRisk({ ...base, stopLoss: 0 }).isValid, false);
  assert.equal(planRisk({ ...base, mode: 'lots', value: 0.5, stopLoss: 0 }).isValid, true);
});

test('refuses rather than exceeding the budget at minimum volume', () => {
  const plan = planRisk({ ...base, value: 0.001 });
  assert.equal(plan.isValid, false);
  assert.match(plan.warnings[0], /minimum volume/);
});

test('caps at the user maximum and symbol maximum', () => {
  const plan = planRisk({ ...base, value: 50, maxLots: 3 });
  assert.equal(plan.lots, 3);
  assert.ok(plan.warnings.some((warning) => warning.includes('capped')));
});

test('splits volume across take-profit legs without exceeding the total', () => {
  const plan = planRisk({ ...base, takeProfits: [{ price: 1.105, share: 50 }, { price: 1.11, share: 30 }, { price: 1.12, share: 20 }] });
  assert.deepEqual(plan.legs.map((leg) => leg.lots), [0.1, 0.06, 0.04]);
  assert.ok(Math.abs(plan.reward - (0.1 * 500 + 0.06 * 1000 + 0.04 * 2000)) < 1e-6);
  assert.ok(Math.abs(plan.rewardRisk - 1.9) < 1e-9);
});

test('merges legs below the minimum volume', () => {
  const plan = planRisk({ ...base, value: 0.05, takeProfits: [{ price: 1.105, share: 90 }, { price: 1.11, share: 10 }] });
  assert.equal(plan.lots, 0.01);
  assert.equal(plan.legs.length, 1);
});

test('distances convert to prices on the correct side', () => {
  assert.equal(distanceToPrice('buy', 1.1, 50, 'pips', eurusd, true), 1.095);
  assert.equal(distanceToPrice('sell', 1.1, 50, 'pips', eurusd, true), 1.105);
  assert.equal(distanceToPrice('buy', 1.1, 300, 'points', eurusd, false), 1.103);
});

test('conversion finds direct, inverse, suffixed and bridged rates', () => {
  const quotes: Record<string, { bid: number; ask: number }> = {
    'GBPUSD.m': { bid: 1.25, ask: 1.2502 }, USDJPY: { bid: 150, ask: 150.02 }, EURUSD: { bid: 1.1, ask: 1.1002 },
  };
  const names = Object.keys(quotes);
  const quote = (name: string) => quotes[name];
  assert.deepEqual(conversionRate('USD', 'USD', names, quote), { rate: 1, via: [] });
  assert.equal(conversionRate('GBP', 'USD', names, quote)!.rate, 1.25);
  assert.ok(Math.abs(conversionRate('JPY', 'USD', names, quote)!.rate - 1 / 150.02) < 1e-12);
  const bridged = conversionRate('JPY', 'EUR', names, quote)!;
  assert.deepEqual(bridged.via, ['USDJPY', 'EURUSD']);
  assert.ok(conversionCandidates('JPY', 'USD', names).includes('USDJPY'));
  assert.equal(conversionRate('CHF', 'USD', names, quote), null);
});

test('linear modes value a lot by contract size and futures are refused', () => {
  assert.equal(moneyPerUnit(0, 100000, 1), 100000);
  assert.equal(moneyPerUnit(1, 100000, 1), null);
  assert.ok(Math.abs(floatingProfit('buy', 0.5, 1.1, { bid: 1.101, ask: 1.1012 }, 100000) - 50) < 1e-6);
  assert.ok(Math.abs(floatingProfit('sell', 0.5, 1.1, { bid: 1.101, ask: 1.1012 }, 100000) + 60) < 1e-6);
});
