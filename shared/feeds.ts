// Where a chart's prices come from. Broker symbols are bare names; every other feed's symbols carry
// its prefix (HYPERLIQUID:BTC), so the symbol alone routes a chart and never matches a broker name.
export const feeds = [
  { key: 'broker', label: 'Broker', prefix: '' },
  { key: 'hyperliquid', label: 'Hyperliquid', prefix: 'HYPERLIQUID:' },
] as const;

export type DataFeed = (typeof feeds)[number]['key'];

// A market a data feed lists. `name` is the prefixed symbol charts use.
export interface FeedSymbol {
  readonly digits: number;
  readonly name: string;
  readonly path: string;
  readonly description: string;
}

export interface FeedQuote {
  readonly bid: number;
  readonly ask: number;
  readonly time: number;
  readonly symbol: string;
}

const prefixOf = (feed: DataFeed) => feeds.find((candidate) => candidate.key === feed)!.prefix;

export function feedOf(symbol: string): DataFeed {
  return feeds.find((feed) => feed.prefix && symbol.startsWith(feed.prefix))?.key ?? 'broker';
}

export const isBrokerSymbol = (symbol: string) => feedOf(symbol) === 'broker';

// The feed's own name for the market: BTC for HYPERLIQUID:BTC.
export const feedSymbol = (symbol: string) => symbol.slice(prefixOf(feedOf(symbol)).length);

export const qualifiedSymbol = (feed: DataFeed, name: string) => `${prefixOf(feed)}${name}`;

// Only the broker trades. A data feed's market may not be listed by the broker, and no feed has an
// account here to trade it with.
export const canTradeSymbol = (symbol: string) => isBrokerSymbol(symbol);

export function dataOnlyHint(symbol: string): string {
  return `${feeds.find((feed) => feed.key === feedOf(symbol))!.label} charts are data only, so trading is off`;
}
