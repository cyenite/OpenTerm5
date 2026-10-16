import { defaultSizes, layoutCells, layoutCount, layoutForCount, layoutOf, visualOrder, type LayoutKey, type LayoutSync, type SplitSizes } from './chart-layouts';
import type { Drawing } from './chart-model';
import type { ChartConfig } from './workspace';

// A tab in the chart bar holds one multi-chart layout. Its charts fill the layout's slots in
// `chartIds` order; charts past the slot count stay saved but hidden, and come back when the
// layout grows again.
export interface ChartTab {
  id: string;
  layout: LayoutKey;
  activeChartId: string;
  syncs: LayoutSync[];
  chartIds: string[];
  // Divider positions per layout, so switching layouts and back keeps them.
  sizes: Partial<Record<LayoutKey, SplitSizes>>;
  // Drawings synced across this tab, by instrument key; they show on its charts of that instrument.
  drawings: Record<string, Drawing[]>;
}

export function makeTab(id: string, chartIds: string[], layout: LayoutKey = 's', syncs: LayoutSync[] = ['crosshair']): ChartTab {
  return { id, layout, activeChartId: chartIds[0] ?? '', syncs, chartIds, sizes: {}, drawings: {} };
}

export function visibleChartIds(tab: ChartTab): string[] {
  return tab.chartIds.slice(0, layoutCount(tab.layout));
}

export function tabSizes(tab: ChartTab): SplitSizes {
  return tab.sizes[tab.layout] ?? defaultSizes(layoutOf(tab.layout).tree);
}

export function hasSync(tab: ChartTab | undefined, sync: LayoutSync): boolean {
  return !!tab?.syncs.includes(sync);
}

// The active chart, or the first visible one when the active chart has been hidden or closed.
export function tabActiveChartId(tab: ChartTab): string {
  const visible = visibleChartIds(tab);
  return visible.includes(tab.activeChartId) ? tab.activeChartId : visible[0] ?? '';
}

// Switches the layout. Slots the tab's charts cannot fill get clones of the active chart.
export function withLayout(tab: ChartTab, layout: LayoutKey, clone: () => ChartConfig): { tab: ChartTab; added: ChartConfig[] } {
  const missing = Math.max(0, layoutCount(layout) - tab.chartIds.length);
  const added = Array.from({ length: missing }, clone);
  const next = { ...tab, layout, chartIds: [...tab.chartIds, ...added.map((chart) => chart.id)] };
  return { tab: { ...next, activeChartId: tabActiveChartId(next) }, added };
}

// Removes a chart. When no hidden chart can take its slot, the layout steps down to one that fits.
export function withoutChart(tab: ChartTab, chartId: string): ChartTab {
  const chartIds = tab.chartIds.filter((id) => id !== chartId);
  const layout = chartIds.length < layoutCount(tab.layout) ? layoutForCount(chartIds.length) : tab.layout;
  const next = { ...tab, layout, chartIds };
  return { ...next, activeChartId: tabActiveChartId(next) };
}

// Every other chart of the tab, hidden ones included, in the same sync group as `chartId`.
// Charts outside any group sync with each other.
export function syncPeers(tab: ChartTab, charts: readonly ChartConfig[], chartId: string): ChartConfig[] {
  const source = charts.find((chart) => chart.id === chartId);
  if (!source) return [];
  return tab.chartIds
    .map((id) => charts.find((chart) => chart.id === id))
    .filter((chart): chart is ChartConfig => !!chart && chart.id !== chartId && chart.linkGroup === source.linkGroup);
}

function visualIds(tab: ChartTab): string[] {
  const visible = visibleChartIds(tab);
  return visualOrder(layoutCells(layoutOf(tab.layout).tree, tabSizes(tab)).slice(0, visible.length)).map((slot) => visible[slot]);
}

// The chart `step` places after (or before) the active one in reading order, wrapping around.
export function steppedChartId(tab: ChartTab, step: 1 | -1): string {
  const ordered = visualIds(tab);
  const index = ordered.indexOf(tabActiveChartId(tab));
  return ordered[(index + step + ordered.length) % ordered.length] ?? '';
}

// Swaps a chart with its neighbour in reading order.
export function withChartMoved(tab: ChartTab, chartId: string, step: 1 | -1): ChartTab {
  const ordered = visualIds(tab);
  const index = ordered.indexOf(chartId);
  const neighbour = ordered[index + step];
  if (index < 0 || !neighbour) return tab;
  const chartIds = tab.chartIds.map((id) => id === chartId ? neighbour : id === neighbour ? chartId : id);
  return { ...tab, chartIds };
}
