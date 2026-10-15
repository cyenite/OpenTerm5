import type { ScaleMode } from './core/price-scale';
import type { MeridianTheme } from './themes';
import type { LineStyle } from './types';
import type { Field, FieldValues } from './ui/dialog';

// Chart appearance the user can change in Chart Settings. Colours left null follow the theme.
export interface ChartSettings {
  upColor: string | null;
  downColor: string | null;
  isBodyVisible: boolean;
  isBorderVisible: boolean;
  borderUpColor: string | null;
  borderDownColor: string | null;
  isWickVisible: boolean;
  wickUpColor: string | null;
  wickDownColor: string | null;
  background: string | null;
  // The colour the background fades to at the bottom; null keeps the theme's (a solid colour set
  // without one stays solid).
  backgroundGradient: string | null;
  isVerticalGridShown: boolean;
  isHorizontalGridShown: boolean;
  verticalGridColor: string | null;
  horizontalGridColor: string | null;
  verticalGridStyle: LineStyle;
  horizontalGridStyle: LineStyle;
  crosshairColor: string | null;
  crosshairStyle: LineStyle;
  crosshairWidth: number;
  textColor: string | null;
  // The axis border lines; null follows the theme's border.
  scaleLineColor: string | null;
  scaleFontSize: number;
  // The lines between panes; null follows the theme's border.
  separatorColor: string | null;
  isWatermarkShown: boolean;
  isTitleShown: boolean;
  isOhlcShown: boolean;
  isBarChangeShown: boolean;
  isStudyValuesShown: boolean;
  isStudyArgumentsShown: boolean;
  isLastPriceLineShown: boolean;
  // Null takes the last candle's colour.
  lastPriceLineColor: string | null;
  lastPriceLineWidth: number;
  isLastPriceLabelShown: boolean;
  isCountdownShown: boolean;
  isStudyLabelsShown: boolean;
  isPriceCrosshairLabelShown: boolean;
  isTimeCrosshairLabelShown: boolean;
  scaleMode: ScaleMode;
  isScaleInverted: boolean;
  rightMarginBars: number;
  topMarginPercent: number;
  bottomMarginPercent: number;
}

export const defaultSettings: ChartSettings = {
  upColor: null,
  downColor: null,
  isBodyVisible: true,
  isBorderVisible: false,
  borderUpColor: null,
  borderDownColor: null,
  isWickVisible: true,
  wickUpColor: null,
  wickDownColor: null,
  background: null,
  backgroundGradient: null,
  isVerticalGridShown: true,
  isHorizontalGridShown: true,
  verticalGridColor: null,
  horizontalGridColor: null,
  verticalGridStyle: 'solid',
  horizontalGridStyle: 'solid',
  crosshairColor: null,
  crosshairStyle: 'dashed',
  crosshairWidth: 1,
  textColor: null,
  scaleLineColor: null,
  scaleFontSize: 11,
  separatorColor: null,
  isWatermarkShown: true,
  isTitleShown: true,
  isOhlcShown: true,
  isBarChangeShown: true,
  isStudyValuesShown: true,
  isStudyArgumentsShown: true,
  isLastPriceLineShown: true,
  lastPriceLineColor: null,
  lastPriceLineWidth: 1,
  isLastPriceLabelShown: true,
  isCountdownShown: true,
  isStudyLabelsShown: true,
  isPriceCrosshairLabelShown: true,
  isTimeCrosshairLabelShown: true,
  scaleMode: 'normal',
  isScaleInverted: false,
  rightMarginBars: 5,
  topMarginPercent: 10,
  bottomMarginPercent: 10,
};

const scaleModes: { mode: ScaleMode; label: string }[] = [
  { mode: 'normal', label: 'Regular' },
  { mode: 'log', label: 'Logarithmic' },
  { mode: 'percent', label: 'Percent' },
  { mode: 'indexed', label: 'Indexed to 100' },
];

const colourKeys = [
  'upColor', 'downColor', 'borderUpColor', 'borderDownColor', 'wickUpColor', 'wickDownColor', 'background', 'backgroundGradient',
  'verticalGridColor', 'horizontalGridColor', 'crosshairColor', 'textColor', 'scaleLineColor', 'separatorColor', 'lastPriceLineColor',
] as const;

const lineStyleKeys = ['crosshairStyle', 'verticalGridStyle', 'horizontalGridStyle'] as const;

const numberRanges = {
  rightMarginBars: [0, 100],
  crosshairWidth: [1, 4],
  scaleFontSize: [8, 20],
  lastPriceLineWidth: [1, 4],
  topMarginPercent: [0, 40],
  bottomMarginPercent: [0, 40],
} as const satisfies Partial<Record<keyof ChartSettings, readonly [number, number]>>;

const lineStyles: readonly LineStyle[] = ['solid', 'dashed', 'dotted'];
const backgroundStyles = ['Solid', 'Gradient'] as const;
const lastPriceLineColours = ['Candle colour', 'Custom'] as const;
const isColour = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

// Settings saved before a setting was split keep looking the same: one grid colour becomes both
// grids', and a hidden OHLC readout also hid the bar change it used to include.
function migrate(saved: Record<string, unknown>): Record<string, unknown> {
  const migrated = { ...saved };
  if (!('verticalGridColor' in saved) && !('horizontalGridColor' in saved) && 'gridColor' in saved) {
    migrated.verticalGridColor = saved.gridColor;
    migrated.horizontalGridColor = saved.gridColor;
  }
  if (!('isBarChangeShown' in saved) && saved.isOhlcShown === false) migrated.isBarChangeShown = false;
  return migrated;
}

// Settings from storage: unknown keys dropped, wrong types replaced by defaults.
export function restoreSettings(value: unknown): ChartSettings {
  const saved = migrate(value !== null && typeof value === 'object' ? value as Record<string, unknown> : {});
  const result: Record<string, unknown> = { ...defaultSettings };
  for (const [key, fallback] of Object.entries(defaultSettings)) {
    const candidate = saved[key];
    if ((colourKeys as readonly string[]).includes(key)) result[key] = candidate === null || isColour(candidate) ? candidate : fallback;
    else if (key === 'scaleMode') result[key] = scaleModes.some((option) => option.mode === candidate) ? candidate : fallback;
    else if ((lineStyleKeys as readonly string[]).includes(key)) result[key] = lineStyles.includes(candidate as LineStyle) ? candidate : fallback;
    else if (typeof fallback === 'number') {
      const [min, max] = numberRanges[key as keyof typeof numberRanges] ?? [0, 100];
      result[key] = typeof candidate === 'number' && Number.isFinite(candidate) ? Math.max(min, Math.min(max, candidate)) : fallback;
    } else result[key] = typeof candidate === typeof fallback ? candidate : fallback;
  }
  return result as unknown as ChartSettings;
}

// The gradient the chart paints: the user's, else the theme's unless the user chose a solid colour.
export function backgroundGradientOf(settings: ChartSettings, theme: MeridianTheme): string | null {
  return settings.backgroundGradient ?? (settings.background === null ? theme.chart.backgroundGradient ?? null : null);
}

// Settings that paint a chart in another theme's colours, as offered by the dialog's Template menu.
export function themeSettings(settings: ChartSettings, theme: MeridianTheme): ChartSettings {
  const { chart } = theme;
  return {
    ...settings,
    upColor: chart.up,
    downColor: chart.down,
    borderUpColor: chart.up,
    borderDownColor: chart.down,
    wickUpColor: chart.up,
    wickDownColor: chart.down,
    background: chart.background,
    backgroundGradient: chart.backgroundGradient ?? null,
    verticalGridColor: chart.grid,
    horizontalGridColor: chart.grid,
    crosshairColor: chart.crosshair,
    textColor: chart.text,
    scaleLineColor: chart.border,
    separatorColor: chart.border,
  };
}

export function settingsFields(settings: ChartSettings, theme: MeridianTheme): Field[] {
  const { chart } = theme;
  const colour = (key: (typeof colourKeys)[number], label: string, tab: string, fallback: string): Field => ({ key, label, tab, type: 'color', value: settings[key] ?? fallback });
  const lineStyle = (key: (typeof lineStyleKeys)[number], label: string): Field => ({ key, label, tab: 'Appearance', type: 'select', value: settings[key], options: lineStyles });
  const number = (key: keyof typeof numberRanges, label: string, tab: string): Field => {
    const [min, max] = numberRanges[key];
    return { key, label, tab, type: 'number', value: settings[key], min, max, step: 1 };
  };
  const gradient = backgroundGradientOf(settings, theme);
  return [
    { key: 'isBodyVisible', label: 'Bodies', tab: 'Symbol', type: 'checkbox', value: settings.isBodyVisible },
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
    { key: 'isBarChangeShown', label: 'Bar change values', tab: 'Status line', type: 'checkbox', value: settings.isBarChangeShown },
    { key: 'isStudyValuesShown', label: 'Indicator values', tab: 'Status line', type: 'checkbox', value: settings.isStudyValuesShown },
    { key: 'isStudyArgumentsShown', label: 'Indicator arguments', tab: 'Status line', type: 'checkbox', value: settings.isStudyArgumentsShown },
    { key: 'scaleMode', label: 'Price scale', tab: 'Scales', type: 'select', value: scaleModes.find((option) => option.mode === settings.scaleMode)!.label, options: scaleModes.map((option) => option.label) },
    { key: 'isScaleInverted', label: 'Invert scale', tab: 'Scales', type: 'checkbox', value: settings.isScaleInverted },
    colour('textColor', 'Text colour', 'Scales', chart.text),
    number('scaleFontSize', 'Font size', 'Scales'),
    colour('scaleLineColor', 'Scale lines', 'Scales', chart.border),
    { key: 'isLastPriceLabelShown', label: 'Last price label', tab: 'Scales', type: 'checkbox', value: settings.isLastPriceLabelShown },
    { key: 'isLastPriceLineShown', label: 'Last price line', tab: 'Scales', type: 'checkbox', value: settings.isLastPriceLineShown },
    { key: 'lastPriceLineColorSource', label: 'Last price line colour', tab: 'Scales', type: 'select', value: settings.lastPriceLineColor ? 'Custom' : 'Candle colour', options: lastPriceLineColours },
    { key: 'lastPriceLineColor', label: 'Custom line colour', tab: 'Scales', type: 'color', value: settings.lastPriceLineColor ?? settings.upColor ?? chart.up },
    number('lastPriceLineWidth', 'Last price line width', 'Scales'),
    { key: 'isCountdownShown', label: 'Countdown to bar close', tab: 'Scales', type: 'checkbox', value: settings.isCountdownShown },
    { key: 'isStudyLabelsShown', label: 'Indicator labels', tab: 'Scales', type: 'checkbox', value: settings.isStudyLabelsShown },
    { key: 'isPriceCrosshairLabelShown', label: 'Crosshair price label', tab: 'Scales', type: 'checkbox', value: settings.isPriceCrosshairLabelShown },
    { key: 'isTimeCrosshairLabelShown', label: 'Crosshair time label', tab: 'Scales', type: 'checkbox', value: settings.isTimeCrosshairLabelShown },
    number('rightMarginBars', 'Right margin (bars)', 'Scales'),
    number('topMarginPercent', 'Top margin (%)', 'Scales'),
    number('bottomMarginPercent', 'Bottom margin (%)', 'Scales'),
    { key: 'backgroundStyle', label: 'Background', tab: 'Appearance', type: 'select', value: gradient ? 'Gradient' : 'Solid', options: backgroundStyles },
    colour('background', 'Background colour', 'Appearance', chart.background),
    { key: 'backgroundGradient', label: 'Gradient bottom colour', tab: 'Appearance', type: 'color', value: gradient ?? settings.background ?? chart.background },
    { key: 'isVerticalGridShown', label: 'Vertical grid lines', tab: 'Appearance', type: 'checkbox', value: settings.isVerticalGridShown },
    colour('verticalGridColor', 'Vertical grid colour', 'Appearance', chart.grid),
    lineStyle('verticalGridStyle', 'Vertical grid style'),
    { key: 'isHorizontalGridShown', label: 'Horizontal grid lines', tab: 'Appearance', type: 'checkbox', value: settings.isHorizontalGridShown },
    colour('horizontalGridColor', 'Horizontal grid colour', 'Appearance', chart.grid),
    lineStyle('horizontalGridStyle', 'Horizontal grid style'),
    colour('separatorColor', 'Pane separators', 'Appearance', chart.border),
    colour('crosshairColor', 'Crosshair', 'Appearance', chart.crosshair),
    { key: 'crosshairStyle', label: 'Crosshair style', tab: 'Appearance', type: 'select', value: settings.crosshairStyle, options: ['dashed', 'dotted', 'solid'] },
    number('crosshairWidth', 'Crosshair width', 'Appearance'),
    { key: 'isWatermarkShown', label: 'Symbol watermark', tab: 'Appearance', type: 'checkbox', value: settings.isWatermarkShown },
  ];
}

// Values from the dialog. A colour left at the theme's colour stays null, so it keeps following
// the theme.
export function applySettingsFields(values: FieldValues, theme: MeridianTheme): ChartSettings {
  const { chart } = theme;
  const themeColours: Record<Exclude<(typeof colourKeys)[number], 'backgroundGradient' | 'lastPriceLineColor'>, string> = {
    upColor: chart.up, downColor: chart.down, borderUpColor: chart.up, borderDownColor: chart.down, wickUpColor: chart.up, wickDownColor: chart.down,
    background: chart.background, verticalGridColor: chart.grid, horizontalGridColor: chart.grid, crosshairColor: chart.crosshair, textColor: chart.text,
    scaleLineColor: chart.border, separatorColor: chart.border,
  };
  const result: Record<string, unknown> = { ...values };
  for (const [key, themeColour] of Object.entries(themeColours)) result[key] = String(values[key]).toLowerCase() === themeColour.toLowerCase() ? null : values[key];
  const isGradient = values.backgroundStyle === 'Gradient';
  const themeGradient = chart.backgroundGradient ?? null;
  const isThemeGradient = result.background === null && String(values.backgroundGradient).toLowerCase() === themeGradient?.toLowerCase();
  result.backgroundGradient = isGradient && !isThemeGradient ? values.backgroundGradient : null;
  // A solid colour over a gradient theme has to be stored, or the theme's gradient would return.
  if (!isGradient && themeGradient && result.background === null) result.background = values.background;
  delete result.backgroundStyle;
  result.lastPriceLineColor = values.lastPriceLineColorSource === 'Custom' ? values.lastPriceLineColor : null;
  delete result.lastPriceLineColorSource;
  result.scaleMode = scaleModes.find((option) => option.label === values.scaleMode)?.mode ?? 'normal';
  return restoreSettings(result);
}
