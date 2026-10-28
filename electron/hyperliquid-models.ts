import { qualifiedSymbol, type FeedSymbol } from '../shared/feeds';
import type { Bar, Timeframe } from '../shared/protocol';
import { klineBar, planKlines, type KlinePlan } from './exchange-common';

export interface RawPerpAsset {
  isDelisted?: boolean;
  szDecimals: number;
  name: string;
}

export interface RawPerpMeta {
  universe: RawPerpAsset[];
}

export interface RawSpotToken {
  index: number;
  szDecimals: number;
  name: string;
}

export interface RawSpotPair {
  index: number;
  name: string;
  tokens: [number, number];
}

export interface RawSpotMeta {
  tokens: RawSpotToken[];
  universe: RawSpotPair[];
}

export interface RawCandle {
  t: number;
  c: string;
  h: string;
  i: string;
  l: string;
  o: string;
  s: string;
  v: string;
}

export interface RawBbo {
  time: number;
  coin: string;
  bbo: [{ px: string } | null, { px: string } | null];
}

// `coin` is Hyperliquid's own id for the market: BTC for a perpetual, @107 for most spot pairs.
export interface HyperliquidMarket {
  coin: string;
  symbol: FeedSymbol;
}

// Hyperliquid prices carry at most 6 (perpetuals) or 8 (spot) decimals less the size decimals.
const PERP_DECIMALS = 6;
const SPOT_DECIMALS = 8;

export function perpMarkets(meta: RawPerpMeta): HyperliquidMarket[] {
  return meta.universe.filter((asset) => !asset.isDelisted).map((asset) => ({
    coin: asset.name,
    symbol: {
      digits: Math.max(0, PERP_DECIMALS - asset.szDecimals),
      name: qualifiedSymbol('hyperliquid', asset.name),
      path: `Hyperliquid\\Perpetuals\\${asset.name}`,
      description: `${asset.name}-USD perpetual, Hyperliquid`,
    },
  }));
}

// Spot pairs are named @<index> on the wire (PURR/USDC is the one exception); charts show the
// tokens' names instead.
export function spotMarkets(meta: RawSpotMeta): HyperliquidMarket[] {
  const tokens = new Map(meta.tokens.map((token) => [token.index, token]));
  return meta.universe.flatMap((pair) => {
    const base = tokens.get(pair.tokens[0]);
    const quote = tokens.get(pair.tokens[1]);
    if (!base || !quote) return [];
    const name = `${base.name}/${quote.name}`;
    return [{
      coin: pair.name,
      symbol: {
        digits: Math.max(0, SPOT_DECIMALS - base.szDecimals),
        name: qualifiedSymbol('hyperliquid', name),
        path: `Hyperliquid\\Spot\\${name}`,
        description: `${name} spot, Hyperliquid`,
      },
    }];
  });
}

export const candleBar = (candle: RawCandle): Bar => klineBar([String(candle.t), candle.o, candle.h, candle.l, candle.c, candle.v]);

export const candleIntervals: Partial<Record<Timeframe, string>> = {
  M1: '1m', M3: '3m', M5: '5m', M15: '15m', M30: '30m', H1: '1h', H2: '2h', H4: '4h', H8: '8h', H12: '12h', D1: '1d', W1: '1w', MN1: '1M',
};

export const candlePlan = (timeframe: Timeframe): KlinePlan => planKlines(timeframe, candleIntervals, 'Hyperliquid');
