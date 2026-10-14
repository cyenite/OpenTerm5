import type { SymbolSpec } from '../../shared/protocol';
import { instrumentKey, symbolCore } from '../../shared/symbol-match';

interface IndexedSymbol {
  readonly spec: SymbolSpec;
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

const indexes = new WeakMap<Record<string, SymbolSpec>, IndexedSymbol[]>();
const categoryLists = new WeakMap<Record<string, SymbolSpec>, string[]>();

const compactOf = (text: string) => text.toUpperCase().replace(/[^A-Z0-9]/g, '');

// The broker's path names the symbol last (Forex\Majors\EURUSD); its first folder is the market.
export function symbolCategory(path: string): string {
  const folders = path.split(/[\\/]/).filter(Boolean);
  return folders.length > 1 ? folders[0] : 'Other';
}

function indexOf(symbols: Record<string, SymbolSpec>): IndexedSymbol[] {
  let found = indexes.get(symbols);
  if (found) return found;
  found = Object.values(symbols).map((spec) => {
    const description = spec.description.toLowerCase();
    return {
      spec,
      core: symbolCore(spec.name),
      upper: spec.name.toUpperCase(),
      compact: compactOf(spec.name),
      category: symbolCategory(spec.path),
      haystack: `${spec.name} ${description} ${spec.path}`.toLowerCase(),
      instrument: instrumentKey(spec.name),
      words: description.split(/[^a-z0-9]+/).filter(Boolean),
    };
  });
  indexes.set(symbols, found);
  return found;
}

export function symbolCategories(symbols: Record<string, SymbolSpec>): string[] {
  let found = categoryLists.get(symbols);
  if (found) return found;
  const counts = new Map<string, number>();
  for (const item of indexOf(symbols)) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  found = [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([name]) => name);
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

export function searchSymbols(symbols: Record<string, SymbolSpec>, query: string, options: SearchOptions = {}): SymbolSpec[] {
  const { limit = 100, category = null } = options;
  const text = query.trim();
  const pool = indexOf(symbols).filter((item) => !category || item.category === category);
  if (!text) return pool.map((item) => item.spec).sort((left, right) => left.name.localeCompare(right.name)).slice(0, limit);
  const upper = text.toUpperCase();
  const compact = compactOf(text);
  const instrument = compact ? instrumentKey(compact) : '';
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  const hits: { spec: SymbolSpec; rank: number }[] = [];
  for (const item of pool) {
    const rank = score(item, upper, compact, instrument, tokens);
    if (rank !== null) hits.push({ rank, spec: item.spec });
  }
  hits.sort((left, right) => left.rank - right.rank || left.spec.name.length - right.spec.name.length || left.spec.name.localeCompare(right.spec.name));
  return hits.slice(0, limit).map((hit) => hit.spec);
}
