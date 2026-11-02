import assert from 'node:assert/strict';
import { test } from 'node:test';
import { candleBar, candlePlan, perpMarkets, spotMarkets } from './hyperliquid-models';

test('perpetuals keep listed markets with price decimals from their size decimals', () => {
  const markets = perpMarkets({ universe: [{ name: 'BTC', szDecimals: 5 }, { name: 'FTT', szDecimals: 1, isDelisted: true }, { name: 'kPEPE', szDecimals: 0 }] });
  assert.deepEqual(markets.map((market) => [market.coin, market.symbol.name, market.symbol.digits]), [['BTC', 'HYPERLIQUID:BTC', 1], ['kPEPE', 'HYPERLIQUID:kPEPE', 6]]);
  assert.equal(markets[0].symbol.path, 'Hyperliquid\\Perpetuals\\BTC');
  assert.match(markets[0].symbol.description, /perpetual, Hyperliquid$/);
});

test('spot pairs are named by their tokens and keep the wire name as the coin', () => {
  const markets = spotMarkets({
    tokens: [{ index: 0, name: 'USDC', szDecimals: 8 }, { index: 1, name: 'PURR', szDecimals: 0 }, { index: 150, name: 'HYPE', szDecimals: 2 }],
    universe: [{ index: 0, name: 'PURR/USDC', tokens: [1, 0] }, { index: 107, name: '@107', tokens: [150, 0] }, { index: 200, name: '@200', tokens: [999, 0] }],
  });
  assert.deepEqual(markets.map((market) => [market.coin, market.symbol.name, market.symbol.digits]), [['PURR/USDC', 'HYPERLIQUID:PURR/USDC', 8], ['@107', 'HYPERLIQUID:HYPE/USDC', 6]]);
  assert.equal(markets[1].symbol.description, 'HYPE/USDC spot, Hyperliquid');
});

test('candles become bars in seconds, and missing timeframes build from a native one', () => {
  assert.deepEqual(candleBar({ t: 1_700_000_040_000, o: '1.5', h: '2', l: '1', c: '1.75', v: '10.5', s: 'BTC', i: '1m' }), { time: 1_700_000_040, open: 1.5, high: 2, low: 1, close: 1.75, volume: 10.5 });
  assert.deepEqual(candlePlan('H4'), { interval: '4h', seconds: 14400, sourceSeconds: 14400, isAggregated: false });
  assert.equal(candlePlan('MN1').interval, '1M');
  assert.deepEqual(candlePlan('H6'), { interval: '2h', seconds: 21600, sourceSeconds: 7200, isAggregated: true });
  assert.deepEqual(candlePlan('M12'), { interval: '3m', seconds: 720, sourceSeconds: 180, isAggregated: true });
});
