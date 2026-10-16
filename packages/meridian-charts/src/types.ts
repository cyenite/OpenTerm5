// Shared data shapes of the Meridian chart engine.

// One bar. `time` is the bar's opening time in epoch milliseconds.
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type InputValue = number | string | boolean;

// A request for history: at most `limit` bars, all strictly older than `to` when it is given.
export interface BarRange {
  to?: number;
  limit: number;
}

export interface SymbolInfo {
  // Smallest price increment; sets the price axis precision.
  tickSize?: number;
  description?: string;
}

// Where a chart's bars come from. Timeframes are Meridian strings: '5s', '1' (minutes), '60',
// '1D', '1W' and 'M' (month).
export interface DataProvider {
  getBars(symbol: string, timeframe: string, range: BarRange): Promise<Bar[]>;
  // Streams the bar in progress (and each new bar) for the symbol and timeframe.
  subscribe?(symbol: string, timeframe: string, onBar: (bar: Bar) => void): () => void;
  getSymbolInfo?(symbol: string): Promise<SymbolInfo | undefined>;
}

export type PriceStyle = 'candles' | 'hollow' | 'bars' | 'line' | 'area' | 'baseline' | 'heikinashi';

export type LineStyle = 'solid' | 'dashed' | 'dotted';

export interface DrawingPoint {
  time: number;
  price: number;
}

export interface DrawingStyle {
  lineColor: string;
  lineWidth: number;
  lineStyle: LineStyle;
  // 0 to 1; a border can be fully transparent while its box stays filled.
  lineOpacity?: number;
  fillColor?: string;
  fillOpacity?: number;
  textColor?: string;
  fontSize?: number;
  extendLeft?: boolean;
  extendRight?: boolean;
}

// A drawing as saved and exchanged with the host. Anchors are in data space (time in epoch ms).
export interface SerializedDrawing {
  id: string;
  type: string;
  paneId: string;
  anchors: DrawingPoint[];
  style: DrawingStyle;
  text?: string;
  locked: boolean;
  visible: boolean;
  zIndex: number;
  createdAt: number;
  props?: Record<string, unknown>;
}

// A tool's saved settings, applied from a drawing's Template menu.
export interface DrawingTemplate {
  name: string;
  style: DrawingStyle;
  props?: Record<string, unknown>;
  text?: string;
}

// Where a host keeps drawing templates, by tool type.
export interface DrawingTemplateStore {
  list(type: string): readonly DrawingTemplate[];
  // Replaces a template of the same name.
  save(type: string, template: DrawingTemplate): void;
  remove(type: string, name: string): void;
  // The look a new drawing of the tool starts with: the last one the user restyled or templated.
  // Without these the chart remembers it for the window's lifetime only.
  lastUsed?(type: string): DrawingTemplate | undefined;
  setLastUsed?(type: string, template: DrawingTemplate): void;
}

// ── Studies ──────────────────────────────────────────────────────────────────

export type StudyInputType = 'int' | 'float' | 'bool' | 'select' | 'color' | 'source';

export interface StudyInput {
  key: string;
  title: string;
  type: StudyInputType;
  default: InputValue;
  min?: number;
  max?: number;
  step?: number;
  // Choices for 'select'. 'source' inputs always offer the price sources below.
  options?: readonly string[];
}

export const priceSources = ['Close', 'Open', 'High', 'Low', 'HL2', 'HLC3', 'OHLC4'] as const;

export interface StudyPlot {
  key: string;
  title: string;
  // One value per bar, aligned with the bars passed to compute; null leaves a gap.
  values: readonly (number | null)[];
  color: string;
  // Optional colour per bar (for example a histogram coloured by sign).
  colors?: readonly (string | null)[];
  width?: number;
  lineStyle?: LineStyle;
  kind?: 'line' | 'histogram' | 'circles' | 'columns';
  // Plot this many bars to the right of the bar it was computed on (for example Ichimoku spans).
  offset?: number;
}

export interface StudyBand {
  key: string;
  from: string;
  to: string;
  color: string;
}

export interface StudyLevel {
  key: string;
  price: number;
  color: string;
  title?: string;
}

export interface StudyOutput {
  plots: StudyPlot[];
  bands?: StudyBand[];
  levels?: StudyLevel[];
}

export interface StudyDefinition {
  type: string;
  title: string;
  shortTitle?: string;
  // Drawn on the price pane, sharing its scale, rather than in a pane of its own.
  overlay: boolean;
  inputs: StudyInput[];
  compute: (bars: readonly Bar[], inputs: Record<string, InputValue>) => StudyOutput;
}
