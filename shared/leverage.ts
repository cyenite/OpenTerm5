export function initialMargin(price: number, volume: number, contractSize: number, leverage: number): number {
  return leverage > 0 ? price * volume * contractSize / leverage : Number.NaN;
}

// Isolated linear contracts: the position is liquidated once its loss consumes the initial
// margin down to the maintenance margin. Fees and the tier deduction are ignored, so the
// result is an estimate that errs slightly early for longs and late for shorts.
export function isolatedLiquidation(side: 'buy' | 'sell', entry: number, leverage: number, maintenanceRate: number): number {
  if (!(entry > 0) || !(leverage > 0)) return Number.NaN;
  const distance = 1 / leverage - maintenanceRate;
  return side === 'buy' ? entry * (1 - distance) : entry * (1 + distance);
}

// Cross margin: the whole free margin absorbs the loss, less the new position's maintenance
// margin. Other positions moving at the same time shift it, so this is a rough guide.
export function crossLiquidation(side: 'buy' | 'sell', entry: number, volume: number, contractSize: number, marginFree: number, maintenanceRate: number): number {
  const units = volume * contractSize;
  if (!(entry > 0) || !(units > 0)) return Number.NaN;
  const cushion = marginFree - entry * units * maintenanceRate;
  const price = side === 'buy' ? entry - cushion / units : entry + cushion / units;
  return price > 0 ? price : 0;
}

// The stop must trigger before liquidation, or the position can be liquidated while the
// stop is still waiting.
export function isStopBeforeLiquidation(side: 'buy' | 'sell', stop: number, liquidation: number): boolean {
  if (!(stop > 0) || !Number.isFinite(liquidation)) return true;
  return side === 'buy' ? stop > liquidation : stop < liquidation;
}

// Liquidation should sit at least this many stop distances from the entry, so a gap through the
// stop or slippage on its market order still closes the position before liquidation does.
export const LIQUIDATION_BUFFER = 1.5;

// The highest isolated leverage whose liquidation keeps that buffer. Its margin is then roughly
// the money at risk, the least that keeps the stop in charge.
export function safeLeverage(entry: number, stop: number, maintenanceRate: number): number {
  const distance = Math.abs(entry - stop) / entry;
  if (!(entry > 0) || !(distance > 0)) return Number.NaN;
  return 1 / (LIQUIDATION_BUFFER * distance + maintenanceRate);
}

export function isLiquidationClose(entry: number, stop: number, liquidation: number): boolean {
  if (!(stop > 0) || !Number.isFinite(liquidation)) return false;
  return Math.abs(entry - liquidation) < LIQUIDATION_BUFFER * Math.abs(entry - stop);
}

export function floorLeverage(value: number, leverageMin: number, leverageMax: number, leverageStep: number): number | null {
  const step = leverageStep > 0 ? leverageStep : 1;
  const floored = Number((Math.floor(value / step + 1e-9) * step).toFixed(4));
  if (!(floored >= leverageMin)) return null;
  return Math.min(floored, leverageMax);
}
