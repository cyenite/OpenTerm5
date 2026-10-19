import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { bybitEnvironment, marginModes, orderType, type Account, type Bar, type CheckResult, type Deal, type History, type LeverageState, type LinkState, type MarginMode, type Order, type Position, type SymbolSpec, type TerminalEvent, type TerminalEvents, type TerminalMethod, type TerminalMethods, type TerminalStatus, type Tick, type Timeframe, type TradeRequest, type TradeResult, type TradeSnapshot } from '../shared/protocol';
import type { Valuation } from '../shared/valuation';
import { crossLiquidation, initialMargin, isolatedLiquidation } from '../shared/leverage';
import { BybitApiError, BybitRest, type Fetch } from './bybit-rest';
import { BybitStream, openWebSocket, type OpenSocket, type StreamMessage } from './bybit-stream';
import {
  aggregateBars, coinRate, dealFrom, formatPrice, formatQty, instrumentSpec, isOpenOrder, isProtection, klineBar, klinePlan, num, orderFrom,
  positionFrom, tickFrom, ticketOf, walletAccount, type AccountIdentity, type KlinePlan, type RawClosedPnl, type RawExecution, type RawInstrument,
  type RawOrder, type RawPosition, type RawTicker, type RawWallet,
} from './bybit-models';
import type { SessionCredentials, TradeGate } from './session-pool';

interface Page<T> {
  list: T[];
  nextPageCursor?: string;
}

interface KeyInfo {
  userID: number;
  readOnly: number;
  deadlineDay?: number;
  permissions: Record<string, string[] | undefined>;
}

// Several charts can show the same symbol and timeframe; the feed lasts until the last of them
// leaves.
interface ChartFeed {
  viewers: number;
  symbol: string;
  timeframe: Timeframe;
  plan: KlinePlan;
  isSeeded: boolean;
  sources: Map<number, Bar>;
}

interface Waiter {
  timer: NodeJS.Timeout;
  isAcceptance: boolean;
  reject: (error: Error) => void;
  resolve: (order: RawOrder | undefined) => void;
}

interface RawKline {
  start: number | string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface BybitLinkOptions {
  fetch?: Fetch;
  now?: () => number;
  openSocket?: OpenSocket;
  resultTimeout?: number;
}

const DAY = 86_400_000;
const PRICE_BAND_AGE = 5_000;
const WEEK = 7 * DAY;
const CATEGORY = 'linear';
const HISTORY_DAYS = 730;
const MAX_KLINE_PAGE = 1000;
const TRADE_PUBLISH_DELAY = 250;
const settleCoins = ['USDT', 'USDC'];
const finalStatuses = new Set(['Filled', 'Cancelled', 'Rejected', 'PartiallyFilledCanceled', 'Deactivated']);
const acceptedStatuses = new Set(['New', 'Untriggered', 'PartiallyFilled']);

const failed = (comment: string, retcode = 0): TradeResult => ({ retcode, isSuccess: false, comment });

// Callers such as the copier read MT5 trade return codes, so Bybit errors are reported as the
// nearest one: too frequent, no money, or rejected.
const retcodes: Record<number, number> = { 10006: 10024, 10429: 10024, 110007: 10019, 110012: 10019, 110045: 10019, 170131: 10019 };
const retcodeOf = (code: number) => retcodes[code] ?? 10006;

// What was sent, for the Journal when Bybit refuses it; the body holds no credentials.
const describeOrder = (body: Record<string, unknown>) => [
  body.side, body.orderType, body.qty, body.symbol,
  body.price !== undefined ? `at ${body.price}` : '', body.triggerPrice !== undefined ? `trigger ${body.triggerPrice}` : '',
  body.stopLoss !== undefined ? `SL ${body.stopLoss}` : '', body.takeProfit !== undefined ? `TP ${body.takeProfit}` : '', body.reduceOnly ? 'reduce-only' : '',
].filter(Boolean).join(' ');

const unknownOutcome = () => new Error('Order outcome is unknown. Check Bybit positions and orders before sending it again.');

// One Bybit Unified Trading Account, USDT and USDC linear contracts. REST reads the initial
// state, the private stream keeps positions, orders and the wallet current, and the public
// stream supplies tickers and klines.
export class BybitLink extends EventEmitter {
  state: LinkState = { url: '', state: 'idle' };
  private epoch = 0;
  private isLoggedIn = false;
  private rest?: BybitRest;
  private wallet?: RawWallet;
  private marginMode?: MarginMode;
  private tradeGate?: TradeGate;
  private identity?: AccountIdentity;
  private publicStream?: BybitStream;
  private publishTimer?: NodeJS.Timeout;
  private privateStream?: BybitStream;
  private readonly ticks = new Map<string, Tick>();
  private readonly specs = new Map<string, SymbolSpec>();
  private readonly charts = new Map<string, ChartFeed>();
  private readonly orders = new Map<string, RawOrder>();
  private readonly topics = new Set<string>();
  private readonly pinned = new Set<string>();
  private readonly tickers = new Map<string, RawTicker>();
  private readonly watched = new Set<string>();
  private readonly waiters = new Map<string, Waiter>();
  private readonly feeRates = new Map<string, number>();
  private readonly priceBands = new Map<string, { buy: number; sell: number; time: number }>();
  private readonly leverages = new Map<string, number>();
  private readonly positions = new Map<string, RawPosition>();
  private readonly maintenance = new Map<string, number>();
  private readonly instruments = new Map<string, RawInstrument>();
  private readonly hedgeSymbols = new Set<string>();

  constructor(private readonly options: BybitLinkOptions = {}) { super(); }

  get loggedIn(): boolean { return this.isLoggedIn; }

  setTradeGate(gate: TradeGate | undefined): void { this.tradeGate = gate; }

  // The streams push every change, so there is nothing to poll.
  setPollInterval(): void {}

  async signIn(credentials: SessionCredentials): Promise<Account> {
    if (credentials.platform !== 'bybit') throw new Error('This session signs in to Bybit accounts only');
    const environment = bybitEnvironment(credentials.environment);
    if (!environment) throw new Error('Unknown Bybit environment');
    const apiKey = credentials.apiKey.trim();
    const apiSecret = credentials.apiSecret.trim();
    if (!apiKey || !apiSecret) throw new Error('Enter the API key and its secret.');
    this.disconnect();
    const epoch = ++this.epoch;
    this.publishState({ url: environment.restUrl, state: 'connecting', error: undefined });
    try {
      const rest = new BybitRest(environment.restUrl, { apiKey, apiSecret }, this.options.fetch, this.options.now);
      await rest.syncClock();
      const key = await rest.get<KeyInfo>('/v5/user/query-api', {}, true);
      if (key.permissions.Wallet?.includes('Withdraw')) throw new Error('This API key can withdraw funds. Create a Bybit key without the Withdraw permission for OpenTerm5.');
      const info = await rest.get<{ unifiedMarginStatus: number; marginMode: string }>('/v5/account/info', {}, true);
      if (info.unifiedMarginStatus === 1) throw new Error('This is a classic Bybit account. Upgrade it to the Unified Trading Account on Bybit first.');
      this.guard(epoch);
      this.rest = rest;
      this.marginMode = marginModes.find((mode) => mode.apiValue === info.marginMode)?.key;
      const isTradeAllowed = key.readOnly === 0 && (!!key.permissions.ContractTrade?.includes('Order') || !!key.permissions.Derivatives?.includes('DerivativesTrade'));
      this.identity = { uid: Number(key.userID), server: `Bybit ${environment.label}`, currency: 'USD', tradeMode: environment.tradeMode, isHedging: false, isTradeAllowed };
      if (key.deadlineDay !== undefined && key.deadlineDay <= 14) this.journal(`This API key stops working in ${key.deadlineDay} days. Bind it to an IP address on Bybit, or create a new key.`);
      if (!isTradeAllowed) this.journal('This API key is read-only. Allow Contract orders and positions on Bybit to trade.');
      await Promise.all([this.loadInstruments(), this.loadWallet(), this.loadPositions(), this.loadOrders()]);
      this.guard(epoch);
      const openSocket = this.options.openSocket ?? openWebSocket;
      const publicStream = new BybitStream(`${environment.publicUrl}/${CATEGORY}`, openSocket);
      const privateStream = new BybitStream(environment.privateUrl, openSocket, () => rest.realtimeAuth());
      this.publicStream = publicStream;
      this.privateStream = privateStream;
      publicStream.on('data', (message: StreamMessage) => { if (this.publicStream === publicStream) this.onPublic(message); });
      publicStream.on('journal', (message: string) => this.journal(message));
      privateStream.on('data', (message: StreamMessage) => { if (this.privateStream === privateStream) this.onPrivate(message); });
      privateStream.on('open', () => { if (this.privateStream === privateStream && this.isLoggedIn) void this.resync(epoch); });
      privateStream.on('closed', () => { if (this.privateStream === privateStream && this.isLoggedIn) this.publishState({ state: 'connecting' }); });
      privateStream.on('failed', (error: Error) => {
        if (this.privateStream !== privateStream) return;
        this.journal(error.message);
        this.isLoggedIn = false;
        this.publishState({ state: 'closed', error: error.message });
      });
      privateStream.subscribe(['order', 'position', 'wallet']);
      this.resubscribe();
      publicStream.start();
      privateStream.start();
      await privateStream.ready();
      this.guard(epoch);
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
    this.publicStream?.removeAllListeners();
    this.publicStream?.stop();
    this.privateStream?.removeAllListeners();
    this.privateStream?.stop();
    this.publicStream = undefined;
    this.privateStream = undefined;
    clearTimeout(this.publishTimer);
    this.publishTimer = undefined;
    for (const waiter of this.waiters.values()) { clearTimeout(waiter.timer); waiter.reject(unknownOutcome()); }
    this.waiters.clear();
    this.rest = undefined;
    this.wallet = undefined;
    this.identity = undefined;
    for (const store of [this.ticks, this.specs, this.orders, this.tickers, this.feeRates, this.priceBands, this.leverages, this.positions, this.maintenance, this.instruments]) store.clear();
    for (const store of [this.topics, this.pinned, this.watched, this.hedgeSymbols]) store.clear();
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
      case 'account.login': throw new Error('Bybit accounts sign in with an API key.');
      case 'symbols.list': return this.symbolList();
      case 'symbols.info': return this.spec(values.symbol);
      case 'symbols.select': return true;
      case 'ticks.subscribe': {
        const symbols = (values.symbols as string[]).filter((symbol) => this.specs.has(symbol));
        this.watched.clear();
        for (const symbol of symbols) this.watched.add(symbol);
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
      default: throw new Error(`${method} is not available on Bybit accounts`);
    }
  }

  private publish<E extends TerminalEvent>(event: E, data: TerminalEvents[E]): void { this.emit('event', event, data); }

  private publishState(patch: Partial<LinkState>): void {
    this.state = { ...this.state, ...patch };
    this.publish('link', this.state);
    this.publish('status', this.status());
  }

  private journal(message: string): void { this.publish('journal', { source: 'Bybit', time: Date.now(), message }); }

  private guard(epoch: number): void {
    if (epoch !== this.epoch) throw new Error('The Bybit connection changed before sign-in finished');
  }

  private api(): BybitRest {
    if (!this.rest) throw new Error('Bybit is not connected');
    return this.rest;
  }

  private spec(symbol: string): SymbolSpec {
    const spec = this.specs.get(symbol);
    if (!spec) throw new Error(`${symbol} is not a Bybit USDT or USDC contract`);
    return spec;
  }

  private status(): TerminalStatus {
    const isTradeAllowed = this.isLoggedIn && !!this.identity?.isTradeAllowed;
    return {
      mode: 'bybit', name: 'OpenTerm5', company: 'Bybit', isConnected: this.isLoggedIn, isTradeAllowed,
      connectionState: this.isLoggedIn ? (this.state.state === 'open' ? 'connected' : 'reconnecting') : this.state.state === 'connecting' ? 'authenticating' : 'disconnected',
      capabilities: { history: true, trading: isTradeAllowed, depth: false },
    };
  }

  private async pages<T>(path: string, query: Record<string, string | number | undefined>, isSigned: boolean, limit: number): Promise<T[]> {
    const rows: T[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page++) {
      const result = await this.api().get<Page<T>>(path, { ...query, limit, cursor }, isSigned);
      rows.push(...result.list);
      cursor = result.nextPageCursor;
      if (!cursor || result.list.length < limit) break;
    }
    return rows;
  }

  private async loadInstruments(): Promise<void> {
    const [instruments, tickers] = await Promise.all([
      this.pages<RawInstrument>('/v5/market/instruments-info', { category: CATEGORY }, false, 1000),
      this.api().get<Page<RawTicker>>('/v5/market/tickers', { category: CATEGORY }),
    ]);
    const now = Date.now();
    for (const ticker of tickers.list) {
      this.tickers.set(ticker.symbol, ticker);
      const tick = tickFrom(ticker, undefined, now);
      if (tick) this.ticks.set(ticker.symbol, tick);
    }
    for (const instrument of instruments) {
      if (!settleCoins.includes(instrument.settleCoin) || instrument.status === 'Closed') continue;
      this.instruments.set(instrument.symbol, instrument);
      this.specs.set(instrument.symbol, instrumentSpec(instrument, this.tickers.get(instrument.symbol)));
    }
  }

  private async loadWallet(): Promise<void> {
    const result = await this.api().get<Page<RawWallet & { accountType: string }>>('/v5/account/wallet-balance', { accountType: 'UNIFIED' }, true);
    this.wallet = result.list.find((item) => item.accountType === 'UNIFIED') ?? result.list[0];
  }

  private async loadPositions(): Promise<void> {
    const lists = await Promise.all(settleCoins.map((coin) => this.pages<RawPosition>('/v5/position/list', { category: CATEGORY, settleCoin: coin }, true, 200)));
    this.positions.clear();
    for (const raw of lists.flat()) this.storePosition(raw);
  }

  private async loadOrders(): Promise<void> {
    const lists = await Promise.all(settleCoins.map((coin) => this.pages<RawOrder>('/v5/order/realtime', { category: CATEGORY, settleCoin: coin }, true, 50)));
    this.orders.clear();
    for (const raw of lists.flat()) this.storeOrder(raw);
  }

  private async resync(epoch: number): Promise<void> {
    try {
      await Promise.all([this.loadWallet(), this.loadPositions(), this.loadOrders()]);
      if (epoch !== this.epoch) return;
      this.publishState({ state: 'open', error: undefined });
      this.publish('trade', this.snapshot());
    } catch (error) {
      if (epoch === this.epoch) this.journal(`Bybit reconnected, but its account state could not be read: ${(error as Error).message}`);
    }
  }

  private storePosition(raw: RawPosition): void {
    const key = `${raw.symbol}|${raw.positionIdx}`;
    if (raw.positionIdx !== 0) this.hedgeSymbols.add(raw.symbol);
    if (num(raw.leverage) > 0) this.leverages.set(raw.symbol, num(raw.leverage));
    // The stream calls the entry price entryPrice; REST calls it avgPrice.
    const update = raw.entryPrice !== undefined ? { ...raw, avgPrice: raw.entryPrice } : raw;
    if (num(raw.size) > 0) this.positions.set(key, { ...this.positions.get(key), ...update });
    else this.positions.delete(key);
  }

  private storeOrder(raw: RawOrder): void {
    if (isOpenOrder(raw)) this.orders.set(raw.orderId, raw);
    else this.orders.delete(raw.orderId);
    const waiter = this.waiters.get(raw.orderLinkId);
    if (waiter && (finalStatuses.has(raw.orderStatus) || waiter.isAcceptance && acceptedStatuses.has(raw.orderStatus))) {
      clearTimeout(waiter.timer);
      this.waiters.delete(raw.orderLinkId);
      waiter.resolve(raw);
    }
  }

  private onPrivate(message: StreamMessage): void {
    const rows = Array.isArray(message.data) ? message.data as (Record<string, unknown>)[] : [];
    const own = rows.filter((row) => row.category === undefined || row.category === CATEGORY);
    if (message.topic === 'position') {
      for (const row of own) this.storePosition(row as unknown as RawPosition);
      this.resubscribe();
    } else if (message.topic === 'order') {
      for (const row of own) this.storeOrder(row as unknown as RawOrder);
    } else if (message.topic === 'wallet') {
      const unified = rows.find((row) => row.accountType === 'UNIFIED');
      if (unified) this.wallet = unified as unknown as RawWallet;
    } else return;
    this.publishTrade(true);
  }

  private onPublic(message: StreamMessage): void {
    const topic = message.topic ?? '';
    if (topic.startsWith('tickers.')) {
      const data = message.data as RawTicker;
      const symbol = data.symbol ?? topic.slice(8);
      const merged = { ...this.tickers.get(symbol), ...data, symbol };
      this.tickers.set(symbol, merged);
      const tick = tickFrom(merged, this.ticks.get(symbol), message.ts ?? Date.now());
      if (!tick) return;
      this.ticks.set(symbol, tick);
      this.publish('tick', tick);
      if ([...this.positions.values()].some((position) => position.symbol === symbol)) this.publishTrade(false);
    } else if (topic.startsWith('kline.')) {
      const [, interval, symbol] = topic.split('.');
      for (const row of (message.data as RawKline[] | undefined) ?? []) {
        const bar = klineBar([String(row.start), row.open, row.high, row.low, row.close, row.volume]);
        for (const feed of this.charts.values()) {
          if (feed.symbol !== symbol || feed.plan.interval !== interval) continue;
          if (!feed.plan.isAggregated) { this.publish('bar', { symbol, timeframe: feed.timeframe, bar }); continue; }
          this.addSource(feed, bar);
        }
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
    const page = await this.api().get<Page<string[]>>('/v5/market/kline', { category: CATEGORY, symbol: feed.symbol, interval: feed.plan.interval, limit: ratio });
    const bucket = Math.floor(Date.now() / 1000 / feed.plan.seconds) * feed.plan.seconds;
    for (const bar of page.list.map(klineBar)) if (bar.time >= bucket && !feed.sources.has(bar.time)) feed.sources.set(bar.time, bar);
    feed.isSeeded = true;
  }

  private resubscribe(): void {
    const symbols = new Set([...this.watched, ...this.pinned, ...[...this.positions.values()].map((position) => position.symbol), ...[...this.charts.values()].map((feed) => feed.symbol)]);
    const wanted = new Set([...symbols].filter((symbol) => this.specs.has(symbol)).map((symbol) => `tickers.${symbol}`));
    for (const feed of this.charts.values()) wanted.add(`kline.${feed.plan.interval}.${feed.symbol}`);
    const added = [...wanted].filter((topic) => !this.topics.has(topic));
    const removed = [...this.topics].filter((topic) => !wanted.has(topic));
    for (const topic of added) this.topics.add(topic);
    for (const topic of removed) this.topics.delete(topic);
    if (removed.length) this.publicStream?.unsubscribe(removed);
    if (added.length) this.publicStream?.subscribe(added);
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

  private rate(coin: string): number { return coinRate(this.wallet, coin); }

  private livePositions(): Position[] {
    const protection = [...this.orders.values()].filter(isProtection);
    const result: Position[] = [];
    for (const raw of this.positions.values()) {
      const spec = this.specs.get(raw.symbol);
      const position = positionFrom(raw, protection, spec?.digits ?? 8);
      if (!position) continue;
      const mark = num(this.tickers.get(raw.symbol)?.markPrice) || position.priceCurrent;
      const direction = position.side === 'buy' ? 1 : -1;
      const profit = mark > 0 ? (mark - position.priceOpen) * position.volume * (spec?.contractSize ?? 1) * direction : position.profit;
      result.push({ ...position, priceCurrent: mark, profit: Math.round(profit * this.rate(spec?.currencyProfit ?? 'USDT') * 100) / 100 });
    }
    return result.sort((left, right) => left.time - right.time);
  }

  private openOrders(): Order[] {
    return [...this.orders.values()].filter((raw) => !isProtection(raw)).map((raw) => {
      const order = orderFrom(raw, this.specs.get(raw.symbol)?.digits ?? 8);
      const tick = this.ticks.get(raw.symbol);
      return tick ? { ...order, priceCurrent: order.type.startsWith('buy') ? tick.ask : tick.bid } : order;
    }).sort((left, right) => left.time - right.time);
  }

  private account(positions = this.livePositions()): Account | null {
    if (!this.wallet || !this.identity) return null;
    const account = walletAccount(this.wallet, this.identity);
    const profit = Math.round(positions.reduce((sum, position) => sum + position.profit, 0) * 100) / 100;
    const equity = Math.round((account.equity - num(this.wallet.totalPerpUPL) + profit) * 100) / 100;
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
    if (!tick || !this.publicStream?.connected || Date.now() - tick.time > 10_000) {
      const result = await this.api().get<Page<RawTicker>>('/v5/market/tickers', { category: CATEGORY, symbol });
      const raw = result.list[0];
      if (raw) {
        this.tickers.set(symbol, { ...this.tickers.get(symbol), ...raw });
        tick = tickFrom(raw, tick, Date.now()) ?? tick;
        if (tick) this.ticks.set(symbol, tick);
      }
    }
    if (!tick) throw new Error(`No Bybit quote for ${symbol}`);
    return { symbol, bid: tick.bid, ask: tick.ask, time: tick.time };
  }

  private async valuation(symbol: string): Promise<Valuation> {
    const spec = this.spec(symbol);
    const rate = this.rate(spec.currencyProfit);
    let takerFeeRate = this.feeRates.get(symbol);
    if (takerFeeRate === undefined) {
      try {
        const result = await this.api().get<Page<{ takerFeeRate: string }>>('/v5/account/fee-rate', { category: CATEGORY, symbol }, true);
        takerFeeRate = num(result.list[0]?.takerFeeRate);
        this.feeRates.set(symbol, takerFeeRate);
      } catch (error) { this.journal(`The ${symbol} fee rate is unavailable, so risk excludes fees: ${(error as Error).message}`); }
    }
    return { via: [], rate, calcMode: 0, moneyPerUnit: spec.contractSize * rate, profitCurrency: spec.currencyProfit, accountCurrency: this.identity?.currency ?? 'USD', ...(takerFeeRate ? { takerFeeRate } : {}) };
  }

  private async rates(symbol: string, timeframe: Timeframe, count: number): Promise<Bar[]> {
    if (!Number.isSafeInteger(count) || count < 1 || count > 5000) throw new Error('Chart bar count must be between 1 and 5000');
    this.spec(symbol);
    const plan = klinePlan(timeframe);
    const ratio = Math.round(plan.seconds / plan.sourceSeconds);
    const needed = Math.min(20_000, (count + 1) * ratio);
    const rows: Bar[] = [];
    let end: number | undefined;
    while (rows.length < needed) {
      const limit = Math.min(MAX_KLINE_PAGE, needed - rows.length);
      const page = await this.api().get<Page<string[]>>('/v5/market/kline', { category: CATEGORY, symbol, interval: plan.interval, limit, end });
      const bars = page.list.map(klineBar);
      rows.push(...bars);
      if (bars.length < limit) break;
      end = Math.min(...bars.map((bar) => bar.time)) * 1000 - 1;
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

  private async history(from: number, to: number): Promise<History> {
    const end = Math.min(to * 1000, Date.now());
    const start = Math.max(from * 1000, Date.now() - HISTORY_DAYS * DAY);
    const executions: RawExecution[] = [];
    const closed: RawClosedPnl[] = [];
    const orders: RawOrder[] = [];
    for (let windowStart = start; windowStart < end; windowStart += WEEK) {
      const range = { category: CATEGORY, startTime: windowStart, endTime: Math.min(windowStart + WEEK - 1, end) };
      const [fills, pnl, history] = await Promise.all([
        this.pages<RawExecution>('/v5/execution/list', range, true, 100),
        this.pages<RawClosedPnl>('/v5/position/closed-pnl', range, true, 100),
        this.pages<RawOrder>('/v5/order/history', range, true, 50),
      ]);
      executions.push(...fills);
      closed.push(...pnl);
      orders.push(...history);
    }
    const closedByOrder = new Map(closed.map((item) => [item.orderId, item]));
    const credited = new Set<string>();
    const deals: Deal[] = executions.sort((left, right) => num(left.execTime) - num(right.execTime)).map((execution) => {
      const isClosing = num(execution.closedSize) > 0;
      const isFirstFill = isClosing && !credited.has(execution.orderId);
      if (isFirstFill) credited.add(execution.orderId);
      return dealFrom(execution, closedByOrder.get(execution.orderId), isFirstFill);
    });
    return { deals, orders: orders.map((raw) => orderFrom(raw, this.specs.get(raw.symbol)?.digits ?? 8)).sort((left, right) => left.time - right.time) };
  }

  private async leverageOf(symbol: string): Promise<number> {
    const known = this.leverages.get(symbol);
    if (known) return known;
    return (await this.leverageState(symbol)).leverage;
  }

  private async leverageState(symbol: string): Promise<LeverageState> {
    this.spec(symbol);
    const filter = this.instruments.get(symbol)!.leverageFilter;
    const result = await this.api().get<Page<RawPosition>>('/v5/position/list', { category: CATEGORY, symbol }, true);
    for (const raw of result.list) this.storePosition(raw);
    const leverage = num(result.list[0]?.leverage) || this.leverages.get(symbol) || 1;
    this.leverages.set(symbol, leverage);
    const maintenanceRate = await this.maintenanceRate(symbol);
    return { symbol, leverage, leverageMin: num(filter.minLeverage), leverageMax: num(filter.maxLeverage), leverageStep: num(filter.leverageStep), maintenanceRate, marginMode: this.marginMode };
  }

  private async setLeverage(symbol: string, leverage: number): Promise<LeverageState> {
    this.spec(symbol);
    const filter = this.instruments.get(symbol)!.leverageFilter;
    const step = num(filter.leverageStep) || 0.01;
    const value = formatQty(leverage + 1e-9, step);
    if (!(Number(value) >= num(filter.minLeverage) && Number(value) <= num(filter.maxLeverage))) throw new Error(`${symbol} leverage must be between ${filter.minLeverage}x and ${filter.maxLeverage}x.`);
    try { await this.api().post('/v5/position/set-leverage', { category: CATEGORY, symbol, buyLeverage: value, sellLeverage: value }); }
    catch (error) { if (!(error instanceof BybitApiError && error.code === 110043)) throw error; }
    this.leverages.set(symbol, Number(value));
    return this.leverageState(symbol);
  }

  private async maintenanceRate(symbol: string): Promise<number> {
    const known = this.maintenance.get(symbol);
    if (known !== undefined) return known;
    const result = await this.api().get<Page<{ id: number; maintenanceMargin: number | string }>>('/v5/market/risk-limit', { category: CATEGORY, symbol });
    const lowest = [...result.list].sort((left, right) => left.id - right.id)[0];
    const rate = num(lowest?.maintenanceMargin);
    this.maintenance.set(symbol, rate);
    return rate;
  }

  // Bybit refuses limit orders priced beyond its band around the market (error 110003): buys
  // above the highest bid it allows, sells below the lowest ask. Without the band, Bybit's own
  // refusal still stands.
  private async priceBand(symbol: string): Promise<{ buy: number; sell: number } | undefined> {
    const cached = this.priceBands.get(symbol);
    if (cached && Date.now() - cached.time < PRICE_BAND_AGE) return cached;
    try {
      const result = await this.api().get<{ buyLmt: string; sellLmt: string }>('/v5/market/price-limit', { category: CATEGORY, symbol });
      const band = { buy: num(result.buyLmt), sell: num(result.sellLmt), time: Date.now() };
      this.priceBands.set(symbol, band);
      return band;
    } catch { return undefined; }
  }

  private async bandProblem(symbol: string, isBuy: boolean, price: number, digits: number): Promise<string | null> {
    const band = await this.priceBand(symbol);
    if (!band) return null;
    if (isBuy && band.buy > 0 && price > band.buy) return `Bybit only accepts ${symbol} buy limits at ${band.buy.toFixed(digits)} or lower right now (its price band around the market). To buy above the market, use a Buy Stop.`;
    if (!isBuy && band.sell > 0 && price < band.sell) return `Bybit only accepts ${symbol} sell limits at ${band.sell.toFixed(digits)} or higher right now (its price band around the market). To sell below the market, use a Sell Stop.`;
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
    const [leverage, maintenanceRate] = await Promise.all([this.leverageOf(request.symbol), this.maintenanceRate(request.symbol)]);
    const rate = this.rate(spec.currencyMargin);
    const margin = Math.round(initialMargin(price, volume, spec.contractSize, leverage) * rate * 100) / 100;
    const marginFree = account.marginFree;
    const liquidation = this.marginMode === 'isolated'
      ? isolatedLiquidation(side, price, leverage, maintenanceRate)
      : this.marginMode === 'cross' ? crossLiquidation(side, price, volume, spec.contractSize, marginFree / rate, maintenanceRate) : Number.NaN;
    const isLimit = request.type === 'buyLimit' || request.type === 'sellLimit';
    const outsideBand = isLimit ? await this.bandProblem(request.symbol, definition.isBuy, price, spec.digits) : null;
    const isSuccess = margin <= marginFree && !outsideBand;
    return {
      retcode: outsideBand ? 10015 : isSuccess ? 0 : 10019, isSuccess, margin, equity: account.equity, balance: account.balance,
      comment: outsideBand ?? (isSuccess ? `Margin ${margin.toFixed(2)} USD at ${leverage}x` : `Not enough free margin: the order needs ${margin.toFixed(2)} USD at ${leverage}x and ${marginFree.toFixed(2)} USD is free.`),
      marginFree: Math.round((marginFree - margin) * 100) / 100,
      marginLevel: account.margin + margin > 0 ? account.equity / (account.margin + margin) * 100 : 0,
      hasMarginEstimate: true,
      leverage,
      maintenanceRate,
      ...(Number.isFinite(liquidation) ? { liquidationPrice: Number(liquidation.toFixed(spec.digits)) } : {}),
    };
  }

  private async send(request: TradeRequest): Promise<TradeResult> {
    if (!this.isLoggedIn) throw new Error('Bybit is not connected');
    if (!this.identity?.isTradeAllowed) return failed('This API key is read-only. Allow Contract orders and positions on Bybit to trade.');
    switch (request.action) {
      case 'deal': return request.position ? this.close(request) : this.open(request, false);
      case 'pending': return this.open(request, true);
      case 'sltp': return this.protect(request);
      case 'modify': return this.modify(request);
      case 'remove': return this.cancel(request);
      default: return failed('Close by is not available on Bybit.');
    }
  }

  private positionIdx(symbol: string, isBuy: boolean): number {
    return this.hedgeSymbols.has(symbol) ? (isBuy ? 1 : 2) : 0;
  }

  private findPosition(ticket: number | undefined): RawPosition | undefined {
    const protection = [...this.orders.values()].filter(isProtection);
    return [...this.positions.values()].find((raw) => positionFrom(raw, protection, 8)?.ticket === ticket);
  }

  private findOrder(ticket: number | undefined): RawOrder | undefined {
    return [...this.orders.values()].find((raw) => ticketOf(raw.orderId) === ticket);
  }

  private async open(request: TradeRequest, isPending: boolean): Promise<TradeResult> {
    const definition = orderType(request.type ?? '');
    if (!definition || !request.symbol) return failed('Choose a symbol and order type.');
    if (definition.isPending !== isPending) return failed(isPending ? 'A pending order needs a limit or stop type.' : 'A market order needs the Buy or Sell type.');
    if (request.expiration) return failed('Bybit orders cannot expire. Remove the expiry and cancel the order when you no longer need it.');
    const spec = this.spec(request.symbol);
    const tickSize = spec.tickSize || spec.point;
    const qty = formatQty(request.volume ?? 0, spec.volumeStep);
    if (!(Number(qty) > 0)) return failed('The volume rounds to zero.');
    const price = request.price ?? 0;
    const body: Record<string, unknown> = { category: CATEGORY, symbol: request.symbol, side: definition.isBuy ? 'Buy' : 'Sell', qty, positionIdx: this.positionIdx(request.symbol, definition.isBuy), orderLinkId: `ot5-${randomUUID()}`.slice(0, 36) };
    const direction = definition.isBuy ? 1 : 2;
    switch (request.type) {
      case 'buyLimit': case 'sellLimit': Object.assign(body, { orderType: 'Limit', price: formatPrice(price, tickSize) }); break;
      case 'buyStop': case 'sellStop': Object.assign(body, { orderType: 'Market', triggerPrice: formatPrice(price, tickSize), triggerDirection: direction, triggerBy: 'LastPrice' }); break;
      case 'buyStopLimit': case 'sellStopLimit': Object.assign(body, { orderType: 'Limit', price: formatPrice(request.stoplimit ?? 0, tickSize), triggerPrice: formatPrice(price, tickSize), triggerDirection: direction, triggerBy: 'LastPrice' }); break;
      default: body.orderType = 'Market';
    }
    if (isPending && !(price > 0)) return failed('A pending order needs a price.');
    if (request.type === 'buyStopLimit' || request.type === 'sellStopLimit') {
      if (!((request.stoplimit ?? 0) > 0)) return failed('A stop-limit order needs its limit price.');
    }
    if (request.type === 'buyLimit' || request.type === 'sellLimit') {
      const problem = await this.bandProblem(request.symbol, definition.isBuy, price, spec.digits);
      if (problem) return failed(problem, 10015);
    }
    // Partial mode sizes each order's TP/SL to that order's own fill, so several risk legs on
    // one netted position keep separate targets, each paired with its own share of the stop.
    if ((request.sl ?? 0) > 0 || (request.tp ?? 0) > 0) {
      Object.assign(body, {
        tpslMode: 'Partial',
        ...((request.tp ?? 0) > 0 ? { takeProfit: formatPrice(request.tp!, tickSize), tpOrderType: 'Market' } : {}),
        ...((request.sl ?? 0) > 0 ? { stopLoss: formatPrice(request.sl!, tickSize), slOrderType: 'Market' } : {}),
      });
    }
    return this.submit(body, isPending);
  }

  private async close(request: TradeRequest): Promise<TradeResult> {
    const raw = this.findPosition(request.position);
    if (!raw) return failed('This position is no longer open.');
    const spec = this.spec(raw.symbol);
    const qty = formatQty(Math.min(request.volume ?? num(raw.size), num(raw.size)), spec.volumeStep);
    if (!(Number(qty) > 0)) return failed('The volume rounds to zero.');
    const body = { category: CATEGORY, symbol: raw.symbol, side: raw.side === 'Buy' ? 'Sell' : 'Buy', orderType: 'Market', qty, reduceOnly: true, positionIdx: raw.positionIdx, orderLinkId: `ot5-${randomUUID()}`.slice(0, 36) };
    const result = await this.submit(body, false);
    return result.isSuccess ? { ...result, position: request.position } : result;
  }

  private waitFor(orderLinkId: string, isAcceptance: boolean): Promise<RawOrder | undefined> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(orderLinkId); resolve(undefined); }, this.options.resultTimeout ?? 10_000);
      this.waiters.set(orderLinkId, { timer, isAcceptance, reject, resolve });
    });
  }

  private async lookup(symbol: string, orderLinkId: string): Promise<RawOrder | undefined> {
    for (const openOnly of [0, 1]) {
      const result = await this.api().get<Page<RawOrder>>('/v5/order/realtime', { category: CATEGORY, symbol, orderLinkId, openOnly }, true);
      if (result.list[0]) return result.list[0];
    }
    return undefined;
  }

  private async submit(body: Record<string, unknown>, isAcceptance: boolean): Promise<TradeResult> {
    const orderLinkId = body.orderLinkId as string;
    const symbol = body.symbol as string;
    const waiting = this.waitFor(orderLinkId, isAcceptance);
    void waiting.catch(() => {});
    try { await this.api().post<{ orderId: string }>('/v5/order/create', body); }
    catch (error) {
      const waiter = this.waiters.get(orderLinkId);
      if (waiter) { clearTimeout(waiter.timer); this.waiters.delete(orderLinkId); }
      if (error instanceof BybitApiError) {
        this.journal(`Bybit refused ${describeOrder(body)}: ${error.message}`);
        return failed(error.message, retcodeOf(error.code));
      }
      throw unknownOutcome();
    }
    let order = await waiting;
    if (!order || !finalStatuses.has(order.orderStatus) && !isAcceptance) {
      try { order = await this.lookup(symbol, orderLinkId) ?? order; }
      catch { /* the stream result, if any, still stands */ }
    }
    if (!order) throw unknownOutcome();
    const ticket = ticketOf(order.orderId);
    const filled = num(order.cumExecQty);
    if (order.orderStatus === 'Rejected' || (order.orderStatus === 'Cancelled' || order.orderStatus === 'Deactivated') && !(filled > 0)) {
      return { ...failed(`Bybit ${order.orderStatus.toLowerCase()} the order${order.rejectReason && order.rejectReason !== 'EC_NoError' ? `: ${order.rejectReason}` : ''}.`, 10006), order: ticket };
    }
    if (isAcceptance) return { retcode: 10008, isSuccess: true, comment: 'Placed', order: ticket, volume: num(order.qty), price: num(order.triggerPrice) || num(order.price) };
    const position = await this.positionAfterFill(symbol, order.positionIdx);
    return {
      retcode: filled < num(order.qty) ? 10010 : 10009, isSuccess: true, comment: 'Done', order: ticket, deal: ticket,
      price: num(order.avgPrice), volume: filled, ...(position ? { position } : {}),
    };
  }

  private async positionAfterFill(symbol: string, positionIdx: number): Promise<number | undefined> {
    try {
      const result = await this.api().get<Page<RawPosition>>('/v5/position/list', { category: CATEGORY, symbol }, true);
      for (const raw of result.list) this.storePosition(raw);
    } catch { /* the stream will still deliver the position */ }
    const raw = this.positions.get(`${symbol}|${positionIdx}`);
    this.publishTrade(true);
    return raw ? positionFrom(raw, [], 8)?.ticket : undefined;
  }

  private async protect(request: TradeRequest): Promise<TradeResult> {
    const raw = this.findPosition(request.position);
    if (!raw) return failed('This position is no longer open.');
    const spec = this.spec(raw.symbol);
    const tickSize = spec.tickSize || spec.point;
    const own = [...this.orders.values()].filter((order) => isProtection(order) && order.symbol === raw.symbol && order.positionIdx === raw.positionIdx);
    const current = positionFrom(raw, own, spec.digits)!;
    const stops = own.filter((order) => order.stopOrderType.endsWith('StopLoss'));
    const targets = own.filter((order) => order.stopOrderType.endsWith('TakeProfit'));
    const sl = request.sl ?? current.sl;
    const tp = request.tp ?? current.tp;
    const full: Record<string, string> = {};
    const writes: (() => Promise<unknown>)[] = [];
    const amend = (order: RawOrder, price: number) => () => this.api().post('/v5/order/amend', { category: CATEGORY, symbol: raw.symbol, orderId: order.orderId, triggerPrice: formatPrice(price, tickSize) });
    const cancel = (order: RawOrder) => () => this.api().post('/v5/order/cancel', { category: CATEGORY, symbol: raw.symbol, orderId: order.orderId });
    if (Math.abs(sl - current.sl) > tickSize / 2) {
      if (stops.length && !(num(raw.stopLoss) > 0)) writes.push(...stops.map((order) => sl > 0 ? amend(order, sl) : cancel(order)));
      else full.stopLoss = sl > 0 ? formatPrice(sl, tickSize) : '0';
    }
    if (Math.abs(tp - current.tp) > tickSize / 2) {
      const nearest = targets.find((order) => Math.abs(num(order.triggerPrice) - current.tp) <= tickSize / 2);
      if (targets.length && !(num(raw.takeProfit) > 0)) writes.push(...(tp > 0 ? (nearest ? [amend(nearest, tp)] : []) : targets.map(cancel)));
      else full.takeProfit = tp > 0 ? formatPrice(tp, tickSize) : '0';
    }
    if (Object.keys(full).length) writes.unshift(() => this.api().post('/v5/position/trading-stop', { category: CATEGORY, symbol: raw.symbol, tpslMode: 'Full', positionIdx: raw.positionIdx, ...full }));
    let done = 0;
    try {
      for (const write of writes) { await write(); done++; }
    } catch (error) {
      if (!(error instanceof BybitApiError)) throw unknownOutcome();
      return failed(done ? `${error.message} ${done} of ${writes.length} changes were applied; check the position on Bybit.` : error.message, retcodeOf(error.code));
    }
    return { retcode: 10009, isSuccess: true, comment: writes.length ? 'Done' : 'No change', order: request.position };
  }

  private async modify(request: TradeRequest): Promise<TradeResult> {
    const raw = this.findOrder(request.order);
    if (!raw) return failed('This order is no longer open.');
    const spec = this.spec(raw.symbol);
    const tickSize = spec.tickSize || spec.point;
    const order = orderFrom(raw, spec.digits);
    const body: Record<string, unknown> = { category: CATEGORY, symbol: raw.symbol, orderId: raw.orderId };
    const price = request.price ?? order.priceOpen;
    if (order.type.endsWith('Limit') && !order.type.endsWith('StopLimit')) {
      const problem = Math.abs(price - order.priceOpen) > tickSize / 2 ? await this.bandProblem(raw.symbol, order.type.startsWith('buy'), price, spec.digits) : null;
      if (problem) return failed(problem, 10015);
      body.price = formatPrice(price, tickSize);
    }
    else {
      body.triggerPrice = formatPrice(price, tickSize);
      if (order.type.endsWith('StopLimit') && request.stoplimit) body.price = formatPrice(request.stoplimit, tickSize);
    }
    if (request.tp !== undefined && Math.abs(request.tp - order.tp) > tickSize / 2) body.takeProfit = request.tp > 0 ? formatPrice(request.tp, tickSize) : '0';
    if (request.sl !== undefined && Math.abs(request.sl - order.sl) > tickSize / 2) body.stopLoss = request.sl > 0 ? formatPrice(request.sl, tickSize) : '0';
    if ((body.takeProfit !== undefined || body.stopLoss !== undefined) && !(num(raw.takeProfit) > 0 || num(raw.stopLoss) > 0)) body.tpslMode = 'Partial';
    try { await this.api().post('/v5/order/amend', body); }
    catch (error) {
      if (error instanceof BybitApiError) return failed(error.message, retcodeOf(error.code));
      throw unknownOutcome();
    }
    return { retcode: 10009, isSuccess: true, comment: 'Done', order: request.order };
  }

  private async cancel(request: TradeRequest): Promise<TradeResult> {
    const raw = this.findOrder(request.order);
    if (!raw) return failed('This order is no longer open.');
    try { await this.api().post('/v5/order/cancel', { category: CATEGORY, symbol: raw.symbol, orderId: raw.orderId }); }
    catch (error) {
      if (error instanceof BybitApiError) return failed(error.message, retcodeOf(error.code));
      throw unknownOutcome();
    }
    return { retcode: 10009, isSuccess: true, comment: 'Done', order: request.order };
  }
}
