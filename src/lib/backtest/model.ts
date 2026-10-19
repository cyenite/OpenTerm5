import type { OrderTypeKey } from '../../../shared/protocol';
import type { LegRule } from '../../../shared/risk-order';

export type { LegRule };

export type Side = 'buy' | 'sell';

export type PendingType = Exclude<OrderTypeKey, 'buy' | 'sell'>;

// Why a deal happened, in the order the History tab's filter lists them.
export const dealReasons = [
  { key: 'market', label: 'Market' },
  { key: 'pending', label: 'Pending order' },
  { key: 'close', label: 'Closed' },
  { key: 'sl', label: 'Stop loss' },
  { key: 'tp', label: 'Take profit' },
  { key: 'stopOut', label: 'Stop out' },
] as const;

export type DealReason = (typeof dealReasons)[number]['key'];

export const dealReasonLabel = (reason: DealReason) => dealReasons.find((candidate) => candidate.key === reason)!.label;

export interface BacktestSettings {
  readonly balance: number;
  readonly leverage: number;
  readonly stopOutLevel: number;
  readonly slippagePoints: number;
  readonly commissionPerLot: number;
  // Null takes each symbol's spread from the broker when the session first trades it.
  readonly spreadPoints: number | null;
}

export const defaultBacktestSettings: BacktestSettings = {
  balance: 10_000,
  leverage: 100,
  stopOutLevel: 50,
  slippagePoints: 0,
  commissionPerLot: 0,
  spreadPoints: null,
};

// What the simulation needs to know about a symbol. It is captured when the session first trades
// the symbol, so a resumed session values its trades the same way whatever the broker says later.
export interface SymbolTerms {
  readonly name: string;
  readonly currencyBase: string;
  readonly currencyProfit: string;
  readonly point: number;
  readonly digits: number;
  readonly volumeMin: number;
  readonly volumeMax: number;
  readonly volumeStep: number;
  readonly spreadPoints: number;
  readonly contractSize: number;
  // Profit currency to account currency, for symbols that are not quoted against the account
  // currency: the broker's rate when the session first traded the symbol.
  readonly profitRate: number;
}

export interface Simulation {
  readonly currency: string;
  readonly settings: BacktestSettings;
  readonly terms: Readonly<Record<string, SymbolTerms>>;
}

export interface SimPosition {
  readonly side: Side;
  readonly symbol: string;
  readonly comment: string;
  readonly sl: number;
  readonly tp: number;
  readonly time: number;
  readonly ticket: number;
  readonly volume: number;
  readonly priceOpen: number;
  readonly commission: number;
  // The money at stake when the stop loss was first set, for R multiples; 0 without one.
  readonly initialRisk: number;
  readonly initialVolume: number;
  // The best and worst prices the position could have closed at.
  readonly bestPrice: number;
  readonly worstPrice: number;
  // Management from a risk order (break-even, trailing, hidden stops), as the live trade manager
  // keeps it; null without any. Sessions saved before rules existed have none.
  readonly rule: LegRule | null;
}

export interface SimOrder {
  readonly type: PendingType;
  readonly symbol: string;
  readonly comment: string;
  readonly sl: number;
  readonly tp: number;
  readonly time: number;
  readonly price: number;
  readonly ticket: number;
  readonly volume: number;
  // The limit a stop limit order becomes once its stop price trades; 0 for other orders.
  readonly stopLimit: number;
  // 0 is good till cancelled.
  readonly expiration: number;
  // Handed to the position the order opens.
  readonly rule: LegRule | null;
}

export interface SimDeal {
  readonly side: Side;
  readonly entry: 'in' | 'out';
  readonly reason: DealReason;
  readonly symbol: string;
  readonly comment: string;
  readonly time: number;
  readonly order: number;
  readonly price: number;
  readonly ticket: number;
  readonly volume: number;
  readonly profit: number;
  readonly position: number;
  readonly commission: number;
}

// A position from its opening to its last close, partial closes included.
export interface ClosedTrade {
  readonly side: Side;
  readonly reason: DealReason;
  readonly symbol: string;
  readonly comment: string;
  readonly mae: number;
  readonly mfe: number;
  readonly profit: number;
  readonly ticket: number;
  readonly volume: number;
  readonly openTime: number;
  readonly closeTime: number;
  readonly priceOpen: number;
  readonly commission: number;
  readonly priceClose: number;
  readonly initialRisk: number;
}

export interface JournalLine {
  readonly time: number;
  readonly message: string;
}

export interface EquityPoint {
  readonly time: number;
  readonly equity: number;
  readonly balance: number;
}

export interface Book {
  // The simulated clock; null until the replay has started.
  readonly time: number | null;
  readonly balance: number;
  readonly nextTicket: number;
  readonly peakEquity: number;
  readonly maxDrawdown: number;
  readonly maxDrawdownPercent: number;
  readonly deals: readonly SimDeal[];
  readonly curve: readonly EquityPoint[];
  readonly orders: readonly SimOrder[];
  readonly trades: readonly ClosedTrade[];
  readonly journal: readonly JournalLine[];
  readonly positions: readonly SimPosition[];
}

export function newBook(balance: number): Book {
  return { time: null, balance, nextTicket: 1, peakEquity: balance, maxDrawdown: 0, maxDrawdownPercent: 0, deals: [], curve: [], orders: [], trades: [], journal: [], positions: [] };
}

export interface Quote {
  readonly bid: number;
  readonly ask: number;
}

export interface AccountFigures {
  readonly profit: number;
  readonly equity: number;
  readonly margin: number;
  readonly balance: number;
  readonly freeMargin: number;
  // Null without open positions.
  readonly marginLevel: number | null;
}
