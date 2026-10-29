import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import type { RawCandle, RawPerpMeta, RawSpotMeta } from './hyperliquid-models';
import type { HyperliquidInfo } from './hyperliquid-rest';
import type { HyperliquidStream, Subscription } from './hyperliquid-stream';
import { HyperliquidFeed } from './hyperliquid-feed';

const intervals: Record<string, number> = { '1m': 60_000, '2h': 7_200_000 };

const perps: RawPerpMeta = { universe: [{ name: 'BTC', szDecimals: 5 }] };
const spot: RawSpotMeta = {
  tokens: [{ index: 0, name: 'USDC', szDecimals: 8 }, { index: 150, name: 'HYPE', szDecimals: 2 }],
  universe: [{ index: 107, name: '@107', tokens: [150, 0] }],
};

// Serves one candle per interval across the asked range, at most `pageSize` per answer; each
// candle's high is its position in time so aggregation is visible.
class FakeInfo {
  calls: [string, string, number, number][] = [];
  constructor(private readonly pageSize = 5000) {}
  async perpMeta() { return perps; }
  async spotMeta() { return spot; }
  async candles(coin: string, interval: string, startTime: number, endTime: number): Promise<RawCandle[]> {
    this.calls.push([coin, interval, startTime, endTime]);
    const step = intervals[interval];
    const candles: RawCandle[] = [];
    for (let t = Math.ceil(startTime / step) * step; t <= endTime && candles.length < this.pageSize; t += step) {
      const index = String(t / step);
      candles.push({ t, o: index, h: index, l: index, c: index, v: '1', s: coin, i: interval });
    }
    return candles;
  }
}

class FakeStream extends EventEmitter {
  synced: Subscription[][] = [];
  isStarted = false;
  sync(wanted: Subscription[]) { this.synced.push(wanted); }
  start() { this.isStarted = true; }
  stop() { this.isStarted = false; }
}

function feedWith(info = new FakeInfo()) {
  const stream = new FakeStream();
  const feed = new HyperliquidFeed(info as unknown as HyperliquidInfo, stream as unknown as HyperliquidStream);
  const events: [string, unknown][] = [];
  feed.on('event', (event: string, data: unknown) => events.push([event, data]));
  return { feed, info, stream, events };
}

test('the market list names perpetuals and spot pairs with the feed prefix', async () => {
  const { feed } = feedWith();
  assert.deepEqual((await feed.symbols()).map((symbol) => symbol.name), ['HYPERLIQUID:BTC', 'HYPERLIQUID:HYPE/USDC']);
});

test('history asks for the bars before `to` under the wire name of the market, reading a range again until it is covered', async () => {
  const to = 1_700_000_400;
  const { feed, info } = feedWith(new FakeInfo(2));
  const bars = await feed.bars({ symbol: 'HYPERLIQUID:HYPE/USDC', timeframe: 'M1', count: 3, to });
  assert.deepEqual(bars.map((bar) => bar.time), [to - 180, to - 120, to - 60]);
  assert.deepEqual(info.calls, [
    ['@107', '1m', (to - 240) * 1000, to * 1000 - 1],
    ['@107', '1m', (to - 120) * 1000, to * 1000 - 1],
  ]);
});

test('a timeframe Hyperliquid lacks is built from a smaller native one', async () => {
  const to = 1_699_984_800;
  const { feed } = feedWith();
  const bars = await feed.bars({ symbol: 'HYPERLIQUID:BTC', timeframe: 'H6', count: 2, to });
  const first = (to - 43_200) / 7200;
  assert.deepEqual(bars, [
    { time: to - 43_200, open: first, high: first + 2, low: first, close: first + 2, volume: 3 },
    { time: to - 21_600, open: first + 3, high: first + 5, low: first + 3, close: first + 5, volume: 3 },
  ]);
});

test('symbols that are not Hyperliquid markets are refused', async () => {
  const { feed } = feedWith();
  await assert.rejects(feed.bars({ symbol: 'BTCUSD', timeframe: 'M1', count: 1 }), /not a Hyperliquid symbol/);
  await assert.rejects(feed.bars({ symbol: 'HYPERLIQUID:NOPE', timeframe: 'M1', count: 1 }), /no NOPE market/);
});

test('live charts share one candle and quote subscription and publish bars and throttled quotes', async () => {
  const { feed, stream, events } = feedWith();
  await feed.subscribe({ symbol: 'HYPERLIQUID:BTC', timeframe: 'M1' });
  await feed.subscribe({ symbol: 'HYPERLIQUID:BTC', timeframe: 'M1' });
  assert.equal(stream.isStarted, true);
  assert.deepEqual(stream.synced, [[{ coin: 'BTC', type: 'candle', interval: '1m' }, { coin: 'BTC', type: 'bbo' }]]);

  stream.emit('data', { channel: 'candle', data: { t: 1_700_000_040_000, o: '1', h: '3', l: '1', c: '2', v: '5', s: 'BTC', i: '1m' } });
  assert.deepEqual(events, [['feedBar', { symbol: 'HYPERLIQUID:BTC', timeframe: 'M1', bar: { time: 1_700_000_040, open: 1, high: 3, low: 1, close: 2, volume: 5 } }]]);

  for (const ask of ['101', '102']) stream.emit('data', { channel: 'bbo', data: { coin: 'BTC', time: 1, bbo: [{ px: '100' }, { px: ask }] } });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(events.slice(1), [['feedQuote', { bid: 100, ask: 102, time: 1, symbol: 'HYPERLIQUID:BTC' }]]);

  feed.unsubscribe({ symbol: 'HYPERLIQUID:BTC', timeframe: 'M1' });
  assert.equal(stream.synced.length, 1);
  feed.unsubscribe({ symbol: 'HYPERLIQUID:BTC', timeframe: 'M1' });
  assert.deepEqual(stream.synced.at(-1), []);
  feed.stop();
});
