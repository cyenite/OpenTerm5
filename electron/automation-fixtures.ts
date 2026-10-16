import { EventEmitter } from 'node:events';
import type { Account, LinkState, Order, Position, SymbolSpec, TerminalMethod, TerminalMethods, TradeRequest, TradeResult } from '../shared/protocol';
import type { TradeGate, TradingLink } from './session-pool';

export const eurusdSpec: SymbolSpec = {
  name: 'EURUSD', path: 'Forex\\EURUSD', tradeMode: 'Full access', description: 'Euro vs US Dollar',
  currencyBase: 'EUR', currencyProfit: 'USD', currencyMargin: 'EUR', point: 0.00001, digits: 5, spread: 10,
  swapLong: 0, swapShort: 0, volumeMin: 0.01, volumeMax: 100, stopsLevel: 0, volumeStep: 0.01, contractSize: 100000,
  visible: true, isSpreadFloat: true,
};

export function account(patch: Partial<Account> = {}): Account {
  return {
    name: 'Test', server: 'Demo', company: 'Broker', currency: 'USD', tradeMode: 'demo', login: 1, credit: 0, margin: 0,
    equity: 10000, profit: 0, balance: 10000, leverage: 100, marginFree: 10000, marginLevel: 0, isHedging: true, isTradeAllowed: true,
    ...patch,
  };
}

export function position(patch: Partial<Position> = {}): Position {
  return {
    side: 'buy', symbol: 'EURUSD', comment: '', sl: 0, tp: 0, swap: 0, time: 1, magic: 0, ticket: 100,
    volume: 1, profit: 0, priceOpen: 1.1, priceCurrent: 1.1, ...patch,
  };
}

export function order(patch: Partial<Order> = {}): Order {
  return {
    type: 'buyLimit', symbol: 'EURUSD', comment: '', sl: 0, tp: 0, time: 1, state: 1, ticket: 500, volume: 1, timeDone: 0,
    priceOpen: 1.09, expiration: 0, positionId: 0, priceCurrent: 1.1, volumeInitial: 1, ...patch,
  };
}

export class FakeLink extends EventEmitter implements TradingLink {
  loggedIn = true;
  state: LinkState = { url: 'wss://fake', state: 'open' };
  sent: TradeRequest[] = [];
  positions: Position[] = [];
  orders: Order[] = [];
  specs: Record<string, SymbolSpec> = { EURUSD: eurusdSpec };
  quote = { bid: 1.1, ask: 1.1001 };
  info = account();
  pollInterval = 2000;
  gate?: TradeGate;
  respond: (request: TradeRequest) => TradeResult | Promise<TradeResult> = (request) => {
    this.applyTrade(request);
    return { retcode: 10009, isSuccess: true, comment: 'Done', order: 900 + this.sent.length };
  };

  async connect(): Promise<void> { this.loggedIn = true; }
  disconnect(): void { this.loggedIn = false; }
  setPollInterval(milliseconds: number): void { this.pollInterval = milliseconds; }
  setTradeGate(gate: TradeGate | undefined): void { this.gate = gate; }

  applyTrade(request: TradeRequest): void {
    if (request.action === 'deal' && request.position) {
      const index = this.positions.findIndex((item) => item.ticket === request.position);
      if (index < 0) return;
      const remaining = Number((this.positions[index].volume - (request.volume ?? 0)).toFixed(8));
      if (remaining <= 0) this.positions.splice(index, 1);
      else this.positions[index] = { ...this.positions[index], volume: remaining };
    } else if (request.action === 'sltp') {
      this.positions = this.positions.map((item) => item.ticket === request.position ? { ...item, sl: request.sl ?? 0, tp: request.tp ?? 0 } : item);
    } else if (request.action === 'remove') {
      this.orders = this.orders.filter((item) => item.ticket !== request.order);
    } else if (request.action === 'pending') {
      this.orders.push(order({ ticket: 900 + this.sent.length, symbol: request.symbol, type: request.type, volume: request.volume, priceOpen: request.price, sl: request.sl ?? 0, tp: request.tp ?? 0, comment: request.comment ?? '' }));
    } else if (request.action === 'modify') {
      this.orders = this.orders.map((item) => item.ticket === request.order ? { ...item, priceOpen: request.price ?? item.priceOpen, sl: request.sl ?? 0, tp: request.tp ?? 0 } : item);
    } else if (request.action === 'deal') {
      this.positions.push(position({ ticket: 900 + this.sent.length, symbol: request.symbol, side: request.type === 'buy' ? 'buy' : 'sell', volume: request.volume, sl: request.sl ?? 0, tp: request.tp ?? 0, comment: request.comment ?? '', priceOpen: request.type === 'buy' ? this.quote.ask : this.quote.bid, priceCurrent: request.type === 'buy' ? this.quote.bid : this.quote.ask }));
    }
  }

  async request<M extends TerminalMethod>(method: M, params: TerminalMethods[M][0]): Promise<TerminalMethods[M][1]> {
    const values = params as Record<string, never>;
    const result = await (async (): Promise<unknown> => {
      switch (method) {
        case 'symbols.info': {
          const spec = this.specs[values.symbol];
          if (!spec) throw new Error(`Unknown symbol ${values.symbol}`);
          return spec;
        }
        case 'symbols.list': return Object.values(this.specs);
        case 'symbols.valuation': return { via: [], rate: 1, calcMode: 0, moneyPerUnit: this.specs[values.symbol].contractSize, profitCurrency: 'USD', accountCurrency: 'USD' };
        case 'symbols.quote': return { symbol: values.symbol, time: 1, ...this.quote };
        case 'account.info': return this.info;
        case 'account.login': this.loggedIn = true; return this.info;
        case 'trade.snapshot': return { account: this.info, orders: this.orders, positions: this.positions };
        case 'order.send': {
          const request = params as TradeRequest;
          const refused = this.gate?.(request);
          if (refused) throw new Error(refused);
          this.sent.push(request);
          return this.respond(request);
        }
        default: throw new Error(`FakeLink does not implement ${method}`);
      }
    })();
    return result as TerminalMethods[M][1];
  }
}

export function memoryStore<T>(initial: T) {
  let value = initial;
  return { saved: [] as T[], load: async () => value, async save(next: T) { value = next; this.saved.push(next); } };
}
