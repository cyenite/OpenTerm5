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

// 'time' values are epoch milliseconds.
export type StudyInputType = 'int' | 'float' | 'bool' | 'select' | 'color' | 'source' | 'text' | 'time';

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
  // Inputs sharing a row sit on one line of the settings dialog.
  row?: string;
  // Left out of the legend's caption.
  isCaptionHidden?: boolean;
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
  // 'area' fills between the line and zero.
  kind?: 'line' | 'histogram' | 'circles' | 'columns' | 'stepline' | 'area' | 'cross';
  // Plot this many bars to the right of the bar it was computed on (for example Ichimoku spans).
  offset?: number;
  // Not drawn, listed or scaled to, but bands can still fill against it.
  isHidden?: boolean;
}

export interface StudyBand {
  key: string;
  from: string;
  to: string;
  color: string;
  // Optional colour per bar, filling the stretch from that bar to the next.
  colors?: readonly (string | null)[];
  // A vertical gradient per bar instead, as Pine's gradient fill: topColor at topPrice fading to
  // bottomColor at bottomPrice.
  gradients?: readonly (StudyGradient | null)[];
}

export interface StudyGradient {
  topPrice: number;
  bottomPrice: number;
  topColor: string;
  bottomColor: string;
}

export interface StudyLevel {
  key: string;
  price: number;
  color: string;
  title?: string;
  width?: number;
  lineStyle?: LineStyle;
}

export type StudySize = 'tiny' | 'small' | 'normal' | 'large' | 'huge';

export type StudyHorizontalAlign = 'left' | 'center' | 'right';

export type StudyVerticalAlign = 'top' | 'center' | 'bottom';

export type StudyShape = 'triangleUp' | 'triangleDown' | 'arrowUp' | 'arrowDown' | 'circle' | 'cross' | 'xcross' | 'diamond' | 'square' | 'flag';

// 'aboveBar' and 'belowBar' follow the bar's high and low on the price pane, and the pane's top
// and bottom elsewhere.
export type StudyMarkerLocation = 'aboveBar' | 'belowBar' | 'top' | 'bottom' | 'absolute';

// A shape or character on one bar, as Pine's plotshape, plotchar and plotarrow draw.
export interface StudyMarker {
  index: number;
  // The marker's price when its location is 'absolute'.
  price?: number;
  // A character drawn instead of the shape.
  char?: string;
  text?: string;
  color: string;
  textColor?: string;
  size: StudySize;
  // A label shape is a callout holding the marker's text, pointing at the bar.
  shape?: StudyShape | 'labelUp' | 'labelDown';
  location: StudyMarkerLocation;
}

// Study objects (Pine's line, box, label, polyline, linefill and table) are read-only drawings a
// study makes. Their x coordinates are bar indexes, fractional and beyond the last bar allowed.
export type StudyExtend = 'none' | 'left' | 'right' | 'both';

export interface StudyLine {
  width: number;
  endIndex: number;
  endPrice: number;
  startIndex: number;
  startPrice: number;
  color: string;
  extend: StudyExtend;
  lineStyle: LineStyle;
  hasEndArrow: boolean;
  hasStartArrow: boolean;
}

export interface StudyBox {
  topPrice: number;
  leftIndex: number;
  rightIndex: number;
  borderWidth: number;
  bottomPrice: number;
  text: string;
  fillColor: string;
  textColor: string;
  borderColor: string;
  extend: StudyExtend;
  textSize: StudySize;
  textHalign: StudyHorizontalAlign;
  textValign: StudyVerticalAlign;
  borderStyle: LineStyle;
}

// A callout ('labelUp' points up at its anchor and sits below it), a shape with its text beside
// it, or bare text ('none').
export type StudyLabelStyle = 'none' | 'labelUp' | 'labelDown' | 'labelLeft' | 'labelRight' | 'labelCenter' | 'labelUpperLeft' | 'labelUpperRight' | 'labelLowerLeft' | 'labelLowerRight' | StudyShape;

export interface StudyLabel {
  index: number;
  price: number;
  text: string;
  color: string;
  tooltip: string;
  textColor: string;
  size: StudySize;
  style: StudyLabelStyle;
  // Where the anchor sits: at `price`, or above or below the bar at `index`.
  location: 'price' | 'aboveBar' | 'belowBar';
  textAlign: StudyHorizontalAlign;
}

export interface StudyPolyline {
  lineWidth: number;
  fillColor: string;
  lineColor: string;
  lineStyle: LineStyle;
  isCurved: boolean;
  isClosed: boolean;
  points: readonly { index: number; price: number }[];
}

export interface StudyTableCell {
  // Share of the pane's width and height, 0 to 100; 0 fits the text.
  width: number;
  height: number;
  text: string;
  fillColor: string;
  textColor: string;
  textSize: StudySize;
  textHalign: StudyHorizontalAlign;
  textValign: StudyVerticalAlign;
}

export interface StudyTable {
  frameWidth: number;
  borderWidth: number;
  fillColor: string;
  frameColor: string;
  borderColor: string;
  position: `${'top' | 'middle' | 'bottom'}-${'left' | 'center' | 'right'}`;
  // Rows of cells; a missing cell is left empty.
  rows: readonly (readonly (StudyTableCell | null)[])[];
}

export interface StudyObjects {
  lines: readonly StudyLine[];
  boxes: readonly StudyBox[];
  labels: readonly StudyLabel[];
  tables: readonly StudyTable[];
  polylines: readonly StudyPolyline[];
}

export interface StudyOutput {
  plots: StudyPlot[];
  bands?: StudyBand[];
  levels?: StudyLevel[];
  markers?: readonly StudyMarker[];
  // A colour per bar for the candle itself, as Pine's barcolor paints. Overlay studies only.
  barColors?: readonly (string | null)[];
  // A colour per bar: behind the bar's column in the study's pane, as Pine's bgcolor paints.
  backgrounds?: readonly (string | null)[];
  objects?: StudyObjects;
}

// What a study computed by the host is asked for. `signal` aborts once the request's bars no
// longer apply (another symbol or timeframe, or the study removed), and the chart ignores what an
// aborted request returns. Requests are not aborted for newer ticks: the chart shows each result
// newer than the one on screen, so the host may skip a queued request once a newer one arrives.
export interface StudyRequest {
  bars: readonly Bar[];
  symbol: string;
  timeframe: string;
  inputs: Record<string, InputValue>;
  signal: AbortSignal;
}

interface StudyBase {
  type: string;
  title: string;
  shortTitle?: string;
  // Drawn on the price pane, sharing its scale, rather than in a pane of its own.
  overlay: boolean;
  inputs: StudyInput[];
}

// A study computes in step with the chart (`compute`), or elsewhere and later (`computeAsync`,
// for example a script runtime in a worker). A failed asynchronous run shows its error in the
// study's legend.
export type StudyDefinition = StudyBase & (
  | { compute: (bars: readonly Bar[], inputs: Record<string, InputValue>) => StudyOutput; computeAsync?: never }
  | { computeAsync: (request: StudyRequest) => Promise<StudyOutput>; compute?: never }
);
