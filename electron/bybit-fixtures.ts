import { EventEmitter } from 'node:events';
import type { RawInstrument, RawOrder, RawPosition, RawWallet } from './bybit-models';
import type { StreamSocket } from './bybit-stream';

export const btcInstrument: RawInstrument = {
  symbol: 'BTCUSDT', status: 'Trading', baseCoin: 'BTC', quoteCoin: 'USDT', settleCoin: 'USDT', priceScale: '2', contractType: 'LinearPerpetual',
  priceFilter: { tickSize: '0.10' },
  lotSizeFilter: { qtyStep: '0.001', minOrderQty: '0.001', maxOrderQty: '1190', maxMktOrderQty: '119', minNotionalValue: '5' },
  leverageFilter: { minLeverage: '1', maxLeverage: '100.00', leverageStep: '0.01' },
};

export const wallet: RawWallet = {
  totalEquity: '10000', totalWalletBalance: '10000', totalMarginBalance: '10000', totalAvailableBalance: '9000', totalPerpUPL: '0',
  totalInitialMargin: '1000', totalMaintenanceMargin: '50', coin: [{ coin: 'USDT', equity: '10000', usdValue: '9990' }],
};

export function rawPosition(patch: Partial<RawPosition> = {}): RawPosition {
  return {
    symbol: 'BTCUSDT', side: 'Buy', size: '0.1', positionIdx: 0, avgPrice: '60000', markPrice: '60100', leverage: '10', liqPrice: '54500',
    takeProfit: '', stopLoss: '', unrealisedPnl: '10', openTime: 1_760_000_000_000, ...patch,
  };
}

export function rawOrder(patch: Partial<RawOrder> = {}): RawOrder {
  return {
    orderId: 'order-1', orderLinkId: 'manual', symbol: 'BTCUSDT', side: 'Buy', price: '59000', qty: '0.05', orderType: 'Limit', orderStatus: 'New',
    stopOrderType: '', triggerPrice: '', takeProfit: '', stopLoss: '', leavesQty: '0.05', cumExecQty: '0', avgPrice: '', reduceOnly: false,
    positionIdx: 0, createdTime: '1760000000000', updatedTime: '1760000000000', ...patch,
  };
}

export class FakeSocket extends EventEmitter implements StreamSocket {
  sent: Record<string, unknown>[] = [];

  constructor(readonly url: string) { super(); }

  send(data: string): void {
    const message = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(message);
    if (message.op === 'auth') setImmediate(() => this.push({ op: 'auth', success: true }));
  }

  close(): void { this.emit('close'); }

  push(message: unknown): void { this.emit('message', JSON.stringify(message)); }
}

type Handler = (query: URLSearchParams, body: Record<string, unknown> | undefined) => unknown;

// Answers Bybit REST paths with fixtures; tests override routes to shape a scenario.
export class FakeBybit {
  sockets: FakeSocket[] = [];
  posts: { path: string; body: Record<string, unknown> }[] = [];
  routes = new Map<string, Handler>();
  positions: RawPosition[] = [];
  orders: RawOrder[] = [];
  permissions: Record<string, string[]> = { ContractTrade: ['Order', 'Position'], Wallet: ['AccountTransfer'] };
  failures = new Map<string, Error | { retCode: number; retMsg: string }>();

  constructor() {
    this.routes.set('/v5/market/time', () => ({ timeSecond: '1760000000', timeNano: '1760000000000000000' }));
    this.routes.set('/v5/user/query-api', () => ({ userID: 4242, readOnly: 0, permissions: this.permissions, deadlineDay: 80 }));
    this.routes.set('/v5/account/info', () => ({ unifiedMarginStatus: 5, marginMode: 'ISOLATED_MARGIN' }));
    this.routes.set('/v5/market/instruments-info', () => ({ list: [btcInstrument] }));
    this.routes.set('/v5/market/tickers', () => ({ list: [{ symbol: 'BTCUSDT', bid1Price: '60000', ask1Price: '60000.1', lastPrice: '60000', markPrice: '60000' }] }));
    this.routes.set('/v5/account/wallet-balance', () => ({ list: [{ ...wallet, accountType: 'UNIFIED' }] }));
    this.routes.set('/v5/position/list', (query) => ({ list: this.positions.filter((item) => !query.get('symbol') || item.symbol === query.get('symbol')) }));
    this.routes.set('/v5/order/realtime', (query) => ({ list: query.get('openOnly') === '1' ? [] : this.orders }));
    this.routes.set('/v5/market/risk-limit', () => ({ list: [{ id: 1, maintenanceMargin: '0.005' }] }));
    this.routes.set('/v5/market/price-limit', () => ({ symbol: 'BTCUSDT', buyLmt: '60600.0', sellLmt: '59400.0' }));
    this.routes.set('/v5/account/fee-rate', () => ({ list: [{ takerFeeRate: '0.00055' }] }));
    this.routes.set('/v5/order/create', () => ({ orderId: 'created-1', orderLinkId: '' }));
    for (const path of ['/v5/order/amend', '/v5/order/cancel', '/v5/position/trading-stop', '/v5/position/set-leverage']) this.routes.set(path, () => ({}));
  }

  readonly fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    const body = init.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    if (body) this.posts.push({ path: parsed.pathname, body });
    const failure = this.failures.get(parsed.pathname);
    if (failure instanceof Error) throw failure;
    if (failure) return new Response(JSON.stringify({ ...failure, result: {} }));
    const route = this.routes.get(parsed.pathname);
    if (!route) return new Response(JSON.stringify({ retCode: 10001, retMsg: `no fixture for ${parsed.pathname}`, result: {} }));
    return new Response(JSON.stringify({ retCode: 0, retMsg: 'OK', result: route(parsed.searchParams, body) }));
  };

  readonly openSocket = (url: string): StreamSocket => {
    const socket = new FakeSocket(url);
    this.sockets.push(socket);
    setImmediate(() => socket.emit('open'));
    return socket;
  };

  get privateSocket(): FakeSocket { return this.sockets.find((socket) => socket.url.includes('/private'))!; }
  get publicSocket(): FakeSocket { return this.sockets.find((socket) => socket.url.includes('/public'))!; }
}
