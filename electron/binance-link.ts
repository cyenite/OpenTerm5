import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { binanceEnvironment, orderType, type Account, type Bar, type CheckResult, type Deal, type History, type LeverageState, type LinkState, type MarginMode, type Order, type Position, type SymbolSpec, type TerminalEvent, type TerminalEvents, type TerminalMethod, type TerminalMethods, type TerminalStatus, type Tick, type Timeframe, type TradeRequest, type TradeResult, type TradeSnapshot } from '../shared/protocol';
import type { Valuation } from '../shared/valuation';
import { crossLiquidation, initialMargin, isolatedLiquidation } from '../shared/leverage';
import { BinanceApiError, BinanceRest } from './binance-rest';
import { BinanceStream } from './binance-stream';
import { openWebSocket, type OpenSocket } from './bybit-stream';
import {
  algoOrderFrom, attachedLevels, dealFrom, fundingFrom, isOpenAlgo, isProtection, isStopLoss, klinePlan, openingTrade, orderFrom, positionFrom, positionKey,
  protectedClientId, protectionOf, symbolSpec, tickFrom, walletAccount, type AccountIdentity, type RawAccount, type RawAlgoOrder, type RawBookTicker,
  type RawIncome, type RawOrder, type RawPosition, type RawSymbol, type RawTrade,
} from './binance-models';
import { aggregateBars, formatPrice, formatQty, klineBar, num, ticketOf, type Fetch, type KlinePlan } from './exchange-common';
import type { SessionCredentials, TradeGate } from './session-pool';

interface ChartFeed {
  viewers: number;
  symbol: string;
  timeframe: Timeframe;
  plan: KlinePlan;
  isSeeded: boolean;
  sources: Map<number, Bar>;
}

interface SymbolConfig {
  symbol: string;
  marginType: string;
  leverage: number;
}

interface Bracket {
  bracket: number;
  initialLeverage: number;
  maintMarginRatio: number;
}

interface KeyRestrictions {
  enableFutures: boolean;
  enableWithdrawals: boolean;
  enableReading: boolean;
}

export interface BinanceLinkOptions {
  fetch?: Fetch;
  now?: () => number;
  openSocket?: OpenSocket;
  keepAlive?: number;
  accountDelay?: number;
}

const DAY = 86_400_000;
const WEEK = 7 * DAY;
// Binance keeps trades and income for three months.
const HISTORY_DAYS = 90;
const OPEN_TIME_WEEKS = 13;
const MAX_KLINE_PAGE = 1500;
const KEEP_ALIVE = 30 * 60_000;
const TRADE_PUBLISH_DELAY = 250;
const ACCOUNT_DELAY = 300;
const contractTypes = new Set(['PERPETUAL', 'CURRENT_QUARTER', 'NEXT_QUARTER', 'TRADIFI_PERPETUAL']);
const tradableStatuses = new Set(['TRADING', 'SETTLING']);

const failed = (comment: string, retcode = 0): TradeResult => ({ retcode, isSuccess: false, comment });

// Callers such as the copier read MT5 trade return codes, so Binance errors are reported as the
// nearest one: too frequent, no money, invalid price, or rejected.
const retcodes: Record<number, number> = { [-1003]: 10024, [-2019]: 10019, [-2018]: 10019, [-4131]: 10015, [-4016]: 10015, [-4024]: 10015 };
const retcodeOf = (code: number) => retcodes[code] ?? 10006;

const describeOrder = (body: Record<string, unknown>) => [
  body.side, body.type, body.quantity, body.symbol,
  body.price !== undefined ? `at ${body.price}` : '', body.triggerPrice !== undefined ? `trigger ${body.triggerPrice}` : '', body.reduceOnly ? 'reduce-only' : '',
].filter(Boolean).join(' ');

const unknownOutcome = () => new Error('Order outcome is unknown. Check Binance positions and orders before sending it again.');

const randomId = () => randomUUID().replace(/-/g, '').slice(0, 12);

const lower = (symbol: string) => symbol.toLowerCase();

// One Binance USDⓈ-M futures account. REST reads the initial state, the user data stream keeps
// orders, protection orders and positions current (the account totals are re-read after each
// change, as the stream carries balances only), and the market streams supply quotes, mark
// prices and klines.
export class BinanceLink extends EventEmitter {
  state: LinkState = { url: '', state: 'idle' };
  private epoch = 0;
  private isHedge = false;
  private isLoggedIn = false;
  private isMultiAssets = false;
  private rest?: BinanceRest;
  private wallet?: RawAccount;
  private tradeGate?: TradeGate;
  private identity?: AccountIdentity;
  private bookStream?: BinanceStream;
  private marketStream?: BinanceStream;
  private userStream?: BinanceStream;
  private keepAlive?: NodeJS.Timeout;
  private publishTimer?: NodeJS.Timeout;
  private accountTimer?: NodeJS.Timeout;
  private readonly ticks = new Map<string, Tick>();
  private readonly specs = new Map<string, SymbolSpec>();
  private readonly marks = new Map<string, number>();
  private readonly charts = new Map<string, ChartFeed>();
  private readonly orders = new Map<number, RawOrder>();
  private readonly algos = new Map<number, RawAlgoOrder>();
  private readonly topics = new Set<string>();
  private readonly pinned = new Set<string>();
  private readonly watched = new Set<string>();
  private readonly configs = new Map<string, SymbolConfig>();
  private readonly brackets = new Map<string, Bracket>();
  private readonly feeRates = new Map<string, number>();
  private readonly positions = new Map<string, RawPosition>();
  private readonly openTimes = new Map<string, number>();
  private readonly discovering = new Map<string, Promise<number | undefined>>();
  private readonly instruments = new Map<string, RawSymbol>();

  constructor(private readonly options: BinanceLinkOptions = {}) { super(); }

  get loggedIn(): boolean { return this.isLoggedIn; }

  setTradeGate(gate: TradeGate | undefined): void { this.tradeGate = gate; }

  // The streams push every change, so there is nothing to poll.
  setPollInterval(): void {}

  async signIn(credentials: SessionCredentials): Promise<Account> {
    if (credentials.platform !== 'binance') throw new Error('This session signs in to Binance accounts only');
    const environment = binanceEnvironment(credentials.environment);
    if (!environment) throw new Error('Unknown Binance environment');
    const apiKey = credentials.apiKey.trim();
    const apiSecret = credentials.apiSecret.trim();
    if (!apiKey || !apiSecret) throw new Error('Enter the API key and its secret or private key.');
    this.disconnect();
    const epoch = ++this.epoch;
    this.publishState({ url: environment.restUrl, state: 'connecting', error: undefined });
    try {
      const rest = new BinanceRest(environment.restUrl, { apiKey, apiSecret }, this.options.fetch, this.options.now);
      await rest.syncClock();
      const restrictions = await this.restrictions(rest, environment.spotUrl);
      if (restrictions?.enableWithdrawals) throw new Error('This API key can withdraw funds. Create a Binance key with Enable Withdrawals off for OpenTerm5.');
      const [config, uid] = await Promise.all([
        rest.get<{ canTrade: boolean; dualSidePosition: boolean; multiAssetsMargin: boolean }>('/fapi/v1/accountConfig', {}, true),
        this.uid(rest, environment.spotUrl, apiKey),
      ]);
      this.guard(epoch);
      this.rest = rest;
      this.isHedge = config.dualSidePosition;
      this.isMultiAssets = config.multiAssetsMargin;
      const isTradeAllowed = config.canTrade && restrictions?.enableFutures !== false;
      this.identity = { uid, server: `Binance ${environment.label}`, currency: this.isMultiAssets ? 'USD' : 'USDT', tradeMode: environment.tradeMode, isHedging: this.isHedge, isTradeAllowed };
      if (!isTradeAllowed) this.journal('This API key cannot trade futures. Turn on Enable Futures for the key on Binance (an HMAC key also needs an IP restriction).');
      await Promise.all([this.loadSymbols(), this.loadAccount(), this.loadPositions(), this.loadOrders(), this.loadConfigs()]);
      this.guard(epoch);
      await Promise.all([...this.positions.values()].map((raw) => this.openTimeOf(raw)));
      this.guard(epoch);
      const openSocket = this.options.openSocket ?? openWebSocket;
      const bookStream = new BinanceStream(() => `${environment.publicUrl}/stream`, openSocket);
      const marketStream = new BinanceStream(() => `${environment.marketUrl}/stream`, openSocket);
      const userStream = new BinanceStream(async () => `${environment.privateUrl}/ws/${(await rest.keyed<{ listenKey: string }>('POST', '/fapi/v1/listenKey')).listenKey}`, openSocket);
      this.bookStream = bookStream;
      this.marketStream = marketStream;
      this.userStream = userStream;
      for (const stream of [bookStream, marketStream]) {
        stream.on('data', (data: Record<string, unknown>) => { if (this.marketStream === marketStream) this.onMarket(data); });
        stream.on('journal', (message: string) => this.journal(message));
      }
      userStream.on('data', (data: Record<string, unknown>) => { if (this.userStream === userStream) this.onUser(data); });
      userStream.on('open', () => { if (this.userStream === userStream && this.isLoggedIn) void this.resync(epoch); });
      userStream.on('closed', () => { if (this.userStream === userStream && this.isLoggedIn) this.publishState({ state: 'connecting' }); });
      this.resubscribe();
      bookStream.start();
      marketStream.start();
      userStream.start();
      await userStream.ready();
      this.guard(epoch);
      this.keepAlive = setInterval(() => {
        void rest.keyed('PUT', '/fapi/v1/listenKey').catch((error: Error) => this.journal(`The Binance user stream could not be kept alive: ${error.message}`));
      }, this.options.keepAlive ?? KEEP_ALIVE);
      this.isLoggedIn = true;
      this.publishState({ state: 'open' });
      this.publish('symbols', this.symbolList());
      this.publish('trade', this.snapshot());
      return this.account()!;
    } catch (error) {
      if (epoch === this.epoch) {
        this.disconnect();
        this.publishState({ state: 'closed', error: (error as Error).message });
      }
      throw error;
    }
  }

  disconnect(): void {
    this.epoch++;
    this.isLoggedIn = false;
    for (const stream of [this.bookStream, this.marketStream, this.userStream]) {
      stream?.removeAllListeners();
      stream?.stop();
    }
    const rest = this.rest;
    if (rest && this.userStream) void rest.keyed('DELETE', '/fapi/v1/listenKey').catch(() => undefined);
    this.bookStream = undefined;
    this.marketStream = undefined;
    this.userStream = undefined;
    clearInterval(this.keepAlive);
    clearTimeout(this.publishTimer);
    clearTimeout(this.accountTimer);
    this.keepAlive = undefined;
    this.publishTimer = undefined;
    this.accountTimer = undefined;
    this.rest = undefined;
    this.wallet = undefined;
    this.identity = undefined;
    for (const store of [this.ticks, this.specs, this.marks, this.charts, this.orders, this.algos, this.configs, this.brackets, this.feeRates, this.positions, this.openTimes, this.discovering, this.instruments]) store.clear();
    for (const store of [this.topics, this.pinned, this.watched]) store.clear();
    if (this.state.state !== 'idle' && this.state.state !== 'closed') this.publishState({ state: 'closed' });
  }

  async request<M extends TerminalMethod>(method: M, params: TerminalMethods[M][0]): Promise<TerminalMethods[M][1]> {
    if (method === 'order.send') {
      const refused = this.tradeGate?.(params as TradeRequest);
      if (refused) throw new Error(refused);
    }
    return await this.route(method, params as Record<string, any>) as TerminalMethods[M][1];
  }

  private async route(method: TerminalMethod, values: Record<string, any>): Promise<unknown> {
    switch (method) {
      case 'terminal.status': return this.status();
      case 'account.info': return this.account();
      case 'account.login': throw new Error('Binance accounts sign in with an API key.');
      case 'symbols.list': return this.symbolList();
      case 'symbols.info': return this.spec(values.symbol);
      case 'symbols.select': return true;
      case 'ticks.subscribe': {
        this.watched.clear();
        for (const symbol of (values.symbols as string[]).filter((name) => this.specs.has(name))) this.watched.add(symbol);
        this.resubscribe();
        return (values.symbols as string[]).map((symbol) => this.ticks.get(symbol) ?? null);
      }
      case 'symbols.quote': return this.quote(values.symbol);
      case 'symbols.valuation': return this.valuation(values.symbol);
      case 'rates.get': return this.rates(values.symbol, values.timeframe, values.count);
      case 'rates.subscribe': {
        this.spec(values.symbol);
        const key = `${values.symbol}:${values.timeframe}`;
        const existing = this.charts.get(key);
        if (existing) existing.viewers++;
        else {
          const plan = klinePlan(values.timeframe);
          const feed: ChartFeed = { viewers: 1, symbol: values.symbol, timeframe: values.timeframe, plan, isSeeded: !plan.isAggregated, sources: new Map() };
          this.charts.set(key, feed);
          if (plan.isAggregated) void this.seed(feed).catch((error: Error) => this.journal(`Chart ${key} could not load its current bar: ${error.message}`));
          this.resubscribe();
        }
        return true;
      }
      case 'rates.unsubscribe': {
        const key = `${values.symbol}:${values.timeframe}`;
        const feed = this.charts.get(key);
        if (feed && feed.viewers > 1) feed.viewers--;
        else {
          this.charts.delete(key);
          this.resubscribe();
        }
        return true;
      }
      case 'book.subscribe': return { symbol: values.symbol, levels: [], isAvailable: false };
      case 'book.unsubscribe': return true;
      case 'trade.snapshot': return this.snapshot();
      case 'history.get': return this.history(values.from, values.to);
      case 'order.check': return this.check(values as TradeRequest);
      case 'order.send': return this.send(values as TradeRequest);
      case 'symbols.leverage': return this.leverageState(values.symbol);
      case 'symbols.setLeverage': return this.setLeverage(values.symbol, values.leverage);
      default: throw new Error(`${method} is not available on Binance accounts`);
    }
  }

  private publish<E extends TerminalEvent>(event: E, data: TerminalEvents[E]): void { this.emit('event', event, data); }

  private publishState(patch: Partial<LinkState>): void {
    this.state = { ...this.state, ...patch };
    this.publish('link', this.state);
    this.publish('status', this.status());
  }

  private journal(message: string): void { this.publish('journal', { source: 'Binance', time: Date.now(), message }); }

  private guard(epoch: number): void {
    if (epoch !== this.epoch) throw new Error('The Binance connection changed before sign-in finished');
  }

  private api(): BinanceRest {
    if (!this.rest) throw new Error('Binance is not connected');
    return this.rest;
  }

  private spec(symbol: string): SymbolSpec {
    const spec = this.specs.get(symbol);
    if (!spec) throw new Error(`${symbol} is not a Binance USDⓈ-M contract`);
    return spec;
  }

  private status(): TerminalStatus {
    const isTradeAllowed = this.isLoggedIn && !!this.identity?.isTradeAllowed;
    return {
      mode: 'binance', name: 'OpenTerm5', company: 'Binance', isConnected: this.isLoggedIn, isTradeAllowed,
      connectionState: this.isLoggedIn ? (this.state.state === 'open' ? 'connected' : 'reconnecting') : this.state.state === 'connecting' ? 'authenticating' : 'disconnected',
      capabilities: { history: true, trading: isTradeAllowed, depth: false },
    };
  }

  // Key permissions live on the spot API, which demo trading does not serve; there the withdrawal
  // check rests on the key the user made. A bad key fails on the futures API next.
  private async restrictions(rest: BinanceRest, spotUrl: string): Promise<KeyRestrictions | undefined> {
    try { return await rest.at(spotUrl).get<KeyRestrictions>('/sapi/v1/account/apiRestrictions', {}, true); }
    catch { return undefined; }
  }

  // The account's UID names its saved profile. Keys that cannot read the spot account fall back
  // to a number derived from the key, so the profile stays the same for that key.
  private async uid(rest: BinanceRest, spotUrl: string, apiKey: string): Promise<number> {
    try {
      const account = await rest.at(spotUrl).get<{ uid?: number }>('/api/v3/account', { omitZeroBalances: true }, true);
      if (Number.isSafeInteger(account.uid) && account.uid! > 0) return account.uid!;
    } catch { /* the derived number below still identifies the key */ }
    return ticketOf(`key|${apiKey}`);
  }

  private async loadSymbols(): Promise<void> {
    const [info, tickers, marks] = await Promise.all([
      this.api().get<{ symbols: RawSymbol[] }>('/fapi/v1/exchangeInfo'),
      this.api().get<RawBookTicker[]>('/fapi/v1/ticker/bookTicker'),
      this.api().get<{ symbol: string; markPrice: string }[]>('/fapi/v1/premiumIndex'),
    ]);
    const assets = this.isMultiAssets ? ['USDT', 'USDC'] : ['USDT'];
    const books = new Map(tickers.map((ticker) => [ticker.symbol, ticker]));
    for (const mark of marks) this.marks.set(mark.symbol, num(mark.markPrice));
    const now = Date.now();
    for (const raw of info.symbols) {
      if (!assets.includes(raw.marginAsset) || !contractTypes.has(raw.contractType) || !tradableStatuses.has(raw.status)) continue;
      this.instruments.set(raw.symbol, raw);
      this.specs.set(raw.symbol, symbolSpec(raw, books.get(raw.symbol)));
      const tick = books.has(raw.symbol) ? tickFrom(books.get(raw.symbol)!, undefined, now) : undefined;
      if (tick) this.ticks.set(raw.symbol, tick);
    }
  }

  private async loadAccount(): Promise<void> {
    this.wallet = await this.api().get<RawAccount>('/fapi/v3/account', {}, true);
  }

  private async loadPositions(): Promise<void> {
    const list = await this.api().get<RawPosition[]>('/fapi/v3/positionRisk', {}, true);
    this.positions.clear();
    for (const raw of list) this.storePosition(raw);
  }

  private async loadOrders(): Promise<void> {
    const [orders, algos] = await Promise.all([
      this.api().get<RawOrder[]>('/fapi/v1/openOrders', {}, true),
      this.api().get<RawAlgoOrder[]>('/fapi/v1/openAlgoOrders', {}, true),
    ]);
    this.orders.clear();
    this.algos.clear();
    for (const raw of orders) this.orders.set(raw.orderId, raw);
    for (const raw of algos) this.algos.set(raw.algoId, raw);
  }

  private async loadConfigs(): Promise<void> {
    const list = await this.api().get<SymbolConfig[]>('/fapi/v1/symbolConfig', {}, true);
    for (const config of list) this.configs.set(config.symbol, config);
  }

  private async resync(epoch: number): Promise<void> {
    try {
      await Promise.all([this.loadAccount(), this.loadPositions(), this.loadOrders(), this.refreshMode()]);
      await Promise.all([...this.positions.values()].map((raw) => this.openTimeOf(raw)));
      if (epoch !== this.epoch) return;
      this.publishState({ state: 'open', error: undefined });
      this.publish('trade', this.snapshot());
    } catch (error) {
      if (epoch === this.epoch) this.journal(`Binance reconnected, but its account state could not be read: ${(error as Error).message}`);
    }
  }

  private storePosition(raw: RawPosition): void {
    const key = positionKey(raw.symbol, raw.positionSide);
    const previous = this.positions.get(key);
    const amount = num(raw.positionAmt);
    if (!amount) {
      this.positions.delete(key);
      this.openTimes.delete(key);
      return;
    }
    // A one-way position that flips from long to short is a new position.
    if (previous && Math.sign(num(previous.positionAmt)) !== Math.sign(amount)) this.openTimes.delete(key);
    this.positions.set(key, { ...previous, ...raw });
  }

  // When the trade that opened the position happened; positions show once it is known, so their
  // ticket never changes.
  private openTimeOf(raw: RawPosition): Promise<number | undefined> {
    const key = positionKey(raw.symbol, raw.positionSide);
    const known = this.openTimes.get(key);
    if (known !== undefined) return Promise.resolve(known);
    const running = this.discovering.get(key);
    if (running) return running;
    const epoch = this.epoch;
    const work = this.discoverOpenTime(raw.symbol, raw.positionSide).then((time) => {
      if (epoch !== this.epoch || !this.positions.has(key)) return undefined;
      this.openTimes.set(key, time);
      return time;
    }).finally(() => this.discovering.delete(key));
    this.discovering.set(key, work);
    return work;
  }

  private async discoverOpenTime(symbol: string, positionSide: string): Promise<number> {
    const step = this.specs.get(symbol)?.volumeStep || 1e-8;
    for (let attempt = 0; attempt < 3; attempt++) {
      const trades: RawTrade[] = [];
      let end = Date.now();
      for (let week = 0; week < OPEN_TIME_WEEKS; week++) {
        const page = await this.api().get<RawTrade[]>('/fapi/v1/userTrades', { symbol, startTime: end - WEEK + 1, endTime: end, limit: 1000 }, true);
        trades.push(...page);
        const amount = num(this.positions.get(positionKey(symbol, positionSide))?.positionAmt);
        if (!amount) return 0;
        const opening = openingTrade(trades, amount, positionSide, step);
        if (opening) return opening.time;
        end -= WEEK;
      }
      // The trade list and the position size disagreed (a fill landed in between); read again.
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    this.journal(`The trade that opened the ${symbol} position was not found, so its ticket may change after a restart.`);
    return 0;
  }

  private onUser(event: Record<string, unknown>): void {
    switch (event.e) {
      case 'ACCOUNT_UPDATE': {
        const update = event.a as { P?: Record<string, string>[] } | undefined;
        for (const row of update?.P ?? []) {
          const previous = this.positions.get(positionKey(row.s, row.ps));
          this.storePosition({ symbol: row.s, positionSide: row.ps, positionAmt: row.pa, entryPrice: row.ep, unRealizedProfit: row.up });
          const raw = this.positions.get(positionKey(row.s, row.ps));
          if (raw) void this.openTimeOf(raw).then(() => this.publishTrade(true));
          else if (previous) void this.cancelProtection(previous, true);
        }
        this.resubscribe();
        this.refreshAccount();
        break;
      }
      case 'ORDER_TRADE_UPDATE': {
        const order = event.o as Record<string, unknown>;
        const raw = this.orderOf(order);
        if (raw.status === 'NEW' || raw.status === 'PARTIALLY_FILLED') this.orders.set(raw.orderId, raw);
        else this.orders.delete(raw.orderId);
        if (order.x === 'TRADE') {
          if (raw.type === 'LIMIT') void this.protectFill(raw.symbol, raw.side === 'BUY', raw.clientOrderId, num(order.l));
          this.refreshAccount();
        }
        break;
      }
      case 'ALGO_UPDATE': {
        const raw = this.algoOf(event.o as Record<string, unknown>);
        if (isOpenAlgo(raw)) this.algos.set(raw.algoId, raw);
        else this.algos.delete(raw.algoId);
        // A stop entry's SL/TP follow its whole fill once the order it triggered is done.
        const executed = num((event.o as Record<string, unknown>).aq);
        if (raw.algoStatus === 'FINISHED' && executed > 0 && !isProtection(raw)) void this.protectFill(raw.symbol, raw.side === 'BUY', raw.clientAlgoId, executed);
        break;
      }
      case 'ACCOUNT_CONFIG_UPDATE': {
        const symbol = event.ac as { s: string; l: number } | undefined;
        const assets = event.ai as { j: boolean } | undefined;
        if (symbol) this.configs.set(symbol.s, { ...this.configs.get(symbol.s), symbol: symbol.s, marginType: this.configs.get(symbol.s)?.marginType ?? 'CROSSED', leverage: symbol.l });
        if (assets && assets.j !== this.isMultiAssets) this.journal('The Binance Multi-Assets mode changed. Sign in again so OpenTerm5 lists the right contracts.');
        break;
      }
      case 'listenKeyExpired':
        this.userStream?.restart();
        return;
      default: return;
    }
    this.publishTrade(true);
  }

  private orderOf(order: Record<string, unknown>): RawOrder {
    return {
      orderId: num(order.i), clientOrderId: String(order.c ?? ''), symbol: String(order.s), side: String(order.S), positionSide: String(order.ps ?? 'BOTH'),
      type: String(order.o), status: String(order.X), price: String(order.p ?? '0'), avgPrice: String(order.ap ?? '0'), origQty: String(order.q ?? '0'),
      executedQty: String(order.z ?? '0'), reduceOnly: !!order.R, updateTime: num(order.T),
    };
  }

  private algoOf(order: Record<string, unknown>): RawAlgoOrder {
    return {
      algoId: num(order.aid), clientAlgoId: String(order.caid ?? ''), symbol: String(order.s), side: String(order.S), positionSide: String(order.ps ?? 'BOTH'),
      orderType: String(order.o), algoStatus: String(order.X), quantity: String(order.q ?? '0'), triggerPrice: String(order.tp ?? '0'), price: String(order.p ?? '0'),
      reduceOnly: !!order.R, closePosition: !!order.cp, createTime: this.algos.get(num(order.aid))?.createTime ?? Date.now(), updateTime: Date.now(),
    };
  }

  // The account totals are not on the stream; a burst of fills reads them once.
  private refreshAccount(): void {
    if (this.accountTimer) return;
    const epoch = this.epoch;
    this.accountTimer = setTimeout(() => {
      this.accountTimer = undefined;
      void this.loadAccount().then(() => { if (epoch === this.epoch) this.publishTrade(true); })
        .catch((error: Error) => { if (epoch === this.epoch) this.journal(`The Binance account could not be read: ${error.message}`); });
    }, this.options.accountDelay ?? ACCOUNT_DELAY);
  }

  private onMarket(data: Record<string, unknown>): void {
    const symbol = String(data.s ?? '');
    if (data.e === 'bookTicker') {
      const tick = tickFrom({ symbol, bidPrice: String(data.b), askPrice: String(data.a) }, this.ticks.get(symbol), num(data.T) || Date.now());
      if (!tick) return;
      this.ticks.set(symbol, tick);
      this.publish('tick', tick);
    } else if (data.e === 'markPriceUpdate') {
      this.marks.set(symbol, num(data.p));
      if ([...this.positions.values()].some((position) => position.symbol === symbol)) this.publishTrade(false);
    } else if (data.e === 'kline') {
      const kline = data.k as Record<string, unknown>;
      const bar = klineBar([String(kline.t), String(kline.o), String(kline.h), String(kline.l), String(kline.c), String(kline.v)]);
      for (const feed of this.charts.values()) {
        if (feed.symbol !== symbol || feed.plan.interval !== kline.i) continue;
        if (!feed.plan.isAggregated) { this.publish('bar', { symbol, timeframe: feed.timeframe, bar }); continue; }
        this.addSource(feed, bar);
      }
    }
  }

  private addSource(feed: ChartFeed, bar: Bar): void {
    const bucket = Math.floor(bar.time / feed.plan.seconds) * feed.plan.seconds;
    for (const time of feed.sources.keys()) if (time < bucket) feed.sources.delete(time);
    feed.sources.set(bar.time, bar);
    if (!feed.isSeeded) return;
    const [current] = aggregateBars([...feed.sources.values()], feed.plan.seconds).slice(-1);
    if (current) this.publish('bar', { symbol: feed.symbol, timeframe: feed.timeframe, bar: current });
  }

  private async seed(feed: ChartFeed): Promise<void> {
    const ratio = Math.round(feed.plan.seconds / feed.plan.sourceSeconds);
    const rows = await this.api().get<unknown[][]>('/fapi/v1/klines', { symbol: feed.symbol, interval: feed.plan.interval, limit: ratio });
    const bucket = Math.floor(Date.now() / 1000 / feed.plan.seconds) * feed.plan.seconds;
    for (const bar of rows.map((row) => klineBar(row.map(String)))) if (bar.time >= bucket && !feed.sources.has(bar.time)) feed.sources.set(bar.time, bar);
    feed.isSeeded = true;
  }

  private resubscribe(): void {
    const held = [...this.positions.values()].map((position) => position.symbol);
    const quoted = new Set([...this.watched, ...this.pinned, ...held, ...[...this.charts.values()].map((feed) => feed.symbol)]);
    const wanted = new Set([...quoted].filter((symbol) => this.specs.has(symbol)).map((symbol) => `${lower(symbol)}@bookTicker`));
    for (const symbol of held) wanted.add(`${lower(symbol)}@markPrice@1s`);
    for (const feed of this.charts.values()) wanted.add(`${lower(feed.symbol)}@kline_${feed.plan.interval}`);
    const added = [...wanted].filter((topic) => !this.topics.has(topic));
    const removed = [...this.topics].filter((topic) => !wanted.has(topic));
    for (const topic of added) this.topics.add(topic);
    for (const topic of removed) this.topics.delete(topic);
    const isBook = (topic: string) => topic.endsWith('@bookTicker');
    const books = { added: added.filter(isBook), removed: removed.filter(isBook) };
    const others = { added: added.filter((topic) => !isBook(topic)), removed: removed.filter((topic) => !isBook(topic)) };
    if (books.removed.length) this.bookStream?.unsubscribe(books.removed);
    if (books.added.length) this.bookStream?.subscribe(books.added);
    if (others.removed.length) this.marketStream?.unsubscribe(others.removed);
    if (others.added.length) this.marketStream?.subscribe(others.added);
  }

  // Ticks move live P/L; account changes publish at once, price moves at most four times a second.
  private publishTrade(isImmediate: boolean): void {
    if (!this.isLoggedIn) return;
    if (isImmediate) {
      clearTimeout(this.publishTimer);
      this.publishTimer = undefined;
      this.publish('trade', this.snapshot());
      return;
    }
    this.publishTimer ??= setTimeout(() => {
      this.publishTimer = undefined;
      if (this.isLoggedIn) this.publish('trade', this.snapshot());
    }, TRADE_PUBLISH_DELAY);
  }

  private symbolList(): SymbolSpec[] {
    return [...this.specs.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  private livePositions(): Position[] {
    const algos = [...this.algos.values()];
    const result: Position[] = [];
    for (const [key, raw] of this.positions) {
      const openTime = this.openTimes.get(key);
      if (openTime === undefined) continue;
      const spec = this.specs.get(raw.symbol);
      const position = positionFrom(raw, algos, openTime, spec?.digits ?? 8, this.configs.get(raw.symbol)?.leverage);
      if (!position) continue;
      const mark = this.marks.get(raw.symbol) || num(raw.markPrice) || position.priceOpen;
      const profit = (mark - position.priceOpen) * num(raw.positionAmt) * (spec?.contractSize ?? 1);
      result.push({ ...position, priceCurrent: mark, profit: Math.round(profit * 100) / 100 });
    }
    return result.sort((left, right) => left.time - right.time);
  }

  private openOrders(): Order[] {
    const quoteOf = (order: Order) => {
      const tick = this.ticks.get(order.symbol);
      return tick ? { ...order, priceCurrent: order.type.startsWith('buy') ? tick.ask : tick.bid } : order;
    };
    const orders = [...this.orders.values()].filter((raw) => raw.type === 'LIMIT' && !raw.reduceOnly).map((raw) => orderFrom(raw, this.digits(raw.symbol), this.tickSize(raw.symbol)));
    const algos = [...this.algos.values()].filter((raw) => !isProtection(raw)).map((raw) => algoOrderFrom(raw, this.digits(raw.symbol), this.tickSize(raw.symbol)));
    return [...orders, ...algos].map(quoteOf).sort((left, right) => left.time - right.time);
  }

  private digits(symbol: string): number { return this.specs.get(symbol)?.digits ?? 8; }

  private tickSize(symbol: string): number {
    const spec = this.specs.get(symbol);
    return spec?.tickSize || spec?.point || 1e-8;
  }

  private account(positions = this.livePositions()): Account | null {
    if (!this.wallet || !this.identity) return null;
    const account = walletAccount(this.wallet, this.identity);
    const profit = Math.round(positions.reduce((sum, position) => sum + position.profit, 0) * 100) / 100;
    const equity = Math.round((account.equity - num(this.wallet.totalUnrealizedProfit) + profit) * 100) / 100;
    return { ...account, profit, equity, marginLevel: account.margin > 0 ? equity / account.margin * 100 : 0 };
  }

  private snapshot(): TradeSnapshot {
    if (!this.isLoggedIn && !this.wallet) return { account: null, orders: [], positions: [] };
    const positions = this.livePositions();
    return { account: this.account(positions), orders: this.openOrders(), positions };
  }

  private async quote(symbol: string): Promise<TerminalMethods['symbols.quote'][1]> {
    this.spec(symbol);
    if (!this.pinned.has(symbol)) {
      this.pinned.add(symbol);
      this.resubscribe();
    }
    let tick = this.ticks.get(symbol);
    if (!tick || !this.bookStream?.connected || Date.now() - tick.time > 10_000) {
      const raw = await this.api().get<RawBookTicker>('/fapi/v1/ticker/bookTicker', { symbol });
      tick = tickFrom(raw, tick, Date.now()) ?? tick;
      if (tick) this.ticks.set(symbol, tick);
    }
    if (!tick) throw new Error(`No Binance quote for ${symbol}`);
    return { symbol, bid: tick.bid, ask: tick.ask, time: tick.time };
  }

  // USDT and USDC contracts settle in stablecoins counted at par with the account currency.
  private async valuation(symbol: string): Promise<Valuation> {
    const spec = this.spec(symbol);
    let takerFeeRate = this.feeRates.get(symbol);
    if (takerFeeRate === undefined) {
      try {
        const result = await this.api().get<{ takerCommissionRate: string }>('/fapi/v1/commissionRate', { symbol }, true);
        takerFeeRate = num(result.takerCommissionRate);
        this.feeRates.set(symbol, takerFeeRate);
      } catch (error) { this.journal(`The ${symbol} fee rate is unavailable, so risk excludes fees: ${(error as Error).message}`); }
    }
    return { via: [], rate: 1, calcMode: 0, moneyPerUnit: spec.contractSize, profitCurrency: spec.currencyProfit, accountCurrency: this.identity?.currency ?? 'USDT', ...(takerFeeRate ? { takerFeeRate } : {}) };
  }

  private async rates(symbol: string, timeframe: Timeframe, count: number): Promise<Bar[]> {
    if (!Number.isSafeInteger(count) || count < 1 || count > 5000) throw new Error('Chart bar count must be between 1 and 5000');
    this.spec(symbol);
    const plan = klinePlan(timeframe);
    const ratio = Math.round(plan.seconds / plan.sourceSeconds);
    const needed = Math.min(20_000, (count + 1) * ratio);
    const rows: Bar[] = [];
    let endTime: number | undefined;
    while (rows.length < needed) {
      const limit = Math.min(MAX_KLINE_PAGE, needed - rows.length);
      const page = await this.api().get<unknown[][]>('/fapi/v1/klines', { symbol, interval: plan.interval, limit, endTime });
      const bars = page.map((row) => klineBar(row.map(String)));
      rows.push(...bars);
      if (bars.length < limit) break;
      endTime = Math.min(...bars.map((bar) => bar.time)) * 1000 - 1;
    }
    const ordered = [...new Map(rows.map((bar) => [bar.time, bar])).values()].sort((left, right) => left.time - right.time);
    const bars = plan.isAggregated ? aggregateBars(ordered, plan.seconds) : ordered;
    const feed = this.charts.get(`${symbol}:${timeframe}`);
    if (feed && plan.isAggregated) {
      const last = bars.at(-1);
      for (const source of ordered) if (last && source.time >= last.time && !feed.sources.has(source.time)) feed.sources.set(source.time, source);
      feed.isSeeded = true;
    }
    return bars.slice(-count);
  }

  // Trades can only be read per symbol, so the income history (which needs none) names the
  // symbols traded in the range first.
  private async history(from: number, to: number): Promise<History> {
    const end = Math.min(to * 1000, Date.now());
    const start = Math.max(from * 1000, Date.now() - HISTORY_DAYS * DAY);
    const incomes: RawIncome[] = [];
    for (let windowStart = start; windowStart < end; windowStart += WEEK) {
      const endTime = Math.min(windowStart + WEEK - 1, end);
      for (let startTime = windowStart; startTime <= endTime;) {
        const rows = await this.api().get<RawIncome[]>('/fapi/v1/income', { startTime, endTime, limit: 1000 }, true);
        incomes.push(...rows);
        if (rows.length < 1000) break;
        startTime = Math.max(...rows.map((row) => row.time)) + 1;
      }
    }
    const symbols = [...new Set(incomes.filter((income) => income.symbol && income.incomeType !== 'TRANSFER').map((income) => income.symbol))];
    const trades: RawTrade[] = [];
    const orders: RawOrder[] = [];
    for (const symbol of symbols) {
      for (let windowStart = start; windowStart < end; windowStart += WEEK) {
        const range = { symbol, startTime: windowStart, endTime: Math.min(windowStart + WEEK - 1, end) };
        const [fills, history] = await Promise.all([
          this.api().get<RawTrade[]>('/fapi/v1/userTrades', { ...range, limit: 1000 }, true),
          this.api().get<RawOrder[]>('/fapi/v1/allOrders', { ...range, limit: 1000 }, true),
        ]);
        trades.push(...fills);
        orders.push(...history);
      }
    }
    const deals: Deal[] = [...new Map(trades.map((trade) => [trade.id, trade])).values()].map(dealFrom).concat( [...new Map(incomes.filter((income) => income.incomeType === 'FUNDING_FEE').map((income) => [income.tranId, income])).values()].map(fundingFrom)).sort((left, right) => left.time - right.time);
    return { deals, orders: orders.map((raw) => orderFrom(raw, this.digits(raw.symbol), this.tickSize(raw.symbol))).sort((left, right) => left.time - right.time) };
  }

  private async bracket(symbol: string): Promise<Bracket> {
    const known = this.brackets.get(symbol);
    if (known) return known;
    // One symbol answers with an object, all symbols with a list.
    const answer = await this.api().get<{ symbol: string; brackets: Bracket[] } | { symbol: string; brackets: Bracket[] }[]>('/fapi/v1/leverageBracket', { symbol }, true);
    const entry = Array.isArray(answer) ? answer.find((item) => item.symbol === symbol) : answer;
    const lowest = [...(entry?.brackets ?? [])].sort((left, right) => left.bracket - right.bracket)[0] ?? { bracket: 1, initialLeverage: 20, maintMarginRatio: 0.004 };
    this.brackets.set(symbol, lowest);
    return lowest;
  }

  private marginModeOf(symbol: string): MarginMode {
    return this.configs.get(symbol)?.marginType === 'ISOLATED' ? 'isolated' : 'cross';
  }

  private async leverageOf(symbol: string): Promise<number> {
    const known = this.configs.get(symbol)?.leverage;
    if (known) return known;
    return (await this.leverageState(symbol)).leverage;
  }

  private async leverageState(symbol: string): Promise<LeverageState> {
    this.spec(symbol);
    const [configs, bracket] = await Promise.all([this.api().get<SymbolConfig[]>('/fapi/v1/symbolConfig', { symbol }, true), this.bracket(symbol)]);
    if (configs[0]) this.configs.set(symbol, configs[0]);
    const leverage = num(configs[0]?.leverage) || this.configs.get(symbol)?.leverage || 1;
    return { symbol, leverage, leverageMin: 1, leverageMax: bracket.initialLeverage, leverageStep: 1, maintenanceRate: bracket.maintMarginRatio, marginMode: this.marginModeOf(symbol) };
  }

  private async setLeverage(symbol: string, leverage: number): Promise<LeverageState> {
    this.spec(symbol);
    const { initialLeverage } = await this.bracket(symbol);
    const value = Math.floor(leverage + 1e-9);
    if (!(value >= 1 && value <= initialLeverage)) throw new Error(`${symbol} leverage must be a whole number between 1x and ${initialLeverage}x.`);
    const result = await this.api().post<{ leverage: number }>('/fapi/v1/leverage', { symbol, leverage: value });
    this.configs.set(symbol, { ...this.configs.get(symbol), symbol, marginType: this.configs.get(symbol)?.marginType ?? 'CROSSED', leverage: num(result.leverage) || value });
    return this.leverageState(symbol);
  }

  // Binance refuses limit prices beyond its percent band around the mark price (PERCENT_PRICE).
  private bandProblem(symbol: string, isBuy: boolean, price: number, digits: number): string | null {
    const filter = this.instruments.get(symbol)?.filters.find((item) => item.filterType === 'PERCENT_PRICE');
    const mark = this.marks.get(symbol);
    if (!filter || !mark) return null;
    const highest = mark * num(filter.multiplierUp);
    const lowest = mark * num(filter.multiplierDown);
    if (isBuy && highest > 0 && price > highest) return `Binance only accepts ${symbol} buy limits at ${highest.toFixed(digits)} or lower right now (its price band around the mark price). To buy above the market, use a Buy Stop.`;
    if (!isBuy && lowest > 0 && price < lowest) return `Binance only accepts ${symbol} sell limits at ${lowest.toFixed(digits)} or higher right now (its price band around the mark price). To sell below the market, use a Sell Stop.`;
    return null;
  }

  private async check(request: TradeRequest): Promise<CheckResult> {
    const account = this.account();
    const definition = orderType(request.type ?? '');
    if (!account || !definition || !request.symbol) throw new Error('Choose a symbol and order type to check');
    const spec = this.spec(request.symbol);
    const side = definition.isBuy ? 'buy' : 'sell';
    const quote = await this.quote(request.symbol);
    const price = definition.isPending && request.price ? request.price : side === 'buy' ? quote.ask : quote.bid;
    const volume = request.volume ?? 0;
    const [leverage, { maintMarginRatio: maintenanceRate }] = await Promise.all([this.leverageOf(request.symbol), this.bracket(request.symbol)]);
    const margin = Math.round(initialMargin(price, volume, spec.contractSize, leverage) * 100) / 100;
    const marginFree = account.marginFree;
    const marginMode = this.marginModeOf(request.symbol);
    const liquidation = marginMode === 'isolated'
      ? isolatedLiquidation(side, price, leverage, maintenanceRate)
      : crossLiquidation(side, price, volume, spec.contractSize, marginFree, maintenanceRate);
    const isLimit = request.type === 'buyLimit' || request.type === 'sellLimit';
    const outsideBand = isLimit ? this.bandProblem(request.symbol, definition.isBuy, price, spec.digits) : null;
    const isSuccess = margin <= marginFree && !outsideBand;
    const currency = account.currency;
    return {
      retcode: outsideBand ? 10015 : isSuccess ? 0 : 10019, isSuccess, margin, equity: account.equity, balance: account.balance,
      comment: outsideBand ?? (isSuccess ? `Margin ${margin.toFixed(2)} ${currency} at ${leverage}x` : `Not enough free margin: the order needs ${margin.toFixed(2)} ${currency} at ${leverage}x and ${marginFree.toFixed(2)} ${currency} is free.`),
      marginFree: Math.round((marginFree - margin) * 100) / 100,
      marginLevel: account.margin + margin > 0 ? account.equity / (account.margin + margin) * 100 : 0,
      hasMarginEstimate: true,
      leverage,
      maintenanceRate,
      ...(Number.isFinite(liquidation) ? { liquidationPrice: Number(liquidation.toFixed(spec.digits)) } : {}),
    };
  }

  private async send(request: TradeRequest): Promise<TradeResult> {
    if (!this.isLoggedIn) throw new Error('Binance is not connected');
    if (!this.identity?.isTradeAllowed) return failed('This API key cannot trade futures. Turn on Enable Futures for the key on Binance.');
    switch (request.action) {
      case 'deal': return request.position ? this.close(request) : this.open(request, false);
      case 'pending': return this.open(request, true);
      case 'sltp': return this.protect(request);
      case 'modify': return this.modify(request);
      case 'remove': return this.cancel(request);
      default: return failed('Close by is not available on Binance.');
    }
  }

  // In hedge mode an order names the position side it opens or closes; one-way mode marks closing
  // orders reduce-only instead (Binance refuses reduce-only in hedge mode). A buy opens a long and
  // closes a short.
  private sideFields(isBuyOrder: boolean, isClosing: boolean): Record<string, string> {
    if (this.isHedge) return { positionSide: isBuyOrder !== isClosing ? 'LONG' : 'SHORT' };
    return isClosing ? { reduceOnly: 'true' } : {};
  }

  // Binance sends no event when the account's position mode changes, so an order refused for a
  // position side that no longer matches it (-4061) re-reads the mode and goes once more in the
  // new one. The refusal means nothing was placed, so the retry cannot duplicate it.
  private async sendOrder<T>(path: string, body: Record<string, string>): Promise<T> {
    try { return await this.api().post<T>(path, body); }
    catch (error) {
      if (!(error instanceof BinanceApiError) || error.code !== -4061 || !(await this.refreshMode().catch(() => false))) throw error;
      return this.api().post<T>(path, this.inMode(body));
    }
  }

  // Whether the position mode changed since it was last read.
  private async refreshMode(): Promise<boolean> {
    const { dualSidePosition } = await this.api().get<{ dualSidePosition: boolean }>('/fapi/v1/accountConfig', {}, true);
    if (dualSidePosition === this.isHedge) return false;
    this.isHedge = dualSidePosition;
    if (this.identity) this.identity = { ...this.identity, isHedging: dualSidePosition };
    this.journal(`This Binance account is now in ${dualSidePosition ? 'Hedge' : 'One-way'} Mode; OpenTerm5 sends its orders that way.`);
    this.publishTrade(true);
    return true;
  }

  // The same order with the position side fields of the current mode. Whether it closes is read
  // from the fields of the old one: reduce-only, close-position, or a side against its position.
  private inMode(body: Record<string, string>): Record<string, string> {
    const { positionSide, reduceOnly, ...rest } = body;
    const isBuyOrder = rest.side === 'BUY';
    if (rest.closePosition === 'true') return this.isHedge ? { ...rest, positionSide: isBuyOrder ? 'SHORT' : 'LONG' } : rest;
    const isClosing = reduceOnly === 'true' || positionSide === (isBuyOrder ? 'SHORT' : 'LONG');
    return { ...rest, ...this.sideFields(isBuyOrder, isClosing) };
  }

  private findPosition(ticket: number | undefined): RawPosition | undefined {
    return [...this.positions.entries()].find(([key, raw]) => {
      const openTime = this.openTimes.get(key);
      return openTime !== undefined && positionFrom(raw, [], openTime, 8)?.ticket === ticket;
    })?.[1];
  }

  private findOrder(ticket: number | undefined): RawOrder | undefined {
    return [...this.orders.values()].find((raw) => ticketOf(`order|${raw.orderId}`) === ticket);
  }

  private findAlgo(ticket: number | undefined): RawAlgoOrder | undefined {
    return [...this.algos.values()].find((raw) => ticketOf(`algo|${raw.algoId}`) === ticket);
  }

  private async open(request: TradeRequest, isPending: boolean): Promise<TradeResult> {
    const definition = orderType(request.type ?? '');
    if (!definition || !request.symbol) return failed('Choose a symbol and order type.');
    if (definition.isPending !== isPending) return failed(isPending ? 'A pending order needs a limit or stop type.' : 'A market order needs the Buy or Sell type.');
    if (request.expiration) return failed('Binance orders here cannot expire. Remove the expiry and cancel the order when you no longer need it.');
    const spec = this.spec(request.symbol);
    const tickSize = this.tickSize(request.symbol);
    const quantity = formatQty(request.volume ?? 0, spec.volumeStep);
    if (!(Number(quantity) > 0)) return failed('The volume rounds to zero.');
    const price = request.price ?? 0;
    const sl = request.sl ?? 0;
    const tp = request.tp ?? 0;
    const base = { symbol: request.symbol, side: definition.isBuy ? 'BUY' : 'SELL', quantity, ...this.sideFields(definition.isBuy, false) };
    if (isPending && !(price > 0)) return failed('A pending order needs a price.');
    const problem = await this.stopsProblem(request, definition.isBuy, isPending, spec.digits);
    if (problem) return failed(problem, 10016);
    switch (request.type) {
      case 'buyLimit': case 'sellLimit': {
        const problem = this.bandProblem(request.symbol, definition.isBuy, price, spec.digits);
        if (problem) return failed(problem, 10015);
        return this.place({ ...base, type: 'LIMIT', timeInForce: 'GTC', price: formatPrice(price, tickSize), newClientOrderId: protectedClientId(randomId(), sl, tp, tickSize) });
      }
      case 'buyStop': case 'sellStop':
        return this.placeAlgo({ ...base, type: 'STOP_MARKET', triggerPrice: formatPrice(price, tickSize), clientAlgoId: protectedClientId(randomId(), sl, tp, tickSize) });
      case 'buyStopLimit': case 'sellStopLimit':
        if (!((request.stoplimit ?? 0) > 0)) return failed('A stop-limit order needs its limit price.');
        return this.placeAlgo({ ...base, type: 'STOP', timeInForce: 'GTC', price: formatPrice(request.stoplimit!, tickSize), triggerPrice: formatPrice(price, tickSize), clientAlgoId: protectedClientId(randomId(), sl, tp, tickSize) });
      default: return this.market(base, sl, tp);
    }
  }

  // A stop or target already beyond the price would trigger at once, which Binance refuses only
  // after the entry has filled. Checked first, as MT5 refuses invalid stops: against the entry
  // price for pending orders, against the side of the book that would trigger it otherwise.
  private async stopsProblem(request: TradeRequest, isBuy: boolean, isPending: boolean, digits: number): Promise<string | null> {
    const sl = request.sl ?? 0;
    const tp = request.tp ?? 0;
    if (!(sl > 0 || tp > 0)) return null;
    const quote = isPending ? undefined : await this.quote(request.symbol!);
    const entry = request.stoplimit || request.price || 0;
    const low = quote ? quote.bid : entry;
    const high = quote ? quote.ask : entry;
    const side = isBuy ? 'buy' : 'sell';
    if (sl > 0 && (isBuy ? sl >= low : sl <= high)) return `The stop loss ${sl.toFixed(digits)} must be ${isBuy ? 'below' : 'above'} ${isPending ? 'the entry price' : 'the market'} (${(isBuy ? low : high).toFixed(digits)}) for a ${side}.`;
    if (tp > 0 && (isBuy ? tp <= high : tp >= low)) return `The take profit ${tp.toFixed(digits)} must be ${isBuy ? 'above' : 'below'} ${isPending ? 'the entry price' : 'the market'} (${(isBuy ? high : low).toFixed(digits)}) for a ${side}.`;
    return null;
  }

  private async place(body: Record<string, string>): Promise<TradeResult> {
    let raw: RawOrder;
    try { raw = await this.sendOrder<RawOrder>('/fapi/v1/order', { ...body, newOrderRespType: 'RESULT' }); }
    catch (error) { return this.refused(body, error); }
    this.orders.set(raw.orderId, raw);
    this.publishTrade(true);
    return { retcode: 10008, isSuccess: true, comment: 'Placed', order: ticketOf(`order|${raw.orderId}`), volume: num(raw.origQty), price: num(raw.price) };
  }

  private async placeAlgo(body: Record<string, string>): Promise<TradeResult> {
    let raw: RawAlgoOrder;
    try { raw = await this.sendOrder<RawAlgoOrder>('/fapi/v1/algoOrder', { ...body, algoType: 'CONDITIONAL' }); }
    catch (error) { return this.refused(body, error); }
    this.algos.set(raw.algoId, raw);
    this.publishTrade(true);
    return { retcode: 10008, isSuccess: true, comment: 'Placed', order: ticketOf(`algo|${raw.algoId}`), volume: num(raw.quantity), price: num(raw.triggerPrice) };
  }

  private refused(body: Record<string, unknown>, error: unknown): TradeResult {
    if (!(error instanceof BinanceApiError)) throw unknownOutcome();
    this.journal(`Binance refused ${describeOrder(body)}: ${error.message}`);
    return failed(error.message, retcodeOf(error.code));
  }

  // Binance attaches no SL or TP to an order, so they follow the fill as reduce-only conditional
  // orders sized to it. Without its stop the fill is closed again: the risk was sized on the stop.
  private async market(base: Record<string, string>, sl: number, tp: number): Promise<TradeResult> {
    let raw: RawOrder;
    try { raw = await this.sendOrder<RawOrder>('/fapi/v1/order', { ...base, type: 'MARKET', newClientOrderId: `ot5-${randomId()}`, newOrderRespType: 'RESULT' }); }
    catch (error) { return this.refused(base, error); }
    const ticket = ticketOf(`order|${raw.orderId}`);
    const filled = num(raw.executedQty);
    if (!(filled > 0)) return { ...failed(`Binance ${raw.status.toLowerCase()} the order.`, 10006), order: ticket };
    const isBuy = base.side === 'BUY';
    const price = await this.fillPrice(base.symbol, raw.orderId);
    const problem = await this.attach(base.symbol, isBuy, raw.executedQty, sl, tp);
    if (problem) {
      const undone = await this.closeQuantity(base.symbol, isBuy, raw.executedQty);
      return { ...failed(undone ? `${problem} The ${raw.executedQty} ${base.symbol} that filled was closed again.` : `${problem} The ${raw.executedQty} ${base.symbol} that filled is still open without its stop loss: close it or set a stop now.`, 10006), order: ticket };
    }
    const position = await this.positionAfterFill(base.symbol, isBuy);
    return {
      retcode: filled < num(raw.origQty) ? 10010 : 10009, isSuccess: true, comment: 'Done', order: ticket, deal: ticket,
      price, volume: filled, ...(position ? { position } : {}),
    };
  }

  // Places the stop loss and take profit for a fill; returns why the stop could not be placed.
  private async attach(symbol: string, isBuy: boolean, quantity: string, sl: number, tp: number): Promise<string | null> {
    const tickSize = this.tickSize(symbol);
    const base = { symbol, side: isBuy ? 'SELL' : 'BUY', quantity, ...this.sideFields(!isBuy, true) };
    if (sl > 0) {
      const result = await this.placeAlgo({ ...base, type: 'STOP_MARKET', triggerPrice: formatPrice(sl, tickSize), clientAlgoId: `ot5s-${randomId()}` }).catch((error: Error) => failed(error.message));
      if (!result.isSuccess) return `Binance refused the stop loss: ${result.comment}`;
    }
    if (tp > 0) {
      const result = await this.placeAlgo({ ...base, type: 'TAKE_PROFIT_MARKET', triggerPrice: formatPrice(tp, tickSize), clientAlgoId: `ot5t-${randomId()}` }).catch((error: Error) => failed(error.message));
      if (!result.isSuccess) this.journal(`The ${symbol} take profit at ${tp} was not placed: ${result.comment}`);
    }
    return null;
  }

  // Order responses carry no average price since 2026-06-30; the order query still does.
  private async fillPrice(symbol: string, orderId: number): Promise<number> {
    try { return num((await this.api().get<RawOrder>('/fapi/v1/order', { symbol, orderId }, true)).avgPrice); }
    catch { return 0; }
  }

  private async closeQuantity(symbol: string, isBuy: boolean, quantity: string): Promise<boolean> {
    try {
      await this.sendOrder('/fapi/v1/order', { symbol, side: isBuy ? 'SELL' : 'BUY', type: 'MARKET', quantity, newClientOrderId: `ot5-${randomId()}`, ...this.sideFields(!isBuy, true) });
      return true;
    } catch (error) {
      this.journal(`Closing ${quantity} ${symbol} after its stop was refused failed: ${(error as Error).message}`);
      return false;
    }
  }

  // A pending entry's fills get the SL/TP its client id carries.
  private async protectFill(symbol: string, isBuy: boolean, clientId: string, quantity: number): Promise<void> {
    const { sl, tp } = attachedLevels(clientId, this.tickSize(symbol));
    if (!(quantity > 0) || !(sl > 0 || tp > 0)) return;
    const problem = await this.attach(symbol, isBuy, formatQty(quantity, this.specs.get(symbol)?.volumeStep ?? 1e-8), sl, tp);
    if (problem) this.journal(`${problem} The ${quantity} ${symbol} filled by a pending order is open without its stop loss.`);
  }

  private async positionAfterFill(symbol: string, isBuy: boolean): Promise<number | undefined> {
    try {
      const list = await this.api().get<RawPosition[]>('/fapi/v3/positionRisk', { symbol }, true);
      for (const raw of list) this.storePosition(raw);
    } catch { /* the stream will still deliver the position */ }
    const key = positionKey(symbol, this.isHedge ? (isBuy ? 'LONG' : 'SHORT') : 'BOTH');
    const raw = this.positions.get(key);
    if (!raw) return undefined;
    const openTime = await this.openTimeOf(raw).catch(() => undefined);
    this.publishTrade(true);
    return openTime === undefined ? undefined : positionFrom(raw, [], openTime, 8)?.ticket;
  }

  private async close(request: TradeRequest): Promise<TradeResult> {
    const raw = this.findPosition(request.position);
    if (!raw) return failed('This position is no longer open.');
    const spec = this.spec(raw.symbol);
    const size = Math.abs(num(raw.positionAmt));
    const quantity = formatQty(Math.min(request.volume ?? size, size), spec.volumeStep);
    if (!(Number(quantity) > 0)) return failed('The volume rounds to zero.');
    const isLong = raw.positionSide === 'LONG' || raw.positionSide === 'BOTH' && num(raw.positionAmt) > 0;
    const body = { symbol: raw.symbol, side: isLong ? 'SELL' : 'BUY', type: 'MARKET', quantity, newClientOrderId: `ot5-${randomId()}`, ...this.sideFields(!isLong, true) };
    let result: RawOrder;
    try { result = await this.sendOrder<RawOrder>('/fapi/v1/order', { ...body, newOrderRespType: 'RESULT' }); }
    catch (error) { return this.refused(body, error); }
    const ticket = ticketOf(`order|${result.orderId}`);
    const filled = num(result.executedQty);
    if (!(filled > 0)) return { ...failed(`Binance ${result.status.toLowerCase()} the order.`, 10006), order: ticket };
    if (filled >= size) await this.cancelProtection(raw);
    const price = await this.fillPrice(raw.symbol, result.orderId);
    return { retcode: filled < Number(quantity) ? 10010 : 10009, isSuccess: true, comment: 'Done', order: ticket, deal: ticket, price, volume: filled, position: request.position };
  }

  // Protection orders of a closed position would otherwise wait to act on the next one. When the
  // position closed by itself only OpenTerm5's own are cancelled.
  private async cancelProtection(raw: RawPosition, isOwnOnly = false): Promise<void> {
    const orders = protectionOf(raw, [...this.algos.values()]).filter((order) => !isOwnOnly || /^ot5[st]-/.test(order.clientAlgoId));
    for (const order of orders) {
      try { await this.api().delete('/fapi/v1/algoOrder', { algoId: order.algoId }); this.algos.delete(order.algoId); }
      catch { /* Binance also cancels reduce-only orders that have nothing left to reduce */ }
    }
  }

  // Untriggered algo orders cannot be amended, so a moved level is placed anew before the old one
  // is cancelled: for a moment both protect the position, never neither.
  private async protect(request: TradeRequest): Promise<TradeResult> {
    const raw = this.findPosition(request.position);
    if (!raw) return failed('This position is no longer open.');
    const key = positionKey(raw.symbol, raw.positionSide);
    const current = positionFrom(raw, [...this.algos.values()], this.openTimes.get(key) ?? 0, this.digits(raw.symbol))!;
    const tickSize = this.tickSize(raw.symbol);
    const own = protectionOf(raw, [...this.algos.values()]);
    const stops = own.filter(isStopLoss);
    const targets = own.filter((order) => !isStopLoss(order));
    const sl = request.sl ?? current.sl;
    const tp = request.tp ?? current.tp;
    const isLong = current.side === 'buy';
    const base = { symbol: raw.symbol, side: isLong ? 'SELL' : 'BUY', ...this.sideFields(!isLong, true) };
    const writes: (() => Promise<unknown>)[] = [];
    const replace = (order: RawAlgoOrder | undefined, type: string, price: number) => {
      const placement = order && !order.closePosition
        ? { ...base, type, quantity: order.quantity, triggerPrice: formatPrice(price, tickSize), clientAlgoId: `ot5${type === 'STOP_MARKET' ? 's' : 't'}-${randomId()}` }
        : { symbol: base.symbol, side: base.side, ...(this.isHedge ? { positionSide: raw.positionSide } : {}), type, closePosition: 'true', triggerPrice: formatPrice(price, tickSize), clientAlgoId: `ot5${type === 'STOP_MARKET' ? 's' : 't'}-${randomId()}` };
      writes.push(() => this.sendOrder('/fapi/v1/algoOrder', { ...placement, algoType: 'CONDITIONAL' }));
      if (order) writes.push(() => this.api().delete('/fapi/v1/algoOrder', { algoId: order.algoId }));
    };
    const cancel = (order: RawAlgoOrder) => writes.push(() => this.api().delete('/fapi/v1/algoOrder', { algoId: order.algoId }));
    if (Math.abs(sl - current.sl) > tickSize / 2) {
      if (!(sl > 0)) stops.forEach(cancel);
      else if (stops.length) stops.forEach((order) => replace(order, 'STOP_MARKET', sl));
      else replace(undefined, 'STOP_MARKET', sl);
    }
    if (Math.abs(tp - current.tp) > tickSize / 2) {
      const nearest = targets.find((order) => Math.abs(num(order.triggerPrice) - current.tp) <= tickSize / 2);
      if (!(tp > 0)) targets.forEach(cancel);
      else replace(nearest, 'TAKE_PROFIT_MARKET', tp);
    }
    let done = 0;
    try {
      for (const write of writes) { await write(); done++; }
    } catch (error) {
      if (!(error instanceof BinanceApiError)) throw unknownOutcome();
      return failed(done ? `${error.message} ${done} of ${writes.length} changes were applied; check the position on Binance.` : error.message, retcodeOf(error.code));
    } finally {
      if (done) void this.loadOrders().then(() => this.publishTrade(true)).catch(() => undefined);
    }
    return { retcode: 10009, isSuccess: true, comment: writes.length ? 'Done' : 'No change', order: request.position };
  }

  // A limit order's price changes in place. Anything else (its SL/TP, or any change to a stop
  // entry, which Binance cannot amend) cancels and replaces it, so the order gets a new ticket.
  private async modify(request: TradeRequest): Promise<TradeResult> {
    const raw = this.findOrder(request.order);
    const algo = raw ? undefined : this.findAlgo(request.order);
    if (!raw && !algo) return failed('This order is no longer open.');
    const symbol = raw?.symbol ?? algo!.symbol;
    const spec = this.spec(symbol);
    const tickSize = this.tickSize(symbol);
    const order = raw ? orderFrom(raw, spec.digits, tickSize) : algoOrderFrom(algo!, spec.digits, tickSize);
    const price = request.price ?? order.priceOpen;
    const sl = request.sl ?? order.sl;
    const tp = request.tp ?? order.tp;
    const isSame = (left: number, right: number) => Math.abs(left - right) <= tickSize / 2;
    if (raw && isSame(sl, order.sl) && isSame(tp, order.tp)) {
      const problem = isSame(price, order.priceOpen) ? null : this.bandProblem(symbol, raw.side === 'BUY', price, spec.digits);
      if (problem) return failed(problem, 10015);
      try { await this.api().put('/fapi/v1/order', { symbol, orderId: raw.orderId, side: raw.side, quantity: formatQty(order.volume, spec.volumeStep), price: formatPrice(price, tickSize) }); }
      catch (error) {
        if (error instanceof BinanceApiError) return failed(error.message, retcodeOf(error.code));
        throw unknownOutcome();
      }
      return { retcode: 10009, isSuccess: true, comment: 'Done', order: request.order };
    }
    const cancelled = await this.cancel({ ...request, action: 'remove' });
    if (!cancelled.isSuccess) return cancelled;
    const replaced = await this.open({ action: 'pending', symbol, type: order.type, volume: order.volume, price, sl, tp, ...(order.stoplimit || request.stoplimit ? { stoplimit: request.stoplimit ?? order.stoplimit } : {}) }, true);
    return replaced.isSuccess ? replaced : { ...replaced, comment: `The old order was cancelled, but its replacement was refused: ${replaced.comment}` };
  }

  private async cancel(request: TradeRequest): Promise<TradeResult> {
    const raw = this.findOrder(request.order);
    const algo = raw ? undefined : this.findAlgo(request.order);
    if (!raw && !algo) return failed('This order is no longer open.');
    try {
      if (raw) await this.api().delete('/fapi/v1/order', { symbol: raw.symbol, orderId: raw.orderId });
      else await this.api().delete('/fapi/v1/algoOrder', { algoId: algo!.algoId });
    } catch (error) {
      if (error instanceof BinanceApiError) return failed(error.message, retcodeOf(error.code));
      throw unknownOutcome();
    }
    if (raw) this.orders.delete(raw.orderId);
    else this.algos.delete(algo!.algoId);
    this.publishTrade(true);
    return { retcode: 10009, isSuccess: true, comment: 'Done', order: request.order };
  }
}
