import { instrumentKey } from '../../shared/symbol-match';
import { migrateDrawing, type Drawing } from './chart-model';
import { log } from './session';
import { Store } from './store';
import { layoutDrawings, setLayoutDrawings, updateChart, workspace, type ChartConfig } from './workspace';

// Drawings that belong to an instrument rather than to one chart window, as TradingView keeps them:
// every chart of the symbol shows them, and editing one on any chart edits it everywhere. They are
// keyed by instrument, so they follow the symbol to a broker that names it differently.

export interface SymbolDrawingsState {
  bySymbol: Readonly<Record<string, readonly Drawing[]>>;
}

const STORAGE_KEY = 'openterm.symbol-drawings.v1';

const none: readonly Drawing[] = [];

export const symbolDrawingKey = (symbol: string) => instrumentKey(symbol);

// Saved drawings from storage; one that no longer reads is dropped, not its whole symbol.
export function restoreSymbolDrawings(value: unknown): Record<string, Drawing[]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, list]) => {
    const drawings = Array.isArray(list) ? list.map((drawing) => migrateDrawing(drawing)).filter((drawing): drawing is Drawing => drawing !== null) : [];
    return key && drawings.length ? [[key, drawings]] : [];
  }));
}

function load(): Record<string, Drawing[]> {
  try {
    return restoreSymbolDrawings(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
  } catch {
    return {};
  }
}

export const symbolDrawings = new Store<SymbolDrawingsState>({ bySymbol: load() });

export function drawingsForSymbol(state: SymbolDrawingsState, symbol: string): readonly Drawing[] {
  return state.bySymbol[symbolDrawingKey(symbol)] ?? none;
}

export function setSymbolDrawings(symbol: string, drawings: readonly Drawing[]): void {
  const key = symbolDrawingKey(symbol);
  symbolDrawings.set((state) => {
    const rest = Object.fromEntries(Object.entries(state.bySymbol).filter(([candidate]) => candidate !== key));
    return { bySymbol: drawings.length ? { ...rest, [key]: drawings } : rest };
  });
}

// Every drawing id across all symbols, for telling which imports are already here.
export function symbolDrawingIds(state: SymbolDrawingsState): ReadonlySet<string> {
  return new Set(Object.values(state.bySymbol).flatMap((drawings) => drawings.map((drawing) => drawing.id)));
}

// Imported drawings replace earlier copies of themselves (same id), wherever they were copied
// before, and join the symbol's drawings.
export function addSymbolDrawings(symbol: string, drawings: readonly Drawing[]): void {
  const incoming = new Set(drawings.map((drawing) => drawing.id));
  const key = symbolDrawingKey(symbol);
  symbolDrawings.set((state) => {
    const kept = Object.entries(state.bySymbol).map(([candidate, list]) => [candidate, list.filter((drawing) => !incoming.has(drawing.id))] as const);
    const bySymbol = Object.fromEntries(kept.map(([candidate, list]) => [candidate, candidate === key ? [...list, ...drawings] : list]).filter(([, list]) => list.length));
    if (!bySymbol[key] && drawings.length) bySymbol[key] = [...drawings];
    return { bySymbol };
  });
}

export function startSymbolDrawings(): void {
  let isSaveFailing = false;
  symbolDrawings.subscribe(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(symbolDrawings.get().bySymbol));
      isSaveFailing = false;
    } catch (error) {
      if (!isSaveFailing) log(`Symbol drawings could not be saved: ${(error as Error).message}`, 'Charts');
      isSaveFailing = true;
    }
  });
}

// Everything a chart shows: its own drawings, then its tab's and its symbol's.
export function chartObjects(chart: ChartConfig): Drawing[] {
  return [...chart.drawings, ...layoutDrawings(workspace.get(), chart), ...drawingsForSymbol(symbolDrawings.get(), chart.symbol)];
}

// Writes an edited list from `chartObjects` back to the chart, its tab and its symbol.
export function replaceChartObjects(chart: ChartConfig, drawings: readonly Drawing[]): void {
  const symbolIds = new Set(drawingsForSymbol(symbolDrawings.get(), chart.symbol).map((drawing) => drawing.id));
  const tabIds = new Set(layoutDrawings(workspace.get(), chart).map((drawing) => drawing.id));
  updateChart(chart.id, { drawings: drawings.filter((drawing) => !symbolIds.has(drawing.id) && !tabIds.has(drawing.id)) });
  setLayoutDrawings(chart.id, chart.symbol, drawings.filter((drawing) => tabIds.has(drawing.id)));
  setSymbolDrawings(chart.symbol, drawings.filter((drawing) => symbolIds.has(drawing.id)));
}
