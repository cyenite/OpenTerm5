import type { MeridianChart, MeridianHover } from '@meridian/charts';
import { chartInstance } from './chart-instances';
import { isReplaySelecting } from './replay';
import { hasSync, tabActiveChartId, visibleChartIds, type ChartTab } from './chart-tabs';
import { activeTab, tabOfChart, workspace, type WorkspaceState } from './workspace';

// Keeps the charts of a layout tab in step: the crosshair, a clicked time and the active chart's
// date range, each as the tab's sync settings allow. Symbol and interval sync change the saved
// charts instead, in `workspace.ts`.

// Charts currently showing another chart's crosshair.
const crosshairTargets = new Set<string>();
// While a divider is dragged every chart resizes; the date range is applied once on release.
let isResizing = false;

function others(state: WorkspaceState, chartId: string): { tab: ChartTab; ids: string[] } | null {
  const tab = tabOfChart(state, chartId);
  return tab ? { tab, ids: visibleChartIds(tab).filter((id) => id !== chartId) } : null;
}

function clearCrosshairs(): void {
  crosshairTargets.forEach((id) => chartInstance(id)?.setExternalCrosshair(null));
  crosshairTargets.clear();
}

// The price line only shows on charts of the same symbol, where the price means the same thing.
// While a replay start is picked every chart mirrors the crosshair, sync or not.
function showCrosshair(chartId: string, hover: MeridianHover): void {
  const state = workspace.get();
  const layout = others(state, chartId);
  if (!layout || hover.time === null || !hasSync(layout.tab, 'crosshair') && !isReplaySelecting(layout.tab.id)) {
    clearCrosshairs();
    return;
  }
  const symbol = state.charts.find((chart) => chart.id === chartId)?.symbol;
  for (const id of layout.ids) {
    const isSameSymbol = state.charts.find((chart) => chart.id === id)?.symbol === symbol;
    chartInstance(id)?.setExternalCrosshair({ time: hover.time, price: isSameSymbol ? hover.price : null });
    crosshairTargets.add(id);
  }
}

// Date range sync already holds every chart on the same dates, so it takes precedence.
function syncTime(chartId: string, time: number): void {
  const layout = others(workspace.get(), chartId);
  if (!layout || !hasSync(layout.tab, 'time') || hasSync(layout.tab, 'dateRange')) return;
  layout.ids.forEach((id) => chartInstance(id)?.scrollToTime(time));
}

// Only the active chart leads, so followers moving into place never echo back.
function syncRange(chartId: string, range: { from: number; to: number }): void {
  const layout = others(workspace.get(), chartId);
  if (!layout || isResizing || !hasSync(layout.tab, 'dateRange') || tabActiveChartId(layout.tab) !== chartId) return;
  layout.ids.forEach((id) => chartInstance(id)?.setVisibleRange(range));
}

function followActiveRange(tab: ChartTab): void {
  const activeId = tabActiveChartId(tab);
  const range = chartInstance(activeId)?.visibleRange();
  if (range) syncRange(activeId, range);
}

// Loading another market cancels a requested range, so a follower asks again after `setMarket`.
export function followDateRange(chartId: string): void {
  const tab = tabOfChart(workspace.get(), chartId);
  if (!tab || !hasSync(tab, 'dateRange') || isResizing) return;
  const range = chartInstance(tabActiveChartId(tab))?.visibleRange();
  if (range && tabActiveChartId(tab) !== chartId) chartInstance(chartId)?.setVisibleRange(range);
}

export function setLayoutResizing(isOn: boolean): void {
  isResizing = isOn;
  if (isOn) return;
  const state = workspace.get();
  const tab = activeTab(state);
  if (tab && hasSync(tab, 'dateRange')) followActiveRange(tab);
}

export function startLayoutSync(chartId: string, engine: MeridianChart): () => void {
  const unsubscribers = [
    engine.onHover((hover) => showCrosshair(chartId, hover)),
    engine.onTimeClick((time) => syncTime(chartId, time)),
    engine.onVisibleRangeChange((range) => syncRange(chartId, range)),
  ];
  // A chart joining a tab that syncs its date range starts on the active chart's dates.
  void engine.ready().then(() => followDateRange(chartId));
  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    crosshairTargets.delete(chartId);
  };
}

// Turning crosshair sync off clears the mirrored crosshairs. Date range sync re-applies whenever
// it is turned on, the active chart changes, or the layout shows other charts.
const signature = (tab: ChartTab) => `${tab.syncs.join()}|${tabActiveChartId(tab)}|${visibleChartIds(tab).join()}`;
let signatures = new Map<string, string>();
workspace.subscribe(() => {
  const state = workspace.get();
  const next = new Map(state.tabs.map((tab) => [tab.id, signature(tab)]));
  for (const tab of state.tabs) {
    if (signatures.get(tab.id) === next.get(tab.id)) continue;
    if (!hasSync(tab, 'crosshair')) clearCrosshairs();
    if (hasSync(tab, 'dateRange')) followActiveRange(tab);
  }
  signatures = next;
});
