import type { OrderTypeKey } from './protocol';

export interface PlanLines {
  entry: number;
  stop?: number;
  target?: number;
}

export interface PlanQuote {
  bid: number;
  ask: number;
}

export interface PlanDecision {
  side?: 'buy' | 'sell';
  type?: OrderTypeKey;
  error?: string;
  entry: number;
  isMarket: boolean;
}

// The stop decides direction (below the entry is a buy); the entry against the
// live price then decides limit or stop. An entry inside the spread, or one the
// trader forced to market, executes at market at the live price instead.
export function decidePlan(lines: PlanLines, quote: PlanQuote | undefined, isMarketForced: boolean, minimumGap = 0): PlanDecision {
  const { entry, stop, target } = lines;
  if (!stop) return { entry, isMarket: false };
  if (stop === entry) return { entry, isMarket: false, error: 'The stop loss cannot sit on the entry.' };
  const side = stop < entry ? 'buy' : 'sell';
  if (!quote?.bid || !quote.ask) return { side, entry, isMarket: false, error: 'Waiting for a live quote.' };
  const live = side === 'buy' ? quote.ask : quote.bid;
  const isInsideSpread = entry >= quote.bid && entry <= quote.ask;
  const isMarket = isMarketForced || isInsideSpread;
  const effectiveEntry = isMarket ? live : entry;
  if (side === 'buy' ? stop >= effectiveEntry : stop <= effectiveEntry) {
    return { side, entry: effectiveEntry, isMarket, error: `At market the ${side} would fill at ${live}, beyond the stop. Move the stop or use a pending entry.` };
  }
  if (target && (side === 'buy' ? target <= effectiveEntry : target >= effectiveEntry)) {
    return { side, entry: effectiveEntry, isMarket, error: `The take profit must be ${side === 'buy' ? 'above' : 'below'} the entry for a ${side}.` };
  }
  if (isMarket) return { side, type: side, entry: effectiveEntry, isMarket: true };
  if (Math.abs(entry - live) < minimumGap) return { side, entry, isMarket: false, error: 'The entry is closer to the price than the broker allows for pending orders.' };
  const isAbove = entry > live;
  const type: OrderTypeKey = side === 'buy' ? (isAbove ? 'buyStop' : 'buyLimit') : (isAbove ? 'sellLimit' : 'sellStop');
  return { side, type, entry, isMarket: false };
}

export interface DraggedLevel {
  kind: 'sl' | 'tp' | 'price';
  side: 'buy' | 'sell';
  price: number;
  reference: number;
}

// Validates moving an existing position's or order's line before anything is sent.
export function validateDrag(level: DraggedLevel): string | null {
  if (!(level.price > 0)) return 'The price must be positive.';
  if (level.kind === 'price') return null;
  const isBelow = level.price < level.reference;
  if (level.kind === 'sl' && (level.side === 'buy' ? !isBelow : isBelow)) return `A ${level.side} stop loss must be ${level.side === 'buy' ? 'below' : 'above'} the current price.`;
  if (level.kind === 'tp' && (level.side === 'buy' ? isBelow : !isBelow)) return `A ${level.side} take profit must be ${level.side === 'buy' ? 'above' : 'below'} the current price.`;
  return null;
}
