import type { RawAccount, RawAlgoOrder, RawOrder, RawPosition, RawSymbol, RawTrade } from './binance-models';
import { FakeSocket } from './bybit-fixtures';
import type { StreamSocket } from './bybit-stream';

export const btcSymbol: RawSymbol = {
  symbol: 'BTCUSDT', status: 'TRADING', baseAsset: 'BTC', quoteAsset: 'USDT', marginAsset: 'USDT', contractType: 'PERPETUAL',
  filters: [
    { filterType: 'PRICE_FILTER', tickSize: '0.10' },
    { filterType: 'LOT_SIZE', stepSize: '0.001', minQty: '0.001', maxQty: '1000' },
    { filterType: 'MARKET_LOT_SIZE', stepSize: '0.001', minQty: '0.001', maxQty: '120' },
    { filterType: 'MIN_NOTIONAL', notional: '50' },
    { filterType: 'PERCENT_PRICE', multiplierUp: '1.0500', multiplierDown: '0.9500' },
  ],
};

export const account: RawAccount = {
  totalWalletBalance: '10000', totalMarginBalance: '10000', totalUnrealizedProfit: '0', totalInitialMargin: '1000', availableBalance: '9000',
  assets: [{ asset: 'USDT', walletBalance: '10000', marginBalance: '10000', unrealizedProfit: '0', availableBalance: '9000' }],
};

export function rawPosition(patch: Partial<RawPosition> = {}): RawPosition {
  return { symbol: 'BTCUSDT', positionSide: 'BOTH', positionAmt: '0.1', entryPrice: '60000', markPrice: '60100', unRealizedProfit: '10', liquidationPrice: '54500', ...patch };
}

export function rawTrade(patch: Partial<RawTrade> = {}): RawTrade {
  return { id: 1, orderId: 11, symbol: 'BTCUSDT', side: 'BUY', positionSide: 'BOTH', price: '60000', qty: '0.1', realizedPnl: '0', commission: '2.4', commissionAsset: 'USDT', time: 1_760_000_000_000, ...patch };
}

export function rawAlgo(patch: Partial<RawAlgoOrder> = {}): RawAlgoOrder {
  return {
    algoId: 500, clientAlgoId: 'manual', symbol: 'BTCUSDT', side: 'SELL', positionSide: 'BOTH', orderType: 'STOP_MARKET', algoStatus: 'NEW', quantity: '0.1',
    triggerPrice: '58000', price: '0', reduceOnly: true, closePosition: false, createTime: 1_760_000_000_000, updateTime: 1_760_000_000_000, ...patch,
  };
}

type Handler = (query: URLSearchParams, method: string) => unknown;

// Answers Binance REST paths with fixtures; tests override routes to shape a scenario.
export class FakeBinance {
  sockets: FakeSocket[] = [];
  calls: { method: string; path: string; query: URLSearchParams }[] = [];
  routes = new Map<string, Handler>();
  positions: RawPosition[] = [];
  orders: RawOrder[] = [];
  algos: RawAlgoOrder[] = [];
  trades: RawTrade[] = [];
  restrictions: Record<string, unknown> | null = { enableReading: true, enableFutures: true, enableWithdrawals: false };
  failures = new Map<string, { code: number; msg: string }>();
  // Refuses a request the way Binance would, decided from its parameters.
  refuse?: (method: string, path: string, query: URLSearchParams) => { code: number; msg: string } | undefined;
  private nextId = 1000;

  constructor() {
    this.routes.set('/fapi/v1/time', () => ({ serverTime: 1_760_000_000_000 }));
    this.routes.set('/sapi/v1/account/apiRestrictions', () => this.restrictions ?? { notFound: true });
    this.routes.set('/api/v3/account', () => ({ uid: 4242, balances: [] }));
    this.routes.set('/fapi/v1/accountConfig', () => ({ canTrade: true, dualSidePosition: false, multiAssetsMargin: false }));
    this.routes.set('/fapi/v1/exchangeInfo', () => ({ symbols: [btcSymbol, { ...btcSymbol, symbol: 'ETHUSDC', marginAsset: 'USDC' }] }));
    this.routes.set('/fapi/v1/ticker/bookTicker', (query) => {
      const ticker = { symbol: 'BTCUSDT', bidPrice: '60000.0', askPrice: '60000.1', time: 1 };
      return query.get('symbol') ? ticker : [ticker];
    });
    this.routes.set('/fapi/v1/premiumIndex', () => [{ symbol: 'BTCUSDT', markPrice: '60000' }]);
    this.routes.set('/fapi/v3/account', () => account);
    this.routes.set('/fapi/v3/positionRisk', () => this.positions);
    this.routes.set('/fapi/v1/openOrders', () => this.orders);
    this.routes.set('/fapi/v1/openAlgoOrders', () => this.algos);
    this.routes.set('/fapi/v1/symbolConfig', () => [{ symbol: 'BTCUSDT', marginType: 'ISOLATED', leverage: 10, isAutoAddMargin: false, maxNotionalValue: '1000000' }]);
    this.routes.set('/fapi/v1/leverageBracket', () => ({ symbol: 'BTCUSDT', brackets: [{ bracket: 1, initialLeverage: 125, notionalCap: 50000, maintMarginRatio: 0.004 }] }));
    this.routes.set('/fapi/v1/commissionRate', () => ({ symbol: 'BTCUSDT', makerCommissionRate: '0.0002', takerCommissionRate: '0.0005' }));
    this.routes.set('/fapi/v1/userTrades', () => this.trades);
    this.routes.set('/fapi/v1/listenKey', () => ({ listenKey: 'listen-1' }));
    this.routes.set('/fapi/v1/order', (query, method) => {
      if (method === 'GET') return { ...this.orderFrom(query), avgPrice: '60000.1', status: 'FILLED' };
      if (method === 'DELETE' || method === 'PUT') return { orderId: Number(query.get('orderId')), status: method === 'PUT' ? 'NEW' : 'CANCELED' };
      return this.orderFrom(query);
    });
    this.routes.set('/fapi/v1/algoOrder', (query, method) => {
      if (method === 'DELETE') return { algoId: Number(query.get('algoId')), code: '200', msg: 'success' };
      return rawAlgo({
        algoId: this.nextId++, clientAlgoId: query.get('clientAlgoId') ?? '', side: query.get('side')!, orderType: query.get('type')!, quantity: query.get('quantity') ?? '0',
        triggerPrice: query.get('triggerPrice') ?? '0', price: query.get('price') ?? '0', reduceOnly: query.get('reduceOnly') === 'true', closePosition: query.get('closePosition') === 'true',
        positionSide: query.get('positionSide') ?? 'BOTH',
      });
    });
  }

  private orderFrom(query: URLSearchParams): RawOrder {
    const isMarket = query.get('type') === 'MARKET';
    return {
      orderId: Number(query.get('orderId')) || this.nextId++, clientOrderId: query.get('newClientOrderId') ?? '', symbol: query.get('symbol') ?? 'BTCUSDT', side: query.get('side') ?? 'BUY',
      positionSide: query.get('positionSide') ?? 'BOTH', type: query.get('type') ?? 'LIMIT', status: isMarket ? 'FILLED' : 'NEW', price: query.get('price') ?? '0', avgPrice: '0',
      origQty: query.get('quantity') ?? '0', executedQty: isMarket ? query.get('quantity') ?? '0' : '0', reduceOnly: query.get('reduceOnly') === 'true', updateTime: 1_760_000_100_000,
    };
  }

  readonly fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    const method = init.method ?? 'GET';
    this.calls.push({ method, path: parsed.pathname, query: parsed.searchParams });
    const failure = this.failures.get(`${method} ${parsed.pathname}`) ?? this.failures.get(parsed.pathname) ?? this.refuse?.(method, parsed.pathname, parsed.searchParams);
    if (failure) return new Response(JSON.stringify(failure), { status: 400 });
    const route = this.routes.get(parsed.pathname);
    const answer = route?.(parsed.searchParams, method);
    if (!route || (answer as { notFound?: boolean })?.notFound) return new Response('<html>404</html>', { status: 404 });
    return new Response(JSON.stringify(answer));
  };

  readonly openSocket = (url: string): StreamSocket => {
    const socket = new FakeSocket(url);
    this.sockets.push(socket);
    setImmediate(() => socket.emit('open'));
    return socket;
  };

  writes(path: string, method = 'POST') { return this.calls.filter((call) => call.method === method && call.path === path).map((call) => Object.fromEntries(call.query)); }

  get userSocket(): FakeSocket { return this.sockets.find((socket) => socket.url.includes('/private'))!; }
}
