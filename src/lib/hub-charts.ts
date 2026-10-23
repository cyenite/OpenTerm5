import type { HubChart, HubChartDocument, HubDrawingEdit } from '../../shared/hub';
import { migrateDrawing, type Drawing } from './chart-model';
import { tabActiveChartId, visibleChartIds } from './chart-tabs';
import { isChartTimeframe } from './mt5-timeframes';
import { session } from './session';
import { chartObjects, drawingsForSymbol, setSymbolDrawings, symbolDrawings } from './symbol-drawings';
import { activeTab, layoutDrawings, marketTabs, setChartSymbol, setChartTimeframe, setLayoutDrawings, updateChart, workspace, type ChartConfig, type WorkspaceState } from './workspace';

// The window's answers to a paired phone's chart requests. A phone sees the charts of the market
// it trades, as the window shows them, and its edits land where the window's own would.

const MAX_DRAWINGS = 2_000;

export function hubCharts(state: WorkspaceState): HubChart[] {
  const current = activeTab(state);
  return marketTabs(state).flatMap((tab, index) => {
    const activeId = tabActiveChartId(tab);
    return visibleChartIds(tab).flatMap((id) => {
      const chart = state.charts.find((candidate) => candidate.id === id);
      return chart ? [{ id, tabId: tab.id, symbol: chart.symbol, timeframe: chart.timeframe, tabLabel: `Layout ${index + 1}`, isActive: tab.id === current?.id && id === activeId }] : [];
    });
  });
}

function findChart(chartId: unknown): ChartConfig {
  const chart = workspace.get().charts.find((candidate) => candidate.id === chartId);
  if (!chart) throw new Error('That chart was closed on the computer.');
  return chart;
}

export function hubChartDocument(chartId: string): HubChartDocument {
  const state = workspace.get();
  const chart = findChart(chartId);
  const listed = hubCharts(state).find((item) => item.id === chartId);
  return {
    id: chart.id, tabId: listed?.tabId ?? '', tabLabel: listed?.tabLabel ?? '', isActive: listed?.isActive ?? false,
    symbol: chart.symbol, timeframe: chart.timeframe, type: chart.type, isVolumeShown: chart.isVolumeShown,
    indicators: chart.indicators, drawings: chartObjects(chart),
  };
}

export function setHubChartMarket(chartId: string, symbol: unknown, timeframe: unknown): HubChartDocument {
  const chart = findChart(chartId);
  if (symbol !== undefined && symbol !== chart.symbol) {
    if (typeof symbol !== 'string' || !session.get().symbols[symbol]) throw new Error(`${String(symbol)} is not offered by the account in use.`);
    setChartSymbol(chart.id, symbol);
  }
  if (timeframe !== undefined && timeframe !== chart.timeframe) {
    if (!isChartTimeframe(timeframe)) throw new Error(`${String(timeframe)} is not a chart timeframe.`);
    setChartTimeframe(chart.id, timeframe);
  }
  return hubChartDocument(chart.id);
}

// Replaces and removes drawings by id. A drawing new to the chart goes where the window's drawing
// sync would put one drawn here: the chart, its layout or every chart of the symbol.
export function editHubDrawings(edit: HubDrawingEdit): HubChartDocument {
  const chart = findChart(edit?.chartId);
  if (!Array.isArray(edit.upserts) || !Array.isArray(edit.removals) || edit.upserts.length + edit.removals.length > MAX_DRAWINGS) throw new Error('Unreadable drawing changes');
  const upserts = edit.upserts.map((value) => migrateDrawing(value));
  if (upserts.some((drawing) => drawing === null)) throw new Error('A drawing from the phone could not be read.');
  const removed = new Set(edit.removals.filter((id) => typeof id === 'string'));
  const byId = new Map((upserts as Drawing[]).map((drawing) => [drawing.id, drawing]));
  const state = workspace.get();
  const own = chart.drawings;
  const layout = layoutDrawings(state, chart);
  const shared = drawingsForSymbol(symbolDrawings.get(), chart.symbol);
  const known = new Set([...own, ...layout, ...shared].map((drawing) => drawing.id));
  const added = [...byId.values()].filter((drawing) => !known.has(drawing.id) && !removed.has(drawing.id));
  const apply = (list: readonly Drawing[], isTarget: boolean) => [
    ...list.filter((drawing) => !removed.has(drawing.id)).map((drawing) => byId.get(drawing.id) ?? drawing),
    ...(isTarget ? added : []),
  ];
  const sync = state.drawingSync;
  const nextOwn = apply(own, sync === 'off');
  const nextLayout = apply(layout, sync === 'layout');
  const nextShared = apply(shared, sync === 'global');
  if (!sameList(nextOwn, own)) updateChart(chart.id, { drawings: nextOwn });
  if (!sameList(nextLayout, layout)) setLayoutDrawings(chart.id, chart.symbol, nextLayout);
  if (!sameList(nextShared, shared)) setSymbolDrawings(chart.symbol, nextShared);
  return hubChartDocument(chart.id);
}

const sameList = (left: readonly Drawing[], right: readonly Drawing[]) => left.length === right.length && left.every((drawing, index) => drawing === right[index]);

// What a phone showing the chart would need to reload when it changes, by reference.
export function chartFingerprint(state: WorkspaceState, chart: ChartConfig): readonly unknown[] {
  return [chart.symbol, chart.timeframe, chart.type, chart.isVolumeShown, chart.indicators, chart.drawings, layoutDrawings(state, chart), drawingsForSymbol(symbolDrawings.get(), chart.symbol)];
}
