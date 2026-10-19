import { orderType } from '../../../shared/protocol';
import { formatPrice, formatVolume } from '../format';
import type { AccountFigures, Book, ClosedTrade, DealReason, EquityPoint, JournalLine, PendingType, Quote, Side, SimDeal, SimOrder, SimPosition, Simulation, SymbolTerms } from './model';
import { barPath, barsEnding, bidAt, type Series, type SimBar } from './series';
import type { BulkKind } from '../../../shared/automation';
import type { LegRule } from '../../../shared/risk-order';

// The simulated broker. Bars are bid prices and the ask is the bid plus the symbol's spread, as in
// MetaTrader's tester. Within a bar prices are assumed to follow `barPath`; an order whose price
// the bar opened beyond (a gap) fills at the opening price instead. Stops, stop losses and market
// orders fill with the session's slippage against the trader; limits and take profits do not.
// Every function returns a new book; the book passed in is never changed.

const EPSILON = 1e-9;
const JOURNAL_LIMIT = 1000;
const CURVE_LIMIT = 4000;

export interface Outcome {
  readonly book: Book;
  readonly error: string | null;
}

// Current bids by symbol, as the charts show them at the book's time.
export type Bids = Readonly<Record<string, number>>;

export interface MarketRequest {
  readonly side: Side;
  readonly symbol: string;
  readonly comment?: string;
  readonly sl?: number;
  readonly tp?: number;
  readonly volume: number;
  readonly rule?: LegRule | null;
}

export interface PendingRequest {
  readonly type: PendingType;
  readonly symbol: string;
  readonly comment?: string;
  readonly sl?: number;
  readonly tp?: number;
  readonly price: number;
  readonly volume: number;
  readonly stopLimit?: number;
  readonly expiration?: number;
  readonly rule?: LegRule | null;
}

export interface OrderChange {
  readonly sl: number;
  readonly tp: number;
  readonly price: number;
  readonly stopLimit: number;
  readonly expiration: number;
}

interface Draft {
  time: number | null;
  balance: number;
  nextTicket: number;
  peakEquity: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  deals: SimDeal[];
  curve: EquityPoint[];
  orders: SimOrder[];
  trades: ClosedTrade[];
  journal: JournalLine[];
  positions: SimPosition[];
}

interface Trigger {
  // The bid at which it fires, rising through it when `isUp`.
  readonly level: number;
  readonly isUp: boolean;
  readonly fire: (bid: number) => void;
}

const round = (value: number, digits: number) => Number(value.toFixed(digits)) || 0;
const sign = (side: Side) => (side === 'buy' ? 1 : -1);
const sideLabel = (side: Side) => (side === 'buy' ? 'Buy' : 'Sell');
const stepDecimals = (step: number) => Math.max(0, Math.min(8, Math.ceil(-Math.log10(step) - EPSILON)));

const draftOf = (book: Book): Draft => ({
  ...book,
  deals: [...book.deals],
  curve: [...book.curve],
  orders: [...book.orders],
  trades: [...book.trades],
  journal: [...book.journal],
  positions: [...book.positions],
});

const done = (draft: Draft): Outcome => ({ book: draft, error: null });
const refused = (book: Book, error: string): Outcome => ({ book, error });

export const spreadOf = (terms: SymbolTerms) => terms.spreadPoints * terms.point;

export function quoteOf(terms: SymbolTerms, bid: number): Quote {
  return { bid, ask: round(bid + spreadOf(terms), terms.digits) };
}

// The price a position of this side closes at, and the one it opens at.
export const closingPrice = (side: Side, quote: Quote) => (side === 'buy' ? quote.bid : quote.ask);
export const openingPrice = (side: Side, quote: Quote) => (side === 'buy' ? quote.ask : quote.bid);

// Account money per lot for a move of 1.0 in price. A symbol quoted in the account currency needs
// no conversion, and one whose base is the account currency (USDJPY on a USD account) converts at
// its own price, which the backtest knows at every moment. Others use the rate captured with the
// symbol's terms.
export function moneyPerUnit(simulation: Simulation, terms: SymbolTerms, price: number): number {
  if (terms.currencyProfit === simulation.currency) return terms.contractSize;
  if (terms.currencyBase === simulation.currency) return price > 0 ? terms.contractSize / price : 0;
  return terms.contractSize * terms.profitRate;
}

export function profitAt(simulation: Simulation, terms: SymbolTerms, side: Side, priceOpen: number, volume: number, price: number): number {
  return (price - priceOpen) * sign(side) * volume * moneyPerUnit(simulation, terms, price);
}

export function marginFor(simulation: Simulation, terms: SymbolTerms, volume: number, price: number): number {
  return volume * price * moneyPerUnit(simulation, terms, price) / Math.max(1, simulation.settings.leverage);
}

// A position's floating profit at the bid, or null while the symbol has no price.
export function floatingProfit(simulation: Simulation, position: SimPosition, bids: Bids): number | null {
  const terms = simulation.terms[position.symbol];
  const bid = bids[position.symbol];
  if (!terms || bid === undefined) return null;
  return profitAt(simulation, terms, position.side, position.priceOpen, position.volume, closingPrice(position.side, quoteOf(terms, bid)));
}

export function accountFigures(book: Pick<Book, 'balance' | 'positions'>, simulation: Simulation, bids: Bids): AccountFigures {
  let profit = 0;
  let margin = 0;
  for (const position of book.positions) {
    const terms = simulation.terms[position.symbol];
    if (!terms) continue;
    profit += floatingProfit(simulation, position, bids) ?? 0;
    margin += marginFor(simulation, terms, position.volume, position.priceOpen);
  }
  const equity = book.balance + profit;
  return { profit, equity, margin, balance: book.balance, freeMargin: equity - margin, marginLevel: margin > 0 ? equity / margin * 100 : null };
}

function note(draft: Draft, time: number, message: string): void {
  draft.journal.push({ time, message });
  if (draft.journal.length > JOURNAL_LIMIT) draft.journal.splice(0, draft.journal.length - JOURNAL_LIMIT);
}

function nextTicket(draft: Draft): number {
  return draft.nextTicket++;
}

export function volumeProblem(terms: SymbolTerms, volume: number): string | null {
  if (!(volume > 0)) return 'The volume must be positive.';
  if (volume < terms.volumeMin - EPSILON) return `The minimum volume for ${terms.name} is ${terms.volumeMin}.`;
  if (volume > terms.volumeMax + EPSILON) return `The maximum volume for ${terms.name} is ${terms.volumeMax}.`;
  const steps = volume / terms.volumeStep;
  if (Math.abs(steps - Math.round(steps)) > 1e-6) return `The volume must be a multiple of ${terms.volumeStep}.`;
  return null;
}

// Stops are checked against the price the position would close at now, as MetaTrader does.
export function stopsProblem(side: Side, reference: number, sl: number, tp: number, digits: number): string | null {
  const isBuy = side === 'buy';
  if (sl < 0 || tp < 0) return 'Stop loss and take profit must be positive.';
  if (sl > 0 && (isBuy ? sl >= reference : sl <= reference)) return `A ${side} stop loss must be ${isBuy ? 'below' : 'above'} ${formatPrice(reference, digits)}.`;
  if (tp > 0 && (isBuy ? tp <= reference : tp >= reference)) return `A ${side} take profit must be ${isBuy ? 'above' : 'below'} ${formatPrice(reference, digits)}.`;
  return null;
}

const pendingSide = (type: PendingType): Side => (orderType(type)!.isBuy ? 'buy' : 'sell');

// Where a pending order may sit against the current quote, and its entry for checking stops.
export function pendingProblem(type: PendingType, price: number, stopLimit: number, quote: Quote): string | null {
  if (!(price > 0)) return 'The order price must be positive.';
  switch (type) {
    case 'buyLimit': return price < quote.ask ? null : 'A buy limit must be below the ask.';
    case 'sellLimit': return price > quote.bid ? null : 'A sell limit must be above the bid.';
    case 'buyStop': return price > quote.ask ? null : 'A buy stop must be above the ask.';
    case 'sellStop': return price < quote.bid ? null : 'A sell stop must be below the bid.';
    case 'buyStopLimit': return price <= quote.ask ? 'A buy stop limit must trigger above the ask.' : stopLimit > 0 && stopLimit <= price ? null : 'The limit of a buy stop limit must be at or below its stop price.';
    case 'sellStopLimit': return price >= quote.bid ? 'A sell stop limit must trigger below the bid.' : stopLimit >= price ? null : 'The limit of a sell stop limit must be at or above its stop price.';
  }
}

export const pendingEntry = (order: Pick<SimOrder, 'price' | 'stopLimit'>) => (order.stopLimit > 0 ? order.stopLimit : order.price);

function openPosition(draft: Draft, simulation: Simulation, bids: Bids, terms: SymbolTerms, side: Side, volume: number, price: number, time: number, details: { sl: number; tp: number; comment: string; reason: DealReason; order: number; rule: LegRule | null }): string | null {
  const required = marginFor(simulation, terms, volume, price);
  if (required > accountFigures(draft, simulation, bids).freeMargin + EPSILON) return `Not enough money: ${formatVolume(volume)} ${terms.name} needs ${required.toFixed(2)} ${simulation.currency} of margin.`;
  const commission = round(simulation.settings.commissionPerLot * volume, 2);
  const ticket = details.order || nextTicket(draft);
  const bid = bids[terms.name] ?? price;
  const current = closingPrice(side, quoteOf(terms, bid));
  const initialRisk = details.sl > 0 ? Math.abs(profitAt(simulation, terms, side, price, volume, details.sl)) : 0;
  draft.positions.push({ side, symbol: terms.name, comment: details.comment, sl: details.sl, tp: details.tp, time, ticket, volume, priceOpen: price, commission, initialRisk, initialVolume: volume, bestPrice: current, worstPrice: current, rule: details.rule });
  draft.deals.push({ side, entry: 'in', reason: details.reason, symbol: terms.name, comment: details.comment, time, order: ticket, price, ticket: nextTicket(draft), volume, profit: 0, position: ticket, commission: -commission });
  draft.balance = round(draft.balance - commission, 2);
  note(draft, time, `${sideLabel(side)} ${formatVolume(volume)} ${terms.name} at ${formatPrice(price, terms.digits)} (#${ticket})`);
  return null;
}

function recordTrade(draft: Draft, simulation: Simulation, terms: SymbolTerms, position: SimPosition, closing: SimDeal): void {
  const deals = draft.deals.filter((deal) => deal.position === position.ticket);
  const exits = deals.filter((deal) => deal.entry === 'out');
  const closed = exits.reduce((sum, deal) => sum + deal.volume, 0);
  const priceClose = closed > 0 ? exits.reduce((sum, deal) => sum + deal.price * deal.volume, 0) / closed : closing.price;
  const excursion = (price: number) => profitAt(simulation, terms, position.side, position.priceOpen, position.initialVolume, price);
  draft.trades.push({
    side: position.side,
    reason: closing.reason,
    symbol: position.symbol,
    comment: position.comment,
    mae: Math.min(0, round(excursion(position.worstPrice), 2)),
    mfe: Math.max(0, round(excursion(position.bestPrice), 2)),
    profit: round(exits.reduce((sum, deal) => sum + deal.profit, 0), 2),
    ticket: position.ticket,
    volume: position.initialVolume,
    openTime: position.time,
    closeTime: closing.time,
    priceOpen: position.priceOpen,
    commission: round(deals.reduce((sum, deal) => sum + deal.commission, 0), 2),
    priceClose: round(priceClose, terms.digits),
    initialRisk: position.initialRisk,
  });
}

// Takes the position by ticket from the draft: excursions may have replaced the record the caller holds.
function closeVolume(draft: Draft, simulation: Simulation, terms: SymbolTerms, ticket: number, volume: number, price: number, time: number, reason: DealReason): void {
  const index = draft.positions.findIndex((candidate) => candidate.ticket === ticket);
  const position = draft.positions[index];
  if (!position) return;
  const decimals = stepDecimals(terms.volumeStep);
  const amount = Math.min(volume, position.volume);
  const profit = round(profitAt(simulation, terms, position.side, position.priceOpen, amount, price), 2);
  const commission = round(simulation.settings.commissionPerLot * amount, 2);
  const deal: SimDeal = { side: position.side === 'buy' ? 'sell' : 'buy', entry: 'out', reason, symbol: position.symbol, comment: position.comment, time, order: 0, price, ticket: nextTicket(draft), volume: amount, profit, position: position.ticket, commission: -commission };
  draft.deals.push(deal);
  draft.balance = round(draft.balance + profit - commission, 2);
  const remaining = round(position.volume - amount, decimals);
  const why = reason === 'sl' ? 'stop loss' : reason === 'tp' ? 'take profit' : reason === 'stopOut' ? 'stop out' : 'close';
  note(draft, time, `#${position.ticket} ${remaining > EPSILON ? `${formatVolume(amount)} of ` : ''}${sideLabel(position.side).toLowerCase()} ${position.symbol} closed by ${why} at ${formatPrice(price, terms.digits)}: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} ${simulation.currency}`);
  if (remaining > EPSILON) {
    draft.positions[index] = { ...position, volume: remaining, commission: round(position.commission + commission, 2) };
    return;
  }
  draft.positions.splice(index, 1);
  recordTrade(draft, simulation, terms, { ...position, commission: round(position.commission + commission, 2) }, deal);
}

// Equity marks after every bar: the peak, the deepest fall from it, and the curve the statistics
// draw. The curve keeps one point per mark at most, thinning older points as it grows.
function mark(draft: Draft, simulation: Simulation, bids: Bids, time: number, isCurvePoint: boolean): void {
  const { equity, balance } = accountFigures(draft, simulation, bids);
  draft.peakEquity = Math.max(draft.peakEquity, equity);
  const drawdown = draft.peakEquity - equity;
  if (drawdown > draft.maxDrawdown) draft.maxDrawdown = round(drawdown, 2);
  const percent = draft.peakEquity > 0 ? drawdown / draft.peakEquity * 100 : 0;
  if (percent > draft.maxDrawdownPercent) draft.maxDrawdownPercent = round(percent, 4);
  if (!isCurvePoint) return;
  const point = { time, equity: round(equity, 2), balance: round(balance, 2) };
  if (draft.curve.at(-1)?.time === time) draft.curve[draft.curve.length - 1] = point;
  else draft.curve.push(point);
  if (draft.curve.length > CURVE_LIMIT) draft.curve = draft.curve.filter((_, index, list) => index % 2 === 0 || index === list.length - 1);
}

function stopOut(draft: Draft, simulation: Simulation, bids: Bids, time: number): void {
  const level = simulation.settings.stopOutLevel;
  for (let guard = 0; guard < 1000 && level > 0 && draft.positions.length; guard++) {
    const { marginLevel } = accountFigures(draft, simulation, bids);
    if (marginLevel === null || marginLevel > level) return;
    const worst = [...draft.positions].sort((left, right) => (floatingProfit(simulation, left, bids) ?? 0) - (floatingProfit(simulation, right, bids) ?? 0))[0];
    const terms = simulation.terms[worst.symbol];
    const bid = bids[worst.symbol];
    if (!terms || bid === undefined) return;
    closeVolume(draft, simulation, terms, worst.ticket, worst.volume, closingPrice(worst.side, quoteOf(terms, bid)), time, 'stopOut');
  }
}

function fillOrder(draft: Draft, simulation: Simulation, bids: Bids, terms: SymbolTerms, order: SimOrder, price: number, time: number): void {
  draft.orders = draft.orders.filter((candidate) => candidate.ticket !== order.ticket);
  const side = pendingSide(order.type);
  const label = orderType(order.type)!.label;
  note(draft, time, `${label} #${order.ticket} triggered at ${formatPrice(price, terms.digits)}`);
  const error = openPosition(draft, simulation, bids, terms, side, order.volume, price, time, { sl: order.sl, tp: order.tp, comment: order.comment, reason: 'pending', order: order.ticket, rule: order.rule ?? null });
  if (error) note(draft, time, `${label} #${order.ticket} cancelled. ${error}`);
}

function triggersFor(draft: Draft, simulation: Simulation, bids: Record<string, number>, terms: SymbolTerms, time: number): Trigger[] {
  const spread = spreadOf(terms);
  const slippage = simulation.settings.slippagePoints * terms.point;
  const price = (value: number) => round(value, terms.digits);
  const ask = (bid: number) => price(bid + spread);
  const result: Trigger[] = [];
  for (const order of draft.orders) {
    if (order.symbol !== terms.name) continue;
    const fill = (at: number) => fillOrder(draft, simulation, bids, terms, order, at, time);
    const becomeLimit = (type: 'buyLimit' | 'sellLimit') => {
      draft.orders = draft.orders.map((candidate) => candidate.ticket === order.ticket ? { ...candidate, type, price: order.stopLimit, stopLimit: 0 } : candidate);
      note(draft, time, `${orderType(order.type)!.label} #${order.ticket} reached ${formatPrice(order.price, terms.digits)} and became a ${orderType(type)!.label.toLowerCase()} at ${formatPrice(order.stopLimit, terms.digits)}`);
    };
    switch (order.type) {
      case 'buyLimit': result.push({ level: order.price - spread, isUp: false, fire: (bid) => fill(ask(bid)) }); break;
      case 'buyStop': result.push({ level: order.price - spread, isUp: true, fire: (bid) => fill(price(ask(bid) + slippage)) }); break;
      case 'sellLimit': result.push({ level: order.price, isUp: true, fire: (bid) => fill(price(bid)) }); break;
      case 'sellStop': result.push({ level: order.price, isUp: false, fire: (bid) => fill(price(bid - slippage)) }); break;
      case 'buyStopLimit': result.push({ level: order.price - spread, isUp: true, fire: () => becomeLimit('buyLimit') }); break;
      case 'sellStopLimit': result.push({ level: order.price, isUp: false, fire: () => becomeLimit('sellLimit') }); break;
    }
  }
  for (const position of draft.positions) {
    if (position.symbol !== terms.name) continue;
    const close = (at: number, reason: DealReason) => closeVolume(draft, simulation, terms, position.ticket, Infinity, at, time, reason);
    // Hidden stops and targets are closed at market by the manager, so both take slippage.
    const hiddenStop = position.rule?.virtualStop ?? 0;
    const hiddenTarget = position.rule?.virtualTarget ?? 0;
    if (position.side === 'buy') {
      if (position.sl > 0) result.push({ level: position.sl, isUp: false, fire: (bid) => close(price(bid - slippage), 'sl') });
      if (position.tp > 0) result.push({ level: position.tp, isUp: true, fire: (bid) => close(price(bid), 'tp') });
      if (hiddenStop > 0) result.push({ level: hiddenStop, isUp: false, fire: (bid) => close(price(bid - slippage), 'sl') });
      if (hiddenTarget > 0) result.push({ level: hiddenTarget, isUp: true, fire: (bid) => close(price(bid - slippage), 'tp') });
    } else {
      if (position.sl > 0) result.push({ level: position.sl - spread, isUp: true, fire: (bid) => close(price(ask(bid) + slippage), 'sl') });
      if (position.tp > 0) result.push({ level: position.tp - spread, isUp: false, fire: (bid) => close(ask(bid), 'tp') });
      if (hiddenStop > 0) result.push({ level: hiddenStop - spread, isUp: true, fire: (bid) => close(price(ask(bid) + slippage), 'sl') });
      if (hiddenTarget > 0) result.push({ level: hiddenTarget - spread, isUp: false, fire: (bid) => close(price(ask(bid) + slippage), 'tp') });
    }
  }
  return result;
}

const holds = (bid: number, trigger: Trigger) => (trigger.isUp ? bid >= trigger.level - EPSILON : bid <= trigger.level + EPSILON);
const crosses = (from: number, to: number, trigger: Trigger) => (trigger.isUp ? from < trigger.level - EPSILON && to >= trigger.level - EPSILON : from > trigger.level + EPSILON && to <= trigger.level + EPSILON);

// Positions remember the best and worst prices they could have closed at.
function touch(draft: Draft, terms: SymbolTerms, bid: number): void {
  const quote = quoteOf(terms, bid);
  draft.positions = draft.positions.map((position) => {
    if (position.symbol !== terms.name) return position;
    const price = closingPrice(position.side, quote);
    const isBuy = position.side === 'buy';
    const bestPrice = isBuy ? Math.max(position.bestPrice, price) : Math.min(position.bestPrice, price);
    const worstPrice = isBuy ? Math.min(position.worstPrice, price) : Math.max(position.worstPrice, price);
    return bestPrice === position.bestPrice && worstPrice === position.worstPrice ? position : { ...position, bestPrice, worstPrice };
  });
}

// Fires everything that holds at the bid: at a bar's opening that is a gap; after another fill at
// the same price it is an order or stop sitting at that price, or a stop a new position already
// sits beyond.
function fireHolding(draft: Draft, simulation: Simulation, bids: Record<string, number>, terms: SymbolTerms, bid: number, time: number): void {
  for (let guard = 0; guard < 1000; guard++) {
    const trigger = triggersFor(draft, simulation, bids, terms, time).find((candidate) => holds(bid, candidate));
    if (!trigger) return;
    trigger.fire(bid);
  }
}

// The live trade manager's rules at one price: break-even first (once), otherwise the trailing
// stop, one change per price as the manager makes one per quote.
function manage(draft: Draft, terms: SymbolTerms, bid: number, time: number): void {
  const quote = quoteOf(terms, bid);
  const point = terms.point;
  draft.positions = draft.positions.map((position) => {
    const rule = position.rule;
    if (position.symbol !== terms.name || !rule || (!rule.breakEven && !rule.trailing)) return position;
    const direction = sign(position.side);
    const price = closingPrice(position.side, quote);
    const profitPoints = direction * (price - position.priceOpen) / point;
    const breakEven = rule.breakEven;
    if (breakEven && !breakEven.isDone && profitPoints >= breakEven.triggerPoints) {
      const target = round(position.priceOpen + direction * breakEven.lockPoints * point, terms.digits);
      const isBetter = !position.sl || direction * (target - position.sl) > point / 2;
      const isDone = { ...rule, breakEven: { ...breakEven, isDone: true } };
      if (isBetter && direction * (price - target) >= 0) {
        note(draft, time, `Break-even: #${position.ticket} stop to ${formatPrice(target, terms.digits)}`);
        return { ...position, sl: target, rule: isDone };
      }
      return isBetter ? position : { ...position, rule: isDone };
    }
    if (rule.trailing && profitPoints >= rule.trailing.startPoints) {
      const target = round(price - direction * rule.trailing.distancePoints * point, terms.digits);
      const step = Math.max(1, rule.trailing.stepPoints) * point;
      if ((!position.sl || direction * (target - position.sl) >= step - point / 2) && direction * (price - target) >= 0) {
        note(draft, time, `Trailing stop: #${position.ticket} stop to ${formatPrice(target, terms.digits)}`);
        return { ...position, sl: target };
      }
    }
    return position;
  });
}

function processBar(draft: Draft, simulation: Simulation, bids: Record<string, number>, terms: SymbolTerms, bar: SimBar): void {
  const time = bar.time;
  for (const order of draft.orders.filter((candidate) => candidate.symbol === terms.name && candidate.expiration > 0 && candidate.expiration <= time)) {
    draft.orders = draft.orders.filter((candidate) => candidate.ticket !== order.ticket);
    note(draft, time, `${orderType(order.type)!.label} #${order.ticket} expired`);
  }
  const path = barPath(bar);
  let cursor = path[0];
  const move = (bid: number) => {
    cursor = bid;
    bids[terms.name] = bid;
    touch(draft, terms, bid);
  };
  // Rules act on each price after the stops there have had their turn.
  const settle = () => {
    manage(draft, terms, cursor, time);
    fireHolding(draft, simulation, bids, terms, cursor, time);
  };
  move(cursor);
  fireHolding(draft, simulation, bids, terms, cursor, time);
  settle();
  for (const target of path.slice(1)) {
    for (let guard = 0; guard < 1000; guard++) {
      const from = cursor;
      const next = triggersFor(draft, simulation, bids, terms, time)
        .filter((candidate) => crosses(from, target, candidate))
        .sort((left, right) => Math.abs(left.level - from) - Math.abs(right.level - from))[0];
      if (!next) break;
      move(round(next.level, terms.digits));
      next.fire(cursor);
      fireHolding(draft, simulation, bids, terms, cursor, time);
      settle();
    }
    move(target);
    settle();
  }
}

// Moves the book's clock to `to`, filling, stopping out and expiring along every bar that ended
// on the way. The first call only sets the clock.
export function advance(book: Book, simulation: Simulation, series: (symbol: string) => Series | undefined, to: number): Book {
  if (book.time === null) {
    const draft = draftOf(book);
    draft.time = to;
    mark(draft, simulation, {}, to, true);
    return draft;
  }
  if (to <= book.time) return book;
  const from = book.time;
  const symbols = [...new Set([...book.positions.map((position) => position.symbol), ...book.orders.map((order) => order.symbol)])].filter((symbol) => simulation.terms[symbol] && series(symbol));
  const draft = draftOf(book);
  const bids: Record<string, number> = {};
  for (const symbol of symbols) {
    const bid = bidAt(series(symbol)!, from);
    if (bid !== null) bids[symbol] = bid;
  }
  const bars = symbols
    .flatMap((symbol) => barsEnding(series(symbol)!, from, to).map((bar) => ({ symbol, bar })))
    .sort((left, right) => left.bar.time - right.bar.time || left.symbol.localeCompare(right.symbol));
  for (const { symbol, bar } of bars) {
    processBar(draft, simulation, bids, simulation.terms[symbol], bar);
    bids[symbol] = bar.close;
    stopOut(draft, simulation, bids, bar.time);
    mark(draft, simulation, bids, bar.time, false);
  }
  for (const symbol of symbols) {
    const bid = bidAt(series(symbol)!, to);
    if (bid !== null) bids[symbol] = bid;
  }
  draft.time = to;
  mark(draft, simulation, bids, to, true);
  return draft;
}

function termsOf(simulation: Simulation, symbol: string): SymbolTerms | string {
  return simulation.terms[symbol] ?? `${symbol} is not set up for this backtest yet.`;
}

function clockOf(book: Book): number | string {
  return book.time ?? 'The backtest starts once the replay has a start.';
}

export function placeMarket(book: Book, simulation: Simulation, bids: Bids, request: MarketRequest): Outcome {
  const time = clockOf(book);
  const terms = termsOf(simulation, request.symbol);
  if (typeof time === 'string') return refused(book, time);
  if (typeof terms === 'string') return refused(book, terms);
  const bid = bids[request.symbol];
  if (bid === undefined) return refused(book, `${request.symbol} has no price at this point of the replay.`);
  const quote = quoteOf(terms, bid);
  const sl = round(request.sl ?? 0, terms.digits);
  const tp = round(request.tp ?? 0, terms.digits);
  const problem = volumeProblem(terms, request.volume) ?? stopsProblem(request.side, closingPrice(request.side, quote), sl, tp, terms.digits);
  if (problem) return refused(book, problem);
  const slippage = simulation.settings.slippagePoints * terms.point * sign(request.side);
  const price = round(openingPrice(request.side, quote) + slippage, terms.digits);
  const draft = draftOf(book);
  const error = openPosition(draft, simulation, bids, terms, request.side, request.volume, price, time, { sl, tp, comment: request.comment ?? '', reason: 'market', order: 0, rule: request.rule ?? null });
  if (error) return refused(book, error);
  mark(draft, simulation, bids, time, true);
  return done(draft);
}

export function placePending(book: Book, simulation: Simulation, bids: Bids, request: PendingRequest): Outcome {
  const time = clockOf(book);
  const terms = termsOf(simulation, request.symbol);
  if (typeof time === 'string') return refused(book, time);
  if (typeof terms === 'string') return refused(book, terms);
  const bid = bids[request.symbol];
  if (bid === undefined) return refused(book, `${request.symbol} has no price at this point of the replay.`);
  const isStopLimit = request.type === 'buyStopLimit' || request.type === 'sellStopLimit';
  const order = {
    sl: round(request.sl ?? 0, terms.digits),
    tp: round(request.tp ?? 0, terms.digits),
    price: round(request.price, terms.digits),
    stopLimit: isStopLimit ? round(request.stopLimit ?? 0, terms.digits) : 0,
    expiration: request.expiration ?? 0,
  };
  const problem = volumeProblem(terms, request.volume)
    ?? pendingProblem(request.type, order.price, order.stopLimit, quoteOf(terms, bid))
    ?? stopsProblem(pendingSide(request.type), pendingEntry(order), order.sl, order.tp, terms.digits)
    ?? (order.expiration > 0 && order.expiration <= time ? 'The expiration must be after the replay time.' : null);
  if (problem) return refused(book, problem);
  const draft = draftOf(book);
  const ticket = nextTicket(draft);
  draft.orders.push({ type: request.type, symbol: request.symbol, comment: request.comment ?? '', ...order, time, ticket, volume: request.volume, rule: request.rule ?? null });
  note(draft, time, `${orderType(request.type)!.label} ${formatVolume(request.volume)} ${request.symbol} at ${formatPrice(order.price, terms.digits)} placed (#${ticket})`);
  return done(draft);
}

export function modifyPosition(book: Book, simulation: Simulation, bids: Bids, ticket: number, sl: number, tp: number): Outcome {
  const position = book.positions.find((candidate) => candidate.ticket === ticket);
  if (!position) return refused(book, `Position #${ticket} is no longer open.`);
  const terms = termsOf(simulation, position.symbol);
  if (typeof terms === 'string') return refused(book, terms);
  const bid = bids[position.symbol];
  if (bid === undefined) return refused(book, `${position.symbol} has no price at this point of the replay.`);
  const levels = { sl: round(sl, terms.digits), tp: round(tp, terms.digits) };
  const problem = stopsProblem(position.side, closingPrice(position.side, quoteOf(terms, bid)), levels.sl, levels.tp, terms.digits);
  if (problem) return refused(book, problem);
  const draft = draftOf(book);
  const initialRisk = position.initialRisk || (levels.sl > 0 ? Math.abs(profitAt(simulation, terms, position.side, position.priceOpen, position.volume, levels.sl)) : 0);
  draft.positions = draft.positions.map((candidate) => candidate.ticket === ticket ? { ...candidate, ...levels, initialRisk } : candidate);
  note(draft, book.time ?? 0, `#${ticket} stop loss ${formatPrice(levels.sl, terms.digits) || 'none'}, take profit ${formatPrice(levels.tp, terms.digits) || 'none'}`);
  return done(draft);
}

export function modifyOrder(book: Book, simulation: Simulation, bids: Bids, ticket: number, change: OrderChange): Outcome {
  const order = book.orders.find((candidate) => candidate.ticket === ticket);
  if (!order) return refused(book, `Order #${ticket} is no longer pending.`);
  const terms = termsOf(simulation, order.symbol);
  if (typeof terms === 'string') return refused(book, terms);
  const bid = bids[order.symbol];
  if (bid === undefined) return refused(book, `${order.symbol} has no price at this point of the replay.`);
  const next = { ...order, sl: round(change.sl, terms.digits), tp: round(change.tp, terms.digits), price: round(change.price, terms.digits), stopLimit: order.stopLimit > 0 ? round(change.stopLimit, terms.digits) : 0, expiration: change.expiration };
  const problem = pendingProblem(order.type, next.price, next.stopLimit, quoteOf(terms, bid))
    ?? stopsProblem(pendingSide(order.type), pendingEntry(next), next.sl, next.tp, terms.digits)
    ?? (next.expiration > 0 && book.time !== null && next.expiration <= book.time ? 'The expiration must be after the replay time.' : null);
  if (problem) return refused(book, problem);
  const draft = draftOf(book);
  draft.orders = draft.orders.map((candidate) => candidate.ticket === ticket ? next : candidate);
  note(draft, book.time ?? 0, `${orderType(order.type)!.label} #${ticket} moved to ${formatPrice(next.price, terms.digits)}`);
  return done(draft);
}

export function cancelOrder(book: Book, ticket: number): Outcome {
  const order = book.orders.find((candidate) => candidate.ticket === ticket);
  if (!order) return refused(book, `Order #${ticket} is no longer pending.`);
  const draft = draftOf(book);
  draft.orders = draft.orders.filter((candidate) => candidate.ticket !== ticket);
  note(draft, book.time ?? 0, `${orderType(order.type)!.label} #${ticket} deleted`);
  return done(draft);
}

// Closes all of a position, or `volume` of it.
export function closePosition(book: Book, simulation: Simulation, bids: Bids, ticket: number, volume?: number): Outcome {
  const position = book.positions.find((candidate) => candidate.ticket === ticket);
  if (!position) return refused(book, `Position #${ticket} is no longer open.`);
  const terms = termsOf(simulation, position.symbol);
  if (typeof terms === 'string') return refused(book, terms);
  const bid = bids[position.symbol];
  if (bid === undefined || book.time === null) return refused(book, `${position.symbol} has no price at this point of the replay.`);
  const amount = volume ?? position.volume;
  if (volume !== undefined) {
    const problem = volumeProblem(terms, amount);
    if (problem) return refused(book, problem);
    if (amount > position.volume + EPSILON) return refused(book, `Position #${ticket} holds only ${formatVolume(position.volume)} lots.`);
    if (position.volume - amount > EPSILON && position.volume - amount < terms.volumeMin - EPSILON) return refused(book, `What would remain is below the minimum volume of ${terms.volumeMin}.`);
  }
  const slippage = simulation.settings.slippagePoints * terms.point * sign(position.side);
  const price = round(closingPrice(position.side, quoteOf(terms, bid)) - slippage, terms.digits);
  const draft = draftOf(book);
  closeVolume(draft, simulation, terms, position.ticket, amount, price, book.time, 'close');
  mark(draft, simulation, bids, book.time, true);
  return done(draft);
}

// Closes every position the filter keeps, and reports the first refusal, if any.
export function closePositions(book: Book, simulation: Simulation, bids: Bids, isIncluded: (position: SimPosition) => boolean = () => true): Outcome {
  let current = book;
  let error: string | null = null;
  for (const position of book.positions.filter(isIncluded)) {
    const outcome = closePosition(current, simulation, bids, position.ticket);
    current = outcome.book;
    error ??= outcome.error;
  }
  return { book: current, error };
}

export function cancelOrders(book: Book, isIncluded: (order: SimOrder) => boolean = () => true): Book {
  return book.orders.filter(isIncluded).reduce((current, order) => cancelOrder(current, order.ticket).book, book);
}

export interface BulkResult {
  readonly ticket: number;
  readonly symbol: string;
  readonly error: string | null;
}

// The live trade manager's bulk actions on the backtest. A symbol narrows every kind to that
// symbol's positions and orders.
export function bulkAction(book: Book, simulation: Simulation, bids: Bids, kind: BulkKind, symbol?: string, ticket?: number): { book: Book; results: BulkResult[] } {
  const isListed = (item: { symbol: string }) => !symbol || item.symbol === symbol;
  const results: BulkResult[] = [];
  let current = book;
  const apply = (target: { ticket: number; symbol: string }, outcome: Outcome) => {
    current = outcome.book;
    results.push({ ticket: target.ticket, symbol: target.symbol, error: outcome.error });
  };
  const profit = (position: SimPosition) => floatingProfit(simulation, position, bids) ?? 0;
  const filters: Partial<Record<BulkKind, (position: SimPosition) => boolean>> = {
    closeAll: () => true,
    closeProfitable: (position) => profit(position) > 0,
    closeLosing: (position) => profit(position) < 0,
    closeBuys: (position) => position.side === 'buy',
    closeSells: (position) => position.side === 'sell',
    closeSymbol: (position) => position.symbol === symbol,
  };
  const filter = filters[kind];
  const positions = book.positions.filter(isListed);
  if (filter) {
    for (const position of positions.filter(filter)) apply(position, closePosition(current, simulation, bids, position.ticket));
  } else if (kind === 'deletePending') {
    for (const order of book.orders.filter(isListed)) apply(order, cancelOrder(current, order.ticket));
  } else if (kind === 'breakEvenAll') {
    for (const position of positions) {
      const terms = simulation.terms[position.symbol];
      const bid = bids[position.symbol];
      if (!terms || bid === undefined) continue;
      const direction = sign(position.side);
      const isAhead = direction * (closingPrice(position.side, quoteOf(terms, bid)) - position.priceOpen) >= terms.point;
      const isImproved = !position.sl || direction * (position.priceOpen - position.sl) > 0;
      if (isAhead && isImproved) apply(position, modifyPosition(current, simulation, bids, position.ticket, position.priceOpen, position.tp));
    }
  } else if (kind === 'reverse') {
    const position = book.positions.find((candidate) => candidate.ticket === ticket);
    if (!position) return { book, results: [{ ticket: ticket ?? 0, symbol: symbol ?? '', error: 'Position is no longer open' }] };
    apply(position, closePosition(current, simulation, bids, position.ticket));
    if (!results[0].error) apply(position, placeMarket(current, simulation, bids, { side: position.side === 'buy' ? 'sell' : 'buy', symbol: position.symbol, volume: position.volume, comment: position.comment }));
  }
  return { book: current, results };
}
