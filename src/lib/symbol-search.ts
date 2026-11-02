import { feedSymbol, isBrokerSymbol } from '../../shared/feeds';
import { instrumentKey, symbolCore } from '../../shared/symbol-match';

// What search reads of a symbol: the broker's specifications and the data feeds' markets both have it.
export interface SearchableSymbol {
  readonly name: string;
  readonly path: string;
  readonly description: string;
}

type SymbolList<T extends SearchableSymbol> = Readonly<Record<string, T>>;

interface IndexedSymbol {
  readonly isFeed: boolean;
  readonly spec: SearchableSymbol;
  readonly core: string;
  readonly upper: string;
  readonly compact: string;
  readonly category: string;
  readonly haystack: string;
  readonly instrument: string;
  readonly words: readonly string[];
}

export interface SearchOptions {
  readonly limit?: number;
  readonly category?: string | null;
}

const indexes = new WeakMap<SymbolList<SearchableSymbol>, IndexedSymbol[]>();
const categoryLists = new WeakMap<SymbolList<SearchableSymbol>, string[]>();

// Ranks up to here match the name itself; higher ones only its middle or description.
const NAME_RANK = 4;

const compactOf = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '');

// The broker's path names the symbol last (Forex\Majors\EURUSD); its first folder is the market.
export function symbolCategory(path: string): string {
  const folders = path.split(/[\\/]/).filter(Boolean);
  return folders.length > 1 ? folders[0] : 'Other';
}

// A data feed's market is matched by its own name (BTC for HYPERLIQUID:BTC).
function indexOf(symbols: SymbolList<SearchableSymbol>): IndexedSymbol[] {
  let found = indexes.get(symbols);
  if (found) return found;
  found = Object.values(symbols).map((spec) => {
    const name = feedSymbol(spec.name);
    const description = spec.description.toLowerCase();
    return {
      isFeed: !isBrokerSymbol(spec.name),
      spec,
      core: symbolCore(name),
      upper: name.toUpperCase(),
      compact: compactOf(name),
      category: symbolCategory(spec.path),
      haystack: `${name} ${description} ${spec.path}`.toLowerCase(),
      instrument: instrumentKey(name),
      words: description.split(/[^a-z0-9]+/).filter(Boolean),
    };
  });
  indexes.set(symbols, found);
  return found;
}

// The broker's markets by size, then the data feeds'.
export function symbolCategories(symbols: SymbolList<SearchableSymbol>): string[] {
  let found = categoryLists.get(symbols);
  if (found) return found;
  const counts = new Map<string, { count: number; isFeed: boolean }>();
  for (const item of indexOf(symbols)) counts.set(item.category, { count: (counts.get(item.category)?.count ?? 0) + 1, isFeed: item.isFeed });
  found = [...counts]
    .sort(([leftName, left], [rightName, right]) => Number(left.isFeed) - Number(right.isFeed) || right.count - left.count || leftName.localeCompare(rightName))
    .map(([name]) => name);
  categoryLists.set(symbols, found);
  return found;
}

// Lower is better. Names beat descriptions; a broker's decorated name (EURUSD.m) ranks with its
// plain instrument so typing "eurusd" finds it first, and another name for the instrument
// (gold for XAUUSD) ranks just below.
function score(item: IndexedSymbol, upper: string, compact: string, instrument: string, tokens: readonly string[]): number | null {
  if (item.upper === upper) return 0;
  if (compact && item.compact === compact) return 1;
  if (compact && item.core === compact) return 2;
  if (compact.length >= 3 && item.instrument === instrument) return 3;
  if (compact && (item.compact.startsWith(compact) || item.core.startsWith(compact))) return 4;
  if (compact.length >= 2 && item.compact.includes(compact)) return 5;
  if (!tokens.every((token) => item.haystack.includes(token))) return null;
  return item.words.some((word) => word.startsWith(tokens[0])) ? 6 : 7;
}

// Name matches come before description matches, and within each the broker's symbols come before
// the data feeds' markets, so Enter after a plain name still picks a symbol the account trades.
export function searchSymbols<T extends SearchableSymbol>(symbols: SymbolList<T>, query: string, options: SearchOptions = {}): T[] {
  const { limit = 100, category = null } = options;
  const text = query.trim();
  const pool = indexOf(symbols).filter((item) => !category || item.category === category);
  if (!text) return pool.sort((left, right) => Number(left.isFeed) - Number(right.isFeed) || left.spec.name.localeCompare(right.spec.name)).slice(0, limit).map((item) => item.spec as T);
  const upper = text.toUpperCase();
  const compact = compactOf(text);
  const instrument = compact ? instrumentKey(compact) : '';
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: { item: IndexedSymbol; rank: number }[] = [];
  for (const item of pool) {
    const rank = score(item, upper, compact, instrument, tokens);
    if (rank !== null) hits.push({ item, rank });
  }
  const tier = (rank: number) => rank <= NAME_RANK ? 0 : 1;
  hits.sort((left, right) => tier(left.rank) - tier(right.rank)
    || Number(left.item.isFeed) - Number(right.item.isFeed)
    || left.rank - right.rank
    || left.item.spec.name.length - right.item.spec.name.length
    || left.item.spec.name.localeCompare(right.item.spec.name));
  return hits.slice(0, limit).map((hit) => hit.item.spec as T);
}
