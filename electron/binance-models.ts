import type { Account, Deal, Order, OrderTypeKey, Position, SymbolSpec, Tick, Timeframe } from '../shared/protocol';
import { decimalsOf, num, planKlines, ticketOf, type KlinePlan } from './exchange-common';

export interface RawFilter {
  filterType: string;
  tickSize?: string;
  stepSize?: string;
  minQty?: string;
  maxQty?: string;
  notional?: string;
  multiplierUp?: string;
  multiplierDown?: string;
}

export interface RawSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  marginAsset: string;
  contractType: string;
  filters: RawFilter[];
}

export interface RawBookTicker {
  symbol: string;
  bidPrice: string;
  askPrice: string;
  time?: number;
}

export interface RawAsset {
  asset: string;
  walletBalance: string;
  marginBalance: string;
  unrealizedProfit: string;
  availableBalance: string;
}

export interface RawAccount {
  totalWalletBalance: string;
  totalMarginBalance: string;
  totalUnrealizedProfit: string;
  totalInitialMargin: string;
  availableBalance: string;
  assets: RawAsset[];
}

export interface RawPosition {
  symbol: string;
  positionSide: string;
  positionAmt: string;
  entryPrice: string;
  markPrice?: string;
  unRealizedProfit: string;
  liquidationPrice?: string;
  updateTime?: number;
}

export interface RawOrder {
  orderId: number;
  clientOrderId: string;
  symbol: string;
  side: string;
  positionSide: string;
  type: string;
  status: string;
  price: string;
  avgPrice: string;
  origQty: string;
  executedQty: string;
  reduceOnly: boolean;
  time?: number;
  updateTime: number;
}

// A conditional order on the algo service: stop entries, and the stop losses and take profits
// that protect positions.
export interface RawAlgoOrder {
  algoId: number;
  clientAlgoId: string;
  symbol: string;
  side: string;
  positionSide: string;
  orderType: string;
  algoStatus: string;
  quantity: string;
  triggerPrice: string;
  price: string;
  reduceOnly: boolean;
  closePosition: boolean;
  createTime: number;
  updateTime: number;
}

export interface RawTrade {
  id: number;
  orderId: number;
  symbol: string;
  side: string;
  positionSide: string;
  price: string;
  qty: string;
  realizedPnl: string;
  commission: string;
  commissionAsset: string;
  time: number;
}

export interface RawIncome {
  symbol: string;
  incomeType: string;
  income: string;
  asset: string;
  time: number;
  tranId: number;
}

export interface AccountIdentity {
  uid: number;
  server: string;
  currency: string;
  tradeMode: Account['tradeMode'];
  isHedging: boolean;
  isTradeAllowed: boolean;
}

const filterOf = (raw: RawSymbol, type: string) => raw.filters.find((filter) => filter.filterType === type);

const contractLabels: Record<string, string> = {
  PERPETUAL: 'perpetual',
  CURRENT_QUARTER: 'quarterly',
  NEXT_QUARTER: 'next quarter',
  TRADIFI_PERPETUAL: 'perpetual',
};

export function symbolSpec(raw: RawSymbol, ticker?: RawBookTicker): SymbolSpec {
  const tickSize = num(filterOf(raw, 'PRICE_FILTER')?.tickSize);
  const lots = filterOf(raw, 'LOT_SIZE');
  const market = filterOf(raw, 'MARKET_LOT_SIZE');
  const digits = decimalsOf(tickSize);
  const point = 10 ** -digits;
  const bid = num(ticker?.bidPrice);
  const ask = num(ticker?.askPrice);
  const label = contractLabels[raw.contractType] ?? raw.contractType.toLowerCase();
  return {
    name: raw.symbol,
    path: `Binance\\${raw.marginAsset} ${label}\\${raw.symbol}`,
    tradeMode: raw.status === 'TRADING' ? 'Full access' : 'Close only',
    description: `${raw.baseAsset}/${raw.quoteAsset} ${label}`,
    currencyBase: raw.baseAsset,
    currencyProfit: raw.marginAsset,
    currencyMargin: raw.marginAsset,
    point,
    digits,
    tickSize,
    spread: bid && ask ? Math.round((ask - bid) / point) : 0,
    swapLong: 0,
    swapShort: 0,
    volumeMin: num(lots?.minQty),
    volumeMax: Math.min(num(lots?.maxQty) || Infinity, num(market?.maxQty) || Infinity),
    stopsLevel: 0,
    volumeStep: num(lots?.stepSize),
    contractSize: 1,
    visible: true,
    isSpreadFloat: true,
  };
}

export function tickFrom(ticker: RawBookTicker, previous: Tick | undefined, time: number, last?: number): Tick | undefined {
  const bid = num(ticker.bidPrice) || previous?.bid || 0;
  const ask = num(ticker.askPrice) || previous?.ask || 0;
  if (!bid || !ask) return undefined;
  return { symbol: ticker.symbol, bid, ask, last: last || previous?.last || 0, time, volume: previous?.volume ?? 0 };
}

export function walletAccount(raw: RawAccount, identity: AccountIdentity): Account {
  const equity = num(raw.totalMarginBalance);
  const margin = num(raw.totalInitialMargin);
  return {
    name: `Binance UID ${identity.uid}`,
    server: identity.server,
    company: 'Binance',
    currency: identity.currency,
    tradeMode: identity.tradeMode,
    login: identity.uid,
    credit: 0,
    margin,
    equity,
    profit: num(raw.totalUnrealizedProfit),
    balance: num(raw.totalWalletBalance),
    leverage: 0,
    marginFree: num(raw.availableBalance),
    marginLevel: margin > 0 ? equity / margin * 100 : 0,
    isHedging: identity.isHedging,
    isFifo: false,
    isEquityLive: true,
    isTradeAllowed: identity.isTradeAllowed,
    utcOffsetSeconds: 0,
  };
}

// Binance has no position id. A position is its symbol and side for as long as it stays open,
// from the trade that opened it (found in the trade history, so it survives a restart).
export const positionTicket = (symbol: string, positionSide: string, openTime: number) => ticketOf(`position|${symbol}|${positionSide}|${openTime}`);

export const positionKey = (symbol: string, positionSide: string) => `${symbol}|${positionSide}`;

// Each trade's signed size, newest first, walked back from the current size: the trade that
// takes the remainder to zero or across it opened the position.
export function openingTrade(trades: readonly RawTrade[], amount: number, positionSide: string, step: number): RawTrade | undefined {
  let remaining = amount;
  const ordered = trades.filter((trade) => trade.positionSide === positionSide).sort((left, right) => right.time - left.time || right.id - left.id);
  for (const trade of ordered) {
    const before = remaining - (trade.side === 'BUY' ? 1 : -1) * num(trade.qty);
    if (Math.abs(before) < step / 2 || Math.sign(before) !== Math.sign(remaining)) return trade;
    remaining = before;
  }
  return undefined;
}

export const isProtection = (raw: RawAlgoOrder) => raw.reduceOnly || raw.closePosition;

const isStop = (raw: RawAlgoOrder) => raw.orderType === 'STOP_MARKET' || raw.orderType === 'STOP' || raw.orderType === 'TRAILING_STOP_MARKET';

export const isStopLoss = isStop;

const sideOf = (positionAmt: number, positionSide: string) => positionSide === 'SHORT' || positionSide === 'BOTH' && positionAmt < 0 ? 'sell' : 'buy';

// Protection orders close a position, so they trade against it.
const protects = (order: RawAlgoOrder, symbol: string, positionSide: string, side: 'buy' | 'sell') =>
  order.symbol === symbol && order.positionSide === positionSide && order.side === (side === 'buy' ? 'SELL' : 'BUY');

export function protectionOf(raw: RawPosition, algos: readonly RawAlgoOrder[]): RawAlgoOrder[] {
  const side = sideOf(num(raw.positionAmt), raw.positionSide);
  return algos.filter((order) => isProtection(order) && protects(order, raw.symbol, raw.positionSide, side));
}

// The nearest stop and target among a position's protection orders stand in for MT5's single levels.
export function positionFrom(raw: RawPosition, algos: readonly RawAlgoOrder[], openTime: number, digits: number, leverage?: number): Position | null {
  const amount = num(raw.positionAmt);
  if (!amount) return null;
  const side = sideOf(amount, raw.positionSide);
  const own = protectionOf(raw, algos);
  const stops = own.filter(isStop).map((order) => num(order.triggerPrice)).filter((price) => price > 0);
  const targets = own.filter((order) => !isStop(order)).map((order) => num(order.triggerPrice)).filter((price) => price > 0);
  const nearest = (prices: number[], isAbove: boolean) => prices.length ? (isAbove ? Math.min(...prices) : Math.max(...prices)) : 0;
  return {
    side,
    symbol: raw.symbol,
    comment: '',
    sl: nearest(stops, side === 'sell'),
    tp: nearest(targets, side === 'buy'),
    swap: 0,
    time: openTime,
    magic: 0,
    ticket: positionTicket(raw.symbol, raw.positionSide, openTime),
    volume: Math.abs(amount),
    profit: num(raw.unRealizedProfit),
    priceOpen: Number(num(raw.entryPrice).toFixed(digits)),
    priceCurrent: num(raw.markPrice),
    leverage,
    liquidationPrice: num(raw.liquidationPrice) || undefined,
  };
}

// SL and TP a pending entry carries until it fills, in ticks of the contract, base 36:
// `ot5-<random>-<sl>-<tp>`. Binance allows 36 characters from [.A-Z:/a-z0-9_-].
export function protectedClientId(random: string, sl: number, tp: number, tickSize: number): string {
  const ticks = (price: number) => price > 0 ? Math.round(price / tickSize).toString(36) : '0';
  return `ot5-${random.slice(0, 8)}-${ticks(sl)}-${ticks(tp)}`.slice(0, 36);
}

export function attachedLevels(clientId: string, tickSize: number): { sl: number; tp: number } {
  const match = /^ot5-[a-z0-9]+-([0-9a-z]+)-([0-9a-z]+)$/.exec(clientId);
  if (!match) return { sl: 0, tp: 0 };
  const price = (ticks: string) => Number((parseInt(ticks, 36) * tickSize).toFixed(decimalsOf(tickSize)));
  return { sl: price(match[1]), tp: price(match[2]) };
}

const orderStates: Record<string, number> = { NEW: 1, PARTIALLY_FILLED: 3, FILLED: 4, CANCELED: 2, EXPIRED: 2, EXPIRED_IN_MATCH: 2, REJECTED: 5 };

export function orderFrom(raw: RawOrder, digits: number, tickSize: number): Order {
  const side = raw.side === 'BUY' ? 'buy' : 'sell';
  const type: OrderTypeKey = raw.type === 'LIMIT' ? `${side}Limit` : side;
  const volume = num(raw.origQty);
  const { sl, tp } = attachedLevels(raw.clientOrderId, tickSize);
  const isOpen = raw.status === 'NEW' || raw.status === 'PARTIALLY_FILLED';
  return {
    type,
    symbol: raw.symbol,
    comment: raw.clientOrderId.startsWith('ot5-') ? '' : raw.clientOrderId,
    sl,
    tp,
    time: raw.time ?? raw.updateTime,
    state: orderStates[raw.status] ?? 0,
    ticket: ticketOf(`order|${raw.orderId}`),
    volume: isOpen ? volume - num(raw.executedQty) : volume,
    timeDone: isOpen ? 0 : raw.updateTime,
    priceOpen: Number((num(raw.price) || num(raw.avgPrice)).toFixed(digits)),
    expiration: 0,
    positionId: 0,
    priceCurrent: 0,
    volumeInitial: volume,
  };
}

const algoStates: Record<string, number> = { NEW: 1, TRIGGERING: 1, TRIGGERED: 4, FINISHED: 4, CANCELED: 2, EXPIRED: 2, REJECTED: 5 };

export const isOpenAlgo = (raw: RawAlgoOrder) => raw.algoStatus === 'NEW';

export function algoOrderFrom(raw: RawAlgoOrder, digits: number, tickSize: number): Order {
  const side = raw.side === 'BUY' ? 'buy' : 'sell';
  const type: OrderTypeKey = raw.orderType === 'STOP' ? `${side}StopLimit` : `${side}Stop`;
  const volume = num(raw.quantity);
  const { sl, tp } = attachedLevels(raw.clientAlgoId, tickSize);
  return {
    type,
    symbol: raw.symbol,
    comment: raw.clientAlgoId.startsWith('ot5-') ? '' : raw.clientAlgoId,
    sl,
    tp,
    time: raw.createTime,
    state: algoStates[raw.algoStatus] ?? 0,
    ticket: ticketOf(`algo|${raw.algoId}`),
    volume,
    timeDone: isOpenAlgo(raw) ? 0 : raw.updateTime,
    priceOpen: Number(num(raw.triggerPrice).toFixed(digits)),
    expiration: 0,
    positionId: 0,
    priceCurrent: 0,
    volumeInitial: volume,
    ...(raw.orderType === 'STOP' ? { stoplimit: num(raw.price) } : {}),
  };
}

// Binance books realised P/L and the fee on each fill; funding arrives as income.
export function dealFrom(raw: RawTrade): Deal {
  const realized = num(raw.realizedPnl);
  return {
    type: raw.side === 'BUY' ? 'buy' : 'sell',
    entry: realized !== 0 ? 'out' : 'in',
    symbol: raw.symbol,
    comment: '',
    fee: 0,
    swap: 0,
    time: raw.time,
    order: ticketOf(`order|${raw.orderId}`),
    price: num(raw.price),
    ticket: ticketOf(`trade|${raw.symbol}|${raw.id}`),
    volume: num(raw.qty),
    profit: realized,
    positionId: 0,
    commission: -num(raw.commission),
  };
}

export function fundingFrom(raw: RawIncome): Deal {
  return {
    type: 'funding',
    entry: 'in',
    symbol: raw.symbol,
    comment: '',
    fee: 0,
    swap: num(raw.income),
    time: raw.time,
    order: 0,
    price: 0,
    ticket: ticketOf(`income|${raw.tranId}`),
    volume: 0,
    profit: 0,
    positionId: 0,
    commission: 0,
  };
}

export const klineIntervals: Partial<Record<Timeframe, string>> = {
  M1: '1m', M3: '3m', M5: '5m', M15: '15m', M30: '30m', H1: '1h', H2: '2h', H4: '4h', H6: '6h', H8: '8h', H12: '12h', D1: '1d', W1: '1w', MN1: '1M',
};

export const klinePlan = (timeframe: Timeframe): KlinePlan => planKlines(timeframe, klineIntervals, 'Binance');
