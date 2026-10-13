import { pipFactor } from './valuation';

export const riskModes = [
  { key: 'percentBalance', label: '% of balance', unit: '%' },
  { key: 'percentEquity', label: '% of equity', unit: '%' },
  { key: 'money', label: 'Money', unit: '' },
  { key: 'lots', label: 'Fixed lots', unit: 'lots' },
] as const;

export type RiskMode = (typeof riskModes)[number]['key'];

export const distanceUnits = [
  { key: 'price', label: 'Price' },
  { key: 'points', label: 'Points' },
  { key: 'pips', label: 'Pips' },
] as const;

export type DistanceUnit = (typeof distanceUnits)[number]['key'];

export interface VolumeLimits {
  digits: number;
  point: number;
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
}

export interface TakeProfitTarget {
  price: number;
  share: number;
}

export interface RiskInput {
  side: 'buy' | 'sell';
  mode: RiskMode;
  limits: VolumeLimits;
  takeProfits: readonly TakeProfitTarget[];
  value: number;
  entry: number;
  equity: number;
  balance: number;
  stopLoss: number;
  maxLots?: number;
  moneyPerUnit: number;
  commissionPerLot?: number;
}

export interface RiskLeg {
  lots: number;
  takeProfit: number;
  reward: number;
}

export interface RiskPlan {
  legs: RiskLeg[];
  warnings: string[];
  lots: number;
  reward: number;
  riskMoney: number;
  budgetMoney: number;
  riskPercent: number;
  rewardRisk: number;
  isValid: boolean;
}

const EPSILON = 1e-9;

export function stepDecimals(step: number): number {
  return Math.max(0, Math.min(8, Math.ceil(-Math.log10(step) - EPSILON)));
}

export function floorToStep(value: number, step: number): number {
  if (!(step > 0)) return 0;
  return Number((Math.floor(value / step + EPSILON) * step).toFixed(stepDecimals(step)));
}

export function distanceToPrice(side: 'buy' | 'sell', entry: number, distance: number, unit: DistanceUnit, limits: Pick<VolumeLimits, 'digits' | 'point'>, isStop: boolean): number {
  if (unit === 'price') return distance;
  const size = distance * limits.point * (unit === 'pips' ? pipFactor(limits.digits) : 1);
  const isBelow = (side === 'buy') === isStop;
  return Number((isBelow ? entry - size : entry + size).toFixed(limits.digits));
}

export function priceToPoints(entry: number, price: number, point: number): number {
  return point > 0 ? Math.round(Math.abs(entry - price) / point) : 0;
}

function budget(input: RiskInput): number {
  switch (input.mode) {
    case 'percentBalance': return input.balance * input.value / 100;
    case 'percentEquity': return input.equity * input.value / 100;
    case 'money': return input.value;
    case 'lots': return Number.NaN;
  }
}

function allocate(total: number, shares: readonly number[], limits: VolumeLimits): number[] {
  const sum = shares.reduce((left, right) => left + right, 0);
  const legs = shares.map((share) => floorToStep(total * share / sum, limits.volumeStep));
  const decimals = stepDecimals(limits.volumeStep);
  let remainder = Math.round((total - legs.reduce((left, right) => left + right, 0)) / limits.volumeStep);
  for (let index = 0; remainder > 0; index = (index + 1) % legs.length, remainder--) {
    legs[index] = Number((legs[index] + limits.volumeStep).toFixed(decimals));
  }
  return legs;
}

export function planRisk(input: RiskInput): RiskPlan {
  const { limits, side, entry, stopLoss } = input;
  const warnings: string[] = [];
  const invalid = (message: string): RiskPlan => ({ legs: [], warnings: [message], lots: 0, reward: 0, riskMoney: 0, budgetMoney: 0, riskPercent: 0, rewardRisk: 0, isValid: false });
  if (!(entry > 0)) return invalid('An entry price is required.');
  if (!(input.moneyPerUnit > 0)) return invalid('The symbol value in account currency is unknown, so risk cannot be sized.');
  if (!(limits.volumeStep > 0 && limits.volumeMin > 0)) return invalid('Symbol volume limits are unavailable.');
  const hasStop = stopLoss > 0;
  if (hasStop && (side === 'buy' ? stopLoss >= entry : stopLoss <= entry)) return invalid(`Stop loss must be ${side === 'buy' ? 'below' : 'above'} the entry price.`);
  for (const target of input.takeProfits) {
    if (target.price > 0 && (side === 'buy' ? target.price <= entry : target.price >= entry)) return invalid(`Take profit must be ${side === 'buy' ? 'above' : 'below'} the entry price.`);
  }
  const commission = input.commissionPerLot ?? 0;
  const lossPerLot = hasStop ? Math.abs(entry - stopLoss) * input.moneyPerUnit + commission : Number.NaN;
  const budgetMoney = budget(input);
  let lots: number;
  if (input.mode === 'lots') {
    lots = floorToStep(input.value, limits.volumeStep);
  } else {
    if (!hasStop) return invalid('Risk-based sizing needs a stop loss.');
    if (!(budgetMoney > 0)) return invalid('The risk amount must be positive.');
    lots = floorToStep(budgetMoney / lossPerLot, limits.volumeStep);
  }
  const cap = Math.min(limits.volumeMax, input.maxLots ?? Number.POSITIVE_INFINITY);
  if (lots > cap) {
    warnings.push(`Volume capped at ${cap} lots.`);
    lots = floorToStep(cap, limits.volumeStep);
  }
  if (lots < limits.volumeMin - EPSILON) {
    const minimumRisk = hasStop ? limits.volumeMin * lossPerLot : Number.NaN;
    return invalid(hasStop ? `The minimum volume ${limits.volumeMin} would risk ${minimumRisk.toFixed(2)}, more than the ${budgetMoney.toFixed(2)} budget.` : `Volume is below the symbol minimum ${limits.volumeMin}.`);
  }
  const targets = input.takeProfits.filter((target) => target.share > 0);
  const shares = targets.length ? targets.map((target) => target.share) : [1];
  const legLots = allocate(lots, shares, limits);
  const prices = targets.length ? targets.map((target) => target.price) : [0];
  const decimals = stepDecimals(limits.volumeStep);
  const merged: { lots: number; price: number }[] = [];
  legLots.forEach((amount, index) => {
    if (amount >= limits.volumeMin - EPSILON) merged.push({ lots: amount, price: prices[index] });
    else if (merged.length) merged[merged.length - 1].lots = Number((merged[merged.length - 1].lots + amount).toFixed(decimals));
    else if (index + 1 < legLots.length) legLots[index + 1] = Number((legLots[index + 1] + amount).toFixed(decimals));
  });
  if (merged.length < shares.length) warnings.push('Some take-profit legs were merged because they fell below the minimum volume.');
  const legs = merged.map((leg) => ({
    lots: leg.lots,
    takeProfit: leg.price,
    reward: leg.price > 0 ? Math.abs(leg.price - entry) * input.moneyPerUnit * leg.lots - commission * leg.lots : 0,
  }));
  const riskMoney = hasStop ? lots * lossPerLot : Number.NaN;
  const reward = legs.reduce((sum, leg) => sum + leg.reward, 0);
  if (!hasStop) warnings.push('No stop loss: the loss on this trade is not limited.');
  if (budgetMoney > 0 && riskMoney < budgetMoney * 0.8) warnings.push('Volume rounding leaves the trade well under the risk budget.');
  return {
    legs, warnings, lots, reward, riskMoney, budgetMoney: Number.isNaN(budgetMoney) ? riskMoney : budgetMoney,
    riskPercent: input.balance > 0 ? riskMoney / input.balance * 100 : Number.NaN,
    rewardRisk: riskMoney > 0 && reward > 0 ? reward / riskMoney : 0,
    isValid: true,
  };
}
