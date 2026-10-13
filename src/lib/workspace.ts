import type { OrderTypeKey, Timeframe } from '../../shared/protocol';
import { indicatorKind, type IndicatorConfig, type IndicatorKey } from './indicators';
import { Store } from './store';
import { applyTemplate, captureProfile, captureTemplate, restoreProfiles, restoreTemplates, type ChartProfile, type ChartTemplate } from './presets';

export const chartTypes = [
  { key: 'bars', label: 'Bar Chart', shortcut: 'Alt+1' },
  { key: 'candles', label: 'Candlesticks', shortcut: 'Alt+2' },
  { key: 'line', label: 'Line Chart', shortcut: 'Alt+3' },
] as const;

export type ChartType = (typeof chartTypes)[number]['key'];

export const colorSchemes = [
  { key: 'greenOnBlack', label: 'Green on Black' },
  { key: 'colorOnWhite', label: 'Color on White' },
  { key: 'blackOnWhite', label: 'Black on White' },
] as const;

export type ColorScheme = (typeof colorSchemes)[number]['key'];

export const tools = [
  { key: 'cursor', label: 'Cursor' },
  { key: 'crosshair', label: 'Crosshair' },
  { key: 'hline', label: 'Horizontal Line' },
  { key: 'trend', label: 'Trendline' },
  { key: 'vline', label: 'Vertical Line' },
  { key: 'ray', label: 'Horizontal Ray' },
  { key: 'rectangle', label: 'Rectangle' },
  { key: 'fibonacci', label: 'Fibonacci Retracement' },
  { key: 'riskOrder', label: 'Risk Order: drag the entry, then the stop loss and take profit' },
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
}

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
  | { kind: 'servers' }
  | { kind: 'alerts' }
  | { kind: 'indicator'; chartId: string; indicator: IndicatorKey }
  | { kind: 'profile' }
  | { kind: 'template'; chartId: string }
  | { kind: 'about' };

export interface WorkspaceState {
  page: Page;
  tool: Tool;
  layout: 'tabs' | 'tile';
  activeChartId: string;
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

const STORAGE_KEY = 'terminal5.workspace.v1';

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
      const restored = { ...defaults, ...saved, profiles: restoreProfiles(saved.profiles), templates: restoreTemplates(saved.templates), dialog: null, depthSymbol: null, tool: 'cursor' as const };
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
  const chart = makeChart(symbol, timeframe ?? activeChart(workspace.get())?.timeframe ?? 'H1');
  workspace.set((state) => ({ charts: [...state.charts, chart], activeChartId: chart.id }));
}

export function closeChart(id: string): void {
  workspace.set((state) => {
    const charts = state.charts.filter((chart) => chart.id !== id);
    const activeChartId = state.activeChartId === id ? charts.at(-1)?.id ?? '' : state.activeChartId;
    return { charts, activeChartId };
  });
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
