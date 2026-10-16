import type { OrderTypeKey } from '../../shared/protocol';
import type { ChartTimeframe } from './mt5-timeframes';
import { defaultThemeId } from '@meridian/charts/themes';
import type { ChartSettings, InputValue } from '@meridian/charts';
import { restoreSettings } from '@meridian/charts/settings';
import type { Drawing, IndicatorConfig } from './chart-model';
import { Store } from './store';
import { arrangeFrames, clampFrame, raise, type ChartFrame, type WindowArrangement } from './chart-windows';
import { applyTemplate, captureProfile, captureTemplate, restoreCharts, restoreLayout, restoreProfiles, restoreTemplates, type ChartProfile, type ChartTemplate } from './presets';

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
  frame?: ChartFrame;
  isMinimized?: boolean;
}

export const chartLayouts = [
  { key: 'tabs', label: 'Tabbed (maximized)' },
  { key: 'windows', label: 'Floating windows' },
] as const;

export type ChartLayout = (typeof chartLayouts)[number]['key'];

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
  | { kind: 'order'; symbol: string; volume?: number; type?: OrderTypeKey; price?: number }
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
  | { kind: 'about' };

export interface WorkspaceState {
  page: Page;
  tool: Tool;
  layout: ChartLayout;
  activeChartId: string;
  windowStack: string[];
  toolboxTab: ToolboxTab;
  // A Meridian theme id, or 'system' to follow the operating system.
  theme: string;
  depthSymbol: string | null;
  dialog: Dialog | null;
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
  // Trade mode keeps the chart's drawing rail closed unless asked; analysis mode always shows it.
  isTradeDrawingToolbarShown: boolean;
  isOneClickEnabled: boolean;
  hasAcceptedOneClick: boolean;
  // Analysis mode swaps the terminal chrome for a chart-first layout. Accounts, copiers, signals
  // and automation keep running; only the controls that place or change trades are withdrawn.
  isAnalysisMode: boolean;
  isAnalysisPositionsShown: boolean;
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
  const defaults: WorkspaceState = {
    page: 'trading',
    tool: 'cursor',
    layout: 'tabs',
    activeChartId: charts[0].id,
    windowStack: charts.map((chart) => chart.id),
    toolboxTab: 'trade',
    theme: defaultThemeId,
    depthSymbol: null,
    dialog: null,
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
    isTradeDrawingToolbarShown: false,
    isOneClickEnabled: false,
    hasAcceptedOneClick: false,
    isAnalysisMode: false,
    isAnalysisPositionsShown: false,
  };
  defaults.profiles = [captureProfile(defaults, 'Default')];
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as (Partial<WorkspaceState> & { scheme?: unknown }) | null;
    // MT5 colour schemes gave way to Meridian themes; the old setting is dropped.
    const { scheme, ...saved } = stored ?? {};
    if (stored && Array.isArray(saved.charts)) {
      const restored = { ...defaults, ...saved, ...restoreLayout(saved.layout as string | undefined, restoreCharts(saved.charts)), profiles: restoreProfiles(saved.profiles), templates: restoreTemplates(saved.templates), dialog: null, depthSymbol: null, tool: 'cursor' as const };
      restored.windowStack = [...(saved.windowStack ?? []).filter((id) => restored.charts.some((chart) => chart.id === id)), ...restored.charts.map((chart) => chart.id).filter((id) => !saved.windowStack?.includes(id))];
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
  const { dialog, depthSymbol, tool, ...persisted } = state;
  persisted.profiles = state.profiles.map((profile) => profile.name === state.activeProfile ? captureProfile(state, profile.name) : profile);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Persisting the profile is a convenience; the terminal works without it.
  }
});

export function activeChart(state: WorkspaceState): ChartConfig | undefined {
  return state.charts.find((chart) => chart.id === state.activeChartId) ?? state.charts[0];
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

export function openChart(symbol: string, timeframe?: ChartTimeframe): void {
  const state = workspace.get();
  const frame = arrangeFrames(state.charts.length + 1, 'cascade').at(-1);
  const chart: ChartConfig = { ...makeChart(symbol, timeframe ?? activeChart(state)?.timeframe ?? 'H1'), frame };
  if (state.defaultChartSettings) chart.settings = structuredClone(state.defaultChartSettings);
  workspace.set((current) => ({ charts: [...current.charts, chart], activeChartId: chart.id, windowStack: raise(current.windowStack, chart.id) }));
}

// Chart Settings for every open chart, and optionally their chart type. With `isDefault`, charts
// opened later start with them too.
export function applyChartSettingsToAll(settings: ChartSettings, type?: ChartType, isDefault = false): void {
  workspace.set((state) => ({
    charts: state.charts.map((chart) => ({ ...chart, settings: structuredClone(settings), ...(type ? { type } : {}) })),
    ...(isDefault ? { defaultChartSettings: structuredClone(settings) } : {}),
  }));
}

export function closeChart(id: string): void {
  workspace.set((state) => {
    const charts = state.charts.filter((chart) => chart.id !== id);
    const windowStack = state.windowStack.filter((candidate) => candidate !== id);
    const visible = windowStack.filter((candidate) => !charts.find((chart) => chart.id === candidate)?.isMinimized);
    const activeChartId = state.activeChartId === id ? visible.at(-1) ?? charts.at(-1)?.id ?? '' : state.activeChartId;
    return { charts, activeChartId, windowStack };
  });
}

export function focusChart(id: string): void {
  workspace.set((state) => ({
    activeChartId: id,
    windowStack: raise(state.windowStack, id),
    charts: state.charts.map((chart) => chart.id === id && chart.isMinimized ? { ...chart, isMinimized: false } : chart),
  }));
}

export function setChartFrame(id: string, frame: ChartFrame): void {
  updateChart(id, { frame: clampFrame(frame) });
}

export function minimizeChart(id: string): void {
  workspace.set((state) => {
    const charts = state.charts.map((chart) => chart.id === id ? { ...chart, isMinimized: true } : chart);
    const next = [...state.windowStack].reverse().find((candidate) => candidate !== id && !charts.find((chart) => chart.id === candidate)?.isMinimized);
    return { charts, layout: 'windows', activeChartId: state.activeChartId === id && next ? next : state.activeChartId };
  });
}

export function maximizeChart(id: string): void {
  focusChart(id);
  workspace.set({ layout: 'tabs' });
}

export function restoreWindows(): void {
  workspace.set((state) => {
    const frames = arrangeFrames(state.charts.length, 'cascade');
    return { layout: 'windows', charts: state.charts.map((chart, index) => chart.frame ? chart : { ...chart, frame: frames[index] }) };
  });
}

export function arrangeWindows(arrangement: WindowArrangement): void {
  workspace.set((state) => {
    const ordered = arrangement === 'cascade' ? state.windowStack : state.charts.map((chart) => chart.id);
    const open = ordered.map((id) => state.charts.find((chart) => chart.id === id)).filter((chart): chart is ChartConfig => !!chart && !chart.isMinimized);
    const frames = new Map(arrangeFrames(open.length, arrangement).map((frame, index) => [open[index].id, frame]));
    return { layout: 'windows', charts: state.charts.map((chart) => frames.has(chart.id) ? { ...chart, frame: frames.get(chart.id) } : chart) };
  });
}

export function arrangeIcons(): void {
  workspace.set((state) => ({ layout: 'windows', charts: state.charts.map((chart) => ({ ...chart, isMinimized: true })) }));
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
  // keeps analysis mode from placing or changing trades, whatever menu or shortcut asked.
  if (workspace.get().isAnalysisMode && isTradeDialog(dialog)) return;
  workspace.set({ dialog });
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
  workspace.set({ ...settings, profiles, activeProfile: profileName, dialog: null, tool: 'cursor' });
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
