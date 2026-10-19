import type { WorkspaceState } from './workspace';
import { Store } from './store';

// Declaration order is the order panels stack in within a dock; `side` is where each starts.
export const dockPanels = [
  { key: 'marketWatch', label: 'Market Watch', side: 'left', flag: 'isMarketWatchShown' },
  { key: 'dataWindow', label: 'Data Window', side: 'left', flag: 'isDataWindowShown' },
  { key: 'navigator', label: 'Navigator', side: 'left', flag: 'isNavigatorShown' },
  { key: 'tradeAssistant', label: 'Trade Assistant', side: 'right', flag: 'isTradeAssistantShown' },
  { key: 'backtest', label: 'Backtest', side: 'right', flag: 'isBacktestPanelShown' },
] as const satisfies readonly { key: string; label: string; side: DockSide; flag: keyof WorkspaceState }[];

export const dockSides = [
  { key: 'left', label: 'Dock Left' },
  { key: 'right', label: 'Dock Right' },
] as const;

export type DockSide = (typeof dockSides)[number]['key'];
export type DockPanel = (typeof dockPanels)[number]['key'];
// Depth of Market stacks in the right dock too, but always there and only while a symbol is open.
export type StackItem = DockPanel | 'depthOfMarket';

export interface DockLayout {
  sides: Record<DockPanel, DockSide>;
  widths: Record<DockSide, number>;
  weights: Partial<Record<StackItem, number>>;
  toolboxHeight: number;
}

export const dockLimits = { minWidth: 180, maxWidth: 720, minPanel: 64, minToolbox: 80, minChart: 120 } as const;

export const defaultDockLayout: DockLayout = {
  sides: Object.fromEntries(dockPanels.map((panel) => [panel.key, panel.side])) as Record<DockPanel, DockSide>,
  widths: { left: 330, right: 280 },
  weights: {},
  toolboxHeight: 230,
};

// The panel being dragged by its header, so both docks can show where it may land.
export const dockDrag = new Store<{ panel: DockPanel | null }>({ panel: null });

export const panelDataType = 'application/x-openterm-panel';

export function isDockPanel(value: unknown): value is DockPanel {
  return dockPanels.some((panel) => panel.key === value);
}

export function otherSide(side: DockSide): DockSide {
  return side === 'left' ? 'right' : 'left';
}

export function clampDockWidth(width: number): number {
  return Math.round(Math.min(dockLimits.maxWidth, Math.max(dockLimits.minWidth, width)));
}

// `available` is the height the chart area and the Toolbox share; the charts keep a minimum.
export function clampToolboxHeight(height: number, available = Number.POSITIVE_INFINITY): number {
  const max = Math.max(dockLimits.minToolbox, available - dockLimits.minChart);
  return Math.round(Math.min(max, Math.max(dockLimits.minToolbox, height)));
}

function isWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function restoreDockLayout(value: unknown): DockLayout {
  if (!value || typeof value !== 'object') return structuredClone(defaultDockLayout);
  const raw = value as Partial<Record<keyof DockLayout, unknown>>;
  const sides = (raw.sides && typeof raw.sides === 'object' ? raw.sides : {}) as Record<string, unknown>;
  const widths = (raw.widths && typeof raw.widths === 'object' ? raw.widths : {}) as Record<string, unknown>;
  const weights = (raw.weights && typeof raw.weights === 'object' ? raw.weights : {}) as Record<string, unknown>;
  return {
    sides: Object.fromEntries(dockPanels.map((panel) => [panel.key, dockSides.some((side) => side.key === sides[panel.key]) ? sides[panel.key] : panel.side])) as Record<DockPanel, DockSide>,
    widths: Object.fromEntries(dockSides.map((side) => [side.key, isWidth(widths[side.key]) ? clampDockWidth(widths[side.key] as number) : defaultDockLayout.widths[side.key]])) as Record<DockSide, number>,
    weights: Object.fromEntries(Object.entries(weights).filter(([key, weight]) => (isDockPanel(key) || key === 'depthOfMarket') && typeof weight === 'number' && weight > 0 && Number.isFinite(weight))),
    toolboxHeight: isWidth(raw.toolboxHeight) ? clampToolboxHeight(raw.toolboxHeight) : defaultDockLayout.toolboxHeight,
  };
}

type DockInput = Pick<WorkspaceState, 'dock' | 'depthSymbol' | 'isAnalysisMode' | (typeof dockPanels)[number]['flag']>;

// Analysis mode keeps its watchlist, Data Window and the Backtest panel on the right whatever their
// trading-mode side, and withdraws the panels that trade live.
export function dockItems(state: DockInput, side: DockSide): StackItem[] {
  if (state.isAnalysisMode) {
    return side === 'right' ? dockPanels.filter((panel) => panel.key !== 'navigator' && panel.key !== 'tradeAssistant' && state[panel.flag]).map((panel) => panel.key) : [];
  }
  const panels: StackItem[] = dockPanels.filter((panel) => state[panel.flag] && state.dock.sides[panel.key] === side).map((panel) => panel.key);
  return side === 'right' && state.depthSymbol ? [...panels, 'depthOfMarket'] : panels;
}

export function weightOf(weights: DockLayout['weights'], item: StackItem): number {
  return weights[item] ?? 1;
}

// Moves the boundary between two neighbouring panels by `delta` pixels. The pair keeps its
// combined weight, so the rest of the dock does not move.
export function resizePair(weights: DockLayout['weights'], above: StackItem, below: StackItem, delta: number, aboveHeight: number, belowHeight: number): DockLayout['weights'] {
  const total = aboveHeight + belowHeight;
  if (!(total > 0)) return weights;
  const share = weightOf(weights, above) + weightOf(weights, below);
  const height = Math.min(total - dockLimits.minPanel, Math.max(dockLimits.minPanel, aboveHeight + delta));
  const next = Number((share * Math.max(0, height) / total).toFixed(4));
  return { ...weights, [above]: next, [below]: Number((share - next).toFixed(4)) };
}

export function withoutWeights(weights: DockLayout['weights'], items: readonly StackItem[]): DockLayout['weights'] {
  return Object.fromEntries(Object.entries(weights).filter(([key]) => !items.includes(key as StackItem)));
}
