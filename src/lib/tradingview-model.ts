import type { SerializedDrawing } from '@meridian/charts';
import { fromTradingViewLineTool } from '@meridian/charts/interop/tradingview';
import type { MeridianChartTokens, ThemePatch } from '@meridian/charts/themes';
import { matchSymbol } from '../../shared/symbol-match';
import type { TradingViewDrawingSet } from '../../shared/tradingview';

export interface SkippedDrawings {
  count: number;
  reason: string;
}

export interface ConvertedSymbol {
  target: string;
  drawings: SerializedDrawing[];
}

export interface ConversionOptions {
  now: number;
  tickSize: (target: string) => number | undefined;
  serverOffsetAt: (utcMs: number) => number;
}

// OANDA:EURUSD → EURUSD. Broker symbols never carry TradingView's exchange prefix.
export function plainSymbol(symbol: string): string {
  return symbol.replace(/^[^:]*:/, '').trim();
}

// The account's symbol for a TradingView symbol, or the plain name when the account has none.
export function suggestedSymbol(symbol: string, available: readonly string[]): string {
  const plain = plainSymbol(symbol);
  return (available.length ? matchSymbol(plain, available) : null) ?? plain;
}

// TradingView drawings for the chosen symbols, as Meridian drawings for each target symbol, plus
// what could not come across and why.
export function convertDrawingSets(sets: readonly TradingViewDrawingSet[], targets: ReadonlyMap<string, string>, options: ConversionOptions): { converted: ConvertedSymbol[]; skipped: SkippedDrawings[] } {
  const converted = new Map<string, SerializedDrawing[]>();
  const skipped = new Map<string, number>();
  const skip = (type: string, reason: string) => {
    const key = `${type.replace(/^LineTool/, '')}: ${reason}`;
    skipped.set(key, (skipped.get(key) ?? 0) + 1);
  };
  for (const set of sets) {
    const target = targets.get(set.symbol);
    if (!target) continue;
    const drawings = converted.get(target) ?? [];
    for (const tool of set.tools) {
      if (!tool.isOnPrice) {
        skip(tool.type, 'it is drawn on an indicator, and Meridian draws only on the price chart');
        continue;
      }
      const result = fromTradingViewLineTool(tool, { serverOffsetAt: options.serverOffsetAt, tickSize: options.tickSize(target), now: options.now });
      if (result.kind === 'drawing') drawings.push(result.drawing);
      else skip(tool.type, result.reason);
    }
    converted.set(target, drawings);
  }
  return {
    converted: [...converted].map(([target, drawings]) => ({ target, drawings })),
    skipped: [...skipped].map(([reason, count]) => ({ reason, count })).sort((left, right) => right.count - left.count),
  };
}

export function themeIdentity(name: string): { id: string; label: string } {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const suffix = slug || [...name].reduce((hash, character) => (hash * 31 + character.codePointAt(0)!) >>> 0, 7).toString(36);
  return { id: `tradingview-${suffix}`, label: `${name} (TradingView)` };
}

const chartTokenKeys: readonly (keyof MeridianChartTokens)[] = ['background', 'backgroundGradient', 'text', 'grid', 'border', 'up', 'down', 'line', 'crosshair', 'askLine'];

const isHex = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

// Imported themes from storage; anything that no longer reads is dropped.
export function restoreThemePatches(value: unknown): ThemePatch[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item): ThemePatch[] => {
    if (item === null || typeof item !== 'object') return [];
    const patch = item as Record<string, unknown>;
    if (typeof patch.id !== 'string' || !patch.id.startsWith('tradingview-') || seen.has(patch.id)) return [];
    if (typeof patch.label !== 'string' || !patch.label || (patch.mode !== 'dark' && patch.mode !== 'light')) return [];
    const chart = patch.chart !== null && typeof patch.chart === 'object' ? patch.chart as Record<string, unknown> : {};
    seen.add(patch.id);
    const tokens = Object.fromEntries(chartTokenKeys.filter((key) => isHex(chart[key])).map((key) => [key, chart[key] as string]));
    return [{ id: patch.id, label: patch.label, mode: patch.mode, chart: tokens }];
  });
}
