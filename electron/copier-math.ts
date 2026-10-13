import type { FollowerConfig, TradingWindow } from '../shared/automation';
import type { Position, SymbolSpec } from '../shared/protocol';
import { floorToStep, stepDecimals } from '../shared/risk';
import { pipFactor } from '../shared/valuation';

export interface SizingContext {
  masterLots: number;
  masterBalance: number;
  masterEquity: number;
  followerBalance: number;
  followerEquity: number;
  masterContract: number;
  followerContract: number;
  stopDistance?: number;
  followerMoneyPerUnit?: number;
  limits: Pick<SymbolSpec, 'volumeMin' | 'volumeMax' | 'volumeStep'>;
}

export type SizingResult = { lots: number; note?: string } | { skip: string };

const roundToStep = (value: number, step: number) => Number((Math.round(value / step) * step).toFixed(stepDecimals(step)));

export function copyVolume(follower: Pick<FollowerConfig, 'riskType' | 'riskValue' | 'fixedMasterBalance' | 'lotRefiner' | 'isContractAligned' | 'isMinimumForced' | 'isMaximumForced' | 'lotFilter'>, context: SizingContext): SizingResult {
  const { masterLots, limits } = context;
  if (follower.lotFilter.min > 0 && masterLots < follower.lotFilter.min - 1e-9) return { skip: `master volume ${masterLots} is below the ${follower.lotFilter.min} lot filter` };
  if (follower.lotFilter.max > 0 && masterLots > follower.lotFilter.max + 1e-9) return { skip: `master volume ${masterLots} is above the ${follower.lotFilter.max} lot filter` };
  const share = follower.riskValue / 100;
  let raw: number;
  switch (follower.riskType) {
    case 'fixedLot': raw = follower.riskValue; break;
    case 'lotMultiplier': raw = masterLots * share; break;
    case 'balanceMultiplier':
      if (!(context.masterBalance > 0)) return { skip: 'master balance is unknown' };
      raw = masterLots * context.followerBalance / context.masterBalance * share;
      break;
    case 'equityMultiplier':
      if (!(context.masterEquity > 0) || !Number.isFinite(context.followerEquity)) return { skip: 'equity is unknown' };
      raw = masterLots * context.followerEquity / context.masterEquity * share;
      break;
    case 'fixedBalance':
      if (!(follower.fixedMasterBalance > 0)) return { skip: 'fixed master balance is not set' };
      raw = masterLots * context.followerBalance / follower.fixedMasterBalance * share;
      break;
    case 'fixedRisk':
      if (!(context.stopDistance && context.stopDistance > 0)) return { skip: 'fixed % risk needs a stop loss on the master trade' };
      if (!(context.followerMoneyPerUnit && context.followerMoneyPerUnit > 0)) return { skip: 'follower symbol value is unknown' };
      raw = context.followerBalance * share / (context.stopDistance * context.followerMoneyPerUnit);
      break;
  }
  if (follower.isContractAligned && follower.riskType !== 'fixedLot' && follower.riskType !== 'fixedRisk' && context.followerContract > 0) {
    raw *= context.masterContract / context.followerContract;
  }
  raw += follower.lotRefiner;
  // Risk sizing must never round up past the budget; proportional copies round to
  // the nearest step so 100% of 0.1 lots stays 0.1 despite float error.
  let lots = follower.riskType === 'fixedRisk' ? floorToStep(raw, limits.volumeStep) : roundToStep(raw, limits.volumeStep);
  let note: string | undefined;
  if (lots < limits.volumeMin - 1e-9) {
    if (!follower.isMinimumForced) return { skip: `copied volume ${lots} is below the symbol minimum ${limits.volumeMin}` };
    lots = limits.volumeMin;
    note = `raised to minimum ${limits.volumeMin}`;
  }
  if (lots > limits.volumeMax + 1e-9) {
    if (!follower.isMaximumForced) return { skip: `copied volume ${lots} is above the symbol maximum ${limits.volumeMax}` };
    lots = limits.volumeMax;
    note = `capped at maximum ${limits.volumeMax}`;
  }
  return note ? { lots, note } : { lots };
}

export function baseName(symbol: string): string {
  const match = /^[A-Z0-9]+/.exec(symbol);
  return match ? match[0] : symbol;
}

export function mapFollowerSymbol(symbol: string, follower: Pick<FollowerConfig, 'symbolMap' | 'isSuffixAutoMapped'>, followerNames: readonly string[]): string | null {
  if (follower.symbolMap[symbol]) return follower.symbolMap[symbol];
  if (followerNames.includes(symbol)) return symbol;
  if (!follower.isSuffixAutoMapped) return null;
  const base = baseName(symbol);
  const candidates = followerNames.filter((name) => name === base || name.startsWith(base) && !/[A-Z0-9]/.test(name[base.length]));
  return candidates.sort((left, right) => left.length - right.length)[0] ?? null;
}

export function passesFilters(follower: FollowerConfig, trade: Pick<Position, 'side' | 'symbol' | 'comment' | 'magic'>): string | null {
  if (follower.side !== 'all' && trade.side !== follower.side) return `only ${follower.side} trades are copied`;
  const { magicFilter, commentFilter, symbolFilter } = follower;
  if (magicFilter.mode !== 'off' && magicFilter.values.length) {
    const isListed = magicFilter.values.includes(trade.magic);
    if (magicFilter.mode === 'copy' ? !isListed : isListed) return `magic ${trade.magic} is filtered`;
  }
  if (commentFilter.mode !== 'off' && commentFilter.values.length) {
    const isListed = commentFilter.values.some((value) => trade.comment.toLowerCase().includes(value.toLowerCase()));
    if (commentFilter.mode === 'copy' ? !isListed : isListed) return 'comment is filtered';
  }
  if (symbolFilter.mode !== 'off' && symbolFilter.values.length) {
    const isListed = symbolFilter.values.includes(trade.symbol) || symbolFilter.values.includes(baseName(trade.symbol));
    if (symbolFilter.mode === 'copy' ? !isListed : isListed) return `${trade.symbol} is filtered`;
  }
  return null;
}

export function isWithinHours(windows: readonly TradingWindow[], time: Date): boolean {
  if (!windows.length) return true;
  const minutes = time.getHours() * 60 + time.getMinutes();
  const toMinutes = (value: string) => {
    const [hours, rest] = value.split(':').map(Number);
    return hours * 60 + (rest || 0);
  };
  return windows.some((window) => {
    if (window.day !== time.getDay()) return false;
    const start = toMinutes(window.start);
    const end = toMinutes(window.end);
    return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  });
}

export interface StopInput {
  side: 'buy' | 'sell';
  masterSide: 'buy' | 'sell';
  masterOpen: number;
  masterStop: number;
  masterTarget: number;
  followerEntry: number;
  digits: number;
  point: number;
}

export function copyStops(follower: Pick<FollowerConfig, 'isStopCopied' | 'isTargetCopied' | 'stopMode' | 'fixedStopPips' | 'fixedTargetPips' | 'stopRefinePips' | 'targetRefinePips' | 'isReversed'>, input: StopInput): { sl: number; tp: number } {
  const pip = input.point * pipFactor(input.digits);
  const direction = input.side === 'buy' ? 1 : -1;
  const round = (value: number) => Number(value.toFixed(input.digits));
  const resolve = (masterLevel: number, isCopied: boolean, fixedPips: number, refinePips: number, isStop: boolean): number => {
    const away = isStop ? -direction : direction;
    if (fixedPips > 0) return round(input.followerEntry + away * fixedPips * pip);
    if (!isCopied || !masterLevel || follower.isReversed) return 0;
    const masterDistance = Math.abs(masterLevel - input.masterOpen);
    const base = follower.stopMode === 'distance' ? input.followerEntry + away * masterDistance : masterLevel;
    return round(base + away * refinePips * pip);
  };
  return {
    sl: resolve(input.masterStop, follower.isStopCopied, follower.fixedStopPips, follower.stopRefinePips, true),
    tp: resolve(input.masterTarget, follower.isTargetCopied, follower.fixedTargetPips, follower.targetRefinePips, false),
  };
}

export function defaultFollower(id: string, accountId: string): FollowerConfig {
  return {
    id, accountId, status: 'enabled', riskType: 'lotMultiplier', comment: 'copy', customComment: '', side: 'all',
    symbolMap: {}, magicFilter: { mode: 'off', values: [] }, commentFilter: { mode: 'off', values: [] },
    symbolFilter: { mode: 'off', values: [] }, tradingHours: [], delay: { minMs: 0, maxMs: 0 }, lotFilter: { min: 0, max: 0 },
    equityProtection: { minEquity: 0, maxDailyLossPercent: 0, action: 'blockNew' }, stopMode: 'price', riskValue: 100, lotRefiner: 0,
    fixedStopPips: 0, fixedTargetPips: 0, stopRefinePips: 0, targetRefinePips: 0, fixedMasterBalance: 0, maxOpenTrades: 0,
    isReversed: false, isStopCopied: true, isTargetCopied: true, isPendingCopied: false, isExpiryCopied: true, isStrictClose: false,
    isExistingCopied: false, isMinimumForced: false, isMaximumForced: false, isContractAligned: true, isSuffixAutoMapped: true,
  };
}
