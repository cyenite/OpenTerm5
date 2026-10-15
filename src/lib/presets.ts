import { restoreSettings } from '@meridian/charts/settings';
import { migrateDrawings, migrateIndicators } from './chart-model';
import { arrangeFrames, isFrame } from './chart-windows';
import { isChartTimeframe } from './mt5-timeframes';
import type { ChartConfig, ChartLayout, WorkspaceState } from './workspace';

// Presets saved before Meridian also carry an MT5 colour scheme. The theme is now an
// application setting, so restoring ignores it.

export interface ChartTemplate {
  name: string;
  settings: Omit<ChartConfig, 'id' | 'symbol' | 'timeframe' | 'frame' | 'isMinimized'>;
}

export interface ChartProfile {
  name: string;
  layout: WorkspaceState['layout'];
  charts: ChartConfig[];
  activeChartId: string;
}

// Before floating windows existed the grid layout was stored as 'tile'.
export function restoreLayout(layout: string | undefined, charts: ChartConfig[]): { layout: ChartLayout; charts: ChartConfig[] } {
  if (layout !== 'tile') return { layout: layout === 'windows' ? 'windows' : 'tabs', charts };
  const frames = arrangeFrames(charts.length, 'tile');
  return { layout: 'windows', charts: charts.map((chart, index) => ({ ...chart, frame: chart.frame ?? frames[index] })) };
}

export function presetName(raw: string): string {
  const name = raw.trim();
  if (!name || name.length > 64 || /[\u0000-\u001f]/.test(name)) {
    throw new Error('Enter a name of 1–64 characters without control characters.');
  }
  return name;
}

export function captureProfile(state: WorkspaceState, name: string): ChartProfile {
  return structuredClone({ name: presetName(name), layout: state.layout, charts: state.charts, activeChartId: state.activeChartId });
}

export function captureTemplate(chart: ChartConfig, name: string): ChartTemplate {
  const { id, symbol, timeframe, frame, isMinimized, ...settings } = chart;
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

// A valid saved chart with its studies and drawings in Meridian's form, or null.
export function restoreChart(value: unknown): ChartConfig | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.symbol !== 'string' || !isChartTimeframe(value.timeframe)) return null;
  if (!chartTypeKeys.includes(String(value.type)) || typeof value.isGridShown !== 'boolean' || typeof value.isVolumeShown !== 'boolean') return null;
  if (value.frame !== undefined && !isFrame(value.frame) || value.isMinimized !== undefined && typeof value.isMinimized !== 'boolean') return null;
  const drawings = migrateDrawings(value.drawings);
  const indicators = migrateIndicators(value.indicators);
  if (!drawings || !indicators) return null;
  const chart: ChartConfig = { ...(value as unknown as ChartConfig), drawings, indicators };
  if (value.settings === undefined) delete chart.settings;
  else chart.settings = restoreSettings(value.settings);
  return chart;
}

export function restoreCharts(value: unknown): ChartConfig[] {
  return Array.isArray(value) ? value.map(restoreChart).filter((chart): chart is ChartConfig => chart !== null) : [];
}

export function restoreProfiles(value: unknown): ChartProfile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((profile): ChartProfile[] => {
    if (!isRecord(profile) || !isName(profile.name) || !['tabs', 'tile', 'windows'].includes(String(profile.layout)) || typeof profile.activeChartId !== 'string' || !Array.isArray(profile.charts)) return [];
    const charts = profile.charts.map(restoreChart);
    if (!charts.every((chart): chart is ChartConfig => chart !== null)) return [];
    return [{ name: profile.name, activeChartId: profile.activeChartId, ...restoreLayout(String(profile.layout), charts) }];
  });
}

export function restoreTemplates(value: unknown): ChartTemplate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((template): ChartTemplate[] => {
    if (!isRecord(template) || !isName(template.name) || !isRecord(template.settings)) return [];
    const chart = restoreChart({ ...template.settings, id: '', symbol: '', timeframe: 'H1' });
    if (!chart) return [];
    const { id, symbol, timeframe, frame, isMinimized, ...settings } = chart;
    return [{ name: template.name, settings }];
  });
}
