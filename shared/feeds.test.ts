import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canTradeSymbol, dataOnlyHint, feedOf, feedSymbol, isBrokerSymbol, qualifiedSymbol } from './feeds';

test('the prefix names the feed; bare names are the broker', () => {
  assert.equal(feedOf('EURUSD'), 'broker');
  assert.equal(feedOf('OANDA:EURUSD'), 'broker');
  assert.equal(feedOf('HYPERLIQUID:BTC'), 'hyperliquid');
  assert.equal(isBrokerSymbol('BTCUSDT'), true);
  assert.equal(isBrokerSymbol('HYPERLIQUID:HYPE/USDC'), false);
});

test('qualified and feed names round-trip', () => {
  assert.equal(qualifiedSymbol('hyperliquid', 'BTC'), 'HYPERLIQUID:BTC');
  assert.equal(qualifiedSymbol('broker', 'EURUSD'), 'EURUSD');
  assert.equal(feedSymbol('HYPERLIQUID:HYPE/USDC'), 'HYPE/USDC');
  assert.equal(feedSymbol('EURUSD.m'), 'EURUSD.m');
});

test('only broker symbols trade', () => {
  assert.equal(canTradeSymbol('EURUSD.m'), true);
  assert.equal(canTradeSymbol('HYPERLIQUID:BTC'), false);
  assert.equal(dataOnlyHint('HYPERLIQUID:BTC'), 'Hyperliquid charts are data only, so trading is off');
});
