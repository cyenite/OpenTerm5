import type { StudyInfo } from '@meridian/charts';
import { mt5StudyPrefix } from './mt5-studies';
import { pineStudyPrefix, pineStudyType } from './pine/pine-script';
import type { PineScript } from './pine/pine-scripts';

// Every indicator the charts can show, whatever its source: Meridian's built-in studies,
// MetaTrader's formulas and imported Pine scripts. The Indicators dialog, the favourites menu and
// the Navigator all read this one list, sectioned as TradingView's dialog is.

// The sidebar, in display order. Favourites cut across the others.
export const indicatorSections = [
  { key: 'favorites', label: 'Favorites', group: 'Personal' },
  { key: 'scripts', label: 'My scripts', group: 'Personal' },
  { key: 'technicals', label: 'Technicals', group: 'Built-in' },
  { key: 'popular', label: 'Popular', group: 'Community' },
] as const;

export type IndicatorSection = (typeof indicatorSections)[number]['key'];

export interface IndicatorEntry {
  // The study type charts add.
  type: string;
  title: string;
  // `rank` is the place in TradingView's popular list, for scripts imported from it.
  rank?: number;
  author?: string;
  license?: string;
  // 'MT5' marks MetaTrader's own formula of a study Meridian also has.
  badge?: 'MT5';
  overlay: boolean;
  section: Exclude<IndicatorSection, 'favorites'>;
  // The imported Pine script behind the entry.
  scriptId?: string;
}

const byTitle = (left: IndicatorEntry, right: IndicatorEntry) => left.title.localeCompare(right.title) || (left.badge ? 1 : 0) - (right.badge ? 1 : 0);

export function indicatorEntries(catalogue: readonly StudyInfo[], scripts: readonly PineScript[]): IndicatorEntry[] {
  const builtIn = catalogue.filter((study) => !study.type.startsWith(pineStudyPrefix)).map((study): IndicatorEntry => (
    study.type.startsWith(mt5StudyPrefix)
      ? { type: study.type, title: study.title.replace(/ \(MT5\)$/, ''), badge: 'MT5', overlay: study.overlay, section: 'technicals' }
      : { type: study.type, title: study.title, overlay: study.overlay, section: 'technicals' }
  ));
  const imported = scripts.map((script): IndicatorEntry => {
    const rank = script.origin.kind === 'tradingview' ? script.origin.rank : undefined;
    return {
      type: pineStudyType(script.id),
      title: script.name,
      ...(rank ? { rank } : {}),
      ...(script.author ? { author: script.author } : {}),
      ...(script.license ? { license: script.license } : {}),
      overlay: script.overlay,
      section: rank ? 'popular' : 'scripts',
      scriptId: script.id,
    };
  });
  return [...builtIn.sort(byTitle), ...imported];
}

// A section's list: favourites by name, popular scripts in TradingView's order, the rest by name.
export function sectionEntries(entries: readonly IndicatorEntry[], section: IndicatorSection, favorites: ReadonlySet<string>): IndicatorEntry[] {
  if (section === 'favorites') return entries.filter((entry) => favorites.has(entry.type)).sort(byTitle);
  const listed = entries.filter((entry) => entry.section === section);
  return section === 'popular' ? listed.sort((left, right) => (left.rank ?? Infinity) - (right.rank ?? Infinity)) : listed.sort(byTitle);
}

// Name label for menus, where an MT5 formula sits beside Meridian's study of the same name.
export const entryLabel = (entry: IndicatorEntry) => (entry.badge ? `${entry.title} (${entry.badge})` : entry.title);

// Search ranks built-ins above scripts, as TradingView's search does; this is relevance, not the
// sidebar's order.
const searchRanks: Record<IndicatorEntry['section'], number> = { technicals: 0, scripts: 1, popular: 2 };

const sectionOrder = (entry: IndicatorEntry) => searchRanks[entry.section];

// Every word must appear in the name or author. Names starting with the query come first, then
// those with a word starting with it, then the rest; built-ins before scripts within each.
export function searchEntries(entries: readonly IndicatorEntry[], query: string): IndicatorEntry[] {
  const text = query.trim().toLowerCase();
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const score = (entry: IndicatorEntry) => {
    const title = entry.title.toLowerCase();
    if (title.startsWith(text)) return 0;
    return title.split(/[^a-z0-9]+/).some((word) => word.startsWith(words[0])) ? 1 : 2;
  };
  return entries
    .filter((entry) => words.every((word) => `${entry.title} ${entry.author ?? ''} ${entry.badge ?? ''}`.toLowerCase().includes(word)))
    .map((entry) => ({ entry, score: score(entry) }))
    .sort((left, right) => left.score - right.score || sectionOrder(left.entry) - sectionOrder(right.entry) || byTitle(left.entry, right.entry))
    .map(({ entry }) => entry);
}
