import type { Account, Order, Position, TradeResult } from '../../../shared/protocol';
import { accountFigures, closingPrice, floatingProfit, quoteOf, type Bids } from './engine';
import type { Book, Simulation } from './model';
import type { BacktestSession } from './session-model';

// The backtest's simulated account in the live protocol's shapes, so the chart overlay, the
// Trade Assistant and the one-click panel show and trade it as they do a broker account.
// Pending expirations are seconds, as on the wire; the book keeps milliseconds.

export function simAccount(session: BacktestSession, simulation: Simulation, bids: Bids): Account {
  const figures = accountFigures(session.book, simulation, bids);
  return {
    name: session.name,
    server: 'Backtest',
    company: '',
    currency: session.currency,
    tradeMode: 'demo',
    login: 0,
    credit: 0,
    margin: figures.margin,
    equity: figures.equity,
    profit: figures.profit,
    balance: figures.balance,
    leverage: session.settings.leverage,
    marginFree: figures.freeMargin,
    marginLevel: figures.marginLevel ?? 0,
    isHedging: true,
    isTradeAllowed: true,
  };
}

export function simPositions(book: Book, simulation: Simulation, bids: Bids): Position[] {
  return book.positions.map((position) => {
    const terms = simulation.terms[position.symbol];
    const bid = bids[position.symbol];
    return {
      side: position.side,
      symbol: position.symbol,
      comment: position.comment,
      sl: position.sl,
      tp: position.tp,
      swap: 0,
      time: position.time,
      magic: 0,
      ticket: position.ticket,
      volume: position.volume,
      profit: floatingProfit(simulation, position, bids) ?? 0,
      priceOpen: position.priceOpen,
      priceCurrent: terms && bid !== undefined ? closingPrice(position.side, quoteOf(terms, bid)) : position.priceOpen,
    };
  });
}

export function simOrders(book: Book, bids: Bids): Order[] {
  return book.orders.map((order) => ({
    type: order.type,
    symbol: order.symbol,
    comment: order.comment,
    sl: order.sl,
    tp: order.tp,
    time: order.time,
    state: 1,
    ticket: order.ticket,
    volume: order.volume,
    timeDone: 0,
    priceOpen: order.price,
    expiration: order.expiration ? Math.floor(order.expiration / 1000) : 0,
    positionId: 0,
    priceCurrent: bids[order.symbol] ?? order.price,
    volumeInitial: order.volume,
    ...(order.stopLimit ? { stoplimit: order.stopLimit } : {}),
  }));
}

// A refusal reads as the broker's "invalid request"; done as "request executed".
export function tradeResult(error: string | null, order?: number): TradeResult {
  return error ? { comment: error, retcode: 10013, isSuccess: false } : { comment: 'Done', retcode: 10009, isSuccess: true, ...(order ? { order } : {}) };
}
