import type { OrderTypeKey, Timeframe } from '../../shared/protocol';
import { indicatorKind, type IndicatorConfig, type IndicatorKey } from './indicators';
import { Store } from './store';
import { arrangeFrames, clampFrame, raise, type ChartFrame, type WindowArrangement } from './chart-windows';
import { applyTemplate, captureProfile, captureTemplate, restoreLayout, restoreProfiles, restoreTemplates, type ChartProfile, type ChartTemplate } from './presets';

export const chartTypes = [
  { key: 'bars', label: 'Bar Chart', shortcut: 'Alt+1', description: 'Each bar shows open, high, low and close.' },
  { key: 'candles', label: 'Candlesticks', shortcut: 'Alt+2', description: 'Filled bodies show whether price rose or fell.' },
  { key: 'line', label: 'Line Chart', shortcut: 'Alt+3', description: 'A single line through closing prices.' },
] as const;

export type ChartType = (typeof chartTypes)[number]['key'];

export const colorSchemes = [
  { key: 'greenOnBlack', label: 'Green on Black' },
  { key: 'colorOnWhite', label: 'Color on White' },
  { key: 'blackOnWhite', label: 'Black on White' },
] as const;

export type ColorScheme = (typeof colorSchemes)[number]['key'];

export const tools = [
  { key: 'cursor', label: 'Cursor', description: 'Select, move and edit chart objects.' },
  { key: 'crosshair', label: 'Crosshair', description: 'Read exact prices and times under the pointer.' },
  { key: 'hline', label: 'Horizontal Line', description: 'Click to mark a price level.' },
  { key: 'trend', label: 'Trendline', description: 'Drag between two points.' },
  { key: 'vline', label: 'Vertical Line', description: 'Click to mark a moment in time.' },
  { key: 'ray', label: 'Horizontal Ray', description: 'A price level that extends to the right from where you click.' },
  { key: 'rectangle', label: 'Rectangle', description: 'Drag to box a price and time range.' },
  { key: 'fibonacci', label: 'Fibonacci Retracement', description: 'Drag from a swing low to a swing high, or the reverse.' },
  { key: 'riskOrder', label: 'Risk Order', description: 'Drag the entry, then the stop loss and take profit; the volume follows your risk setting.' },
] as const;

export type Tool = (typeof tools)[number]['key'];

export type Drawing =
  | { id: string; kind: 'hline'; price: number }
  | { id: string; kind: 'vline'; time: number }
  | { id: string; kind: 'ray'; from: { time: number; price: number } }
  | { id: string; kind: 'trend' | 'rectangle' | 'fibonacci'; from: { time: number; price: number }; to: { time: number; price: number } };

export interface ChartConfig {
  id: string;
  symbol: string;
  type: ChartType;
  timeframe: Timeframe;
  drawings: Drawing[];
  indicators: IndicatorConfig[];
  isGridShown: boolean;
  isVolumeShown: boolean;
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
  { key: 'copier', label: 'Copy Trading', shortcut: 'Ctrl+2' },
  { key: 'signals', label: 'Signals', shortcut: 'Ctrl+3' },
  { key: 'automation', label: 'Automation', shortcut: 'Ctrl+4' },
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
  | { kind: 'indicator'; chartId: string; indicator: IndicatorKey }
  | { kind: 'profile' }
  | { kind: 'template'; chartId: string }
  | { kind: 'about' };

export interface WorkspaceState {
  page: Page;
  tool: Tool;
  layout: ChartLayout;
  activeChartId: string;
  windowStack: string[];
  toolboxTab: ToolboxTab;
  scheme: ColorScheme;
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
  isOneClickEnabled: boolean;
  hasAcceptedOneClick: boolean;
}

const STORAGE_KEY = 'openterm.workspace.v1';

export const newId = () => Math.random().toString(36).slice(2, 10);

export function makeChart(symbol: string, timeframe: Timeframe = 'H1'): ChartConfig {
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
    scheme: 'greenOnBlack',
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
    isOneClickEnabled: false,
    hasAcceptedOneClick: false,
  };
  defaults.profiles = [captureProfile(defaults, 'Default')];
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<WorkspaceState> | null;
    if (saved && Array.isArray(saved.charts)) {
      const restored = { ...defaults, ...saved, ...restoreLayout(saved.layout as string | undefined, saved.charts), profiles: restoreProfiles(saved.profiles), templates: restoreTemplates(saved.templates), dialog: null, depthSymbol: null, tool: 'cursor' as const };
      restored.windowStack = [...(saved.windowStack ?? []).filter((id) => restored.charts.some((chart) => chart.id === id)), ...restored.charts.map((chart) => chart.id).filter((id) => !saved.windowStack?.includes(id))];
      if (!restored.profiles.some((profile) => profile.name === restored.activeProfile)) restored.activeProfile = 'Default';
      if (!restored.profiles.some((profile) => profile.name === 'Default')) restored.profiles = [captureProfile(restored, 'Default'), ...restored.profiles];
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

export function openChart(symbol: string, timeframe?: Timeframe): void {
  const state = workspace.get();
  const frame = arrangeFrames(state.charts.length + 1, 'cascade').at(-1);
  const chart = { ...makeChart(symbol, timeframe ?? activeChart(state)?.timeframe ?? 'H1'), frame };
  workspace.set((current) => ({ charts: [...current.charts, chart], activeChartId: chart.id, windowStack: raise(current.windowStack, chart.id) }));
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

export function addIndicator(chartId: string, kind: IndicatorKey, params: Record<string, number | boolean>): void {
  updateChart(chartId, (chart) => ({ indicators: [...chart.indicators, { id: newId(), kind, params }] }));
}

export function defaultParams(kind: IndicatorKey): Record<string, number | boolean> {
  return { ...indicatorKind(kind).defaults };
}

export function openDialog(dialog: Dialog): void {
  workspace.set({ dialog });
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
  const template = captureTemplate(chart, state.scheme, name);
  workspace.set({ templates: [...state.templates.filter((candidate) => candidate.name !== template.name), template] });
}

export function loadTemplate(chartId: string, name: string): void {
  const template = workspace.get().templates.find((candidate) => candidate.name === name);
  if (!template) return;
  updateChart(chartId, (chart) => applyTemplate(chart, template, newId));
  workspace.set({ scheme: template.scheme });
}
