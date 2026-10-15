import type { ScaleMode } from './core/price-scale';
import type { MeridianTheme } from './themes';
import type { LineStyle } from './types';
import type { Field, FieldValues } from './ui/dialog';

// Chart appearance the user can change in Chart Settings. Colours left null follow the theme.
export interface ChartSettings {
  upColor: string | null;
  downColor: string | null;
  isBorderVisible: boolean;
  borderUpColor: string | null;
  borderDownColor: string | null;
  isWickVisible: boolean;
  wickUpColor: string | null;
  wickDownColor: string | null;
  background: string | null;
  isVerticalGridShown: boolean;
  isHorizontalGridShown: boolean;
  gridColor: string | null;
  crosshairColor: string | null;
  crosshairStyle: LineStyle;
  isWatermarkShown: boolean;
  isTitleShown: boolean;
  isOhlcShown: boolean;
  isStudyValuesShown: boolean;
  isLastPriceLineShown: boolean;
  isLastPriceLabelShown: boolean;
  isCountdownShown: boolean;
  isStudyLabelsShown: boolean;
  scaleMode: ScaleMode;
  isScaleInverted: boolean;
  rightMarginBars: number;
}

export const defaultSettings: ChartSettings = {
  upColor: null,
  downColor: null,
  isBorderVisible: false,
  borderUpColor: null,
  borderDownColor: null,
  isWickVisible: true,
  wickUpColor: null,
  wickDownColor: null,
  background: null,
  isVerticalGridShown: true,
  isHorizontalGridShown: true,
  gridColor: null,
  crosshairColor: null,
  crosshairStyle: 'dashed',
  isWatermarkShown: true,
  isTitleShown: true,
  isOhlcShown: true,
  isStudyValuesShown: true,
  isLastPriceLineShown: true,
  isLastPriceLabelShown: true,
  isCountdownShown: true,
  isStudyLabelsShown: true,
  scaleMode: 'normal',
  isScaleInverted: false,
  rightMarginBars: 5,
};

const scaleModes: { mode: ScaleMode; label: string }[] = [
  { mode: 'normal', label: 'Regular' },
  { mode: 'log', label: 'Logarithmic' },
  { mode: 'percent', label: 'Percent' },
  { mode: 'indexed', label: 'Indexed to 100' },
];

const colourKeys = ['upColor', 'downColor', 'borderUpColor', 'borderDownColor', 'wickUpColor', 'wickDownColor', 'background', 'gridColor', 'crosshairColor'] as const;
const isColour = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

// Settings from storage: unknown keys dropped, wrong types replaced by defaults.
export function restoreSettings(value: unknown): ChartSettings {
  const saved = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result: Record<string, unknown> = { ...defaultSettings };
  for (const [key, fallback] of Object.entries(defaultSettings)) {
    const candidate = saved[key];
    if ((colourKeys as readonly string[]).includes(key)) result[key] = candidate === null || isColour(candidate) ? candidate : fallback;
    else if (key === 'scaleMode') result[key] = scaleModes.some((option) => option.mode === candidate) ? candidate : fallback;
    else if (key === 'crosshairStyle') result[key] = candidate === 'solid' || candidate === 'dashed' || candidate === 'dotted' ? candidate : fallback;
    else if (typeof fallback === 'number') result[key] = typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(0, Math.min(100, candidate)) : fallback;
    else result[key] = typeof candidate === typeof fallback ? candidate : fallback;
  }
  return result as unknown as ChartSettings;
}

export function settingsFields(settings: ChartSettings, theme: MeridianTheme): Field[] {
  const { chart } = theme;
  const colour = (key: (typeof colourKeys)[number], label: string, tab: string, fallback: string): Field => ({ key, label, tab, type: 'color', value: settings[key] ?? fallback });
  return [
    colour('upColor', 'Body up', 'Symbol', chart.up),
    colour('downColor', 'Body down', 'Symbol', chart.down),
    { key: 'isBorderVisible', label: 'Borders', tab: 'Symbol', type: 'checkbox', value: settings.isBorderVisible },
    colour('borderUpColor', 'Border up', 'Symbol', chart.up),
    colour('borderDownColor', 'Border down', 'Symbol', chart.down),
    { key: 'isWickVisible', label: 'Wicks', tab: 'Symbol', type: 'checkbox', value: settings.isWickVisible },
    colour('wickUpColor', 'Wick up', 'Symbol', chart.up),
    colour('wickDownColor', 'Wick down', 'Symbol', chart.down),
    { key: 'isTitleShown', label: 'Symbol title', tab: 'Status line', type: 'checkbox', value: settings.isTitleShown },
    { key: 'isOhlcShown', label: 'OHLC values', tab: 'Status line', type: 'checkbox', value: settings.isOhlcShown },
    { key: 'isStudyValuesShown', label: 'Indicator values', tab: 'Status line', type: 'checkbox', value: settings.isStudyValuesShown },
    { key: 'scaleMode', label: 'Price scale', tab: 'Scales', type: 'select', value: scaleModes.find((option) => option.mode === settings.scaleMode)!.label, options: scaleModes.map((option) => option.label) },
    { key: 'isScaleInverted', label: 'Invert scale', tab: 'Scales', type: 'checkbox', value: settings.isScaleInverted },
    { key: 'isLastPriceLabelShown', label: 'Last price label', tab: 'Scales', type: 'checkbox', value: settings.isLastPriceLabelShown },
    { key: 'isLastPriceLineShown', label: 'Last price line', tab: 'Scales', type: 'checkbox', value: settings.isLastPriceLineShown },
    { key: 'isCountdownShown', label: 'Countdown to bar close', tab: 'Scales', type: 'checkbox', value: settings.isCountdownShown },
    { key: 'isStudyLabelsShown', label: 'Indicator labels', tab: 'Scales', type: 'checkbox', value: settings.isStudyLabelsShown },
    { key: 'rightMarginBars', label: 'Right margin (bars)', tab: 'Scales', type: 'number', value: settings.rightMarginBars, min: 0, max: 100, step: 1 },
    colour('background', 'Background', 'Appearance', chart.background),
    { key: 'isVerticalGridShown', label: 'Vertical grid lines', tab: 'Appearance', type: 'checkbox', value: settings.isVerticalGridShown },
    { key: 'isHorizontalGridShown', label: 'Horizontal grid lines', tab: 'Appearance', type: 'checkbox', value: settings.isHorizontalGridShown },
    colour('gridColor', 'Grid', 'Appearance', chart.grid),
    colour('crosshairColor', 'Crosshair', 'Appearance', chart.crosshair),
    { key: 'crosshairStyle', label: 'Crosshair style', tab: 'Appearance', type: 'select', value: settings.crosshairStyle, options: ['dashed', 'dotted', 'solid'] },
    { key: 'isWatermarkShown', label: 'Symbol watermark', tab: 'Appearance', type: 'checkbox', value: settings.isWatermarkShown },
  ];
}

// Values from the dialog. A colour left at the theme's colour stays null, so it keeps following
// the theme.
export function applySettingsFields(values: FieldValues, theme: MeridianTheme): ChartSettings {
  const { chart } = theme;
  const themeColours: Record<(typeof colourKeys)[number], string> = {
    upColor: chart.up, downColor: chart.down, borderUpColor: chart.up, borderDownColor: chart.down, wickUpColor: chart.up, wickDownColor: chart.down,
    background: chart.background, gridColor: chart.grid, crosshairColor: chart.crosshair,
  };
  const result: Record<string, unknown> = { ...values };
  for (const key of colourKeys) result[key] = String(values[key]).toLowerCase() === themeColours[key].toLowerCase() ? null : values[key];
  result.scaleMode = scaleModes.find((option) => option.label === values.scaleMode)?.mode ?? 'normal';
  return restoreSettings(result);
}
