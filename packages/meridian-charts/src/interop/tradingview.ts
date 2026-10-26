import { timeframeMs } from '../core/timeframes';
import { visibilityBands, visibilityFrom, type Visibility } from '../drawings/settings';
import { styleFor, toolDefinitions, type Level } from '../drawings/tools';
import { restoreSettings, type ChartSettings } from '../settings';
import type { MeridianChartTokens, ThemePatch } from '../themes';
import type { DrawingPoint, DrawingStyle, LineStyle, PriceStyle, SerializedDrawing } from '../types';

// TradingView saves a drawing as a "line tool": its class name, its points and its properties.

export interface TradingViewPoint {
  time_t?: number;
  offset?: number;
  price?: number;
  interval?: string;
}

export interface TradingViewLineTool {
  id: string;
  type: string;
  points: readonly TradingViewPoint[];
  state: Readonly<Record<string, unknown>>;
  zorder?: number;
}

export interface TradingViewImportOptions {
  // The data's clock minus UTC at a UTC instant, added to intraday times, which TradingView keeps
  // in UTC. A broker's offset changes with daylight saving, so it is asked per point.
  serverOffsetAt: (utcMs: number) => number;
  // Price step of the symbol, for tools TradingView sizes in ticks (long and short positions).
  tickSize?: number;
  now?: number;
}

export type TradingViewConversion =
  | { kind: 'drawing'; drawing: SerializedDrawing }
  | { kind: 'skipped'; reason: string };

interface ToolMapping {
  type: string;
  levels?: Readonly<Record<string, string>>;
}

const fibLevels = { level: 'levels' };

// TradingView class → Meridian tool. Classes missing here have no Meridian counterpart.
const toolMappings: Readonly<Record<string, ToolMapping>> = {
  LineToolTrendLine: { type: 'trend-line' },
  LineToolRay: { type: 'ray' },
  LineToolExtended: { type: 'extended-line' },
  LineToolInfoLine: { type: 'info-line' },
  LineToolTrendAngle: { type: 'trend-angle' },
  LineToolHorzLine: { type: 'horizontal-line' },
  LineToolHorzRay: { type: 'horizontal-ray' },
  LineToolVertLine: { type: 'vertical-line' },
  LineToolCrossLine: { type: 'cross-line' },
  LineToolParallelChannel: { type: 'parallel-channel' },
  LineToolRegressionTrend: { type: 'regression-trend' },
  LineToolFlatBottom: { type: 'flat-top-bottom' },
  LineToolDisjointAngle: { type: 'disjoint-channel' },
  LineToolPitchfork: { type: 'pitchfork', levels: fibLevels },
  LineToolSchiffPitchfork2: { type: 'schiff-pitchfork', levels: fibLevels },
  LineToolSchiffPitchfork: { type: 'modified-schiff-pitchfork', levels: fibLevels },
  LineToolInsidePitchfork: { type: 'inside-pitchfork', levels: fibLevels },
  LineToolPitchfan: { type: 'pitchfan', levels: fibLevels },
  LineToolFibRetracement: { type: 'fib-retracement', levels: fibLevels },
  LineToolTrendBasedFibExtension: { type: 'fib-extension', levels: fibLevels },
  LineToolFibChannel: { type: 'fib-channel', levels: fibLevels },
  LineToolFibTimeZone: { type: 'fib-time-zone', levels: fibLevels },
  LineToolFibSpeedResistanceFan: { type: 'fib-speed-fan', levels: { hlevel: 'levels', vlevel: 'timeLevels' } },
  LineToolFibCircles: { type: 'fib-circles', levels: fibLevels },
  LineToolFibSpeedResistanceArcs: { type: 'fib-arcs', levels: fibLevels },
  LineToolFibWedge: { type: 'fib-wedge', levels: fibLevels },
  LineToolFibSpiral: { type: 'fib-spiral' },
  LineToolGannSquare: { type: 'gann-box', levels: { hlevel: 'priceLevels', vlevel: 'timeLevels' } },
  LineToolGannComplex: { type: 'gann-square' },
  LineToolGannFixed: { type: 'gann-square-fixed' },
  LineToolGannFan: { type: 'gann-fan', levels: fibLevels },
  LineTool5PointsPattern: { type: 'xabcd-pattern' },
  LineToolCypherPattern: { type: 'cypher-pattern' },
  LineToolABCD: { type: 'abcd-pattern' },
  LineToolTrianglePattern: { type: 'triangle-pattern' },
  LineToolHeadAndShoulders: { type: 'head-shoulders' },
  LineToolThreeDrivers: { type: 'three-drives' },
  LineToolElliottImpulse: { type: 'elliott-impulse' },
  LineToolElliottCorrection: { type: 'elliott-correction' },
  LineToolElliottTriangle: { type: 'elliott-triangle' },
  LineToolElliottDoubleCombo: { type: 'elliott-double-combo' },
  LineToolElliottTripleCombo: { type: 'elliott-triple-combo' },
  LineToolCircleLines: { type: 'cyclic-lines' },
  LineToolTimeCycles: { type: 'time-cycles' },
  LineToolSineLine: { type: 'sine-line' },
  LineToolRiskRewardLong: { type: 'long-position' },
  LineToolRiskRewardShort: { type: 'short-position' },
  LineToolPrediction: { type: 'forecast' },
  LineToolBarsPattern: { type: 'bars-pattern' },
  LineToolGhostFeed: { type: 'ghost-feed' },
  LineToolProjection: { type: 'projection' },
  LineToolAnchoredVWAP: { type: 'anchored-vwap' },
  LineToolFixedRangeVolumeProfile: { type: 'fixed-range-volume-profile' },
  LineToolPriceRange: { type: 'price-range' },
  LineToolDateRange: { type: 'date-range' },
  LineToolDateAndPriceRange: { type: 'date-price-range' },
  LineToolBrush: { type: 'brush' },
  LineToolHighlighter: { type: 'highlighter' },
  LineToolArrowMarker: { type: 'arrow-marker' },
  LineToolArrow: { type: 'arrow' },
  LineToolArrowMarkUp: { type: 'arrow-mark-up' },
  LineToolArrowMarkDown: { type: 'arrow-mark-down' },
  LineToolRectangle: { type: 'rectangle' },
  LineToolRotatedRectangle: { type: 'rotated-rectangle' },
  LineToolPath: { type: 'path' },
  LineToolCircle: { type: 'circle' },
  LineToolEllipse: { type: 'ellipse' },
  LineToolPolyline: { type: 'polyline' },
  LineToolTriangle: { type: 'triangle' },
  LineToolArc: { type: 'arc' },
  LineToolBezierQuadro: { type: 'curve' },
  LineToolBezierCubic: { type: 'double-curve' },
  LineToolText: { type: 'text' },
  LineToolTextAbsolute: { type: 'anchored-text' },
  LineToolNote: { type: 'note' },
  LineToolNoteAbsolute: { type: 'note' },
  LineToolTextNote: { type: 'note' },
  LineToolPriceNote: { type: 'price-note' },
  LineToolCallout: { type: 'callout' },
  LineToolBalloon: { type: 'comment' },
  LineToolComment: { type: 'comment' },
  LineToolPriceLabel: { type: 'price-label' },
  LineToolSignpost: { type: 'signpost' },
  LineToolFlagMark: { type: 'flag-mark' },
};

const DAY = 86_400_000;

// TradingView's line style numbers: solid, dotted, dashed, large dashed, sparse dotted.
const lineStyles: readonly LineStyle[] = ['solid', 'dotted', 'dashed', 'dashed', 'dotted'];

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

interface Rgba { r: number; g: number; b: number; a: number }

export function parseColor(value: unknown): Rgba | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(text)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const full = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex;
    const channel = (index: number) => parseInt(full.slice(index * 2, index * 2 + 2), 16);
    return { r: channel(0), g: channel(1), b: channel(2), a: full.length === 8 ? channel(3) / 255 : 1 };
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(text)?.[1];
  if (!rgb) return null;
  const parts = rgb.split(/[\s,/]+/).filter(Boolean).map((part) => (part.endsWith('%') ? Number(part.slice(0, -1)) / 100 : Number(part)));
  if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return null;
  const [r, g, b, a = 1] = parts;
  return { r, g, b, a: Math.max(0, Math.min(1, a)) };
}

const hexOf = ({ r, g, b }: Rgba) => `#${[r, g, b].map((channel) => Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, '0')).join('')}`;

// An opaque colour as it looks over `under`, since Meridian's colour fields only keep #rrggbb.
function flatten(color: Rgba, under: Rgba): string {
  const mix = (top: number, bottom: number) => top * color.a + bottom * (1 - color.a);
  return hexOf({ r: mix(color.r, under.r), g: mix(color.g, under.g), b: mix(color.b, under.b), a: 1 });
}

const luminance = ({ r, g, b }: Rgba) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

function timeframeOf(interval: string | undefined): number | null {
  if (!interval) return null;
  const meridian = interval.trim().replace(/S$/, 's');
  try {
    return timeframeMs(meridian);
  } catch {
    return null;
  }
}

function pointOf(point: TradingViewPoint, serverOffsetAt: (utcMs: number) => number): DrawingPoint | null {
  const seconds = finite(point.time_t);
  const price = finite(point.price);
  if (seconds === undefined || price === undefined) return null;
  const barMs = timeframeOf(point.interval);
  const bars = finite(point.offset) ?? 0;
  const utc = seconds * 1000 + bars * (barMs ?? 0);
  // Daily and longer bars are dated, not timed: their date is the same on every clock.
  return { time: utc + (barMs !== null && barMs >= DAY ? 0 : serverOffsetAt(utc)), price };
}

function lineStyleOf(value: unknown): LineStyle | undefined {
  const index = finite(value);
  return index === undefined ? undefined : lineStyles[index] ?? 'solid';
}

function fillOf(state: Readonly<Record<string, unknown>>): Pick<DrawingStyle, 'fillColor' | 'fillOpacity'> {
  const color = parseColor(state.backgroundColor);
  if (!color || state.fillBackground === false) return state.fillBackground === false ? { fillOpacity: 0 } : {};
  const transparency = finite(state.transparency) ?? finite(state.backgroundTransparency);
  const opacity = color.a < 1 ? color.a : transparency !== undefined ? 1 - transparency / 100 : 0.15;
  return { fillColor: hexOf(color), fillOpacity: Math.round(Math.max(0, Math.min(1, opacity)) * 100) / 100 };
}

// Tools whose text is the drawing itself: their `color` is the text's, not a line's.
const textTools: ReadonlySet<string> = new Set(['text', 'anchored-text', 'note', 'comment', 'callout', 'price-note', 'pin', 'signpost']);

function styleOf(type: string, state: Readonly<Record<string, unknown>>): DrawingStyle {
  const base = styleFor(type);
  const isTextTool = textTools.has(type);
  // Tools name the same settings differently: linecolor, lineColor or color; a channel styles its
  // lines through level1; a highlighter's width is `width`.
  const trend = isRecord(state.trendline) ? state.trendline : {};
  const levelsStyle = isRecord(state.levelsStyle) ? state.levelsStyle : {};
  const firstLevel = isRecord(state.level1) ? state.level1 : {};
  const lineColor = parseColor(isTextTool ? state.borderColor ?? state.color : state.linecolor ?? state.lineColor ?? state.color ?? trend.color ?? firstLevel.color);
  const textColor = parseColor(isTextTool ? state.color ?? state.textColor : state.textcolor ?? state.textColor);
  const lineWidth = finite(state.linewidth) ?? finite(state.lineWidth) ?? finite(state.width) ?? finite(levelsStyle.linewidth) ?? finite(trend.linewidth) ?? finite(firstLevel.linewidth);
  const lineStyle = lineStyleOf(state.linestyle ?? state.lineStyle ?? levelsStyle.linestyle ?? trend.linestyle ?? firstLevel.linestyle);
  const fontSize = finite(state.fontsize) ?? finite(state.fontSize);
  const extendLeft = state.extendLeft ?? state.extendLinesLeft;
  const extendRight = state.extendRight ?? state.extendLines;
  // A border TradingView draws see-through (rectangles often have none at all) keeps its opacity.
  const lineOpacity = lineColor && lineColor.a < 1 && !isTextTool ? Math.round(lineColor.a * 100) / 100 : undefined;
  return {
    ...base,
    ...(lineColor ? { lineColor: hexOf(lineColor) } : {}),
    ...(lineWidth !== undefined ? { lineWidth: Math.max(1, Math.min(12, Math.round(lineWidth))) } : {}),
    ...(lineStyle ? { lineStyle } : {}),
    ...(lineOpacity !== undefined ? { lineOpacity } : {}),
    ...(textColor ? { textColor: hexOf(textColor) } : {}),
    ...(fontSize !== undefined ? { fontSize: Math.max(8, Math.min(40, Math.round(fontSize))) } : {}),
    ...(typeof extendLeft === 'boolean' ? { extendLeft } : {}),
    ...(typeof extendRight === 'boolean' ? { extendRight } : {}),
    ...fillOf(state),
  };
}

// TradingView numbers its levels (level1, level2 …), each `{coeff, color, visible}`.
// TradingView numbers its levels (level1, level2 …), each `{coeff, color, visible}` or, for
// Fibonacci tools, `[coeff, color, visible, text]`.
function levelsOf(state: Readonly<Record<string, unknown>>, prefix: string): Level[] {
  return Object.entries(state)
    .filter(([key]) => new RegExp(`^${prefix}\\d+$`).test(key))
    .flatMap(([, value]): Level[] => {
      const level = Array.isArray(value) ? { coeff: value[0], color: value[1], visible: value[2], text: value[3] } : isRecord(value) ? value : null;
      if (!level) return [];
      const coeff = finite(level.coeff);
      const color = parseColor(level.color);
      const text = typeof level.text === 'string' && level.text.trim() ? level.text.trim() : undefined;
      return coeff === undefined ? [] : [{ value: coeff, color: color ? hexOf(color) : '#787b86', isVisible: level.visible !== false, ...(text ? { text } : {}) }];
    })
    .sort((left, right) => left.value - right.value);
}

// The same shape Meridian keeps: each band's flag with its From/To range.
function visibilityOf(value: unknown): Visibility | undefined {
  if (!isRecord(value)) return undefined;
  return visibilityFrom(Object.fromEntries(visibilityBands.map((band) => {
    const from = Number(value[`${band.key}From`]);
    const to = Number(value[`${band.key}To`]);
    const range: [number, number] = [Number.isFinite(from) ? Math.max(1, Math.min(band.max, from)) : 1, Number.isFinite(to) ? Math.max(1, Math.min(band.max, to)) : band.max];
    return [band.key, { isVisible: value[band.key] !== false, range: [Math.min(...range), Math.max(...range)] as const }];
  })));
}

const horizontalAligns: Readonly<Record<string, string>> = { left: 'Left', center: 'Center', right: 'Right' };
// TradingView aligns a line's text by its own edge: "bottom" sits the text's bottom on the line.
const linePositions: Readonly<Record<string, string>> = { bottom: 'Above line', middle: 'On line', top: 'Below line' };
const boxPositions: Readonly<Record<string, string>> = { top: 'Top', middle: 'Middle', bottom: 'Bottom' };

function propsOf(mapping: ToolMapping, state: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const fields = new Map((toolDefinitions.get(mapping.type)?.fields ?? []).map((field) => [field.key, field]));
  const copy = (from: string, to = from) => { if (fields.has(to) && typeof state[from] === 'boolean') props[to] = state[from]; };
  for (const key of ['showPriceRange', 'showPercentPriceRange', 'showBarsRange', 'showDateTimeRange', 'showAngle', 'showMiddlePoint', 'alwaysShowStats', 'showPrices', 'reverse', 'fillBackground', 'extendLines', 'bold', 'italic', 'extendLeft', 'extendRight', 'showPrice', 'showTime', 'showText', 'showPriceLabels']) copy(key);
  copy('coeffsAsPercents', 'isPercent');
  copy('drawBorder', 'showBorder');
  if (fields.has('showBackground')) copy('fillBackground', 'showBackground');
  for (const key of ['backgroundColor', 'borderColor']) {
    const color = parseColor(state[key]);
    if (fields.has(key) && color) props[key] = hexOf(color);
  }
  const orientation = String(state.textOrientation);
  if (fields.has('textOrientation') && (orientation === 'vertical' || orientation === 'horizontal')) props.textOrientation = orientation === 'vertical' ? 'Vertical' : 'Horizontal';
  copy('showCoeffs', 'showLevels');
  copy('showMidline', 'showMiddle');
  copy('compact', 'isCompact');
  copy('alwaysShowStats', 'showStats');
  if (fields.has('showMiddleLine') && isRecord(state.middleLine) && typeof state.middleLine.showLine === 'boolean') props.showMiddleLine = state.middleLine.showLine;
  if (fields.has('showTrendLine') && isRecord(state.trendline) && typeof state.trendline.visible === 'boolean') props.showTrendLine = state.trendline.visible;
  if (fields.has('startArrow') && finite(state.leftEnd) !== undefined) props.startArrow = state.leftEnd === 1;
  if (fields.has('endArrow') && finite(state.rightEnd) !== undefined) props.endArrow = state.rightEnd === 1;
  const textAlign = horizontalAligns[String(state.horzLabelsAlign)];
  if (fields.has('textAlign') && textAlign) props.textAlign = textAlign;
  if (fields.has('labelsPosition') && (textAlign === 'Left' || textAlign === 'Right')) props.labelsPosition = textAlign;
  const position = fields.get('textPosition');
  const textPosition = position?.type === 'select' ? (position.options.includes('On line') ? linePositions : boxPositions)[String(state.vertLabelsAlign)] : undefined;
  if (textPosition) props.textPosition = textPosition;
  const labelFontSize = finite(state.labelFontSize);
  if (fields.has('labelFontSize') && labelFontSize !== undefined) props.labelFontSize = labelFontSize;
  const transparency = finite(state.transparency);
  if (fields.has('backgroundOpacity') && transparency !== undefined) props.backgroundOpacity = Math.max(0, Math.min(100, 100 - transparency));
  for (const [prefix, key] of Object.entries(mapping.levels ?? {})) {
    const levels = levelsOf(state, prefix);
    if (levels.length && fields.has(key)) props[key] = levels;
  }
  Object.assign(props, positionProps(fields, state));
  const visibility = visibilityOf(state.intervalsVisibilities);
  if (visibility) props.visibility = visibility;
  return props;
}

// A position's sizing (TradingView can state the risk as money), colours and text colour.
function positionProps(fields: ReadonlyMap<string, unknown>, state: Readonly<Record<string, unknown>>): Record<string, unknown> {
  if (!fields.has('riskPercent')) return {};
  const props: Record<string, unknown> = {};
  const risk = finite(state.risk);
  const lotSize = finite(state.lotSize);
  const accountSize = finite(state.accountSize);
  if (accountSize !== undefined) props.accountSize = accountSize;
  if (lotSize !== undefined) props.lotSize = lotSize;
  if (risk !== undefined) {
    const percent = state.riskDisplayMode === 'money' ? (accountSize ? risk / accountSize * 100 : undefined) : risk;
    if (percent !== undefined) props.riskPercent = Math.max(0, Math.min(100, percent));
  }
  const profit = parseColor(state.profitBackground);
  const stop = parseColor(state.stopBackground);
  const text = parseColor(state.textcolor);
  if (profit) props.profitColor = hexOf(profit);
  if (stop) props.stopColor = hexOf(stop);
  if (text) props.textColor = hexOf(text);
  const transparency = finite(state.profitBackgroundTransparency);
  const opacity = profit && profit.a < 1 ? profit.a * 100 : transparency !== undefined ? 100 - transparency : undefined;
  if (opacity !== undefined) props.areaOpacity = Math.round(Math.max(0, Math.min(100, opacity)));
  return props;
}

// TradingView keeps a position's target and stop as distances in ticks from the entry.
function positionAnchors(points: readonly DrawingPoint[], state: Readonly<Record<string, unknown>>, isLong: boolean, tickSize: number | undefined): DrawingPoint[] | string {
  const [entry, end] = points;
  const profit = finite(state.profitLevel);
  const stop = finite(state.stopLevel);
  if (!entry || profit === undefined || stop === undefined) return 'the position has no entry, target or stop';
  if (!tickSize) return 'the symbol\'s price step is unknown, so the target and stop cannot be placed';
  // The far edge can sit on either side of the entry; a position without one gets TradingView's
  // usual length.
  const time = end && end.time !== entry.time ? end.time : entry.time + 20 * 3_600_000;
  const direction = isLong ? 1 : -1;
  return [entry, { time, price: entry.price + direction * profit * tickSize }, { time, price: entry.price - direction * stop * tickSize }];
}

// TradingView defines an ellipse by its axis and a point on its edge; Meridian by its bounding box.
function ellipseAnchors(points: readonly DrawingPoint[]): DrawingPoint[] {
  const [a, b, edge] = points;
  if (!edge) return [a, b];
  const middle = (a.price + b.price) / 2;
  const half = Math.max(Math.abs(a.price - b.price) / 2, Math.abs(edge.price - middle));
  return [{ time: a.time, price: middle + half }, { time: b.time, price: middle - half }];
}

function anchorsFor(type: string, points: readonly DrawingPoint[], state: Readonly<Record<string, unknown>>, options: TradingViewImportOptions): DrawingPoint[] | string {
  if (type === 'long-position' || type === 'short-position') return positionAnchors(points, state, type === 'long-position', options.tickSize);
  if (type === 'ellipse' && points.length >= 2) return ellipseAnchors(points);
  const wanted = toolDefinitions.get(type)?.anchors;
  if (wanted === 'free') return points.length >= 2 ? [...points] : 'TradingView sends only the first point of its stroke';
  if (wanted === 'multi') return points.length >= 2 ? [...points] : 'it has fewer than two points';
  if (wanted === undefined) return 'Meridian has no such tool';
  if (points.length < wanted) return `it has ${points.length} of the ${wanted} points it needs`;
  return points.slice(0, wanted);
}

// The Meridian id of an imported drawing, the same on every import so re-imports can find it.
export function tradingViewDrawingId(id: string): string {
  return `tv-${id}`;
}

// A TradingView tool's settings as a Meridian drawing's style, options and text. A line's text
// counts only while TradingView shows it.
function propertiesOf(mapping: ToolMapping, state: Readonly<Record<string, unknown>>): { style: DrawingStyle; props: Record<string, unknown>; text?: string } {
  const hasText = toolDefinitions.get(mapping.type)?.hasText === true;
  const isShown = textTools.has(mapping.type) || state.showLabel !== false;
  const text = hasText && isShown && typeof state.text === 'string' && state.text ? state.text : undefined;
  return { style: styleOf(mapping.type, state), props: propsOf(mapping, state), ...(text !== undefined ? { text } : {}) };
}

export interface TradingViewTemplate {
  // The Meridian tool the template is for.
  type: string;
  style: DrawingStyle;
  props: Record<string, unknown>;
  text?: string;
}

// A TradingView drawing template (a tool's saved settings) for the Meridian tool, or null when
// Meridian has no such tool.
export function fromTradingViewTemplate(type: string, content: unknown): TradingViewTemplate | null {
  const mapping = toolMappings[type];
  if (!mapping || !isRecord(content)) return null;
  return { type: mapping.type, ...propertiesOf(mapping, content) };
}

// Every TradingView tool class that has a Meridian counterpart.
export function tradingViewToolTypes(): string[] {
  return Object.keys(toolMappings);
}

export function tradingViewToolType(type: string): string | null {
  return toolMappings[type]?.type ?? null;
}

export function fromTradingViewLineTool(tool: TradingViewLineTool, options: TradingViewImportOptions): TradingViewConversion {
  const mapping = toolMappings[tool.type];
  if (!mapping) return { kind: 'skipped', reason: `${tool.type.replace(/^LineTool/, '')} has no Meridian counterpart` };
  const points = tool.points.map((point) => pointOf(point, options.serverOffsetAt));
  if (points.some((point) => point === null)) return { kind: 'skipped', reason: 'it is pinned to the screen instead of to prices and times' };
  const anchors = anchorsFor(mapping.type, points as DrawingPoint[], tool.state, options);
  if (typeof anchors === 'string') return { kind: 'skipped', reason: anchors };
  const { style, props, text } = propertiesOf(mapping, tool.state);
  return {
    kind: 'drawing',
    drawing: {
      id: tradingViewDrawingId(tool.id),
      type: mapping.type,
      paneId: 'price',
      anchors,
      style,
      ...(text !== undefined ? { text } : {}),
      locked: tool.state.frozen === true,
      visible: tool.state.visible !== false,
      zIndex: finite(tool.zorder) ?? 0,
      createdAt: options.now ?? Date.now(),
      ...(Object.keys(props).length ? { props } : {}),
    },
  };
}

const path = (value: unknown, ...keys: string[]): unknown => keys.reduce<unknown>((node, key) => (isRecord(node) ? node[key] : undefined), value);

// The chart colours of a theme saved in TradingView. The rest of the application keeps the
// Meridian theme of the same brightness.
interface Backdrop {
  top: string;
  // The gradient's bottom colour, when it differs from the top.
  bottom: string | null;
  // What translucent colours are flattened over.
  under: Rgba;
}

// A pane's background. Translucent lines are flattened over the middle of a gradient, where most
// of the chart sits.
function backdropOf(pane: unknown): Backdrop | null {
  const isGradient = String(path(pane, 'backgroundType')).toLowerCase() === 'gradient';
  const top = parseColor(isGradient ? path(pane, 'backgroundGradientStartColor') ?? path(pane, 'background') : path(pane, 'background'));
  if (!top) return null;
  const opaqueTop = { ...top, a: 1 };
  const bottom = isGradient ? parseColor(path(pane, 'backgroundGradientEndColor')) : null;
  const opaqueBottom = bottom ? { ...bottom, a: 1 } : null;
  const under = opaqueBottom ? { r: (opaqueTop.r + opaqueBottom.r) / 2, g: (opaqueTop.g + opaqueBottom.g) / 2, b: (opaqueTop.b + opaqueBottom.b) / 2, a: 1 } : opaqueTop;
  return { top: hexOf(opaqueTop), bottom: opaqueBottom && hexOf(opaqueBottom) !== hexOf(opaqueTop) ? hexOf(opaqueBottom) : null, under };
}

export function fromTradingViewTheme(content: unknown, identity: { id: string; label: string }): ThemePatch | null {
  const pane = path(content, 'chartProperties', 'paneProperties');
  const backdrop = backdropOf(pane);
  if (!backdrop) return null;
  const { under } = backdrop;
  const mode = luminance(under) < 0.5 ? 'dark' : 'light';
  const colour = (value: unknown) => {
    const parsed = parseColor(value);
    return parsed ? flatten(parsed, under) : undefined;
  };
  const candles = path(content, 'mainSourceProperties', 'candleStyle');
  const tokens: Partial<Record<keyof MeridianChartTokens, string | undefined>> = {
    background: backdrop.top,
    backgroundGradient: backdrop.bottom ?? undefined,
    text: colour(path(content, 'chartProperties', 'scalesProperties', 'textColor')),
    grid: colour(path(pane, 'horzGridProperties', 'color') ?? path(pane, 'vertGridProperties', 'color')),
    border: colour(path(content, 'chartProperties', 'scalesProperties', 'lineColor')),
    up: colour(path(candles, 'upColor')),
    down: colour(path(candles, 'downColor')),
    line: colour(path(content, 'mainSourceProperties', 'lineStyle', 'color')),
    crosshair: colour(path(pane, 'crossHairProperties', 'color')),
  };
  const chart = Object.fromEntries(Object.entries(tokens).filter(([, value]) => value !== undefined)) as Partial<MeridianChartTokens>;
  return { id: identity.id, label: identity.label, mode, chart };
}

// TradingView's series styles that Meridian draws; others (Renko, line break and so on) leave the
// chart type alone.
const priceStyles: Readonly<Record<number, PriceStyle>> = { 0: 'bars', 1: 'candles', 2: 'line', 3: 'area', 8: 'heikinashi', 9: 'hollow', 10: 'baseline' };

const candleStyleKeys: Partial<Record<PriceStyle, string>> = { hollow: 'hollowCandleStyle', heikinashi: 'haStyle', bars: 'barStyle' };

export interface ConvertedChartSettings {
  settings: ChartSettings;
  priceStyle?: PriceStyle;
}

function mainSeriesState(chart: unknown): unknown {
  const panes = path(chart, 'panes');
  const sources = Array.isArray(panes) ? panes.flatMap((pane) => {
    const list = path(pane, 'sources');
    return Array.isArray(list) ? list : [];
  }) : [];
  return path(sources.find((source) => path(source, 'type') === 'MainSeries'), 'state');
}

// The chart settings of one chart in a TradingView layout (`content.charts[i]`): its canvas,
// candles, scales, status line and margins. Anything a layout does not say keeps Meridian's
// default, and colours are flattened over the background because settings keep only #rrggbb.
export function fromTradingViewChartSettings(chart: unknown): ConvertedChartSettings | null {
  const properties = path(chart, 'chartProperties');
  const pane = path(properties, 'paneProperties');
  const backdrop = backdropOf(pane);
  if (!backdrop) return null;
  const series = mainSeriesState(chart);
  const scales = path(properties, 'scalesProperties');
  const legend = path(pane, 'legendProperties');
  const vertical = path(pane, 'vertGridProperties');
  const horizontal = path(pane, 'horzGridProperties');
  const crosshair = path(pane, 'crossHairProperties');
  const styleNumber = finite(path(series, 'style'));
  const priceStyle = styleNumber === undefined ? undefined : priceStyles[styleNumber];
  // Bars keep only up and down colours; borders and wicks still come from the candles.
  const candles = path(series, 'candleStyle');
  const bodies = path(series, (priceStyle && candleStyleKeys[priceStyle]) ?? 'candleStyle');
  const axis = isRecord(path(series, 'priceAxisProperties')) ? path(series, 'priceAxisProperties') : path(pane, 'axisProperties');
  const colour = (value: unknown, transparency?: unknown) => {
    const parsed = parseColor(value);
    if (!parsed) return undefined;
    const faded = finite(transparency);
    return flatten(faded === undefined ? parsed : { ...parsed, a: parsed.a * (1 - Math.max(0, Math.min(100, faded)) / 100) }, backdrop.under);
  };
  const flag = (value: unknown) => (typeof value === 'boolean' ? value : undefined);
  const whole = (value: unknown) => {
    const number = finite(value);
    return number === undefined ? undefined : Math.round(number);
  };
  const scaleMode = path(axis, 'log') === true ? 'log' : path(axis, 'percentage') === true ? 'percent' : path(axis, 'indexedTo100') === true ? 'indexed' : 'normal';
  const priceLineColor = path(series, 'priceLineColor');
  const mapped: Record<keyof ChartSettings, unknown> = {
    upColor: colour(path(bodies, 'upColor')),
    downColor: colour(path(bodies, 'downColor')),
    isBodyVisible: flag(path(bodies, 'drawBody') ?? path(candles, 'drawBody')),
    isBorderVisible: flag(path(bodies, 'drawBorder') ?? path(candles, 'drawBorder')),
    borderUpColor: colour(path(bodies, 'borderUpColor') ?? path(candles, 'borderUpColor')),
    borderDownColor: colour(path(bodies, 'borderDownColor') ?? path(candles, 'borderDownColor')),
    isWickVisible: flag(path(bodies, 'drawWick') ?? path(candles, 'drawWick')),
    wickUpColor: colour(path(bodies, 'wickUpColor') ?? path(candles, 'wickUpColor')),
    wickDownColor: colour(path(bodies, 'wickDownColor') ?? path(candles, 'wickDownColor')),
    background: backdrop.top,
    backgroundGradient: backdrop.bottom,
    isVerticalGridShown: flag(path(vertical, 'visible')),
    isHorizontalGridShown: flag(path(horizontal, 'visible')),
    verticalGridColor: colour(path(vertical, 'color')),
    horizontalGridColor: colour(path(horizontal, 'color')),
    verticalGridStyle: lineStyleOf(path(vertical, 'style')),
    horizontalGridStyle: lineStyleOf(path(horizontal, 'style')),
    crosshairColor: colour(path(crosshair, 'color'), path(crosshair, 'transparency')),
    crosshairStyle: lineStyleOf(path(crosshair, 'style')),
    crosshairWidth: whole(path(crosshair, 'width')),
    textColor: colour(path(scales, 'textColor')),
    // A fully transparent scale line flattens to the background: no visible line.
    scaleLineColor: colour(path(scales, 'lineColor')),
    scaleFontSize: whole(path(scales, 'fontSize')),
    separatorColor: colour(path(pane, 'separatorColor')),
    isWatermarkShown: undefined,
    isTitleShown: flag(path(legend, 'showSeriesTitle')),
    isOhlcShown: flag(path(legend, 'showSeriesOHLC')),
    isBarChangeShown: flag(path(legend, 'showBarChange')),
    isStudyValuesShown: flag(path(legend, 'showStudyValues')),
    isStudyArgumentsShown: flag(path(legend, 'showStudyArguments')),
    isLastPriceLineShown: flag(path(series, 'showPriceLine')),
    // An empty colour follows the candle, as Meridian's null does.
    lastPriceLineColor: priceLineColor === '' ? null : colour(priceLineColor),
    lastPriceLineWidth: whole(path(series, 'priceLineWidth')),
    isLastPriceLabelShown: flag(path(scales, 'showSeriesLastValue')),
    isCountdownShown: flag(path(series, 'showCountdown')),
    isStudyLabelsShown: flag(path(scales, 'showStudyLastValue')),
    isPriceCrosshairLabelShown: flag(path(scales, 'showPriceScaleCrosshairLabel')),
    isTimeCrosshairLabelShown: flag(path(scales, 'showTimeScaleCrosshairLabel')),
    scaleMode,
    isScaleInverted: flag(path(axis, 'isInverted')),
    rightMarginBars: whole(path(chart, 'timeScale', 'm_rightOffset')),
    topMarginPercent: finite(path(pane, 'topMargin')),
    bottomMarginPercent: finite(path(pane, 'bottomMargin')),
  };
  return { settings: restoreSettings(mapped), ...(priceStyle ? { priceStyle } : {}) };
}

export interface TradingViewExportOptions {
  // As for importing: the data's clock minus UTC at a UTC instant.
  serverOffsetAt: (utcMs: number) => number;
  tickSize?: number;
}

export type TradingViewPatch =
  | { kind: 'patched'; tool: Record<string, unknown>; unwritten: string[] }
  | { kind: 'unwritable'; reason: string };

type Slot = readonly [Record<string, unknown> | undefined, string];

const stableJson = (value: unknown): string => JSON.stringify(value, (_key, inner: unknown) => (isRecord(inner) ? Object.fromEntries(Object.entries(inner).sort(([left], [right]) => left.localeCompare(right))) : inner));

const same = (left: unknown, right: unknown) => stableJson(left) === stableJson(right);

const recordAt = (state: Record<string, unknown>, key: string) => (isRecord(state[key]) ? state[key] : undefined);

// The first slot TradingView already uses, else the fallback, so a value goes back where the
// import read it from.
function slotOf(candidates: readonly Slot[], fallback: Slot): [Record<string, unknown>, string] {
  const found = candidates.find(([owner, key]) => owner !== undefined && owner[key] !== undefined) ?? fallback;
  return [found[0] ?? {}, found[1]];
}

function write(slot: [Record<string, unknown>, string], value: unknown): void {
  slot[0][slot[1]] = value;
}

// #rrggbb at an opacity, written as TradingView wrote the colour before when it can carry it.
function colorText(hex: string, opacity: number, before: unknown): string {
  const color = parseColor(hex);
  if (!color) return hex;
  const isRgba = typeof before === 'string' && before.trim().toLowerCase().startsWith('rgba');
  return opacity >= 1 && !isRgba ? hexOf(color) : `rgba(${color.r}, ${color.g}, ${color.b}, ${Math.round(Math.max(0, Math.min(1, opacity)) * 100) / 100})`;
}

// Undoes `serverOffsetAt`, which is asked at UTC instants: one step from the data's time lands
// within the offset of the right instant, and a second step settles it.
function utcOf(time: number, serverOffsetAt: (utcMs: number) => number): number {
  return time - serverOffsetAt(time - serverOffsetAt(time));
}

function pointAt(point: DrawingPoint, base: TradingViewPoint | undefined, options: TradingViewExportOptions): TradingViewPoint {
  const barMs = timeframeOf(base?.interval);
  const utc = barMs !== null && barMs >= DAY ? point.time : utcOf(point.time, options.serverOffsetAt);
  return { ...(base ?? {}), time_t: Math.round(utc / 1000), offset: 0, price: point.price };
}

function pointsFor(type: string, anchors: readonly DrawingPoint[], state: Record<string, unknown>, base: readonly TradingViewPoint[], options: TradingViewExportOptions): TradingViewPoint[] | string {
  if (type === 'long-position' || type === 'short-position') {
    const [entry, target, stop] = anchors;
    if (!entry || !target || !stop) return 'the position has no entry, target or stop';
    const tick = options.tickSize;
    if (!tick) return 'the symbol\'s price step is unknown, so the target and stop cannot be sized in ticks';
    const direction = type === 'long-position' ? 1 : -1;
    const was = { entry: finite(base[0]?.price), profit: finite(state.profitLevel), stop: finite(state.stopLevel) };
    state.profitLevel = Math.round(Math.abs(target.price - entry.price) / tick);
    state.stopLevel = Math.round(Math.abs(entry.price - stop.price) / tick);
    const moved = [pointAt(entry, base[0], options), pointAt({ time: target.time, price: entry.price }, base[1] ?? base[0], options)];
    // Newer saves carry more points: one on the entry, one on the stop. They keep their place
    // relative to the entry, and follow the entry, target or stop price they sat on.
    const barSeconds = (timeframeOf(base[0]?.interval) ?? 0) / 1000;
    const entryWas = (finite(base[0]?.time_t) ?? 0) + (finite(base[0]?.offset) ?? 0) * barSeconds;
    const shift = (moved[0].time_t ?? entryWas) - entryWas;
    const isAt = (price: number | undefined, level: number | undefined, sign: number) => was.entry !== undefined && level !== undefined && price !== undefined && Math.abs(price - (was.entry + sign * level * tick)) < tick / 2;
    const extra = base.slice(2).map((point): TradingViewPoint => {
      const price = isAt(point.price, 0, 1) ? entry.price : isAt(point.price, was.stop, -direction) ? stop.price : isAt(point.price, was.profit, direction) ? target.price : point.price;
      return { ...point, ...(point.time_t !== undefined ? { time_t: point.time_t + shift } : {}), ...(price !== undefined ? { price } : {}) };
    });
    return [...moved, ...extra];
  }
  // A three-point ellipse is its axis and a point on its edge; the import made it a bounding box.
  if (type === 'ellipse' && base.length >= 3 && anchors.length >= 2) {
    const [top, bottom] = anchors;
    const middle = (top.price + bottom.price) / 2;
    return [
      pointAt({ time: top.time, price: middle }, base[0], options),
      pointAt({ time: bottom.time, price: middle }, base[1], options),
      pointAt({ time: (top.time + bottom.time) / 2, price: Math.max(top.price, bottom.price) }, base[2], options),
    ];
  }
  return anchors.map((anchor, index) => pointAt(anchor, base[index] ?? base.at(-1), options));
}

function patchStyle(type: string, state: Record<string, unknown>, previous: DrawingStyle, next: DrawingStyle, unwritten: string[]): void {
  const isTextTool = textTools.has(type);
  const trend = recordAt(state, 'trendline');
  const levelsStyle = recordAt(state, 'levelsStyle');
  const firstLevel = recordAt(state, 'level1');
  const changed = (key: keyof DrawingStyle) => !same(previous[key], next[key]);
  if (changed('lineColor') || changed('lineOpacity')) {
    const slot = isTextTool ? slotOf([[state, 'borderColor']], [state, 'borderColor']) : slotOf([[state, 'linecolor'], [state, 'lineColor'], [state, 'color'], [trend, 'color'], [firstLevel, 'color']], [state, 'linecolor']);
    write(slot, colorText(next.lineColor, next.lineOpacity ?? 1, slot[0][slot[1]]));
  }
  if (changed('lineWidth')) write(slotOf([[state, 'linewidth'], [state, 'lineWidth'], [state, 'width'], [levelsStyle, 'linewidth'], [trend, 'linewidth'], [firstLevel, 'linewidth']], [state, 'linewidth']), next.lineWidth);
  if (changed('lineStyle')) write(slotOf([[state, 'linestyle'], [state, 'lineStyle'], [levelsStyle, 'linestyle'], [trend, 'linestyle'], [firstLevel, 'linestyle']], [state, 'linestyle']), Math.max(0, lineStyles.indexOf(next.lineStyle)));
  if (changed('textColor') && next.textColor) {
    const slot = isTextTool ? slotOf([[state, 'color'], [state, 'textColor']], [state, 'color']) : slotOf([[state, 'textcolor'], [state, 'textColor']], [state, 'textcolor']);
    write(slot, colorText(next.textColor, 1, slot[0][slot[1]]));
  }
  if (changed('fontSize') && next.fontSize !== undefined) write(slotOf([[state, 'fontsize'], [state, 'fontSize']], [state, 'fontsize']), next.fontSize);
  if (changed('extendLeft') && next.extendLeft !== undefined) write(slotOf([[state, 'extendLeft'], [state, 'extendLinesLeft']], [state, 'extendLeft']), next.extendLeft);
  if (changed('extendRight') && next.extendRight !== undefined) write(slotOf([[state, 'extendRight'], [state, 'extendLines']], [state, 'extendRight']), next.extendRight);
  if (changed('fillColor') || changed('fillOpacity')) {
    const opacity = next.fillOpacity ?? 0.15;
    state.fillBackground = opacity > 0;
    const before = parseColor(state.backgroundColor);
    if (next.fillColor && before && before.a < 1) state.backgroundColor = colorText(next.fillColor, opacity, 'rgba');
    else {
      if (next.fillColor) state.backgroundColor = colorText(next.fillColor, 1, state.backgroundColor);
      write(slotOf([[state, 'transparency'], [state, 'backgroundTransparency']], [state, 'transparency']), Math.round((1 - opacity) * 100));
    }
  }
  const known: readonly string[] = ['lineColor', 'lineOpacity', 'lineWidth', 'lineStyle', 'textColor', 'fontSize', 'extendLeft', 'extendRight', 'fillColor', 'fillOpacity'];
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (!known.includes(key) && !same(previous[key as keyof DrawingStyle], next[key as keyof DrawingStyle])) unwritten.push(key);
  }
}

// Meridian option → TradingView flag, the reverse of the import's copies.
const flagKeys: Readonly<Record<string, string>> = {
  ...Object.fromEntries(['showPriceRange', 'showPercentPriceRange', 'showBarsRange', 'showDateTimeRange', 'showAngle', 'showMiddlePoint', 'alwaysShowStats', 'showPrices', 'reverse', 'fillBackground', 'extendLines', 'bold', 'italic', 'extendLeft', 'extendRight', 'showPrice', 'showTime', 'showText', 'showPriceLabels'].map((key) => [key, key])),
  isPercent: 'coeffsAsPercents',
  showBorder: 'drawBorder',
  showBackground: 'fillBackground',
  showLevels: 'showCoeffs',
  showMiddle: 'showMidline',
  isCompact: 'compact',
  showStats: 'alwaysShowStats',
};

const keyOf = (map: Readonly<Record<string, string>>, value: unknown) => Object.entries(map).find(([, label]) => label === value)?.[0];

function patchLevels(state: Record<string, unknown>, prefix: string, levels: readonly Level[]): boolean {
  const keys = Object.keys(state).filter((key) => new RegExp(`^${prefix}\\d+$`).test(key) && finite(Array.isArray(state[key]) ? (state[key] as unknown[])[0] : recordAt(state, key)?.coeff) !== undefined);
  if (keys.length !== levels.length) return false;
  const coeffOf = (key: string) => finite(Array.isArray(state[key]) ? (state[key] as unknown[])[0] : recordAt(state, key)?.coeff) ?? 0;
  keys.sort((left, right) => coeffOf(left) - coeffOf(right)).forEach((key, index) => {
    const level = levels[index];
    const before = state[key];
    if (Array.isArray(before)) state[key] = [level.value, colorText(level.color, 1, before[1]), level.isVisible, ...(before.length > 3 ? [level.text ?? before[3]] : [])];
    else state[key] = { ...(before as Record<string, unknown>), coeff: level.value, color: colorText(level.color, 1, (before as Record<string, unknown>).color), visible: level.isVisible };
  });
  return true;
}

function patchProps(mapping: ToolMapping, state: Record<string, unknown>, previous: Readonly<Record<string, unknown>>, next: Readonly<Record<string, unknown>>, unwritten: string[]): void {
  const levelKeys = new Map(Object.entries(mapping.levels ?? {}).map(([prefix, key]) => [key, prefix]));
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const value = next[key];
    if (same(previous[key], value)) continue;
    const isWritten = ((): boolean => {
      if (flagKeys[key] && typeof value === 'boolean') return (state[flagKeys[key]] = value, true);
      if ((key === 'backgroundColor' || key === 'borderColor') && typeof value === 'string') return (state[key] = colorText(value, 1, state[key]), true);
      if (key === 'textOrientation' && typeof value === 'string') return (state.textOrientation = value.toLowerCase(), true);
      if (key === 'showMiddleLine' && typeof value === 'boolean') return (state.middleLine = { ...(recordAt(state, 'middleLine') ?? {}), showLine: value }, true);
      if (key === 'showTrendLine' && typeof value === 'boolean') return (state.trendline = { ...(recordAt(state, 'trendline') ?? {}), visible: value }, true);
      if (key === 'startArrow' && typeof value === 'boolean') return (state.leftEnd = value ? 1 : 0, true);
      if (key === 'endArrow' && typeof value === 'boolean') return (state.rightEnd = value ? 1 : 0, true);
      if ((key === 'textAlign' || key === 'labelsPosition') && keyOf(horizontalAligns, value)) return (state.horzLabelsAlign = keyOf(horizontalAligns, value), true);
      if (key === 'textPosition' && (keyOf(linePositions, value) ?? keyOf(boxPositions, value))) return (state.vertLabelsAlign = keyOf(linePositions, value) ?? keyOf(boxPositions, value), true);
      if (key === 'labelFontSize' && finite(value) !== undefined) return (state.labelFontSize = value, true);
      if (key === 'backgroundOpacity' && finite(value) !== undefined) return (state.transparency = 100 - (value as number), true);
      if (levelKeys.has(key) && Array.isArray(value)) return patchLevels(state, levelKeys.get(key)!, value as Level[]);
      if (key === 'visibility') {
        const visibility = isRecord(value) ? value : {};
        const bands = Object.fromEntries(visibilityBands.flatMap((band) => [[band.key, visibility[band.key] ?? true], [`${band.key}From`, visibility[`${band.key}From`] ?? 1], [`${band.key}To`, visibility[`${band.key}To`] ?? band.max]]));
        return (state.intervalsVisibilities = { ...(recordAt(state, 'intervalsVisibilities') ?? {}), ...bands }, true);
      }
      return patchPositionProp(key, value, state);
    })();
    if (!isWritten) unwritten.push(key);
  }
}

function patchPositionProp(key: string, value: unknown, state: Record<string, unknown>): boolean {
  if ((key === 'accountSize' || key === 'lotSize') && finite(value) !== undefined) return (state[key] = value, true);
  if (key === 'riskPercent' && finite(value) !== undefined) {
    const accountSize = finite(state.accountSize);
    state.risk = state.riskDisplayMode === 'money' && accountSize ? (value as number) / 100 * accountSize : value;
    return true;
  }
  const colorKeys: Readonly<Record<string, string>> = { profitColor: 'profitBackground', stopColor: 'stopBackground', textColor: 'textcolor' };
  if (colorKeys[key] && typeof value === 'string') return (state[colorKeys[key]] = colorText(value, 1, state[colorKeys[key]]), true);
  if (key === 'areaOpacity' && finite(value) !== undefined) {
    state.profitBackgroundTransparency = 100 - (value as number);
    state.stopBackgroundTransparency = 100 - (value as number);
    return true;
  }
  return false;
}

// A TradingView tool (`{type, points, state, zorder, …}`, as its storage keeps it) with the edits
// between two versions of its Meridian drawing written in. Only what changed is touched, so every
// setting Meridian does not model goes back as TradingView sent it. `unwritten` names the edits
// TradingView has no place for.
export function patchTradingViewLineTool(base: Readonly<Record<string, unknown>>, previous: SerializedDrawing, next: SerializedDrawing, options: TradingViewExportOptions): TradingViewPatch {
  const mapping = typeof base.type === 'string' ? toolMappings[base.type] : undefined;
  if (!mapping || mapping.type !== next.type) return { kind: 'unwritable', reason: 'it is no longer the same kind of drawing as in TradingView' };
  const tool = structuredClone(base) as Record<string, unknown>;
  if (!isRecord(tool.state)) tool.state = {};
  const state = tool.state as Record<string, unknown>;
  const unwritten: string[] = [];
  if (!same(previous.anchors, next.anchors)) {
    const points = pointsFor(mapping.type, next.anchors, state, Array.isArray(base.points) ? base.points as TradingViewPoint[] : [], options);
    if (typeof points === 'string') return { kind: 'unwritable', reason: points };
    tool.points = points;
  }
  patchStyle(mapping.type, state, previous.style, next.style, unwritten);
  if ((previous.text ?? '') !== (next.text ?? '')) {
    state.text = next.text ?? '';
    if (next.text && !textTools.has(mapping.type)) state.showLabel = true;
  }
  if (previous.locked !== next.locked) state.frozen = next.locked;
  if (previous.visible !== next.visible) state.visible = next.visible;
  if (previous.zIndex !== next.zIndex) tool.zorder = next.zIndex;
  patchProps(mapping, state, previous.props ?? {}, next.props ?? {}, unwritten);
  return { kind: 'patched', tool, unwritten };
}
