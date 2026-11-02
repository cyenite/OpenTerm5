import type { FeedQuote, FeedSymbol } from '../../shared/feeds';
import type { SymbolSpec } from '../../shared/protocol';
import { log, terminal } from './session';
import { Store } from './store';

// Markets and quotes of the data feeds other than the broker. Kept apart from the session's
// symbols and ticks, which the trading panels read: a feed's quote must never make one tradable.
export interface FeedState {
  symbols: Readonly<Record<string, FeedSymbol>>;
  quotes: Readonly<Record<string, FeedQuote>>;
}

export const feedSymbols = new Store<FeedState>({ symbols: {}, quotes: {} });

let loading: Promise<void> | null = null;

export function loadFeedSymbols(): Promise<void> {
  loading ??= terminal.request('feeds.symbols', {})
    .then((symbols) => feedSymbols.set({ symbols: Object.fromEntries(symbols.map((symbol) => [symbol.name, symbol])) }))
    .catch((error: Error) => {
      // A later chart or search tries again.
      loading = null;
      log(error.message, 'Hyperliquid');
    });
  return loading;
}

const merged = new WeakMap<object, WeakMap<object, Record<string, SymbolSpec | FeedSymbol>>>();

// The broker's symbols and the data feeds' markets, for a chart's symbol search. The same pair of
// lists gives the same record, which keeps the search index (cached per record) across renders.
export function chartSymbols(broker: Readonly<Record<string, SymbolSpec>>, feeds: Readonly<Record<string, FeedSymbol>>): Readonly<Record<string, SymbolSpec | FeedSymbol>> {
  const byFeeds = merged.get(broker) ?? new WeakMap<object, Record<string, SymbolSpec | FeedSymbol>>();
  merged.set(broker, byFeeds);
  let found = byFeeds.get(feeds);
  if (!found) {
    found = { ...feeds, ...broker };
    byFeeds.set(feeds, found);
  }
  return found;
}

export function startFeedQuotes(): void {
  terminal.on('feedQuote', (quote) => feedSymbols.set((state) => ({ quotes: { ...state.quotes, [quote.symbol]: quote } })));
}
