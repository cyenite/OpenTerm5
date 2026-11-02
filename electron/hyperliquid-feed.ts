import { EventEmitter } from 'node:events';
import { feedOf, feedSymbol, type FeedQuote, type FeedSymbol } from '../shared/feeds';
import type { Bar, TerminalEvents, TerminalMethods, Timeframe } from '../shared/protocol';
import { aggregateBars, num, type KlinePlan } from './exchange-common';
import { HyperliquidInfo } from './hyperliquid-rest';
import { HyperliquidStream, type StreamMessage, type Subscription } from './hyperliquid-stream';
import { candleBar, candlePlan, perpMarkets, spotMarkets, type HyperliquidMarket, type RawBbo, type RawCandle } from './hyperliquid-models';

const MAX_BARS = 5000;
const MAX_PAGES = 20;
const QUOTE_INTERVAL = 250;
const LISTING_LIFETIME = 5 * 60_000;
// A chart switching symbol unsubscribes and resubscribes at once; the socket outlives that.
const IDLE_CLOSE = 30_000;

interface ChartFeed {
  viewers: number;
  coin: string;
  symbol: string;
  isSeeded: boolean;
  plan: KlinePlan;
  timeframe: Timeframe;
  sources: Map<number, Bar>;
}

type FeedEvent = 'feedBar' | 'feedQuote';

// Hyperliquid's public market data for charts: the market list, candle history and live candles
// and best bid/ask. It needs no account and is independent of the trading link, so it works while
// logged out or signed in to any broker. Events go out as 'event' (name, data).
export class HyperliquidFeed extends EventEmitter {
  private loadedAt = 0;
  private idleTimer?: NodeJS.Timeout;
  private quoteTimer?: NodeJS.Timeout;
  private markets?: Map<string, HyperliquidMarket>;
  private loading?: Promise<Map<string, HyperliquidMarket>>;
  private readonly charts = new Map<string, ChartFeed>();
  private readonly quotes = new Map<string, FeedQuote>();

  constructor(
    private readonly info = new HyperliquidInfo(),
    private readonly stream = new HyperliquidStream(),
  ) {
    super();
    stream.on('data', (message: StreamMessage) => this.onData(message));
    stream.on('journal', (message: string) => this.emit('journal', message));
  }

  async symbols(): Promise<FeedSymbol[]> {
    return [...(await this.listing()).values()].map((market) => market.symbol);
  }

  async bars({ symbol, timeframe, count, to }: TerminalMethods['feeds.bars'][0]): Promise<Bar[]> {
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_BARS) throw new Error(`Chart bar count must be between 1 and ${MAX_BARS}`);
    const { coin } = await this.market(symbol);
    const plan = candlePlan(timeframe);
    const end = Math.min(to ?? Infinity, Math.floor(Date.now() / 1000) + plan.seconds);
    // One bar more than asked, so an aggregated first bar is never built from part of its candles.
    const start = (Math.floor(end / plan.seconds) - count - 1) * plan.seconds;
    const sources = await this.candles(coin, plan, start * 1000, end * 1000 - 1);
    const bars = (plan.isAggregated ? aggregateBars(sources, plan.seconds) : sources).filter((bar) => bar.time < end).slice(-count);
    const feed = this.charts.get(`${symbol}:${timeframe}`);
    if (feed && plan.isAggregated && to === undefined) {
      const last = bars.at(-1);
      for (const source of sources) if (last && source.time >= last.time) feed.sources.set(source.time, source);
      feed.isSeeded = true;
    }
    return bars;
  }

  async subscribe({ symbol, timeframe }: TerminalMethods['feeds.subscribe'][0]): Promise<boolean> {
    const { coin } = await this.market(symbol);
    const key = `${symbol}:${timeframe}`;
    const existing = this.charts.get(key);
    if (existing) {
      existing.viewers++;
      return true;
    }
    const plan = candlePlan(timeframe);
    const feed: ChartFeed = { viewers: 1, coin, symbol, isSeeded: !plan.isAggregated, plan, timeframe, sources: new Map() };
    this.charts.set(key, feed);
    if (plan.isAggregated) void this.seed(feed).catch((error: Error) => this.emit('journal', `Chart ${feedSymbol(symbol)},${timeframe} could not load its current bar: ${error.message}`));
    this.resubscribe();
    return true;
  }

  unsubscribe({ symbol, timeframe }: TerminalMethods['feeds.unsubscribe'][0]): boolean {
    const key = `${symbol}:${timeframe}`;
    const feed = this.charts.get(key);
    if (feed && feed.viewers > 1) feed.viewers--;
    else if (feed) {
      this.charts.delete(key);
      this.resubscribe();
    }
    return true;
  }

  stop(): void {
    clearTimeout(this.idleTimer);
    clearTimeout(this.quoteTimer);
    this.charts.clear();
    this.stream.stop();
  }

  private publish<E extends FeedEvent>(event: E, data: TerminalEvents[E]): void { this.emit('event', event, data); }

  // The market list changes rarely; a failed refresh keeps the last one.
  private listing(): Promise<Map<string, HyperliquidMarket>> {
    if (this.markets && Date.now() - this.loadedAt < LISTING_LIFETIME) return Promise.resolve(this.markets);
    this.loading ??= Promise.all([this.info.perpMeta(), this.info.spotMeta()])
      .then(([perps, spot]) => {
        const markets = new Map<string, HyperliquidMarket>();
        for (const market of [...perpMarkets(perps), ...spotMarkets(spot)]) if (!markets.has(market.symbol.name)) markets.set(market.symbol.name, market);
        this.markets = markets;
        this.loadedAt = Date.now();
        return markets;
      })
      .catch((error: Error) => {
        if (this.markets) return this.markets;
        throw new Error(`Hyperliquid markets could not be loaded: ${error.message}`);
      })
      .finally(() => { this.loading = undefined; });
    return this.loading;
  }

  private async market(symbol: string): Promise<HyperliquidMarket> {
    if (feedOf(symbol) !== 'hyperliquid') throw new Error(`${symbol} is not a Hyperliquid symbol`);
    const market = (await this.listing()).get(symbol);
    if (!market) throw new Error(`Hyperliquid has no ${feedSymbol(symbol)} market`);
    return market;
  }

  // The answer's size limit is not documented; a range is read again from its last candle until
  // it is covered.
  private async candles(coin: string, plan: KlinePlan, startTime: number, endTime: number): Promise<Bar[]> {
    const step = plan.sourceSeconds * 1000;
    const rows = new Map<number, Bar>();
    let from = startTime;
    for (let page = 0; page < MAX_PAGES && from <= endTime; page++) {
      const candles = await this.info.candles(coin, plan.interval, from, endTime);
      for (const candle of candles) rows.set(candle.t, candleBar(candle));
      const last = candles.at(-1)?.t;
      if (last === undefined || last < from || last + step > endTime) break;
      from = last + step;
    }
    return [...rows.values()].sort((left, right) => left.time - right.time);
  }

  private async seed(feed: ChartFeed): Promise<void> {
    const bucket = Math.floor(Date.now() / 1000 / feed.plan.seconds) * feed.plan.seconds;
    const sources = await this.candles(feed.coin, feed.plan, bucket * 1000, Date.now());
    for (const source of sources) if (source.time >= bucket && !feed.sources.has(source.time)) feed.sources.set(source.time, source);
    feed.isSeeded = true;
  }

  private resubscribe(): void {
    const wanted = [...this.charts.values()].flatMap((feed): Subscription[] => [
      { coin: feed.coin, type: 'candle', interval: feed.plan.interval },
      { coin: feed.coin, type: 'bbo' },
    ]);
    this.stream.sync(wanted);
    clearTimeout(this.idleTimer);
    if (wanted.length) this.stream.start();
    else this.idleTimer = setTimeout(() => this.stream.stop(), IDLE_CLOSE);
  }

  private onData(message: StreamMessage): void {
    if (message.channel === 'candle') {
      // Candles arrive one at a time, and only when the market trades.
      const candles = (Array.isArray(message.data) ? message.data : [message.data]) as RawCandle[];
      for (const candle of candles) {
        const bar = candleBar(candle);
        for (const feed of this.charts.values()) {
          if (feed.coin !== candle.s || feed.plan.interval !== candle.i) continue;
          if (!feed.plan.isAggregated) this.publish('feedBar', { symbol: feed.symbol, timeframe: feed.timeframe, bar });
          else this.addSource(feed, bar);
        }
      }
    } else if (message.channel === 'bbo') {
      const { coin, time, bbo: [bid, ask] } = message.data as RawBbo;
      const symbols = new Set([...this.charts.values()].filter((feed) => feed.coin === coin).map((feed) => feed.symbol));
      for (const symbol of symbols) this.quotes.set(symbol, { bid: num(bid?.px), ask: num(ask?.px), time, symbol });
      // Busy books change every block; charts only need the ask line a few times a second.
      this.quoteTimer ??= setTimeout(() => {
        this.quoteTimer = undefined;
        for (const quote of this.quotes.values()) this.publish('feedQuote', quote);
        this.quotes.clear();
      }, QUOTE_INTERVAL);
    }
  }

  private addSource(feed: ChartFeed, bar: Bar): void {
    const bucket = Math.floor(bar.time / feed.plan.seconds) * feed.plan.seconds;
    for (const time of feed.sources.keys()) if (time < bucket) feed.sources.delete(time);
    feed.sources.set(bar.time, bar);
    if (!feed.isSeeded) return;
    const [current] = aggregateBars([...feed.sources.values()], feed.plan.seconds).slice(-1);
    if (current) this.publish('feedBar', { symbol: feed.symbol, timeframe: feed.timeframe, bar: current });
  }
}
