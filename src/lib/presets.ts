import { restoreSettings } from '@meridian/charts/settings';
import { isLayoutKey, layoutCount, layoutForCount, layoutOf, layoutSyncs, linkGroups, restoreLayoutKey, restoreSizes, type LayoutKey, type SplitSizes } from './chart-layouts';
import { markets } from '../../shared/protocol';
import { inferMarket, makeTab, tabActiveChartId, type ChartTab } from './chart-tabs';
import { migrateDrawings, migrateIndicators, type Drawing } from './chart-model';
import { isChartTimeframe } from './mt5-timeframes';
import type { ChartConfig, WorkspaceState } from './workspace';

// Presets saved before Meridian also carry an MT5 colour scheme. The theme is now an
// application setting, so restoring ignores it.

export interface ChartTemplate {
  name: string;
  settings: Omit<ChartConfig, 'id' | 'symbol' | 'timeframe' | 'linkGroup'>;
}

export interface ChartProfile {
  name: string;
  activeTabId: string;
  tabs: ChartTab[];
  charts: ChartConfig[];
}

export type WorkspaceCharts = Pick<ChartProfile, 'activeTabId' | 'tabs' | 'charts'>;

export function presetName(raw: string): string {
  const name = raw.trim();
  if (!name || name.length > 64 || /[\u0000-\u001f]/.test(name)) {
    throw new Error('Enter a name of 1–64 characters without control characters.');
  }
  return name;
}

export function captureProfile(state: WorkspaceState, name: string): ChartProfile {
  return structuredClone({ name: presetName(name), activeTabId: state.activeTabId, tabs: state.tabs, charts: state.charts });
}

export function captureTemplate(chart: ChartConfig, name: string): ChartTemplate {
  const { id, symbol, timeframe, linkGroup, ...settings } = chart;
  return structuredClone({ name: presetName(name), settings });
}

export function applyTemplate(chart: ChartConfig, template: ChartTemplate, newId: () => string): ChartConfig {
  const settings = structuredClone(template.settings);
  return {
    ...chart,
    ...settings,
    drawings: settings.drawings.map((drawing) => ({ ...drawing, id: newId() })),
    indicators: settings.indicators.map((indicator) => ({ ...indicator, id: newId() })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && !!value && value.length <= 64 && !/[\u0000-\u001f]/.test(value);
}

const chartTypeKeys = ['bars', 'candles', 'hollow', 'line', 'area', 'baseline', 'heikinashi'];

// A valid saved chart with its studies and drawings in Meridian's form, or null. The MT5 window
// geometry older versions saved (`frame`, `isMinimized`) is dropped.
export function restoreChart(value: unknown): ChartConfig | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.symbol !== 'string' || !isChartTimeframe(value.timeframe)) return null;
  if (!chartTypeKeys.includes(String(value.type)) || typeof value.isGridShown !== 'boolean' || typeof value.isVolumeShown !== 'boolean') return null;
  const drawings = migrateDrawings(value.drawings);
  const indicators = migrateIndicators(value.indicators);
  if (!drawings || !indicators) return null;
  const { frame, isMinimized, linkGroup, ...rest } = value;
  const chart: ChartConfig = { ...(rest as unknown as ChartConfig), drawings, indicators };
  if (linkGroups.some((group) => group.key === linkGroup)) chart.linkGroup = linkGroup as ChartConfig['linkGroup'];
  if (value.settings === undefined) delete chart.settings;
  else chart.settings = restoreSettings(value.settings);
  return chart;
}

const marketOfCharts = (charts: readonly ChartConfig[]) => inferMarket(charts.map((chart) => chart.symbol));

function restoreTab(value: unknown, claimed: Set<string>, charts: readonly ChartConfig[]): ChartTab | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !Array.isArray(value.chartIds)) return null;
  const chartIds = value.chartIds.filter((id): id is string => typeof id === 'string' && claimed.has(id));
  chartIds.forEach((id) => claimed.delete(id));
  if (!chartIds.length) return null;
  const saved = restoreLayoutKey(value.layout);
  const layout = chartIds.length < layoutCount(saved) ? layoutForCount(chartIds.length) : saved;
  const syncs = layoutSyncs.map((sync) => sync.key).filter((key) => Array.isArray(value.syncs) && value.syncs.includes(key));
  const sizes = isRecord(value.sizes) ? Object.fromEntries(Object.entries(value.sizes).filter(([key]) => isLayoutKey(key)).map(([key, shares]) => [key, restoreSizes(shares, layoutOf(key as LayoutKey).tree)])) as Partial<Record<LayoutKey, SplitSizes>> : {};
  const drawings = isRecord(value.drawings) ? Object.fromEntries(Object.entries(value.drawings).flatMap(([key, list]) => { const restored = migrateDrawings(list); return key && restored?.length ? [[key, restored]] : []; })) as Record<string, Drawing[]> : {};
  const market = markets.find((candidate) => candidate.key === value.market)?.key ?? marketOfCharts(charts.filter((chart) => chartIds.includes(chart.id)));
  const tab = { ...makeTab(value.id, chartIds, layout, syncs, market), sizes, drawings, activeChartId: typeof value.activeChartId === 'string' ? value.activeChartId : '' };
  return { ...tab, activeChartId: tabActiveChartId(tab) };
}

// Profiles and saved workspaces before layout tabs held MT5 chart windows: tabbed charts become a
// tab each, and floating windows one tab in reading order, its layout fitting the open windows.
function legacyTabs(saved: Record<string, unknown>, charts: ChartConfig[], raw: unknown[]): { tabs: ChartTab[]; activeTabId: string } {
  const activeChartId = typeof saved.activeChartId === 'string' ? saved.activeChartId : '';
  if (saved.layout !== 'windows' && saved.layout !== 'tile') {
    const tabs = charts.map((chart) => makeTab(`tab-${chart.id}`, [chart.id], 's', ['crosshair'], marketOfCharts([chart])));
    return { tabs, activeTabId: tabs.find((tab) => tab.chartIds[0] === activeChartId)?.id ?? tabs[0]?.id ?? '' };
  }
  const windows = new Map(raw.filter(isRecord).map((entry) => [entry.id, entry]));
  const frameOf = (chart: ChartConfig) => (isRecord(windows.get(chart.id)?.frame) ? windows.get(chart.id)!.frame : {}) as { top?: number; left?: number };
  const isIcon = (chart: ChartConfig) => windows.get(chart.id)?.isMinimized === true;
  const byPosition = (left: ChartConfig, right: ChartConfig) => (frameOf(left).top ?? 0) - (frameOf(right).top ?? 0) || (frameOf(left).left ?? 0) - (frameOf(right).left ?? 0);
  const open = charts.filter((chart) => !isIcon(chart)).sort(byPosition);
  const ordered = [...open, ...charts.filter(isIcon)];
  if (!ordered.length) return { tabs: [], activeTabId: '' };
  const tab = makeTab(`tab-${ordered[0].id}`, ordered.map((chart) => chart.id), layoutForCount(Math.max(1, open.length)), ['crosshair'], marketOfCharts(ordered));
  const active = { ...tab, activeChartId: activeChartId || tab.activeChartId };
  return { tabs: [{ ...active, activeChartId: tabActiveChartId(active) }], activeTabId: tab.id };
}

// The charts and tabs of a saved workspace or profile. Each chart belongs to one tab; a chart no
// tab lists gets a tab of its own.
export function restoreWorkspaceCharts(saved: Record<string, unknown>): WorkspaceCharts {
  const raw = Array.isArray(saved.charts) ? saved.charts : [];
  const charts = raw.map(restoreChart).filter((chart): chart is ChartConfig => chart !== null);
  if (!Array.isArray(saved.tabs)) return { charts, ...legacyTabs(saved, charts, raw) };
  const claimed = new Set(charts.map((chart) => chart.id));
  const tabs = saved.tabs.map((tab) => restoreTab(tab, claimed, charts)).filter((tab): tab is ChartTab => tab !== null);
  for (const chart of charts) if (claimed.has(chart.id)) tabs.push(makeTab(`tab-${chart.id}`, [chart.id], 's', ['crosshair'], marketOfCharts([chart])));
  const activeTabId = tabs.find((tab) => tab.id === saved.activeTabId)?.id ?? tabs[0]?.id ?? '';
  return { charts, tabs, activeTabId };
}

export function restoreProfiles(value: unknown): ChartProfile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((profile): ChartProfile[] => {
    if (!isRecord(profile) || !isName(profile.name) || !Array.isArray(profile.charts)) return [];
    if (!profile.charts.every((chart) => restoreChart(chart) !== null)) return [];
    return [{ name: profile.name, ...restoreWorkspaceCharts(profile) }];
  });
}

export function restoreTemplates(value: unknown): ChartTemplate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((template): ChartTemplate[] => {
    if (!isRecord(template) || !isName(template.name) || !isRecord(template.settings)) return [];
    const chart = restoreChart({ ...template.settings, id: '', symbol: '', timeframe: 'H1' });
    if (!chart) return [];
    const { id, symbol, timeframe, linkGroup, ...settings } = chart;
    return [{ name: template.name, settings }];
  });
}
