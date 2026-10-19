import type { OrderTypeKey } from '../../shared/protocol';
import type { ChartTimeframe } from './mt5-timeframes';
import { defaultThemeId } from '@meridian/charts/themes';
import type { ChartSettings, InputValue } from '@meridian/charts';
import { restoreSettings } from '@meridian/charts/settings';
import type { Drawing, IndicatorConfig } from './chart-model';
import { Store } from './store';
import { instrumentKey } from '../../shared/symbol-match';
import { drawingSyncs, type DrawingSync, type LayoutKey, type LayoutSync, type LinkGroup, type SplitSizes } from './chart-layouts';
import { hasSync, makeTab, steppedChartId, syncPeers, tabActiveChartId, visibleChartIds, withChartMoved, withLayout, withoutChart, type ChartTab } from './chart-tabs';
import { replayModes, replaySpeeds, type ReplayMode, type ReplaySpeed } from './replay-model';
import { isReplayingChart, replay, replayTradingHint } from './replay-session';
import { applyTemplate, captureProfile, captureTemplate, restoreProfiles, restoreTemplates, restoreWorkspaceCharts, type ChartProfile, type ChartTemplate } from './presets';
import type { IndicatorSection } from './indicator-catalog';
import { clampDockWidth, clampToolboxHeight, defaultDockLayout, dockPanels, restoreDockLayout, withoutWeights, type DockLayout, type DockPanel, type DockSide, type StackItem } from './dock';

export type { Drawing, IndicatorConfig } from './chart-model';

export const chartTypes = [
  { key: 'bars', label: 'Bar Chart', shortcut: 'Alt+1', description: 'Each bar shows open, high, low and close.' },
  { key: 'candles', label: 'Candlesticks', shortcut: 'Alt+2', description: 'Filled bodies show whether price rose or fell.' },
  { key: 'hollow', label: 'Hollow Candles', shortcut: undefined, description: 'Rising candles drawn as outlines, falling ones filled.' },
  { key: 'line', label: 'Line Chart', shortcut: 'Alt+3', description: 'A single line through closing prices.' },
  { key: 'area', label: 'Area', shortcut: undefined, description: 'A line through closing prices with the area beneath it filled.' },
  { key: 'baseline', label: 'Baseline', shortcut: undefined, description: 'Closing prices coloured above and below a reference level.' },
  { key: 'heikinashi', label: 'Heikin Ashi', shortcut: undefined, description: 'Averaged candles that smooth out noise to show the trend.' },
] as const;

export type ChartType = (typeof chartTypes)[number]['key'];

// Quick tools for the toolbar and menus. Drawing tools hand over to Meridian's tool of the same
// kind; every other Meridian tool is on the drawing toolbar inside each chart.
export const tools = [
  { key: 'cursor', label: 'Cursor', description: 'Select, move and edit chart objects.', drawing: null },
  { key: 'crosshair', label: 'Crosshair', description: 'Read exact prices and times under the pointer.', drawing: null },
  { key: 'hline', label: 'Horizontal Line', description: 'Click to mark a price level.', drawing: 'horizontal-line' },
  { key: 'trend', label: 'Trendline', description: 'Click the two ends of the line.', drawing: 'trend-line' },
  { key: 'vline', label: 'Vertical Line', description: 'Click to mark a moment in time.', drawing: 'vertical-line' },
  { key: 'ray', label: 'Horizontal Ray', description: 'A price level that extends to the right from where you click.', drawing: 'horizontal-ray' },
  { key: 'rectangle', label: 'Rectangle', description: 'Click two opposite corners to box a price and time range.', drawing: 'rectangle' },
  { key: 'fibonacci', label: 'Fibonacci Retracement', description: 'Click a swing low and then a swing high, or the reverse.', drawing: 'fib-retracement' },
  { key: 'riskOrder', label: 'Risk Order', description: 'Drag the entry, then the stop loss and take profit; the volume follows your risk setting.', drawing: null },
] as const satisfies readonly { key: string; label: string; description: string; drawing: string | null }[];

export type Tool = (typeof tools)[number]['key'];

export interface ChartConfig {
  id: string;
  symbol: string;
  type: ChartType;
  timeframe: ChartTimeframe;
  drawings: Drawing[];
  indicators: IndicatorConfig[];
  isGridShown: boolean;
  isVolumeShown: boolean;
  // Chart Settings from the chart's own settings dialog; missing means the defaults.
  settings?: ChartSettings;
  // Symbol and interval sync only spread between charts of the same group (or of none).
  linkGroup?: LinkGroup;
}

export type ToolboxTab = 'trade' | 'exposure' | 'history' | 'journal';

export const pages = [
  { key: 'trading', label: 'Trading', shortcut: 'Ctrl+1' },
  { key: 'copier', label: 'Trade Copier', shortcut: 'Ctrl+2' },
  { key: 'signals', label: 'Signals', shortcut: 'Ctrl+3' },
  { key: 'automation', label: 'Automation', shortcut: 'Ctrl+4' },
  { key: 'journaling', label: 'Journaling', shortcut: 'Ctrl+5' },
] as const;

export type Page = (typeof pages)[number]['key'];

export type Dialog =
  // `chartId` is the chart the ticket was opened from, so a replaying chart can refuse it.
  | { kind: 'order'; symbol: string; volume?: number; type?: OrderTypeKey; price?: number; chartId?: string }
  | { kind: 'modifyPosition'; ticket: number }
  | { kind: 'closeBy'; ticket: number }
  | { kind: 'manage'; ticket: number }
  | { kind: 'modifyOrder'; ticket: number }
  | { kind: 'symbols' }
  | { kind: 'specification'; symbol: string }
  | { kind: 'objects'; chartId: string }
  | { kind: 'connection' }
  | { kind: 'login'; profileId?: string }
  | { kind: 'accounts' }
  | { kind: 'alerts' }
  | { kind: 'profile' }
  | { kind: 'template'; chartId: string }
  | { kind: 'tradingview' }
  | { kind: 'indicators'; section?: IndicatorSection }
  | { kind: 'backtests' }
  // Backtest dialogs change the simulated account, so analysis mode does not withhold them.
  | { kind: 'backtestPosition'; ticket: number }
  | { kind: 'backtestOrderEdit'; ticket: number }
  | { kind: 'about' };

export interface WorkspaceState {
  page: Page;
  tool: Tool;
  activeTabId: string;
  toolboxTab: ToolboxTab;
  // A Meridian theme id, or 'system' to follow the operating system.
  theme: string;
  depthSymbol: string | null;
  dialog: Dialog | null;
  drawingSync: DrawingSync;
  // Panel sides, dock widths, stacked panel shares and the Toolbox height.
  dock: DockLayout;
  replayMode: ReplayMode;
  replaySpeed: ReplaySpeed;
  tabs: ChartTab[];
  charts: ChartConfig[];
  profiles: ChartProfile[];
  templates: ChartTemplate[];
  activeProfile: string;
  isToolboxShown: boolean;
  isNavigatorShown: boolean;
  isStatusBarShown: boolean;
  isDataWindowShown: boolean;
  isChartBarShown: boolean;
  isMarketWatchShown: boolean;
  isTradeAssistantShown: boolean;
  isBacktestPanelShown: boolean;
  // Backtest mode: the interface given over to backtesting, set and cleared by the backtest runtime
  // (which keeps the settings it replaced); not saved, so OpenTerm5 always starts outside it.
  isBacktestMode: boolean;
  // Trade mode keeps the chart's drawing rail closed unless asked; analysis mode always shows it.
  isTradeDrawingToolbarShown: boolean;
  isOneClickEnabled: boolean;
  hasAcceptedOneClick: boolean;
  // Analysis mode swaps the terminal chrome for a chart-first layout. Accounts, copiers, signals
  // and automation keep running; only the controls that place or change trades are withdrawn.
  isAnalysisMode: boolean;
  isAnalysisPositionsShown: boolean;
  // The active tab's active chart fills the layout; not saved.
  isChartMaximized: boolean;
  // New tabs start with crosshair sync as it was last set.
  isCrosshairSyncedByDefault: boolean;
  // Chart Settings that new charts start with, such as ones imported from TradingView; missing
  // means the defaults.
  defaultChartSettings?: ChartSettings;
}

const STORAGE_KEY = 'openterm.workspace.v1';

export const newId = () => Math.random().toString(36).slice(2, 10);

export function makeChart(symbol: string, timeframe: ChartTimeframe = 'H1'): ChartConfig {
  return {
    id: newId(),
    symbol,
    type: 'candles',
    timeframe,
    drawings: [],
    indicators: [],
    isGridShown: true,
    isVolumeShown: false,
  };
}

function initialState(): WorkspaceState {
  const charts = [makeChart('EURUSD'), makeChart('GBPUSD'), makeChart('USDJPY'), makeChart('XAUUSD', 'H4')];
  const tab = makeTab(newId(), charts.map((chart) => chart.id), '4');
  const defaults: WorkspaceState = {
    page: 'trading',
    tool: 'cursor',
    activeTabId: tab.id,
    toolboxTab: 'trade',
    theme: defaultThemeId,
    depthSymbol: null,
    dialog: null,
    drawingSync: 'layout',
    dock: structuredClone(defaultDockLayout),
    replayMode: 'allCharts',
    replaySpeed: '1x',
    tabs: [tab],
    charts,
    profiles: [],
    templates: [],
    activeProfile: 'Default',
    isToolboxShown: true,
    isNavigatorShown: true,
    isStatusBarShown: true,
    isDataWindowShown: false,
    isChartBarShown: true,
    isMarketWatchShown: true,
    isTradeAssistantShown: false,
    isBacktestPanelShown: false,
    isBacktestMode: false,
    isTradeDrawingToolbarShown: false,
    isOneClickEnabled: false,
    hasAcceptedOneClick: false,
    isAnalysisMode: false,
    isAnalysisPositionsShown: false,
    isChartMaximized: false,
    isCrosshairSyncedByDefault: true,
  };
  defaults.profiles = [captureProfile(defaults, 'Default')];
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as (Partial<WorkspaceState> & Record<string, unknown>) | null;
    // MT5 colour schemes gave way to Meridian themes, and MT5 chart windows to layout tabs; the
    // old window fields are read once by `restoreWorkspaceCharts` and dropped.
    const { scheme, layout, activeChartId, windowStack, ...saved } = stored ?? {};
    if (stored && Array.isArray(saved.charts)) {
      const charts = restoreWorkspaceCharts(stored);
      const drawingSync = drawingSyncs.find((candidate) => candidate.key === saved.drawingSync)?.key ?? defaults.drawingSync;
      const replayMode = replayModes.find((candidate) => candidate.key === saved.replayMode)?.key ?? defaults.replayMode;
      const replaySpeed = replaySpeeds.find((candidate) => candidate.key === saved.replaySpeed)?.key ?? defaults.replaySpeed;
      const restored = { ...defaults, ...saved, ...charts, drawingSync, dock: restoreDockLayout(saved.dock), replayMode, replaySpeed, profiles: restoreProfiles(saved.profiles), templates: restoreTemplates(saved.templates), dialog: null, depthSymbol: null, tool: 'cursor' as const, isChartMaximized: false, isBacktestMode: false };
      if (!restored.profiles.some((profile) => profile.name === restored.activeProfile)) restored.activeProfile = 'Default';
      if (!restored.profiles.some((profile) => profile.name === 'Default')) restored.profiles = [captureProfile(restored, 'Default'), ...restored.profiles];
      if (saved.defaultChartSettings === undefined) delete restored.defaultChartSettings;
      else restored.defaultChartSettings = restoreSettings(saved.defaultChartSettings);
      return restored;
    }
  } catch {
    // Storage can be unavailable or hold a stale shape; fall back to the default profile.
  }
  return defaults;
}

export const workspace = new Store<WorkspaceState>(initialState());

workspace.subscribe(() => {
  const state = workspace.get();
  const { dialog, depthSymbol, tool, isChartMaximized, isBacktestMode, ...persisted } = state;
  persisted.profiles = state.profiles.map((profile) => profile.name === state.activeProfile ? captureProfile(state, profile.name) : profile);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Persisting the profile is a convenience; the terminal works without it.
  }
});

export function activeTab(state: WorkspaceState): ChartTab | undefined {
  return state.tabs.find((tab) => tab.id === state.activeTabId) ?? state.tabs[0];
}

export function tabOfChart(state: WorkspaceState, chartId: string): ChartTab | undefined {
  return state.tabs.find((tab) => tab.chartIds.includes(chartId));
}

export function activeChart(state: WorkspaceState): ChartConfig | undefined {
  const tab = activeTab(state);
  const id = tab ? tabActiveChartId(tab) : undefined;
  return state.charts.find((chart) => chart.id === id);
}

const noDrawings: readonly Drawing[] = [];

// Drawings shared across the chart's tab for the chart's symbol.
export function layoutDrawings(state: WorkspaceState, chart: ChartConfig): readonly Drawing[] {
  return tabOfChart(state, chart.id)?.drawings[instrumentKey(chart.symbol)] ?? noDrawings;
}

function updateTab(id: string, patch: Partial<ChartTab> | ((tab: ChartTab) => Partial<ChartTab>)): void {
  workspace.set((state) => ({ tabs: state.tabs.map((tab) => tab.id === id ? { ...tab, ...(typeof patch === 'function' ? patch(tab) : patch) } : tab) }));
}

export function updateChart(id: string, patch: Partial<ChartConfig> | ((chart: ChartConfig) => Partial<ChartConfig>)): void {
  workspace.set((state) => ({
    charts: state.charts.map((chart) => (chart.id === id ? { ...chart, ...(typeof patch === 'function' ? patch(chart) : patch) } : chart)),
  }));
}

export function updateActiveChart(patch: Partial<ChartConfig> | ((chart: ChartConfig) => Partial<ChartConfig>)): void {
  const chart = activeChart(workspace.get());
  if (chart) {
    updateChart(chart.id, patch);
  }
}

// Changes a chart's symbol, and with symbol sync every chart of its tab in the same sync group.
export function setChartSymbol(chartId: string, symbol: string): void {
  const state = workspace.get();
  const tab = tabOfChart(state, chartId);
  const peers = tab && hasSync(tab, 'symbol') ? syncPeers(tab, state.charts, chartId).map((chart) => chart.id) : [];
  const ids = new Set([chartId, ...peers]);
  workspace.set({ charts: state.charts.map((chart) => ids.has(chart.id) ? { ...chart, symbol } : chart) });
}

export function setChartTimeframe(chartId: string, timeframe: ChartTimeframe): void {
  const state = workspace.get();
  const tab = tabOfChart(state, chartId);
  const peers = tab && hasSync(tab, 'interval') ? syncPeers(tab, state.charts, chartId).map((chart) => chart.id) : [];
  const ids = new Set([chartId, ...peers]);
  workspace.set({ charts: state.charts.map((chart) => ids.has(chart.id) ? { ...chart, timeframe } : chart) });
}

function newChart(state: WorkspaceState, symbol: string, timeframe?: ChartTimeframe): ChartConfig {
  const chart = makeChart(symbol, timeframe ?? activeChart(state)?.timeframe ?? 'H1');
  if (state.defaultChartSettings) chart.settings = structuredClone(state.defaultChartSettings);
  return chart;
}

// Opens a chart in a tab of its own.
export function openChart(symbol: string, timeframe?: ChartTimeframe): void {
  const state = workspace.get();
  const chart = newChart(state, symbol, timeframe);
  const tab = makeTab(newId(), [chart.id], 's', state.isCrosshairSyncedByDefault ? ['crosshair'] : []);
  workspace.set((current) => ({ charts: [...current.charts, chart], tabs: [...current.tabs, tab], activeTabId: tab.id, isChartMaximized: false }));
}

// A new tab with a copy of the active chart, as TradingView's new tab does.
export function openTab(): void {
  const source = activeChart(workspace.get());
  if (!source) return;
  openChart(source.symbol, source.timeframe);
}

// Chart Settings for every open chart, and optionally their chart type. With `isDefault`, charts
// opened later start with them too.
export function applyChartSettingsToAll(settings: ChartSettings, type?: ChartType, isDefault = false): void {
  workspace.set((state) => ({
    charts: state.charts.map((chart) => ({ ...chart, settings: structuredClone(settings), ...(type ? { type } : {}) })),
    ...(isDefault ? { defaultChartSettings: structuredClone(settings) } : {}),
  }));
}

function withoutTab(state: WorkspaceState, tabId: string): Partial<WorkspaceState> {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  const tab = state.tabs[index];
  if (!tab) return {};
  const tabs = state.tabs.filter((candidate) => candidate.id !== tabId);
  const activeTabId = state.activeTabId === tabId ? tabs[Math.min(index, tabs.length - 1)]?.id ?? '' : state.activeTabId;
  return { tabs, activeTabId, charts: state.charts.filter((chart) => !tab.chartIds.includes(chart.id)), isChartMaximized: false };
}

export function closeTab(tabId: string): void {
  workspace.set((state) => withoutTab(state, tabId));
}

// In a multi-chart tab the layout steps down to fit the charts left; the last chart closes its tab.
export function closeChart(id: string): void {
  workspace.set((state) => {
    const tab = tabOfChart(state, id);
    if (!tab || tab.chartIds.length === 1) return tab ? withoutTab(state, tab.id) : { charts: state.charts.filter((chart) => chart.id !== id) };
    return {
      tabs: state.tabs.map((candidate) => candidate.id === tab.id ? withoutChart(tab, id) : candidate),
      charts: state.charts.filter((chart) => chart.id !== id),
      isChartMaximized: state.isChartMaximized && visibleChartIds(withoutChart(tab, id)).length > 1,
    };
  });
}

export function focusTab(tabId: string): void {
  workspace.set({ activeTabId: tabId, isChartMaximized: false });
}

export function focusChart(id: string): void {
  const state = workspace.get();
  const tab = tabOfChart(state, id);
  if (!tab || state.activeTabId === tab.id && tab.activeChartId === id) return;
  workspace.set({ activeTabId: tab.id, tabs: state.tabs.map((candidate) => candidate.id === tab.id ? { ...candidate, activeChartId: id } : candidate) });
}

// Tab and Shift+Tab: the next or previous chart of the layout in reading order. A maximized
// layout shows the chart it moves to.
export function stepChart(step: 1 | -1): void {
  const tab = activeTab(workspace.get());
  if (tab) focusChart(steppedChartId(tab, step));
}

export function moveChart(chartId: string, step: 1 | -1): void {
  const tab = tabOfChart(workspace.get(), chartId);
  if (tab) updateTab(tab.id, (current) => withChartMoved(current, chartId, step));
}

export function toggleMaximized(): void {
  workspace.set((state) => {
    const tab = activeTab(state);
    return { isChartMaximized: !state.isChartMaximized && !!tab && visibleChartIds(tab).length > 1 };
  });
}

// Choosing a layout also restores a maximized chart, so picking the current one does just that.
export function setTabLayout(tabId: string, layout: LayoutKey): void {
  workspace.set((state) => {
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    const source = tab && state.charts.find((chart) => chart.id === tabActiveChartId(tab));
    if (!tab || !source) return { isChartMaximized: false };
    const clone = (): ChartConfig => ({
      ...structuredClone(source),
      id: newId(),
      drawings: [],
      indicators: source.indicators.map((indicator) => ({ ...structuredClone(indicator), id: newId() })),
    });
    const { tab: next, added } = withLayout(tab, layout, clone);
    return { tabs: state.tabs.map((candidate) => candidate.id === tabId ? next : candidate), charts: [...state.charts, ...added], isChartMaximized: false };
  });
}

export function setTabSizes(tabId: string, sizes: SplitSizes): void {
  updateTab(tabId, (tab) => ({ sizes: { ...tab.sizes, [tab.layout]: sizes } }));
}

export function resetTabSizes(tabId: string): void {
  updateTab(tabId, (tab) => ({ sizes: Object.fromEntries(Object.entries(tab.sizes).filter(([key]) => key !== tab.layout)) }));
}

// Turning symbol or interval sync on brings each group into line: the active chart's group
// follows the active chart, any other group its first chart.
function aligned(tab: ChartTab, charts: readonly ChartConfig[], field: 'symbol' | 'timeframe'): ChartConfig[] {
  const members = tab.chartIds.map((id) => charts.find((chart) => chart.id === id)).filter((chart): chart is ChartConfig => !!chart);
  const active = members.find((chart) => chart.id === tabActiveChartId(tab));
  const leaders = new Map<LinkGroup | undefined, ChartConfig>();
  if (active) leaders.set(active.linkGroup, active);
  for (const chart of members) if (!leaders.has(chart.linkGroup)) leaders.set(chart.linkGroup, chart);
  const ids = new Set(tab.chartIds);
  return charts.map((chart) => ids.has(chart.id) ? { ...chart, [field]: leaders.get(chart.linkGroup)![field] } : chart);
}

export function toggleLayoutSync(tabId: string, sync: LayoutSync): void {
  workspace.set((state) => {
    const tab = state.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return {};
    const isOn = !tab.syncs.includes(sync);
    const next = { ...tab, syncs: isOn ? [...tab.syncs, sync] : tab.syncs.filter((candidate) => candidate !== sync) };
    const charts = isOn && sync === 'symbol' ? aligned(next, state.charts, 'symbol') : isOn && sync === 'interval' ? aligned(next, state.charts, 'timeframe') : state.charts;
    return {
      tabs: state.tabs.map((candidate) => candidate.id === tabId ? next : candidate),
      charts,
      ...(sync === 'crosshair' ? { isCrosshairSyncedByDefault: isOn } : {}),
    };
  });
}

// Joining a group with symbol or interval sync on takes the group's symbol and interval.
export function setLinkGroup(chartId: string, linkGroup: LinkGroup | undefined): void {
  workspace.set((state) => {
    const tab = tabOfChart(state, chartId);
    const leader = tab?.chartIds.map((id) => state.charts.find((chart) => chart.id === id)).find((chart) => chart && chart.id !== chartId && chart.linkGroup === linkGroup);
    return {
      charts: state.charts.map((chart) => {
        if (chart.id !== chartId) return chart;
        const { linkGroup: previous, ...rest } = chart;
        return {
          ...rest,
          ...(linkGroup ? { linkGroup } : {}),
          ...(leader && hasSync(tab, 'symbol') ? { symbol: leader.symbol } : {}),
          ...(leader && hasSync(tab, 'interval') ? { timeframe: leader.timeframe } : {}),
        };
      }),
    };
  });
}

export function setLayoutDrawings(chartId: string, symbol: string, drawings: readonly Drawing[]): void {
  const tab = tabOfChart(workspace.get(), chartId);
  if (!tab) return;
  const key = instrumentKey(symbol);
  updateTab(tab.id, (current) => {
    const rest = Object.fromEntries(Object.entries(current.drawings).filter(([candidate]) => candidate !== key));
    return { drawings: drawings.length ? { ...rest, [key]: [...drawings] } : rest };
  });
}

export function setDrawingSync(drawingSync: DrawingSync): void {
  workspace.set({ drawingSync });
}

// Copies the chart's studies to every other chart of its tab, replacing theirs.
export function applyIndicatorsToLayout(chartId: string): void {
  workspace.set((state) => {
    const tab = tabOfChart(state, chartId);
    const source = state.charts.find((chart) => chart.id === chartId);
    if (!tab || !source) return {};
    const others = new Set(tab.chartIds.filter((id) => id !== chartId));
    return { charts: state.charts.map((chart) => others.has(chart.id) ? { ...chart, indicators: source.indicators.map((indicator) => ({ ...structuredClone(indicator), id: newId() })) } : chart) };
  });
}

// The chart fills in the study's default inputs when it adds it.
export function addIndicator(chartId: string, kind: string, params: Record<string, InputValue> = {}): void {
  updateChart(chartId, (chart) => ({ indicators: [...chart.indicators, { id: newId(), kind, params }] }));
}

const tradeDialogs: ReadonlySet<Dialog['kind']> = new Set(['order', 'modifyPosition', 'modifyOrder', 'closeBy', 'manage']);

export function isTradeDialog(dialog: Dialog): boolean {
  return tradeDialogs.has(dialog.kind);
}

export function openDialog(dialog: Dialog): void {
  // Every trading entry point reaches the tickets through here, so this is the one gate that
  // keeps analysis mode from placing or changing trades, whatever menu or shortcut asked. A ticket
  // opened from a replaying chart is refused too; the reason shows in the replay toolbar.
  if (workspace.get().isAnalysisMode && isTradeDialog(dialog)) return;
  if (dialog.kind === 'order' && isReplayingChart(replay.get().session, dialog.chartId)) {
    replay.set((state) => (state.session ? { session: { ...state.session, notice: `${replayTradingHint}.` } } : state));
    return;
  }
  workspace.set({ dialog });
}

function setDock(patch: (dock: DockLayout) => Partial<DockLayout>): void {
  workspace.set((state) => ({ dock: { ...state.dock, ...patch(state.dock) } }));
}

// Moving a panel also shows it, so a menu's "Dock Right" never leaves it hidden.
export function moveDockPanel(panel: DockPanel, side: DockSide): void {
  const flag = dockPanels.find((candidate) => candidate.key === panel)!.flag;
  workspace.set((state) => ({ [flag]: true, dock: { ...state.dock, sides: { ...state.dock.sides, [panel]: side } } }));
}

export function setDockWidth(side: DockSide, width: number): void {
  setDock((dock) => ({ widths: { ...dock.widths, [side]: clampDockWidth(width) } }));
}

export function setDockWeights(weights: DockLayout['weights']): void {
  setDock(() => ({ weights }));
}

export function resetDockWeights(items: readonly StackItem[]): void {
  setDock((dock) => ({ weights: withoutWeights(dock.weights, items) }));
}

export function setToolboxHeight(height: number, available?: number): void {
  setDock(() => ({ toolboxHeight: clampToolboxHeight(height, available) }));
}

export function toggleAnalysisMode(): void {
  workspace.set((state) => state.isAnalysisMode
    ? { isAnalysisMode: false }
    : {
      isAnalysisMode: true,
      page: 'trading',
      tool: state.tool === 'riskOrder' ? 'cursor' : state.tool,
      depthSymbol: null,
      dialog: state.dialog && isTradeDialog(state.dialog) ? null : state.dialog,
    });
}

export function toggleAnalysisPositions(): void {
  workspace.set((state) => ({ isAnalysisPositionsShown: !state.isAnalysisPositionsShown }));
}

export function closeDialog(): void {
  workspace.set({ dialog: null });
}

export function saveProfile(name: string): void {
  const state = workspace.get();
  const profile = captureProfile(state, name);
  const profiles = state.profiles.map((candidate) => candidate.name === state.activeProfile ? captureProfile(state, candidate.name) : candidate);
  workspace.set({ profiles: [...profiles.filter((candidate) => candidate.name !== profile.name), profile], activeProfile: profile.name });
}

export function loadProfile(name: string): void {
  const state = workspace.get();
  if (name === state.activeProfile) return;
  const profile = state.profiles.find((candidate) => candidate.name === name);
  if (!profile) return;
  const profiles = state.profiles.map((candidate) => candidate.name === state.activeProfile ? captureProfile(state, candidate.name) : candidate);
  const { name: profileName, ...settings } = structuredClone(profile);
  workspace.set({ ...settings, profiles, activeProfile: profileName, dialog: null, tool: 'cursor', isChartMaximized: false });
}

export function removeProfile(name: string): void {
  if (name === 'Default') throw new Error('The default profile cannot be removed.');
  if (name === workspace.get().activeProfile) throw new Error('Switch to another profile before removing the current profile.');
  workspace.set((state) => ({ profiles: state.profiles.filter((profile) => profile.name !== name) }));
}

export function saveTemplate(chartId: string, name: string): void {
  const state = workspace.get();
  const chart = state.charts.find((candidate) => candidate.id === chartId);
  if (!chart) throw new Error('This chart has been closed.');
  const template = captureTemplate(chart, name);
  workspace.set({ templates: [...state.templates.filter((candidate) => candidate.name !== template.name), template] });
}

export function loadTemplate(chartId: string, name: string): void {
  const template = workspace.get().templates.find((candidate) => candidate.name === name);
  if (!template) return;
  updateChart(chartId, (chart) => applyTemplate(chart, template, newId));
}
