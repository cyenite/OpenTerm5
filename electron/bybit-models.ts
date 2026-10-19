import { createHash } from 'node:crypto';
import { timeframes, type Account, type Bar, type Deal, type Order, type OrderTypeKey, type Position, type SymbolSpec, type Tick, type Timeframe } from '../shared/protocol';

export interface RawInstrument {
  symbol: string;
  status: string;
  baseCoin: string;
  quoteCoin: string;
  settleCoin: string;
  priceScale: string;
  contractType: string;
  displayName?: string;
  priceFilter: { tickSize: string };
  lotSizeFilter: { qtyStep: string; minOrderQty: string; maxOrderQty: string; maxMktOrderQty?: string; minNotionalValue?: string };
  leverageFilter: { minLeverage: string; maxLeverage: string; leverageStep: string };
}

export interface RawTicker {
  symbol: string;
  lastPrice?: string;
  bid1Price?: string;
  ask1Price?: string;
  markPrice?: string;
  volume24h?: string;
}

export interface RawWallet {
  totalEquity: string;
  totalWalletBalance: string;
  totalMarginBalance: string;
  totalAvailableBalance: string;
  totalPerpUPL: string;
  totalInitialMargin: string;
  totalMaintenanceMargin: string;
  coin: { coin: string; equity: string; usdValue: string }[];
}

export interface RawPosition {
  symbol: string;
  side: string;
  size: string;
  positionIdx: number;
  avgPrice?: string;
  entryPrice?: string;
  markPrice: string;
  leverage: string;
  liqPrice: string;
  takeProfit: string;
  stopLoss: string;
  unrealisedPnl: string;
  openTime?: number | string;
  createdTime?: string;
}

export interface RawOrder {
  orderId: string;
  orderLinkId: string;
  symbol: string;
  side: string;
  price: string;
  qty: string;
  orderType: string;
  orderStatus: string;
  stopOrderType: string;
  triggerPrice: string;
  takeProfit: string;
  stopLoss: string;
  leavesQty: string;
  cumExecQty: string;
  avgPrice: string;
  reduceOnly: boolean;
  positionIdx: number;
  createdTime: string;
  updatedTime: string;
  rejectReason?: string;
}

export interface RawExecution {
  execId: string;
  orderId: string;
  symbol: string;
  side: string;
  execType: string;
  execPrice: string;
  execQty: string;
  execFee: string;
  execTime: string;
  closedSize?: string;
}

export interface RawClosedPnl {
  orderId: string;
  closedPnl: string;
  openFee: string;
  closeFee: string;
}

export interface AccountIdentity {
  uid: number;
  server: string;
  currency: string;
  tradeMode: Account['tradeMode'];
  isHedging: boolean;
  isTradeAllowed: boolean;
}

export const num = (value: unknown): number => {
  if (value === '' || value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Bybit identifies orders by UUID and positions by symbol; the terminal needs numeric tickets.
// 52 bits of a hash stay safe integers and collide with negligible probability.
export function ticketOf(id: string): number {
  return parseInt(createHash('sha256').update(id).digest('hex').slice(0, 13), 16) || 1;
}

export const positionTicket = (symbol: string, positionIdx: number, openTime: number) => ticketOf(`position|${symbol}|${positionIdx}|${openTime}`);

export const isBuy = (side: string) => side === 'Buy';

const decimalsOf = (step: number) => {
  const text = String(step);
  if (text.includes('e-')) return Number(text.split('e-')[1]);
  return text.includes('.') ? text.split('.')[1].length : 0;
};

export const roundTo = (value: number, step: number) => step > 0 ? Number((Math.round(value / step) * step).toFixed(decimalsOf(step))) : value;

export const formatQty = (value: number, step: number) => (Math.floor(value / step + 1e-9) * step).toFixed(decimalsOf(step));

export const formatPrice = (value: number, tickSize: number) => roundTo(value, tickSize).toFixed(decimalsOf(tickSize));

const contractLabels: Record<string, string> = {
  LinearPerpetual: 'perpetual',
  LinearFutures: 'futures',
  InversePerpetual: 'inverse perpetual',
  InverseFutures: 'inverse futures',
};

export function instrumentSpec(raw: RawInstrument, ticker?: RawTicker): SymbolSpec {
  const digits = Math.max(0, Math.round(num(raw.priceScale)));
  const tickSize = num(raw.priceFilter.tickSize);
  const lots = raw.lotSizeFilter;
  const limitMax = num(lots.maxOrderQty);
  const marketMax = num(lots.maxMktOrderQty) || limitMax;
  const point = 10 ** -digits;
  const bid = num(ticker?.bid1Price);
  const ask = num(ticker?.ask1Price);
  return {
    name: raw.symbol,
    path: `Bybit\\${raw.settleCoin} ${contractLabels[raw.contractType] ?? raw.contractType}\\${raw.symbol}`,
    tradeMode: raw.status === 'Trading' ? 'Full access' : raw.status === 'Closed' ? 'Disabled' : 'Close only',
    description: `${raw.baseCoin}/${raw.quoteCoin} ${contractLabels[raw.contractType] ?? raw.contractType}`,
    currencyBase: raw.baseCoin,
    currencyProfit: raw.settleCoin,
    currencyMargin: raw.settleCoin,
    point,
    digits,
    tickSize,
    spread: bid && ask ? Math.round((ask - bid) / point) : 0,
    swapLong: 0,
    swapShort: 0,
    volumeMin: num(lots.minOrderQty),
    volumeMax: Math.min(limitMax, marketMax),
    stopsLevel: 0,
    volumeStep: num(lots.qtyStep),
    contractSize: 1,
    visible: true,
    isSpreadFloat: true,
  };
}

export function tickFrom(ticker: RawTicker, previous: Tick | undefined, time: number): Tick | undefined {
  const bid = num(ticker.bid1Price) || previous?.bid || 0;
  const ask = num(ticker.ask1Price) || previous?.ask || 0;
  if (!bid || !ask) return undefined;
  return { symbol: ticker.symbol, bid, ask, last: num(ticker.lastPrice) || previous?.last || 0, time, volume: num(ticker.volume24h) || previous?.volume || 0 };
}

export function walletAccount(wallet: RawWallet, identity: AccountIdentity): Account {
  const equity = num(wallet.totalEquity);
  const margin = num(wallet.totalInitialMargin);
  return {
    name: `Bybit UID ${identity.uid}`,
    server: identity.server,
    company: 'Bybit',
    currency: identity.currency,
    tradeMode: identity.tradeMode,
    login: identity.uid,
    credit: 0,
    margin,
    equity,
    profit: num(wallet.totalPerpUPL),
    balance: num(wallet.totalWalletBalance),
    leverage: 0,
    marginFree: num(wallet.totalAvailableBalance),
    marginLevel: margin > 0 ? equity / margin * 100 : 0,
    isHedging: identity.isHedging,
    isFifo: false,
    isEquityLive: true,
    isTradeAllowed: identity.isTradeAllowed,
    utcOffsetSeconds: 0,
  };
}

// The coin's own USD valuation is what Bybit uses for collateral; stablecoins absent from the
// wallet count at par.
export function coinRate(wallet: RawWallet | undefined, coin: string): number {
  const entry = wallet?.coin.find((item) => item.coin === coin);
  const equity = num(entry?.equity);
  const value = num(entry?.usdValue);
  return equity > 0 && value > 0 ? value / equity : 1;
}

export const protectionTypes = new Set(['TakeProfit', 'StopLoss', 'PartialTakeProfit', 'PartialStopLoss', 'TrailingStop']);

export const isProtection = (raw: RawOrder) => protectionTypes.has(raw.stopOrderType);

const isStopLoss = (raw: RawOrder) => raw.stopOrderType === 'StopLoss' || raw.stopOrderType === 'PartialStopLoss' || raw.stopOrderType === 'TrailingStop';

const openStatuses = new Set(['New', 'PartiallyFilled', 'Untriggered']);

export const isOpenOrder = (raw: RawOrder) => openStatuses.has(raw.orderStatus);

// The nearest stop and target among a position's TP/SL orders stand in for MT5's single levels.
export function positionFrom(raw: RawPosition, protection: readonly RawOrder[], digits: number): Position | null {
  const volume = num(raw.size);
  if (!(volume > 0) || !raw.side) return null;
  const side = isBuy(raw.side) ? 'buy' : 'sell';
  const priceOpen = num(raw.avgPrice ?? raw.entryPrice);
  const own = protection.filter((order) => order.symbol === raw.symbol && order.positionIdx === raw.positionIdx);
  const stops = [num(raw.stopLoss), ...own.filter(isStopLoss).map((order) => num(order.triggerPrice))].filter((price) => price > 0);
  const targets = [num(raw.takeProfit), ...own.filter((order) => !isStopLoss(order)).map((order) => num(order.triggerPrice))].filter((price) => price > 0);
  const nearest = (prices: number[], isAbove: boolean) => prices.length ? (isAbove ? Math.min(...prices) : Math.max(...prices)) : 0;
  const openTime = num(raw.openTime) || num(raw.createdTime);
  return {
    side,
    symbol: raw.symbol,
    comment: '',
    sl: nearest(stops, side === 'sell'),
    tp: nearest(targets, side === 'buy'),
    swap: 0,
    time: openTime,
    magic: 0,
    ticket: positionTicket(raw.symbol, raw.positionIdx, openTime),
    volume,
    profit: num(raw.unrealisedPnl),
    priceOpen: Number(priceOpen.toFixed(digits)),
    priceCurrent: num(raw.markPrice),
    leverage: num(raw.leverage) || undefined,
    liquidationPrice: num(raw.liqPrice) || undefined,
  };
}

export function orderTypeOf(raw: RawOrder): OrderTypeKey {
  const side = isBuy(raw.side) ? 'buy' : 'sell';
  const isTriggered = num(raw.triggerPrice) > 0;
  if (raw.orderType === 'Limit') return isTriggered ? `${side}StopLimit` : `${side}Limit`;
  return isTriggered ? `${side}Stop` : side;
}

const orderStates: Record<string, number> = { New: 1, Untriggered: 1, PartiallyFilled: 3, Filled: 4, Cancelled: 2, PartiallyFilledCanceled: 2, Deactivated: 2, Rejected: 5, Triggered: 1 };

export function orderFrom(raw: RawOrder, digits: number): Order {
  const type = orderTypeOf(raw);
  const trigger = num(raw.triggerPrice);
  const price = num(raw.price);
  const isStopLimit = type === 'buyStopLimit' || type === 'sellStopLimit';
  const volume = num(raw.qty);
  return {
    type,
    symbol: raw.symbol,
    comment: raw.orderLinkId.startsWith('ot5-') ? '' : raw.orderLinkId,
    sl: num(raw.stopLoss),
    tp: num(raw.takeProfit),
    time: num(raw.createdTime),
    state: orderStates[raw.orderStatus] ?? 0,
    ticket: ticketOf(raw.orderId),
    volume: num(raw.leavesQty) || volume,
    timeDone: isOpenOrder(raw) ? 0 : num(raw.updatedTime),
    priceOpen: Number((trigger > 0 ? trigger : price || num(raw.avgPrice)).toFixed(digits)),
    expiration: 0,
    positionId: 0,
    priceCurrent: 0,
    volumeInitial: volume,
    ...(isStopLimit ? { stoplimit: price } : {}),
  };
}

export function dealFrom(raw: RawExecution, closed: RawClosedPnl | undefined, isFirstFill: boolean): Deal {
  const closedSize = num(raw.closedSize);
  const volume = num(raw.execQty);
  const isTrade = raw.execType === 'Trade' || raw.execType === 'BustTrade' || raw.execType === 'AdlTrade';
  // Bybit reports one closedPnl per closing order, net of its open and close fees; the terminal
  // books gross profit on the order's first closing fill and fees per fill as commission.
  const profit = closed && isFirstFill ? num(closed.closedPnl) + num(closed.openFee) + num(closed.closeFee) : 0;
  return {
    type: isTrade ? (isBuy(raw.side) ? 'buy' : 'sell') : raw.execType === 'Funding' ? 'funding' : raw.execType.toLowerCase(),
    entry: closedSize <= 0 ? 'in' : closedSize < volume ? 'inout' : 'out',
    symbol: raw.symbol,
    comment: '',
    fee: 0,
    swap: raw.execType === 'Funding' ? -num(raw.execFee) : 0,
    time: num(raw.execTime),
    order: ticketOf(raw.orderId),
    price: num(raw.execPrice),
    ticket: ticketOf(raw.execId),
    volume,
    profit,
    positionId: 0,
    commission: raw.execType === 'Funding' ? 0 : -num(raw.execFee),
  };
}

export const klineIntervals: Partial<Record<Timeframe, string>> = {
  M1: '1', M3: '3', M5: '5', M15: '15', M30: '30', H1: '60', H2: '120', H4: '240', H6: '360', H12: '720', D1: 'D', W1: 'W', MN1: 'M',
};

export interface KlinePlan {
  interval: string;
  seconds: number;
  sourceSeconds: number;
  isAggregated: boolean;
}

// Every non-native period divides a day, so epoch-aligned buckets match Bybit's UTC sessions.
export function klinePlan(timeframe: Timeframe): KlinePlan {
  const target = timeframes.find((period) => period.label === timeframe);
  if (!target) throw new RangeError('Unknown chart timeframe');
  const native = klineIntervals[timeframe];
  if (native) return { interval: native, seconds: target.seconds, sourceSeconds: target.seconds, isAggregated: false };
  const source = timeframes.filter((period) => klineIntervals[period.label] && period.seconds < target.seconds && target.seconds % period.seconds === 0 && period.seconds < 86400).at(-1);
  if (!source) throw new RangeError(`Bybit has no data for ${timeframe}`);
  return { interval: klineIntervals[source.label]!, seconds: target.seconds, sourceSeconds: source.seconds, isAggregated: true };
}

export const klineBar = (row: readonly string[]): Bar => ({
  time: Math.floor(num(row[0]) / 1000), open: num(row[1]), high: num(row[2]), low: num(row[3]), close: num(row[4]), volume: num(row[5]),
});

export function aggregateBars(bars: readonly Bar[], seconds: number): Bar[] {
  const ordered = [...new Map(bars.map((bar) => [bar.time, bar])).values()].sort((left, right) => left.time - right.time);
  const result: Bar[] = [];
  for (const bar of ordered) {
    const time = Math.floor(bar.time / seconds) * seconds;
    const previous = result.at(-1);
    if (!previous || previous.time !== time) result.push({ ...bar, time });
    else result[result.length - 1] = { time, open: previous.open, high: Math.max(previous.high, bar.high), low: Math.min(previous.low, bar.low), close: bar.close, volume: previous.volume + bar.volume };
  }
  return result;
}
