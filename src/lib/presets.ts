import { isDrawing } from './drawing-geometry';
import { timeframes } from '../../shared/protocol';
import { indicatorKinds } from './indicators';
import { arrangeFrames, isFrame } from './chart-windows';
import type { ChartConfig, ChartLayout, ColorScheme, WorkspaceState } from './workspace';

export interface ChartTemplate {
  name: string;
  scheme: ColorScheme;
  settings: Omit<ChartConfig, 'id' | 'symbol' | 'timeframe' | 'frame' | 'isMinimized'>;
}

export interface ChartProfile {
  name: string;
  scheme: ColorScheme;
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
  return structuredClone({ name: presetName(name), scheme: state.scheme, layout: state.layout, charts: state.charts, activeChartId: state.activeChartId });
}

export function captureTemplate(chart: ChartConfig, scheme: ColorScheme, name: string): ChartTemplate {
  const { id, symbol, timeframe, frame, isMinimized, ...settings } = chart;
  return structuredClone({ name: presetName(name), scheme, settings });
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

function isScheme(value: unknown): value is ColorScheme {
  return value === 'greenOnBlack' || value === 'colorOnWhite' || value === 'blackOnWhite';
}

function isChart(value: unknown): value is ChartConfig {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.symbol !== 'string' || !timeframes.some((period) => period.label === value.timeframe)) return false;
  if (!['bars', 'candles', 'line'].includes(String(value.type)) || typeof value.isGridShown !== 'boolean' || typeof value.isVolumeShown !== 'boolean') return false;
  if (!Array.isArray(value.drawings) || !Array.isArray(value.indicators)) return false;
  if (value.frame !== undefined && !isFrame(value.frame) || value.isMinimized !== undefined && typeof value.isMinimized !== 'boolean') return false;
  return value.drawings.every(isDrawing) &&
    value.indicators.every((indicator) => isRecord(indicator) && typeof indicator.id === 'string' && indicatorKinds.some((kind) => kind.key === indicator.kind) && isRecord(indicator.params) && Object.values(indicator.params).every((parameter) => typeof parameter === 'boolean' || typeof parameter === 'number' && Number.isFinite(parameter)));
}

export function restoreProfiles(value: unknown): ChartProfile[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((profile): profile is ChartProfile => isRecord(profile) && isName(profile.name) && isScheme(profile.scheme) && ['tabs', 'tile', 'windows'].includes(String(profile.layout)) && typeof profile.activeChartId === 'string' && Array.isArray(profile.charts) && profile.charts.every(isChart))
    .map((profile) => ({ ...profile, ...restoreLayout(profile.layout, profile.charts) }));
}

export function restoreTemplates(value: unknown): ChartTemplate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((template): template is ChartTemplate => isRecord(template) && isName(template.name) && isScheme(template.scheme) && isRecord(template.settings) && isChart({ ...template.settings, id: '', symbol: '', timeframe: 'H1' }));
}
