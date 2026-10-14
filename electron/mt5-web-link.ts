import { EventEmitter } from 'node:events';
import { randomInt } from 'node:crypto';
import type { Account, Bar, TerminalEvent, TerminalEvents, TerminalMethod, TerminalMethods, CheckResult, LinkState, Order, Position, SymbolSpec, TerminalStatus, Tick, Timeframe, TradeRequest, TradeResult, TradeSnapshot } from '../shared/protocol';
import { adjustDepthPrice, decodeDepth, WebDepthBook } from './mt5-web-depth';
import { Mt5WebClient, type WebCredentials } from './mt5-web-client';
import { WebProtocolError } from './mt5-web-transport';
import { buildSymbolSubscription, type WebTickUpdate } from './mt5-web-market';
import { adjustQuote, parseAccountModel, parseSymbolDetails, type WebAccountModel, type WebSymbolDetails } from './mt5-web-models';
import { aggregateRates, timeframePlan, timeframeStart } from './mt5-web-timeframes';
import { decodeHistory, decodeRates, encodeHistoryRequest, encodeRatesRequest } from './mt5-web-history';
import { applyOrderChange, applyPositionChange, encodeTradeRequest, parseTradeAdmission, parseTradeResponse, parseTradeSnapshot, parseTradeTransactions, TransactionAction } from './mt5-web-trading';
import { conversionCandidates, conversionRate, floatingProfit, moneyPerUnit, type Quote, type Valuation } from '../shared/valuation';

interface PendingTrade {
  readonly timer: NodeJS.Timeout;
  readonly reject: (error: Error) => void;
  readonly resolve: (result: TradeResult) => void;
}

interface ChartSubscription {
  readonly symbol: string;
  readonly timeframe: Timeframe;
}

export class Mt5WebLink extends EventEmitter {
  private build = 0;
  private epoch = 0;
  private backoff = 500;
  private nextId = randomInt(1, 0x7fffffff);
  private isStopped = true;
  private isPolling = false;
  private isLoggedIn = false;
  private pollInterval = 2_000;
  private retry?: NodeJS.Timeout;
  private livePublish?: NodeJS.Timeout;
  private poller?: NodeJS.Timeout;
  private client?: Mt5WebClient;
  private profile?: WebAccountModel;
  private credentials?: WebCredentials;
  private queue: Promise<unknown> = Promise.resolve();
  private positions: Position[] = [];
  private orders: Order[] = [];
  private endpoint = '';
  private readonly depthSymbols = new Set<string>();
  private readonly depthBooks = new Map<string, WebDepthBook>();
  private readonly visible = new Set<string>();
  private readonly watched = new Set<string>();
  private readonly rawTicks = new Map<string, Tick>();
  private readonly charts = new Map<string, ChartSubscription>();
  private readonly lastBars = new Map<string, string>();
  private readonly rateEnds = new Map<string, number>();
  private readonly details = new Map<string, WebSymbolDetails>();
  private readonly summaries = new Map<string, SymbolSpec>();
  private readonly symbolIds = new Map<string, number>();
  private readonly pendingTrades = new Map<number, PendingTrade>();
  private readonly conversions = new Set<string>();
  private readonly pinned = new Set<string>();
  private readonly untrusted = new Set<string>();
  state: LinkState = { url: '', state: 'idle' };

  constructor(private readonly createClient = (endpoint: string) => new Mt5WebClient(endpoint), private readonly retryDelay = 500) {
    super();
  }

  async connect(endpoint: string): Promise<void> {
    this.disconnect();
    this.endpoint = endpoint;
    this.isStopped = false;
    this.backoff = this.retryDelay;
    this.publishState({ url: endpoint, state: 'connecting' });
    await this.open();
  }

  disconnect(): void {
    this.isStopped = true;
    this.epoch++;
    clearTimeout(this.retry);
    clearInterval(this.poller);
    this.client?.removeAllListeners();
    this.client?.close();
    this.client = undefined;
    this.credentials = undefined;
    this.isLoggedIn = false;
    this.profile = undefined;
    this.orders = [];
    this.positions = [];
    this.charts.clear();
    this.depthSymbols.clear();
    this.depthBooks.clear();
    this.watched.clear();
    this.visible.clear();
    this.details.clear();
    this.summaries.clear();
    this.symbolIds.clear();
    this.rawTicks.clear();
    this.lastBars.clear();
    this.rateEnds.clear();
    this.conversions.clear();
    this.pinned.clear();
    this.untrusted.clear();
    clearTimeout(this.livePublish);
    this.failTrades();
    this.publishState({ state: 'closed' });
  }

  get loggedIn(): boolean { return this.isLoggedIn; }

  setPollInterval(milliseconds: number): void {
    this.pollInterval = Math.max(250, Math.min(10_000, milliseconds));
    if (this.poller) this.startPolling();
  }

  request<M extends TerminalMethod>(method: M, params: TerminalMethods[M][0]): Promise<TerminalMethods[M][1]> {
    const epoch = this.epoch;
    const run = this.queue.then(() => {
      if (epoch !== this.epoch || this.isStopped) throw new Error('Connection changed before the request could run');
      return this.route(method, params);
    });
    this.queue = run.catch(() => {});
    return run as Promise<TerminalMethods[M][1]>;
  }

  private publish<E extends TerminalEvent>(event: E, data: TerminalEvents[E]): void { this.emit('event', event, data); }
  private publishState(patch: Partial<LinkState>): void {
    this.state = { ...this.state, ...patch };
    this.publish('link', this.state);
    if (patch.state !== undefined) this.publish('status', this.status());
  }
  private journal(message: string): void { this.publish('journal', { source: 'Network', time: Date.now(), message }); }

  private async open(): Promise<void> {
    const epoch = ++this.epoch;
    const client = this.createClient(this.endpoint);
    this.client = client;
    client.on('fault', (error) => { if (client === this.client) this.lost(error); });
    client.on('tick', (update: WebTickUpdate) => { if (client === this.client) this.tick(update); });
    client.transport.on('latency', (latency: number) => { if (client === this.client) this.publishState({ latency }); });
    client.transport.on('notification', (response) => {
      if (client !== this.client) return;
      if (response.command === 23) {
        try {
          if (response.status) throw new Error('Broker declined market depth');
          for (const update of decodeDepth(response.payload)) {
            const name = [...this.depthSymbols].find((name) => this.symbolIds.get(name) === update.id);
            if (!name) continue;
            const detail = this.details.get(name);
            if (!detail) continue;
            let book = this.depthBooks.get(name);
            if (!book) { book = new WebDepthBook(name, detail.spec.digits); this.depthBooks.set(name, book); }
            const result = book.apply(update, (value, side) => adjustDepthPrice(value, side, detail));
            this.publish('book', result ?? { symbol: name, levels: [], isAvailable: false });
          }
        } catch {
          this.depthBooks.clear();
          for (const symbol of this.depthSymbols) this.publish('book', { symbol, levels: [], isAvailable: false });
          this.journal('Broker market depth is unavailable or requires a fresh snapshot.');
        }
        return;
      }
      if (response.command === 10) {
        try {
          if (response.status) throw new Error('Broker trade transaction returned an error');
          this.applyTransactions(response.payload);
        } catch { this.lost(new Error('Unrecognized broker trade transaction; reconnecting to read positions and orders again')); }
        return;
      }
      if (response.command !== 19) return;
      try {
        if (response.status) throw new Error('Broker trade notification returned an error');
        const final = parseTradeResponse(response.payload);
        const pending = this.pendingTrades.get(final.requestId);
        if (pending && final.isFinal) {
          clearTimeout(pending.timer);
          this.pendingTrades.delete(final.requestId);
          pending.resolve(final.result);
        }
      } catch { this.lost(new Error('Unrecognized broker trade result; reconcile positions and history before repeating an order')); }
    });
    try {
      const session = await client.connect();
      if (this.isStopped || epoch !== this.epoch) { client.close(); return; }
      this.build = session.version;
      if (this.credentials) {
        await client.login(this.credentials);
        if (epoch !== this.epoch) return;
        this.isLoggedIn = true;
        await this.hydrate();
        await this.restoreSubscriptions();
      }
      if (epoch !== this.epoch) return;
      this.backoff = this.retryDelay;
      this.publishState({ state: 'open', error: undefined });
      this.startPolling();
    } catch (error) {
      if (epoch !== this.epoch || this.isStopped) return;
      if (error instanceof WebProtocolError && error.command === 28 && [3, 5, 6, 9, 201].includes(error.status)) {
        this.credentials = undefined;
        this.isLoggedIn = false;
        this.client?.removeAllListeners();
        this.client?.close();
        this.client = undefined;
        this.publishState({ state: 'closed', error: 'Login is required again; authentication was not retried' });
      } else this.lost(error);
      throw error;
    }
  }

  private lost(error: unknown): void {
    if (this.isStopped || !this.client) return;
    this.epoch++;
    this.client.removeAllListeners();
    this.client.close();
    this.client = undefined;
    this.isLoggedIn = false;
    clearInterval(this.poller);
    this.rawTicks.clear();
    this.depthBooks.clear();
    for (const symbol of this.depthSymbols) this.publish('book', { symbol, levels: [], isAvailable: false });
    this.failTrades();
    if (this.credentials?.otp) this.credentials = undefined;
    this.publishState({ state: 'closed', latency: undefined, error: error instanceof Error ? error.message : 'Broker connection lost' });
    this.journal('Connection lost. Outstanding orders are not replayed; broker state will be read again after reconnecting.');
    clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      if (this.isStopped) return;
      this.publishState({ state: 'connecting' });
      void this.open().catch(() => {});
    }, this.backoff);
    this.backoff = Math.min(10_000, this.backoff * 2);
  }

  private failTrades(): void {
    for (const trade of this.pendingTrades.values()) {
      clearTimeout(trade.timer);
      trade.reject(new Error('Order outcome is unknown. Check broker positions and history before submitting it again.'));
    }
    this.pendingTrades.clear();
  }

  private async hydrate(): Promise<void> {
    const client = this.authenticated();
    this.profile = parseAccountModel(await client.transport.request(3), Number(this.credentials!.login));
    const symbols = await client.marketSymbols();
    this.summaries.clear();
    this.symbolIds.clear();
    for (const symbol of symbols) {
      this.symbolIds.set(symbol.name, symbol.id);
      this.summaries.set(symbol.name, {
        name: symbol.name, description: symbol.description, path: symbol.path, digits: symbol.digits,
        point: 10 ** -symbol.digits, visible: this.visible.has(symbol.name), tradeMode: 'Metadata required',
        currencyBase: '', currencyProfit: '', currencyMargin: '', spread: 0, swapLong: 0, swapShort: 0,
        volumeMin: 0, volumeMax: 0, volumeStep: 0, stopsLevel: 0, contractSize: 0, isSpreadFloat: true,
      });
    }
    if (!this.visible.size) {
      for (const name of ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCHF', 'USDCAD', 'XAUUSD']) {
        if (this.summaries.has(name)) this.visible.add(name);
      }
    }
    this.details.clear();
    await this.loadDetails([...this.visible]);
    await this.snapshot(true);
  }

  private authenticated(): Mt5WebClient {
    if (!this.client || !this.isLoggedIn || !this.credentials) throw new Error('Log in to the selected broker endpoint first');
    return this.client;
  }

  private async loadDetails(names: readonly string[]): Promise<void> {
    const missing = [...new Set(names)].filter((name) => !this.details.has(name));
    if (!missing.length) return;
    const client = this.authenticated();
    const ids = missing.map((name) => {
      const id = this.symbolIds.get(name);
      if (id === undefined) throw new Error(`Broker does not provide ${name}`);
      return id;
    });
    const parsed = parseSymbolDetails(await client.transport.request(18, buildSymbolSubscription(ids)), this.profile);
    for (const detail of parsed) this.details.set(detail.spec.name, detail);
    if (missing.some((name) => !this.details.has(name))) throw new Error('Broker did not supply the requested symbol metadata');
  }

  private async restoreSubscriptions(): Promise<void> {
    const names = [...new Set([...this.watched, ...this.visible, ...this.depthSymbols, ...[...this.charts.values()].map((chart) => chart.symbol), ...this.positions.map((position) => position.symbol), ...this.conversions, ...this.pinned])];
    if (!names.length) return;
    await this.loadDetails(names);
    await this.authenticated().subscribe(names);
    if (this.depthSymbols.size) await this.subscribeDepth();
  }

  private async subscribeDepth(): Promise<void> {
    const ids = [...this.depthSymbols].map((name) => this.symbolIds.get(name)!);
    try { await this.authenticated().transport.request(22, buildSymbolSubscription(ids)); }
    catch (error) {
      if (!(error instanceof WebProtocolError)) throw error;
      this.depthBooks.clear();
      for (const symbol of this.depthSymbols) this.publish('book', { symbol, levels: [], isAvailable: false });
      this.journal('Broker declined market depth; quote ladders remain available.');
    }
  }

  private tick(update: WebTickUpdate): void {
    const previous = this.rawTicks.get(update.symbol);
    const raw: Tick = {
      symbol: update.symbol, time: update.timeMs,
      bid: update.bid ?? previous?.bid ?? 0, ask: update.ask ?? previous?.ask ?? 0,
      last: update.last ?? previous?.last ?? 0, volume: update.volume !== undefined ? Number(update.volume) : previous?.volume ?? 0,
    };
    if (!Number.isSafeInteger(raw.volume)) return;
    this.rawTicks.set(update.symbol, raw);
    const details = this.details.get(update.symbol);
    if (!details) return;
    this.publish('tick', { ...raw, ...adjustQuote(raw.bid, raw.ask, details) });
    if (this.positions.length && !this.livePublish) {
      this.livePublish = setTimeout(() => {
        this.livePublish = undefined;
        if (this.isLoggedIn) this.publish('trade', { account: this.account(), orders: this.orders, positions: this.livePositions() });
      }, 250);
    }
  }

  private quote(symbol: string): Quote | undefined {
    const raw = this.rawTicks.get(symbol);
    const details = this.details.get(symbol);
    if (!raw || !details || !raw.bid || !raw.ask) return undefined;
    return adjustQuote(raw.bid, raw.ask, details);
  }

  private valuation(symbol: string): Valuation | null {
    const detail = this.details.get(symbol);
    const account = this.profile?.account;
    if (!detail || !account) return null;
    const conversion = conversionRate(detail.spec.currencyProfit, account.currency, [...this.summaries.keys()], (name) => this.quote(name));
    if (!conversion) return null;
    const perUnit = moneyPerUnit(detail.calcMode, detail.spec.contractSize, conversion.rate);
    if (perUnit === null) return null;
    return { via: conversion.via, rate: conversion.rate, calcMode: detail.calcMode, moneyPerUnit: perUnit, profitCurrency: detail.spec.currencyProfit, accountCurrency: account.currency };
  }

  private async prepareValuation(symbols: readonly string[]): Promise<void> {
    const currency = this.profile?.account.currency;
    if (!currency) return;
    const names = [...this.summaries.keys()];
    const added: string[] = [];
    for (const symbol of new Set(symbols)) {
      const detail = this.details.get(symbol);
      if (!detail) continue;
      for (const candidate of conversionCandidates(detail.spec.currencyProfit, currency, names)) {
        if (!this.conversions.has(candidate)) { this.conversions.add(candidate); added.push(candidate); }
      }
    }
    if (added.length) await this.restoreSubscriptions();
  }

  // Live P/L uses our own valuation between broker snapshots. A symbol whose
  // estimate disagrees with the broker's own position profit is not trusted and
  // keeps showing the last broker value instead.
  private verifyValuation(): void {
    for (const position of this.positions) {
      const valuation = this.valuation(position.symbol);
      if (!valuation || this.untrusted.has(position.symbol) || position.priceCurrent <= 0) continue;
      const estimate = floatingProfit(position.side, position.volume, position.priceOpen, { bid: position.priceCurrent, ask: position.priceCurrent }, valuation.moneyPerUnit);
      const tolerance = Math.max(0.05, Math.abs(position.profit) * (valuation.via.length ? 0.02 : 0.002));
      if (Math.abs(estimate - position.profit) > tolerance) {
        this.untrusted.add(position.symbol);
        this.journal(`Live P/L for ${position.symbol} disagrees with the broker (${estimate.toFixed(2)} vs ${position.profit.toFixed(2)}); showing broker values for it.`);
      }
    }
  }

  private livePositions(): Position[] {
    return this.positions.map((position) => {
      const quote = this.quote(position.symbol);
      const valuation = this.valuation(position.symbol);
      if (!quote || !valuation || this.untrusted.has(position.symbol)) return position;
      return {
        ...position,
        priceCurrent: position.side === 'buy' ? quote.bid : quote.ask,
        profit: Math.round(floatingProfit(position.side, position.volume, position.priceOpen, quote, valuation.moneyPerUnit) * 100) / 100,
      };
    });
  }

  private account(): Account | null {
    if (!this.isLoggedIn || !this.profile) return null;
    const account = this.profile.account;
    if (!this.positions.length && !this.orders.length) return account;
    const positions = this.livePositions();
    const profit = Math.round(positions.reduce((sum, position) => sum + position.profit, 0) * 100) / 100;
    const swap = positions.reduce((sum, position) => sum + position.swap, 0);
    const equity = Math.round((account.balance + account.credit + profit + swap) * 100) / 100;
    return { ...account, profit, equity, isEquityLive: positions.every((position, index) => position !== this.positions[index] || !position.profit), margin: Number.NaN, marginFree: Number.NaN, marginLevel: Number.NaN };
  }

  // Command 4 answers with the state captured at login, so it is read once per session and
  // notification 10 keeps positions and orders current afterwards.
  private async snapshot(isInitial = false): Promise<TradeSnapshot> {
    if (!this.isLoggedIn) return { account: null, orders: [], positions: [] };
    const client = this.authenticated();
    this.profile = parseAccountModel(await client.transport.request(3), Number(this.credentials!.login));
    if (isInitial) {
      const snapshot = parseTradeSnapshot(await client.transport.request(4));
      this.orders = snapshot.orders;
      this.positions = snapshot.positions;
    }
    const symbols = this.positions.map((position) => position.symbol);
    try {
      await this.loadDetails(symbols);
      await this.prepareValuation(symbols);
    } catch { this.journal('Symbol metadata for open positions is unavailable; live P/L uses broker snapshots.'); }
    this.verifyValuation();
    this.publish('status', this.status());
    return { account: this.account(), orders: this.orders, positions: this.livePositions() };
  }

  private applyTransactions(payload: Uint8Array): void {
    for (const transaction of parseTradeTransactions(payload)) {
      if (transaction.kind === 'order') this.orders = applyOrderChange(this.orders, transaction.action, transaction.order);
      if (transaction.kind !== 'deal') continue;
      if (transaction.action === TransactionAction.added && this.profile) {
        this.profile = { ...this.profile, account: { ...this.profile.account, balance: transaction.balance, credit: transaction.credit } };
      }
      for (const position of [transaction.position, ...transaction.positions]) {
        if (position) this.positions = applyPositionChange(this.positions, position);
      }
    }
    this.publish('trade', { account: this.account(), orders: this.orders, positions: this.livePositions() });
  }

  private status(): TerminalStatus {
    return {
      mode: 'mt5-web', name: 'OpenTerm', build: this.build,
      company: this.profile?.account.company, isConnected: this.isLoggedIn,
      isTradeAllowed: this.isLoggedIn && !!this.profile?.account.isTradeAllowed,
      connectionState: this.state.state === 'connecting' ? 'reconnecting' : this.isLoggedIn ? 'connected' : this.state.state === 'open' ? 'login-required' : 'disconnected',
      capabilities: { history: true, trading: this.isLoggedIn && !!this.profile?.account.isTradeAllowed, depth: this.isLoggedIn },
    };
  }

  private async rates(symbol: string, timeframe: Timeframe, count: number): Promise<Bar[]> {
    if (!Number.isSafeInteger(count) || count < 1 || count > 5000) throw new Error('Chart bar count must be between 1 and 5000');
    await this.loadDetails([symbol]);
    const offset = this.profile?.serverOffsetSeconds ?? 0;
    const plan = timeframePlan(timeframe, offset);
    const period = { seconds: plan.seconds };
    const end = Math.floor(Date.now() / 1000) + (this.profile?.serverOffsetSeconds ?? 0);
    const cachedEnd = this.rateEnds.get(`${symbol}:${timeframe}`);
    let span = count <= 2 && cachedEnd !== undefined ? Math.max(period.seconds * 2, end - cachedEnd + period.seconds * 2) : Math.max(period.seconds * count * 3, 7 * 86400);
    let bars: Bar[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const start = plan.isAggregated ? timeframeStart(Math.max(0, end - span), plan.seconds, offset) : end - span;
      const raw = decodeRates(await this.authenticated().transport.request(11, encodeRatesRequest(symbol, plan.source, Math.max(0, start), end)));
      bars = aggregateRates(raw, timeframe, offset);
      if (bars.length >= count || end - span <= 0) break;
      span *= 4;
    }
    const selected = bars.slice(-count);
    if (selected.length) this.rateEnds.set(`${symbol}:${timeframe}`, selected[selected.length - 1].time);
    return selected;
  }

  private startPolling(): void {
    clearInterval(this.poller);
    this.poller = setInterval(() => {
      if (!this.isLoggedIn || this.isPolling) return;
      this.isPolling = true;
      void this.request('trade.snapshot', {}).then((snapshot) => this.publish('trade', snapshot)).then(async () => {
        for (const [key, chart] of this.charts) {
          const bars = await this.request('rates.get', { ...chart, count: 2 });
          const bar = bars[bars.length - 1];
          if (!bar) continue;
          const signature = JSON.stringify(bar);
          if (signature !== this.lastBars.get(key)) {
            this.lastBars.set(key, signature);
            this.publish('bar', { ...chart, bar });
          }
        }
      }).catch((error: unknown) => { if (this.isLoggedIn) this.journal(error instanceof Error ? error.message : 'Refresh failed'); }).finally(() => { this.isPolling = false; });
    }, this.pollInterval);
  }

  private enriched(request: TradeRequest): TradeRequest {
    if (request.action === 'closeBy') {
      const first = this.positions.find((position) => position.ticket === request.position);
      const second = this.positions.find((position) => position.ticket === request.positionBy);
      if (!this.profile?.account.isHedging) throw new Error('Close By requires a hedging account');
      if (this.profile.account.isFifo !== false) throw new Error('Close By requires confirmed non-FIFO account rules');
      if (!first || !second || first.ticket === second.ticket || first.symbol !== second.symbol || first.side === second.side || first.volume <= 0 || second.volume <= 0) throw new Error('Close By requires current opposite positions in the same symbol');
      if (request.symbol && request.symbol !== first.symbol) throw new Error('Close By symbol mismatch');
      return { action: 'closeBy', symbol: first.symbol, position: first.ticket, positionBy: second.ticket, volume: first.volume, type: first.side === 'buy' ? 'sell' : 'buy', price: first.priceCurrent };
    }
    if (request.action === 'modify' || request.action === 'remove') {
      const order = this.orders.find((order) => order.ticket === request.order);
      if (!order) throw new Error('Order is absent from the current broker snapshot');
      return { symbol: order.symbol, type: order.type, volume: order.volumeInitial, price: order.priceOpen, sl: order.sl, tp: order.tp, expiration: order.expiration, stoplimit: order.stoplimit, ...request };
    }
    if (request.position) {
      const position = this.positions.find((position) => position.ticket === request.position);
      if (!position) throw new Error('Position is absent from the current broker snapshot');
      if (request.action === 'deal' && (request.volume ?? 0) > position.volume) throw new Error('Close volume exceeds the open position');
      return { symbol: position.symbol, ...request };
    }
    return request;
  }

  private prepare(request: TradeRequest, requestId: number): Buffer {
    if (!this.profile?.account.isTradeAllowed || !this.isLoggedIn) throw new Error('Account does not permit trading');
    const details = this.details.get(request.symbol ?? '');
    if (!details) throw new Error('Symbol metadata is required before trading');
    const closing = !!request.position || request.action === 'remove' || request.action === 'modify' || request.action === 'sltp';
    if (!details.trade.tradeMode || details.trade.tradeMode > 4 || (!closing && details.trade.tradeMode === 3)) throw new Error('Symbol does not permit this trade');
    if (!closing && details.trade.tradeMode === 1 && request.type?.startsWith('sell')) throw new Error('Symbol is long-only');
    if (!closing && details.trade.tradeMode === 2 && request.type?.startsWith('buy')) throw new Error('Symbol is short-only');
    const raw = this.rawTicks.get(details.spec.name);
    const tick = raw ? { ...raw, ...adjustQuote(raw.bid, raw.ask, details) } : undefined;
    const price = request.price ?? (request.type === 'buy' ? tick?.ask : tick?.bid);
    const order = request.order ? this.orders.find((order) => order.ticket === request.order) : undefined;
    return encodeTradeRequest({ ...request, price }, { ...details.trade, requestId, symbol: details.spec.name, expirationMode: order?.expirationMode, isNegativePriceAllowed: details.allowsNegativePrices });
  }

  private async sendTrade(request: TradeRequest): Promise<TradeResult> {
    request = this.enriched(request);
    await this.loadDetails([request.symbol ?? '']);
    const id = this.nextId++;
    if (this.nextId > 0xffffffff) this.nextId = 1;
    const payload = this.prepare(request, id);
    let outcome: Promise<TradeResult>;
    outcome = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingTrades.delete(id);
        reject(new Error('Order result timed out. Its outcome is unknown; check broker positions and history before repeating it.'));
      }, 30_000);
      this.pendingTrades.set(id, { timer, reject, resolve });
    });
    void outcome.catch(() => {});
    try {
      const code = parseTradeAdmission(await this.authenticated().transport.request(12, payload));
      if (code !== 0) {
        const pending = this.pendingTrades.get(id);
        if (pending) { clearTimeout(pending.timer); this.pendingTrades.delete(id); pending.resolve({ retcode: code, isSuccess: false, comment: `Broker declined the request (${code})` }); }
      }
      const result = await outcome;
      try { this.publish('trade', await this.snapshot()); }
      catch { this.journal('Trade result received; broker snapshot refresh is pending.'); }
      return result;
    } catch (error) {
      const pending = this.pendingTrades.get(id);
      if (pending) { clearTimeout(pending.timer); this.pendingTrades.delete(id); pending.reject(error instanceof Error ? error : new Error('Order outcome is unknown')); }
      if (!(error instanceof WebProtocolError)) throw new Error('Order outcome is unknown. Reconcile broker positions and history before submitting it again.');
      throw error;
    }
  }

  private async route(method: TerminalMethod, values: unknown): Promise<unknown> {
    const params = values as Record<string, any>;
    switch (method) {
      case 'terminal.status': return this.status();
      case 'account.info': return this.account();
      case 'account.login': {
        if (!Number.isSafeInteger(params.login) || params.login < 1 || typeof params.password !== 'string') throw new Error('Invalid account login');
        const credentials: WebCredentials = { login: BigInt(params.login), password: params.password, ...(params.otp ? { otp: String(params.otp) } : {}) };
        const endpoint = this.endpoint;
        this.disconnect();
        this.endpoint = endpoint;
        this.isStopped = false;
        this.credentials = credentials;
        await this.open();
        if (!this.account()) throw new Error('Login did not establish an account');
        this.publish('trade', { account: this.account(), orders: this.orders, positions: this.positions });
        return this.account();
      }
      case 'symbols.list': return [...this.summaries].map(([name, summary]) => ({ ...(this.details.get(name)?.spec ?? summary), visible: this.visible.has(name) }));
      case 'symbols.info': {
        await this.loadDetails([params.symbol]);
        return this.details.get(params.symbol)!.spec;
      }
      case 'symbols.select': {
        await this.loadDetails([params.symbol]);
        params.isEnabled ? this.visible.add(params.symbol) : this.visible.delete(params.symbol);
        this.publish('symbols', [{ ...this.details.get(params.symbol)!.spec, visible: this.visible.has(params.symbol) }]);
        return true;
      }
      case 'ticks.subscribe': {
        if (!Array.isArray(params.symbols) || params.symbols.some((symbol: unknown) => typeof symbol !== 'string') || params.symbols.length > 256) throw new Error('Invalid quote subscription');
        this.watched.clear();
        for (const symbol of params.symbols) this.watched.add(symbol);
        if (this.isLoggedIn) await this.restoreSubscriptions();
        return params.symbols.map((symbol: string) => {
          const tick = this.rawTicks.get(symbol);
          const details = this.details.get(symbol);
          return tick && details ? { ...tick, ...adjustQuote(tick.bid, tick.ask, details) } : null;
        });
      }
      case 'rates.get': return this.rates(params.symbol, params.timeframe, params.count);
      case 'rates.subscribe': this.charts.set(`${params.symbol}:${params.timeframe}`, { symbol: params.symbol, timeframe: params.timeframe }); if (this.isLoggedIn) await this.restoreSubscriptions(); return true;
      case 'rates.unsubscribe': this.charts.delete(`${params.symbol}:${params.timeframe}`); return true;
      case 'trade.snapshot': return this.snapshot();
      case 'history.get': return decodeHistory(await this.authenticated().transport.request(5, encodeHistoryRequest(Math.max(0, params.from), params.to)));
      case 'order.check': {
        const request = this.enriched(params as TradeRequest);
        await this.loadDetails([request.symbol ?? '']);
        this.prepare(request, 1);
        const account = this.account()!;
        const result: CheckResult = { retcode: 0, isSuccess: true, hasMarginEstimate: false, comment: 'Order fields validated locally. Margin and execution conditions are checked by the broker on submission.', balance: account.balance, equity: account.equity, margin: Number.NaN, marginFree: Number.NaN, marginLevel: Number.NaN };
        return result;
      }
      case 'order.send': return this.sendTrade(params as TradeRequest);
      case 'symbols.quote': {
        if (!this.pinned.has(params.symbol)) {
          await this.loadDetails([params.symbol]);
          this.pinned.add(params.symbol);
          await this.restoreSubscriptions();
        }
        for (let waited = 0; !this.quote(params.symbol) && waited < 3_000; waited += 100) await new Promise((resolve) => setTimeout(resolve, 100));
        const quote = this.quote(params.symbol);
        if (!quote) throw new Error(`No live quote for ${params.symbol}; the market may be closed`);
        return { symbol: params.symbol, ...quote, time: this.rawTicks.get(params.symbol)!.time };
      }
      case 'symbols.valuation': {
        await this.loadDetails([params.symbol]);
        await this.prepareValuation([params.symbol]);
        const valuation = this.valuation(params.symbol);
        if (!valuation) throw new Error(`No live conversion from ${this.details.get(params.symbol)?.spec.currencyProfit || 'the profit currency'} to the account currency, or ${params.symbol} uses a calculation mode that needs a broker tick value`);
        return valuation;
      }
      case 'book.subscribe': {
        await this.loadDetails([params.symbol]);
        this.depthSymbols.add(params.symbol);
        await this.subscribeDepth();
        return { symbol: params.symbol, levels: [] };
      }
      case 'book.unsubscribe': {
        this.depthSymbols.delete(params.symbol);
        this.depthBooks.delete(params.symbol);
        if (this.isLoggedIn) await this.subscribeDepth();
        return true;
      }
      default: throw new Error('Unsupported direct broker operation');
    }
  }
}
