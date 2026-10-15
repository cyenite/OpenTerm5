import type { Bar, DrawingPoint, DrawingStyle, SerializedDrawing } from '../types';
import { cubic, distance, extend, lerp, midpoint, quadratic, ShapeList, type Bounds, type Pt, type ShapeStyle } from './shapes';

export interface ToolEnv {
  points: Pt[];
  anchors: DrawingPoint[];
  drawing: SerializedDrawing;
  bounds: Bounds;
  style: DrawingStyle;
  theme: { text: string; background: string; up: string; down: string; muted: string };
  formatPrice: (price: number) => string;
  formatDuration: (ms: number) => string;
  formatTime: (time: number) => string;
  timeToX: (time: number) => number;
  priceToY: (price: number) => number;
  bars: readonly Bar[];
  indexOf: (time: number) => number;
  intervalMs: number;
  // True while the drawing is still being placed.
  isDraft: boolean;
  isSelected: boolean;
}

export interface CreateEnv {
  xToTime: (x: number) => number;
  yToPrice: (y: number) => number;
  timeToX: (time: number) => number;
  priceToY: (price: number) => number;
  bounds: Bounds;
}

export interface Level {
  value: number;
  color: string;
  isVisible: boolean;
  // Shown beside the level when the tool's level text is on.
  text?: string;
}

// Extra settings a tool offers in its settings dialog. Values live in the drawing's `props`
// under the field's key; read them with `fieldValue`.
// `tab` puts a field on another tab of the settings dialog than Style.
export type ToolField = { tab?: string } & (
  | { key: string; label: string; type: 'checkbox'; default: boolean }
  | { key: string; label: string; type: 'number'; default: number; min?: number; max?: number; step?: number }
  | { key: string; label: string; type: 'select'; default: string; options: readonly string[] }
  | { key: string; label: string; type: 'color'; default: string }
  | { key: string; label: string; type: 'levels'; default: readonly Level[] }
);

export function fieldValue<T>(env: { drawing: SerializedDrawing }, definition: ToolDefinition | undefined, key: string): T {
  const saved = env.drawing.props?.[key];
  if (saved !== undefined) return saved as T;
  return definition?.fields?.find((field) => field.key === key)?.default as T;
}

export interface ToolHandles {
  at: (anchors: readonly DrawingPoint[]) => DrawingPoint[];
  drag: (anchors: readonly DrawingPoint[], handle: number, point: DrawingPoint) => DrawingPoint[];
}

export interface ToolDefinition {
  type: string;
  // Points the user places: a fixed count, a freehand stroke, or clicks until a double-click.
  anchors: number | 'free' | 'multi';
  // One-click tools that need several anchors build them from the first click.
  create?: (first: DrawingPoint, env: CreateEnv) => DrawingPoint[];
  // Handles placed elsewhere than on the anchors, and the anchors that dragging one gives.
  handles?: ToolHandles;
  isFillable?: boolean;
  hasText?: boolean;
  defaultText?: string;
  defaults?: Partial<DrawingStyle>;
  // Tool-specific settings (levels, options) shown in the settings dialog.
  fields?: readonly ToolField[];
  build: (g: ShapeList, env: ToolEnv) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const dashes: Record<DrawingStyle['lineStyle'], readonly number[]> = { solid: [], dashed: [6, 4], dotted: [1.5, 3] };

const stroke = (env: ToolEnv, overrides: ShapeStyle = {}): ShapeStyle => ({ color: env.style.lineColor, width: env.style.lineWidth, dash: dashes[env.style.lineStyle], ...(env.style.lineOpacity !== undefined ? { opacity: env.style.lineOpacity } : {}), ...overrides });

const area = (env: ToolEnv, color = env.style.fillColor ?? env.style.lineColor, opacity = env.style.fillOpacity ?? 0.15): ShapeStyle => ({ width: 0, fill: color, fillOpacity: opacity });

// A thin line in a level's colour that still follows the drawing's line style.
const levelStroke = (env: ToolEnv, color: string, overrides: ShapeStyle = {}): ShapeStyle => ({ color, width: env.style.lineWidth, dash: dashes[env.style.lineStyle], ...overrides });

const guide = (env: ToolEnv): ShapeStyle => ({ color: env.theme.muted, width: 1, dash: [4, 4] });

const textOf = (env: ToolEnv, fallback = '') => env.drawing.text ?? fallback;

const fontSize = (env: ToolEnv) => env.style.fontSize ?? 13;

const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const scale = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// Trims a ratio for display: 0.618, 1.272, 2.
const trim = (value: number, digits = 3) => String(Number(value.toFixed(digits)));

const signed = (env: ToolEnv, change: number) => `${change > 0 ? '+' : ''}${env.formatPrice(change)}`;
const percent = (change: number, base: number) => (base ? `${change > 0 ? '+' : ''}${(change / base * 100).toFixed(2)}%` : '–');

function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trim(value / 1e9, 2)}B`;
  if (abs >= 1e6) return `${trim(value / 1e6, 2)}M`;
  if (abs >= 1e3) return `${trim(value / 1e3, 2)}K`;
  return trim(value, 2);
}

// Quantities and amounts: whole numbers stay whole, small ones keep a few significant digits.
const amount = (value: number) => (Math.abs(value) >= 1 ? trim(value, 2) : String(Number(value.toPrecision(3))));

const barsBetween = (env: ToolEnv, from: number, to: number) => {
  const bars = Math.round(env.indexOf(to) - env.indexOf(from));
  return Number.isFinite(bars) ? bars : 0;
};

// Index range of the bars between two times, clamped to the data.
function barRange(env: ToolEnv, from: number, to: number): [number, number] | null {
  const i0 = env.indexOf(from);
  const i1 = env.indexOf(to);
  if (!Number.isFinite(i0) || !Number.isFinite(i1)) return null;
  const start = Math.max(0, Math.ceil(Math.min(i0, i1) - 1e-9));
  const end = Math.min(env.bars.length - 1, Math.floor(Math.max(i0, i1) + 1e-9));
  return end >= start ? [start, end] : null;
}

function volumeBetween(env: ToolEnv, from: number, to: number): number {
  const range = barRange(env, from, to);
  if (!range) return 0;
  let volume = 0;
  for (let index = range[0]; index <= range[1]; index++) volume += env.bars[index].volume ?? 0;
  return volume;
}

// Signed angle difference folded into (-π, π].
const turn = (angle: number) => {
  const folded = ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return folded === -Math.PI ? Math.PI : folded;
};

// The shorter sweep between two directions, as [start, end] with end > start.
function sweep(from: number, to: number): [number, number] {
  const delta = turn(to - from);
  return delta >= 0 ? [from, from + delta] : [from + delta, from];
}

// Outline of a ring sector between radii r0 and r1 (r0 may be 0), for filling.
function ringSector(center: Pt, r0: number, r1: number, start: number, end: number, steps = 48): Pt[] {
  const arcPoints = (radius: number) => Array.from({ length: steps + 1 }, (_, index) => {
    const angle = start + (end - start) * index / steps;
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
  return [...arcPoints(r1), ...(r0 > 0 ? arcPoints(r0).reverse() : [center])];
}

interface LabelOptions {
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  background?: string;
  border?: string;
  color?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  rotation?: number;
}

// A text label. Multi-line text (split on '\n') is stacked, with one background box behind all of
// its lines; its width is estimated at 0.6em per character as the shapes are built without a canvas.
function label(g: ShapeList, at: Pt, text: string, env: ToolEnv, options: LabelOptions = {}): void {
  const color = options.color ?? (options.background ? '#ffffff' : env.style.textColor ?? env.style.lineColor);
  const size = options.size ?? 12;
  const padding = options.background || options.border ? 4 : 0;
  const lines = text.split('\n');
  if (lines.length === 1) {
    g.text(at, text, { color, size, bold: options.bold, italic: options.italic, rotation: options.rotation, align: options.align, baseline: options.baseline, background: options.background, border: options.border, padding });
    return;
  }
  const align = options.align ?? 'left';
  const baseline = options.baseline ?? 'middle';
  const lineHeight = Math.round(size * 1.3);
  const width = Math.max(...lines.map((line) => line.length)) * size * 0.6 + padding * 2;
  const height = lines.length * lineHeight + padding * 2;
  const left = align === 'center' ? at.x - width / 2 : align === 'right' || align === 'end' ? at.x - width : at.x;
  const top = baseline === 'middle' ? at.y - height / 2 : baseline === 'bottom' || baseline === 'alphabetic' ? at.y - height : at.y;
  if (options.background || options.border) {
    g.rect({ x: left, y: top }, { x: left + width, y: top + height }, { width: options.border ? 1 : 0, color: options.border, dash: [], fill: options.background, fillOpacity: 1 });
  }
  const x = align === 'center' ? left + width / 2 : align === 'right' || align === 'end' ? left + width - padding : left + padding;
  lines.forEach((line, index) => {
    g.text({ x, y: top + padding + lineHeight * (index + 0.5) }, line, { color, size, bold: options.bold, italic: options.italic, align: align === 'end' ? 'right' : align === 'start' ? 'left' : align, baseline: 'middle' });
  });
}

// ── Tool options ────────────────────────────────────────────────────────────

interface Options {
  bool(key: string): boolean;
  num(key: string): number;
  str(key: string): string;
  // The visible levels of a 'levels' field, sorted by value.
  levels(key?: string): Level[];
}

function optionsFor(env: ToolEnv, definition: ToolDefinition): Options {
  const fieldOf = (key: string) => definition.fields?.find((field) => field.key === key);
  const value = (key: string) => fieldValue<unknown>(env, definition, key);
  return {
    bool: (key) => {
      const saved = value(key);
      if (typeof saved === 'boolean') return saved;
      if (saved === 'true' || saved === 'false') return saved === 'true';
      return fieldOf(key)?.default === true;
    },
    num: (key) => {
      const field = fieldOf(key);
      const parsed = Number(value(key));
      let number = Number.isFinite(parsed) ? parsed : Number(field?.default ?? 0) || 0;
      if (field?.type === 'number') {
        if (field.min !== undefined) number = Math.max(field.min, number);
        if (field.max !== undefined) number = Math.min(field.max, number);
      }
      return number;
    },
    str: (key) => {
      const field = fieldOf(key);
      const saved = value(key);
      if (field?.type === 'select') return typeof saved === 'string' && field.options.includes(saved) ? saved : field.default;
      return typeof saved === 'string' ? saved : String(field?.default ?? '');
    },
    levels: (key = 'levels') => {
      const saved = value(key);
      if (!Array.isArray(saved)) return [];
      return saved.flatMap((item): Level[] => {
        if (!item || typeof item !== 'object') return [];
        const level = item as Partial<Level>;
        const number = Number(level.value);
        if (!Number.isFinite(number) || level.isVisible === false) return [];
        return [{ value: number, color: typeof level.color === 'string' && level.color ? level.color : '#787b86', isVisible: true, ...(typeof level.text === 'string' && level.text ? { text: level.text } : {}) }];
      }).sort((left, right) => left.value - right.value);
    },
  };
}

type Build = (g: ShapeList, env: ToolEnv, o: Options) => void;
type Extra = Partial<Omit<ToolDefinition, 'type' | 'anchors' | 'build'>>;

function define(type: string, anchors: ToolDefinition['anchors'], build: Build, extra: Extra = {}): ToolDefinition {
  const definition: ToolDefinition = { type, anchors, ...extra, build: (g, env) => build(g, env, optionsFor(env, definition)) };
  return definition;
}

const one = (type: string, build: Build, extra: Extra = {}) => define(type, 1, build, extra);
const two = (type: string, build: Build, extra: Extra = {}) => define(type, 2, build, extra);
const three = (type: string, build: Build, extra: Extra = {}) => define(type, 3, build, extra);

const checkbox = (key: string, label: string, value = false): ToolField => ({ key, label, type: 'checkbox', default: value });
const numberField = (key: string, label: string, value: number, min?: number, max?: number, step?: number): ToolField => ({ key, label, type: 'number', default: value, min, max, step });
const selectField = (key: string, label: string, options: readonly string[], value = options[0]): ToolField => ({ key, label, type: 'select', default: value, options });
const levelsField = (key: string, label: string, levels: readonly Level[]): ToolField => ({ key, label, type: 'levels', default: levels });
const colorField = (key: string, label: string, value: string): ToolField => ({ key, label, type: 'color', default: value });
const onTab = (tab: string, fields: readonly ToolField[]): ToolField[] => fields.map((field) => ({ ...field, tab }));

const backgroundFields = (opacity = 8): ToolField[] => [checkbox('fillBackground', 'Background', true), numberField('backgroundOpacity', 'Background opacity (%)', opacity, 0, 100, 1)];

const backgroundOpacity = (o: Options) => (o.bool('fillBackground') ? o.num('backgroundOpacity') / 100 : 0);

// ── Level presets ───────────────────────────────────────────────────────────

const fibColors: Record<string, string> = {
  '0': '#787b86', '0.236': '#f23645', '0.25': '#f57c00', '0.382': '#ff9800', '0.5': '#4caf50', '0.618': '#089981', '0.75': '#26a69a', '0.786': '#00bcd4', '1': '#787b86',
  '1.272': '#7e57c2', '1.414': '#ab47bc', '1.618': '#2962ff', '2': '#9c27b0', '2.618': '#f23645', '3': '#ff9800', '3.618': '#9c27b0', '4.236': '#e91e63', '4.618': '#00897b',
};
const fibColor = (ratio: number) => fibColors[String(ratio)] ?? '#787b86';

function levelList(visible: readonly number[], hidden: readonly number[] = [], color: (value: number, index: number) => string = fibColor): Level[] {
  return [...visible.map((value) => ({ value, isVisible: true })), ...hidden.map((value) => ({ value, isVisible: false }))]
    .sort((left, right) => left.value - right.value)
    .map((level, index) => ({ ...level, color: color(level.value, index) }));
}

const fibMain = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const retracementLevels = levelList([...fibMain, 1.618, 2.618, 3.618, 4.236], [1.272, 1.414, 2, 3]);
const extensionLevels = levelList([...fibMain, 1.618, 2.618, 3.618, 4.236], [1.272, 1.414, 2, 3]);
const channelLevels = levelList([...fibMain, 1.618], [1.272, 1.414, 2, 2.618, 3.618]);
const timeZoneColors = ['#787b86', '#2962ff', '#089981', '#ff9800', '#f23645', '#9c27b0', '#00bcd4', '#4caf50', '#e91e63', '#7e57c2', '#26a69a', '#f57c00', '#ab47bc'];
const timeZoneLevels = levelList([0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89], [144, 233], (_, index) => timeZoneColors[index % timeZoneColors.length]);
const speedLevels = levelList([0, 0.25, 0.382, 0.5, 0.618, 0.75, 1]);
const circleLevels = levelList([0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618], [2.618, 3.618, 4.236]);
const arcLevels = levelList([0.236, 0.382, 0.5, 0.618, 0.786, 1], [1.618, 2.618]);
const wedgeLevels = levelList([0.236, 0.382, 0.5, 0.618, 0.786, 1]);

const gannColors: Record<string, string> = {
  '0': '#787b86', '0.25': '#ff9800', '0.333': '#4caf50', '0.382': '#4caf50', '0.4': '#4caf50', '0.5': '#089981', '0.6': '#00bcd4', '0.618': '#00bcd4',
  '0.667': '#2962ff', '0.75': '#2962ff', '1': '#787b86',
};
const gannBoxLevels = levelList([0, 0.25, 0.382, 0.5, 0.618, 0.75, 1], [], (value) => gannColors[String(value)] ?? '#787b86');
const gannFanColors: Record<string, string> = {
  '0.125': '#ff9800', '0.25': '#089981', '0.333': '#4caf50', '0.5': '#00bcd4', '1': '#2962ff', '2': '#9c27b0', '3': '#e91e63', '4': '#f23645', '8': '#787b86',
};
const gannFanLevels = levelList([0.125, 0.25, 0.333, 0.5, 1, 2, 3, 4, 8], [], (value) => gannFanColors[String(value)] ?? '#787b86');
const gannGridLevels = levelList([0.25, 0.4, 0.6, 0.75], [0.333, 0.5, 0.667], (value) => gannColors[String(value)] ?? '#787b86');
const gannFixedFanLevels = levelList([0.5, 1, 2], [0.125, 0.25, 0.333, 3, 4, 8], (value) => gannFanColors[String(value)] ?? '#787b86');

const pitchforkColors: Record<string, string> = {
  '0.25': '#ff9800', '0.382': '#4caf50', '0.5': '#089981', '0.618': '#00bcd4', '0.75': '#2962ff', '1': '#2962ff', '1.5': '#9c27b0', '1.75': '#e91e63', '2': '#f23645',
};
const pitchforkLevels = levelList([0.5, 1], [0.25, 0.382, 0.618, 0.75, 1.5, 1.75, 2], (value) => pitchforkColors[String(value)] ?? '#787b86');

// Gann ratios read as price/time units: 0.125 is 1/8, 2 is 2/1.
const gannName = (value: number) => (value < 1 ? `1/${Math.round(1 / value)}` : `${trim(value, 2)}/1`);

// ── Fibonacci ───────────────────────────────────────────────────────────────

function fibFields(levels: readonly Level[], options: { prices?: boolean; reverse?: boolean; trendLine?: boolean; label?: string; extra?: ToolField[] } = {}): ToolField[] {
  return [
    levelsField('levels', options.label ?? 'Levels', levels),
    ...(options.extra ?? []),
    ...(options.prices === false ? [] : [checkbox('showPrices', 'Prices', true)]),
    checkbox('showLevels', 'Levels labels', true),
    checkbox('isPercent', 'Levels as percentages'),
    checkbox('showText', 'Level text', true),
    selectField('labelsPosition', 'Labels position', ['Left', 'Right']),
    numberField('labelFontSize', 'Labels font size', 11, 8, 24, 1),
    ...(options.trendLine ? [checkbox('showTrendLine', 'Trend line', true)] : []),
    ...(options.reverse ? [checkbox('reverse', 'Reverse')] : []),
    ...backgroundFields(),
  ];
}

function levelText(env: ToolEnv, o: Options, value: number, price?: number, text?: string): string {
  const ratio = o.bool('showLevels') ? (o.bool('isPercent') ? `${trim(value * 100, 1)}%` : trim(value)) : '';
  const shown = price !== undefined && o.bool('showPrices') ? env.formatPrice(price) : '';
  const numbers = ratio && shown ? `${ratio} (${shown})` : ratio || shown;
  const named = text && o.bool('showText') ? text : '';
  return [numbers, named].filter(Boolean).join(' ');
}

const levelFontSize = (o: Options) => o.num('labelFontSize') || 11;

const isLeft = (o: Options) => o.str('labelsPosition') !== 'Right';

// Horizontal levels between x0 and x1 (or to the edges when the style extends them), each shaded
// towards the next one in that level's colour.
function horizontalLevels(g: ShapeList, env: ToolEnv, o: Options, levels: readonly { level: Level; price: number }[], x0: number, x1: number): void {
  const left = env.style.extendLeft ? 0 : x0;
  const right = env.style.extendRight ? env.bounds.width : x1;
  const opacity = backgroundOpacity(o);
  if (opacity > 0) {
    for (let index = 0; index + 1 < levels.length; index++) {
      const next = levels[index + 1];
      g.rect({ x: left, y: env.priceToY(levels[index].price) }, { x: right, y: env.priceToY(next.price) }, area(env, next.level.color, opacity));
    }
  }
  for (const { level, price } of levels) {
    const y = env.priceToY(price);
    g.line({ x: left, y }, { x: right, y }, levelStroke(env, level.color));
    const text = levelText(env, o, level.value, price, level.text);
    if (!text) continue;
    if (isLeft(o)) {
      const inside = !!env.style.extendLeft;
      label(g, { x: inside ? left + 4 : left - 4, y: inside ? y - 2 : y }, text, env, { align: inside ? 'left' : 'right', baseline: inside ? 'bottom' : 'middle', color: level.color, size: levelFontSize(o) });
    } else {
      const inside = !!env.style.extendRight;
      label(g, { x: inside ? right - 4 : right + 4, y: inside ? y - 2 : y }, text, env, { align: inside ? 'right' : 'left', baseline: inside ? 'bottom' : 'middle', color: level.color, size: levelFontSize(o) });
    }
  }
}

// Concentric level rings (or arcs/sectors between `start` and `end`) around `center`.
function radialLevels(g: ShapeList, env: ToolEnv, o: Options, center: Pt, radius: number, start: number, end: number): void {
  const levels = o.levels();
  const opacity = backgroundOpacity(o);
  const isFull = end - start >= Math.PI * 2 - 1e-6;
  if (opacity > 0) {
    for (let index = 0; index + 1 < levels.length; index++) {
      const next = levels[index + 1];
      g.poly(ringSector(center, radius * levels[index].value, radius * next.value, start, end), true, area(env, next.color, opacity));
    }
  }
  for (const level of levels) {
    const r = radius * level.value;
    if (r <= 0) continue;
    g.ellipse(center.x, center.y, r, r, levelStroke(env, level.color), 0, start, end);
    const text = levelText(env, o, level.value, undefined, level.text);
    if (!text) continue;
    const angle = isFull ? (isLeft(o) ? Math.PI : 0) : isLeft(o) ? start : end;
    const at = { x: center.x + (r + 4) * Math.cos(angle), y: center.y + (r + 4) * Math.sin(angle) };
    label(g, at, text, env, { align: Math.cos(angle) < -0.3 ? 'right' : Math.cos(angle) > 0.3 ? 'left' : 'center', color: level.color, size: levelFontSize(o) });
  }
}

// ── Lines ───────────────────────────────────────────────────────────────────

const lineInfoFields = (value = false): ToolField[] => onTab('Stats', [
  checkbox('showPriceRange', 'Price range', value),
  checkbox('showPercentPriceRange', 'Percent change', value),
  checkbox('showBarsRange', 'Bars range', value),
  checkbox('showDateTimeRange', 'Date/time range', value),
  checkbox('showAngle', 'Angle', value),
  checkbox('showMiddlePoint', 'Middle point'),
  checkbox('alwaysShowStats', 'Always show stats', true),
]);

interface LineStats { price: boolean; percent: boolean; bars: boolean; duration: boolean; angle: boolean }

function lineInfo(env: ToolEnv, show: LineStats): string[] {
  const [a, b] = env.points;
  const [p0, p1] = env.anchors;
  const change = p1.price - p0.price;
  const lines: string[] = [];
  const changes = [show.price ? signed(env, change) : '', show.percent ? percent(change, p0.price) : ''].filter(Boolean);
  if (changes.length) lines.push(changes.length === 2 ? `${changes[0]} (${changes[1]})` : changes[0]);
  const spans = [show.bars ? `${barsBetween(env, p0.time, p1.time)} bars` : '', show.duration ? env.formatDuration(Math.abs(p1.time - p0.time)) : ''].filter(Boolean);
  if (spans.length) lines.push(spans.join(', '));
  if (show.angle) lines.push(`${(Math.atan2(a.y - b.y, b.x - a.x) * 180 / Math.PI).toFixed(2)}°`);
  return lines;
}

function infoLabel(g: ShapeList, env: ToolEnv, o: Options, at: Pt): void {
  const [a, b] = env.points;
  if (o.bool('showMiddlePoint')) g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, 3, 3, { color: env.style.lineColor, width: 1, fill: env.theme.background });
  if (!o.bool('alwaysShowStats') && !env.isSelected) return;
  const lines = lineInfo(env, { price: o.bool('showPriceRange'), percent: o.bool('showPercentPriceRange'), bars: o.bool('showBarsRange'), duration: o.bool('showDateTimeRange'), angle: o.bool('showAngle') });
  if (lines.length) label(g, { x: at.x + 8, y: at.y + 8 }, lines.join('\n'), env, { baseline: 'top', background: env.theme.background, border: env.style.lineColor, color: env.theme.text, size: 11 });
}

// ── Pitchforks ──────────────────────────────────────────────────────────────

type ForkType = 'pitchfork' | 'schiff-pitchfork' | 'modified-schiff-pitchfork' | 'inside-pitchfork';

// Where the median line starts. The Schiff variants move it halfway up the handle's first leg
// (price only, or price and time); the inside pitchfork starts it at the midpoint of that
// first reaction leg, so the whole fork sits inside the A–B–C swing.
function forkOrigin(type: ForkType, a: Pt, b: Pt): Pt {
  if (type === 'schiff-pitchfork') return { x: a.x, y: (a.y + b.y) / 2 };
  if (type === 'modified-schiff-pitchfork' || type === 'inside-pitchfork') return midpoint(a, b);
  return a;
}

const pitchforkFields: ToolField[] = [levelsField('levels', 'Levels', pitchforkLevels), checkbox('extendLines', 'Extend lines'), ...backgroundFields()];

function pitchforkBuild(type: ForkType): Build {
  return (g, env, o) => {
    const [a, b, c] = env.points;
    if (!b) return;
    g.line(a, b, stroke(env, { width: 1 }));
    if (!c) return;
    g.line(b, c, stroke(env, { width: 1 }));
    const middle = midpoint(b, c);
    const origin = forkOrigin(type, a, b);
    if (origin.x !== a.x || origin.y !== a.y) g.line(a, origin, stroke(env, { width: 1, dash: [4, 4] }));
    const direction = sub(middle, origin);
    if (Math.hypot(direction.x, direction.y) < 1e-6) return;
    const isExtended = o.bool('extendLines');
    const reach = (from: Pt): [Pt, Pt] => (isExtended ? extend(from, add(from, direction), env.bounds, false, true) : [from, add(from, direction)]);
    // Level v sits v times the half-spread away from the median: level 1 runs through B and C.
    const at = (value: number, side: Pt) => lerp(middle, side, value);
    const levels = o.levels().filter((level) => level.value > 0);
    const opacity = backgroundOpacity(o);
    if (opacity > 0) {
      let previous = 0;
      for (const level of levels) {
        for (const side of [b, c]) {
          const [s0, e0] = reach(at(previous, side));
          const [s1, e1] = reach(at(level.value, side));
          g.poly([s0, e0, e1, s1], true, area(env, level.color, opacity));
        }
        previous = level.value;
      }
    }
    g.line(origin, reach(middle)[1], stroke(env));
    for (const level of levels) for (const side of [b, c]) g.line(...reach(at(level.value, side)), levelStroke(env, level.color));
  };
}

// ── Patterns ────────────────────────────────────────────────────────────────

// A zig-zag through the anchors with a label at each point, placed above peaks and below troughs.
function waves(g: ShapeList, env: ToolEnv, names: readonly string[], options: { fill?: boolean; circled?: boolean } = {}) {
  const { points } = env;
  if (options.fill && points.length >= 3) {
    for (let index = 2; index < points.length; index += 2) g.poly([points[index - 2], points[index - 1], points[index]], true, area(env));
  }
  g.poly(points, false, stroke(env));
  points.forEach((point, index) => {
    const name = names[index];
    if (!name) return;
    const before = points[index - 1];
    const after = points[index + 1];
    const neighbour = before ?? after;
    const isPeak = neighbour ? point.y <= (before && after ? Math.min(before.y, after.y) : neighbour.y) : true;
    if (options.circled) {
      const radius = Math.max(8, name.length * 3.5 + 4);
      const at = { x: point.x, y: point.y + (isPeak ? -(radius + 5) : radius + 5) };
      g.ellipse(at.x, at.y, radius, radius, { color: env.style.lineColor, width: 1, dash: [], fill: env.theme.background, fillOpacity: 1 });
      g.text(at, name, { color: env.style.lineColor, size: 10, bold: true, align: 'center', baseline: 'middle' });
    } else {
      label(g, { x: point.x, y: point.y + (isPeak ? -14 : 14) }, name, env, { align: 'center', background: env.style.lineColor, size: 11, bold: true });
    }
  });
}

const ratio = (part: number, whole: number) => (whole ? trim(Math.abs(part / whole)) : '');

// Dashed connectors between anchor pairs, each labelled with a ratio of price legs.
function ratioLegs(g: ShapeList, env: ToolEnv, legs: readonly [number, number, string][]): void {
  const p = env.points;
  for (const [from, to, text] of legs) {
    if (!p[from] || !p[to]) continue;
    g.line(p[from], p[to], stroke(env, { dash: [4, 4], width: 1 }));
    if (text) label(g, midpoint(p[from], p[to]), text, env, { align: 'center', background: env.theme.background, color: env.theme.text, border: env.style.lineColor, size: 10 });
  }
}

// ── Forecasting ─────────────────────────────────────────────────────────────

function positionCreate(isLong: boolean) {
  return (first: DrawingPoint, env: CreateEnv): DrawingPoint[] => {
    const x = env.timeToX(first.time);
    const y = env.priceToY(first.price);
    const step = env.bounds.height * 0.08;
    const end = env.xToTime(Math.min(env.bounds.width - 10, x + Math.max(60, env.bounds.width * 0.15)));
    return [first, { time: end, price: env.yToPrice(y + (isLong ? -2 * step : 2 * step)) }, { time: end, price: env.yToPrice(y + (isLong ? step : -step)) }];
  };
}

const positionFields: ToolField[] = [
  numberField('accountSize', 'Account size', 1000, 0),
  numberField('lotSize', 'Lot size', 1, 0),
  numberField('riskPercent', 'Risk (%)', 1, 0, 100, 0.1),
  colorField('profitColor', 'Target colour', '#089981'),
  colorField('stopColor', 'Stop colour', '#f23645'),
  numberField('areaOpacity', 'Background opacity (%)', 20, 0, 100, 1),
  ...onTab('Text', [
    checkbox('showStats', 'Always show stats', true),
    checkbox('showPriceLabels', 'Target and stop labels', true),
    checkbox('isCompact', 'Compact labels'),
    colorField('textColor', 'Text colour', '#ffffff'),
  ]),
];

// Follows price from the entry bar to the end of the position: the trade closes at the first bar
// that touches the stop (checked first) or the target, else it is still open at the last close.
function positionOutcome(env: ToolEnv, isLong: boolean, entry: DrawingPoint, end: number, target: number, stop: number): { exit: number; isClosed: boolean } | null {
  const range = barRange(env, entry.time, end);
  if (!range) return null;
  for (let index = range[0]; index <= range[1]; index++) {
    const bar = env.bars[index];
    if (isLong ? bar.low <= stop : bar.high >= stop) return { exit: stop, isClosed: true };
    if (isLong ? bar.high >= target : bar.low <= target) return { exit: target, isClosed: true };
  }
  return { exit: env.bars[range[1]].close, isClosed: false };
}

function position(isLong: boolean): Build {
  return (g, env, o) => {
    const [entry, target, stop] = env.points;
    if (!target || !stop) return;
    const [entryPoint, targetPoint, stopPoint] = env.anchors;
    const [entryPrice, targetPrice, stopPrice] = [entryPoint.price, targetPoint.price, stopPoint.price];
    const x0 = entry.x;
    // The far edge can be dragged to either side of the entry, as in TradingView.
    const x1 = Math.abs(target.x - x0) < 1 ? x0 + 1 : target.x;
    const profitColor = o.str('profitColor');
    const stopColor = o.str('stopColor');
    const opacity = o.num('areaOpacity') / 100;
    g.rect({ x: x0, y: entry.y }, { x: x1, y: target.y }, { width: 0, fill: profitColor, fillOpacity: opacity });
    g.rect({ x: x0, y: entry.y }, { x: x1, y: stop.y }, { width: 0, fill: stopColor, fillOpacity: opacity });
    g.line({ x: x0, y: entry.y }, { x: x1, y: entry.y }, { color: env.theme.muted, width: 1 });
    const reward = Math.abs(targetPrice - entryPrice);
    const risk = Math.abs(entryPrice - stopPrice);
    const lot = o.num('lotSize') || 1;
    const riskAmount = o.num('accountSize') * o.num('riskPercent') / 100;
    const quantity = risk > 0 ? riskAmount / (risk * lot) : 0;
    const money = (priceMove: number) => amount(priceMove * quantity * lot);
    const pct = (price: number) => percent(price - entryPrice, entryPrice);
    const mid = (x0 + x1) / 2;
    const isCompact = o.bool('isCompact');
    const color = o.str('textColor');
    const ratio = risk ? (reward / risk).toFixed(2) : '-';
    if (o.bool('showPriceLabels') || env.isSelected) {
      const targetText = isCompact ? `${env.formatPrice(targetPrice)} (${pct(targetPrice)})` : `Target: ${env.formatPrice(targetPrice)} (${pct(targetPrice)}) ${env.formatPrice(reward)}, Amount: ${money(reward)}`;
      const stopText = isCompact ? `${env.formatPrice(stopPrice)} (${pct(stopPrice)})` : `Stop: ${env.formatPrice(stopPrice)} (${pct(stopPrice)}) ${env.formatPrice(risk)}, Amount: ${money(risk)}`;
      label(g, { x: mid, y: target.y + (isLong ? -12 : 12) }, targetText, env, { align: 'center', background: profitColor, color, size: 11 });
      label(g, { x: mid, y: stop.y + (isLong ? 12 : -12) }, stopText, env, { align: 'center', background: stopColor, color, size: 11 });
    }
    if (o.bool('showStats') || env.isSelected) {
      const outcome = targetPoint.time > entryPoint.time ? positionOutcome(env, isLong, entryPoint, targetPoint.time, targetPrice, stopPrice) : null;
      const pnl = outcome ? `${outcome.isClosed ? 'Closed' : 'Open'} P&L: ${money((outcome.exit - entryPrice) * (isLong ? 1 : -1))}, ` : '';
      const text = isCompact ? `R:R ${ratio}` : `${isLong ? 'Long' : 'Short'} · ${pnl}Qty: ${amount(quantity)}\nRisk/Reward Ratio: ${ratio}`;
      label(g, { x: mid, y: entry.y }, text, env, { align: 'center', background: env.theme.muted, color, size: 11 });
    }
  };
}

// As in TradingView: the entry, target and stop handles sit on the entry's edge, and one handle
// on the far edge, at the entry price, sets the position's length.
const positionHandles: ToolHandles = {
  at: ([entry, target, stop]) => [entry, { time: entry.time, price: target.price }, { time: entry.time, price: stop.price }, { time: target.time, price: entry.price }],
  drag: ([entry, target, stop], handle, point) => {
    if (handle === 0) return [point, target, stop];
    if (handle === 1) return [entry, { ...target, price: point.price }, stop];
    if (handle === 2) return [entry, target, { ...stop, price: point.price }];
    return [entry, { ...target, time: point.time }, { ...stop, time: point.time }];
  },
};

// Deterministic noise in [0, 1) for the ghost feed, so a drawing looks the same on every paint.
const noise = (seed: number) => {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
};

interface Candle { x: number; open: number; high: number; low: number; close: number }

function candles(g: ShapeList, env: ToolEnv, list: readonly Candle[], spacing: number, mode = 'Candles', opacity = 0.55): void {
  const half = clamp(spacing * 0.3, 0.5, 20);
  if (mode === 'Line') {
    g.poly(list.map((candle) => ({ x: candle.x, y: env.priceToY(candle.close) })), false, stroke(env, { opacity }));
    return;
  }
  for (const candle of list) {
    const color = candle.close >= candle.open ? env.theme.up : env.theme.down;
    const style = { color, width: 1, dash: [], opacity };
    g.line({ x: candle.x, y: env.priceToY(candle.high) }, { x: candle.x, y: env.priceToY(candle.low) }, style);
    if (mode === 'Bars') {
      g.line({ x: candle.x - half, y: env.priceToY(candle.open) }, { x: candle.x, y: env.priceToY(candle.open) }, style);
      g.line({ x: candle.x, y: env.priceToY(candle.close) }, { x: candle.x + half, y: env.priceToY(candle.close) }, style);
      continue;
    }
    const top = env.priceToY(Math.max(candle.open, candle.close));
    const bottom = env.priceToY(Math.min(candle.open, candle.close));
    g.rect({ x: candle.x - half, y: top }, { x: candle.x + half, y: Math.max(bottom, top + 1) }, { ...style, fill: color, fillOpacity: 0.6 });
  }
}

type Source = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4';
const sources: readonly Source[] = ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'];

function sourceOf(name: string): (bar: Bar) => number {
  switch (name) {
    case 'open': return (bar) => bar.open;
    case 'high': return (bar) => bar.high;
    case 'low': return (bar) => bar.low;
    case 'hl2': return (bar) => (bar.high + bar.low) / 2;
    case 'hlc3': return (bar) => (bar.high + bar.low + bar.close) / 3;
    case 'ohlc4': return (bar) => (bar.open + bar.high + bar.low + bar.close) / 4;
    default: return (bar) => bar.close;
  }
}

function regression(env: ToolEnv, from: number, to: number, source: (bar: Bar) => number) {
  const range = barRange(env, from, to);
  if (!range) return null;
  const [start, end] = range;
  const n = end - start + 1;
  if (n < 2) return null;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
  for (let index = start; index <= end; index++) {
    const x = index - start;
    const y = source(env.bars[index]);
    sumX += x; sumY += y; sumXY += x * y; sumXX += x * x; sumYY += y * y;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX || 1);
  const intercept = (sumY - slope * sumX) / n;
  let squares = 0;
  for (let index = start; index <= end; index++) squares += (source(env.bars[index]) - (intercept + slope * (index - start))) ** 2;
  const spread = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
  return { start, end, startPrice: intercept, endPrice: intercept + slope * (n - 1), deviation: Math.sqrt(squares / n), pearson: spread ? (n * sumXY - sumX * sumY) / spread : 0 };
}

// ── Tools ───────────────────────────────────────────────────────────────────

const textFields: ToolField[] = [checkbox('bold', 'Bold')];

const fontFields = [checkbox('bold', 'Bold'), checkbox('italic', 'Italic')];

const lineTextFields: ToolField[] = onTab('Text', [
  selectField('textAlign', 'Alignment', ['Left', 'Center', 'Right'], 'Center'),
  selectField('textPosition', 'Position', ['Above line', 'On line', 'Below line']),
  ...fontFields,
]);

const boxTextFields: ToolField[] = onTab('Text', [
  selectField('textAlign', 'Alignment', ['Left', 'Center', 'Right'], 'Center'),
  selectField('textPosition', 'Position', ['Top', 'Middle', 'Bottom'], 'Middle'),
  ...fontFields,
]);

const arrowFields: ToolField[] = [checkbox('startArrow', 'Arrow at start'), checkbox('endArrow', 'Arrow at end')];

const lineText = { hasText: true, defaultText: '' };

// The drawing's text along the line from a to b, turned to the line's slope but never upside down.
function textAlongLine(g: ShapeList, env: ToolEnv, o: Options, a: Pt, b: Pt): void {
  const text = textOf(env);
  if (!text) return;
  const isVertical = Math.abs(b.x - a.x) < 1e-6;
  const [from, to] = isVertical ? (a.y >= b.y ? [a, b] : [b, a]) : a.x <= b.x ? [a, b] : [b, a];
  const rotation = Math.atan2(to.y - from.y, to.x - from.x);
  const where = o.str('textAlign');
  const at = where === 'Left' ? from : where === 'Right' ? to : midpoint(from, to);
  const position = o.str('textPosition');
  label(g, at, text, env, {
    align: where === 'Left' ? 'left' : where === 'Right' ? 'right' : 'center',
    baseline: position === 'On line' ? 'middle' : position === 'Below line' ? 'top' : 'bottom',
    color: env.style.textColor ?? env.style.lineColor,
    size: fontSize(env),
    bold: o.bool('bold'),
    italic: o.bool('italic'),
    rotation,
  });
}

// Text placed inside a box by the tool's alignment and position.
function textInBox(g: ShapeList, env: ToolEnv, o: Options, a: Pt, b: Pt): void {
  const text = textOf(env);
  if (!text) return;
  const [left, right, top, bottom] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const where = o.str('textAlign');
  const position = o.str('textPosition');
  const x = where === 'Left' ? left + 6 : where === 'Right' ? right - 6 : (left + right) / 2;
  const y = position === 'Top' ? top + 4 : position === 'Bottom' ? bottom - 4 : (top + bottom) / 2;
  label(g, { x, y }, text, env, {
    align: where === 'Left' ? 'left' : where === 'Right' ? 'right' : 'center',
    baseline: position === 'Top' ? 'top' : position === 'Bottom' ? 'bottom' : 'middle',
    color: env.style.textColor ?? env.style.lineColor,
    size: fontSize(env),
    bold: o.bool('bold'),
    italic: o.bool('italic'),
  });
}

function lineEnds(g: ShapeList, env: ToolEnv, o: Options, a: Pt, b: Pt): void {
  const size = 8 + env.style.lineWidth * 2;
  if (o.bool('startArrow')) g.arrowHead(b, a, size, stroke(env, { dash: [] }));
  if (o.bool('endArrow')) g.arrowHead(a, b, size, stroke(env, { dash: [] }));
}

const definitions: ToolDefinition[] = [
  // Lines
  two('trend-line', (g, env, o) => {
    const [a, b] = env.points;
    if (!b) return;
    const [start, end] = extend(a, b, env.bounds, !!env.style.extendLeft, !!env.style.extendRight);
    g.line(start, end, stroke(env));
    lineEnds(g, env, o, a, b);
    textAlongLine(g, env, o, a, b);
    infoLabel(g, env, o, b);
  }, { ...lineText, fields: [...arrowFields, ...lineInfoFields(), ...lineTextFields] }),
  two('ray', (g, env, o) => {
    const [a, b] = env.points;
    if (!b) return;
    g.line(...extend(a, b, env.bounds, false, true), stroke(env));
    lineEnds(g, env, o, a, b);
    textAlongLine(g, env, o, a, b);
    infoLabel(g, env, o, b);
  }, { ...lineText, fields: [...arrowFields, ...lineInfoFields(), ...lineTextFields] }),
  two('extended-line', (g, env, o) => {
    const [a, b] = env.points;
    if (!b) return;
    g.line(...extend(a, b, env.bounds, true, true), stroke(env));
    textAlongLine(g, env, o, a, b);
    infoLabel(g, env, o, b);
  }, { ...lineText, fields: [...lineInfoFields(), ...lineTextFields] }),
  two('info-line', (g, env) => {
    const [a, b] = env.points;
    if (!b) return;
    g.line(a, b, stroke(env));
    label(g, { x: b.x + 8, y: b.y }, lineInfo(env, { price: true, percent: true, bars: true, duration: true, angle: true }).join('\n'), env, { background: env.theme.background, color: env.theme.text, size: 11 });
  }),
  two('trend-angle', (g, env) => {
    const [a, b] = env.points;
    if (!b) return;
    g.line(a, b, stroke(env));
    g.line(a, { x: a.x + Math.max(40, Math.abs(b.x - a.x) * 0.6), y: a.y }, stroke(env, { dash: [3, 3], width: 1 }));
    const angle = Math.atan2(a.y - b.y, b.x - a.x);
    g.ellipse(a.x, a.y, 30, 30, { width: 1, color: env.style.lineColor }, 0, Math.min(0, -angle), Math.max(0, -angle));
    label(g, { x: a.x + 36, y: a.y - (angle >= 0 ? 10 : -10) }, `${(angle * 180 / Math.PI).toFixed(2)}°`, env, { size: 11 });
  }),
  one('horizontal-line', (g, env, o) => {
    const [a] = env.points;
    const [start, end] = [{ x: 0, y: a.y }, { x: env.bounds.width, y: a.y }];
    g.line(start, end, stroke(env));
    textAlongLine(g, env, o, start, { x: end.x - (o.bool('showPrice') ? 80 : 4), y: a.y });
    if (o.bool('showPrice')) label(g, { x: env.bounds.width - 4, y: a.y }, env.formatPrice(env.anchors[0].price), env, { align: 'right', background: env.style.lineColor, size: 11 });
  }, { ...lineText, fields: [checkbox('showPrice', 'Price label', true), ...lineTextFields] }),
  one('horizontal-ray', (g, env, o) => {
    const [a] = env.points;
    g.line(a, { x: env.bounds.width, y: a.y }, stroke(env));
    textAlongLine(g, env, o, a, { x: env.bounds.width - (o.bool('showPrice') ? 80 : 4), y: a.y });
    if (o.bool('showPrice')) label(g, { x: env.bounds.width - 4, y: a.y }, env.formatPrice(env.anchors[0].price), env, { align: 'right', background: env.style.lineColor, size: 11 });
  }, { ...lineText, fields: [checkbox('showPrice', 'Price label', true), ...lineTextFields] }),
  one('vertical-line', (g, env, o) => {
    const [a] = env.points;
    const [top, bottom] = [env.bounds.top, env.bounds.top + env.bounds.height];
    g.line({ x: a.x, y: top }, { x: a.x, y: bottom }, stroke(env));
    if (o.bool('showTime')) label(g, { x: a.x, y: bottom - 4 }, env.formatTime(env.anchors[0].time), env, { align: 'center', baseline: 'bottom', background: env.style.lineColor, size: 11 });
    const text = textOf(env);
    if (!text) return;
    const position = o.str('textPosition');
    const side = o.str('textAlign');
    const y = position === 'Top' ? top + 6 : position === 'Bottom' ? bottom - (o.bool('showTime') ? 26 : 6) : (top + bottom) / 2;
    const font = { color: env.style.textColor ?? env.style.lineColor, size: fontSize(env), bold: o.bool('bold'), italic: o.bool('italic') };
    // Turned a quarter left, the text reads upwards and its baseline faces the line's right.
    if (o.str('textOrientation') === 'Vertical') {
      label(g, { x: side === 'Left' ? a.x - 3 : side === 'Right' ? a.x + 3 : a.x, y }, text, env, { ...font, rotation: -Math.PI / 2, align: position === 'Top' ? 'right' : position === 'Bottom' ? 'left' : 'center', baseline: side === 'Left' ? 'bottom' : side === 'Right' ? 'top' : 'middle' });
    } else {
      label(g, { x: side === 'Left' ? a.x - 4 : side === 'Right' ? a.x + 4 : a.x, y }, text, env, { ...font, align: side === 'Left' ? 'right' : side === 'Right' ? 'left' : 'center', baseline: position === 'Top' ? 'top' : position === 'Bottom' ? 'bottom' : 'middle' });
    }
  }, {
    ...lineText,
    fields: [
      checkbox('showTime', 'Time label', true),
      ...onTab('Text', [
        selectField('textOrientation', 'Orientation', ['Vertical', 'Horizontal']),
        selectField('textPosition', 'Position', ['Top', 'Middle', 'Bottom']),
        selectField('textAlign', 'Side', ['Left', 'Center', 'Right'], 'Right'),
        ...fontFields,
      ]),
    ],
  }),
  one('cross-line', (g, env) => {
    const [a] = env.points;
    g.line({ x: 0, y: a.y }, { x: env.bounds.width, y: a.y }, stroke(env));
    g.line({ x: a.x, y: env.bounds.top }, { x: a.x, y: env.bounds.top + env.bounds.height }, stroke(env));
  }),

  // Channels
  three('parallel-channel', (g, env, o) => {
    const [a, b, c] = env.points;
    if (!b) return;
    const line = (p: Pt, q: Pt) => extend(p, q, env.bounds, o.bool('extendLeft'), o.bool('extendRight'));
    if (!c) { g.line(...line(a, b), stroke(env)); return; }
    const offset = c.y - (a.y + (b.y - a.y) * ((c.x - a.x) / ((b.x - a.x) || 1)));
    const a2 = { x: a.x, y: a.y + offset };
    const b2 = { x: b.x, y: b.y + offset };
    const [s1, e1] = line(a, b);
    const [s2, e2] = line(a2, b2);
    g.poly([s1, e1, e2, s2], true, area(env));
    g.line(s1, e1, stroke(env));
    g.line(s2, e2, stroke(env));
    if (o.bool('showMiddle')) g.line(...line(midpoint(a, a2), midpoint(b, b2)), stroke(env, { dash: [4, 4], width: 1 }));
  }, { isFillable: true, fields: [checkbox('extendLeft', 'Extend left'), checkbox('extendRight', 'Extend right'), checkbox('showMiddle', 'Middle line', true)] }),
  two('regression-trend', (g, env, o) => {
    const [a0, a1] = env.anchors;
    if (!a1) return;
    const fit = regression(env, a0.time, a1.time, sourceOf(o.str('source')));
    if (!fit) { g.line(env.points[0], env.points[1], stroke(env)); return; }
    const x0 = env.timeToX(env.bars[fit.start].time);
    const x1 = env.timeToX(env.bars[fit.end].time);
    const span = (shift: number): [Pt, Pt] => {
      const p = { x: x0, y: env.priceToY(fit.startPrice + shift) };
      const q = { x: x1, y: env.priceToY(fit.endPrice + shift) };
      return o.bool('extendLines') ? extend(p, q, env.bounds, false, true) : [p, q];
    };
    const k = o.num('deviation') * fit.deviation;
    const upper = o.bool('useUpperDeviation') ? k : 0;
    const lower = o.bool('useLowerDeviation') ? -k : 0;
    if (upper !== lower) {
      const [u0, u1] = span(upper);
      const [l0, l1] = span(lower);
      g.poly([u0, u1, l1, l0], true, area(env, env.style.lineColor, 0.08));
    }
    g.line(...span(0), stroke(env));
    if (upper) g.line(...span(upper), stroke(env, { width: 1 }));
    if (lower) g.line(...span(lower), stroke(env, { width: 1 }));
    if (o.bool('showPearsons')) {
      const bottom = span(lower)[0];
      label(g, { x: bottom.x, y: bottom.y + 12 }, fit.pearson.toFixed(4), env, { size: 11 });
    }
  }, {
    fields: [
      selectField('source', 'Source', sources), numberField('deviation', 'Deviation', 2, 0, 10, 0.1),
      checkbox('useUpperDeviation', 'Upper deviation', true), checkbox('useLowerDeviation', 'Lower deviation', true),
      checkbox('showPearsons', "Pearson's R", true), checkbox('extendLines', 'Extend lines'),
    ],
  }),
  three('flat-top-bottom', (g, env) => {
    const [a, b, c] = env.points;
    if (!b) return;
    g.line(a, b, stroke(env));
    if (!c) return;
    const flatA = { x: a.x, y: c.y };
    const flatB = { x: b.x, y: c.y };
    g.poly([a, b, flatB, flatA], true, area(env));
    g.line(flatA, flatB, stroke(env));
  }, { isFillable: true }),
  define('disjoint-channel', 4, (g, env) => {
    const [a, b, c, d] = env.points;
    if (!b) return;
    g.line(a, b, stroke(env));
    if (!c) return;
    const end = d ?? { x: b.x, y: c.y };
    g.poly([a, b, end, c], true, area(env));
    g.line(c, end, stroke(env));
  }, { isFillable: true }),

  // Pitchforks
  ...(['pitchfork', 'schiff-pitchfork', 'modified-schiff-pitchfork', 'inside-pitchfork'] as const).map((type) => three(type, pitchforkBuild(type), { isFillable: true, fields: pitchforkFields })),
  three('pitchfan', (g, env, o) => {
    const [a, b, c] = env.points;
    if (!b) return;
    g.line(a, b, stroke(env, { width: 1 }));
    if (!c) return;
    g.line(b, c, stroke(env, { width: 1 }));
    const middle = midpoint(b, c);
    const isExtended = o.bool('extendLines');
    const end = (through: Pt) => (isExtended ? extend(a, through, env.bounds, false, true)[1] : lerp(a, through, 1.5));
    const levels = o.levels().filter((level) => level.value > 0);
    const opacity = backgroundOpacity(o);
    if (opacity > 0) {
      let previous = 0;
      for (const level of levels) {
        for (const side of [b, c]) g.poly([a, end(lerp(middle, side, previous)), end(lerp(middle, side, level.value))], true, area(env, level.color, opacity));
        previous = level.value;
      }
    }
    g.line(a, end(middle), stroke(env));
    for (const level of levels) for (const side of [b, c]) g.line(a, end(lerp(middle, side, level.value)), levelStroke(env, level.color));
  }, { isFillable: true, fields: pitchforkFields }),

  // Fibonacci
  two('fib-retracement', (g, env, o) => {
    const [a, b] = env.points;
    if (!b) return;
    if (o.bool('showTrendLine')) g.line(a, b, guide(env));
    const [p0, p1] = env.anchors;
    // Level 0 sits on the second anchor and 1 on the first; reversed, the other way round.
    const [zero, one] = o.bool('reverse') ? [p0.price, p1.price] : [p1.price, p0.price];
    const levels = o.levels().map((level) => ({ level, price: zero + (one - zero) * level.value }));
    horizontalLevels(g, env, o, levels, Math.min(a.x, b.x), Math.max(a.x, b.x));
  }, { fields: fibFields(retracementLevels, { reverse: true, trendLine: true }) }),
  three('fib-extension', (g, env, o) => {
    const [a, b, c] = env.points;
    if (!b) return;
    if (o.bool('showTrendLine')) g.poly(c ? [a, b, c] : [a, b], false, guide(env));
    if (!c) return;
    const [p0, p1, p2] = env.anchors;
    // Levels project the first leg from the third anchor; reversed, they project it the other way.
    const move = (p1.price - p0.price) * (o.bool('reverse') ? -1 : 1);
    const levels = o.levels().map((level) => ({ level, price: p2.price + move * level.value }));
    horizontalLevels(g, env, o, levels, c.x, c.x + Math.max(40, Math.abs(b.x - a.x)));
  }, { fields: fibFields(extensionLevels, { reverse: true, trendLine: true }) }),
  three('fib-channel', (g, env, o) => {
    const [a, b, c] = env.points;
    if (!b) return;
    if (!c) { g.line(a, b, stroke(env)); return; }
    const [p0, p1, p2] = env.anchors;
    const offset = c.y - (a.y + (b.y - a.y) * ((c.x - a.x) / ((b.x - a.x) || 1)));
    const span = p1.time - p0.time;
    const priceOffset = p2.price - (span ? p0.price + (p1.price - p0.price) * (p2.time - p0.time) / span : p0.price);
    const lines = o.levels().map((level) => {
      const start = { x: a.x, y: a.y + offset * level.value };
      const end = { x: b.x, y: b.y + offset * level.value };
      return { level, start, end, drawn: extend(start, end, env.bounds, !!env.style.extendLeft, !!env.style.extendRight) };
    });
    const opacity = backgroundOpacity(o);
    if (opacity > 0) {
      for (let index = 0; index + 1 < lines.length; index++) {
        const [s0, e0] = lines[index].drawn;
        const [s1, e1] = lines[index + 1].drawn;
        g.poly([s0, e0, e1, s1], true, area(env, lines[index + 1].level.color, opacity));
      }
    }
    for (const { level, start, end, drawn } of lines) {
      g.line(...drawn, levelStroke(env, level.color));
      const left = isLeft(o);
      const text = levelText(env, o, level.value, (left ? p0.price : p1.price) + priceOffset * level.value, level.text);
      if (text) label(g, left ? { x: start.x - 4, y: start.y } : { x: end.x + 4, y: end.y }, text, env, { align: left ? 'right' : 'left', color: level.color, size: 11 });
    }
  }, { fields: fibFields(channelLevels) }),
  two('fib-time-zone', (g, env, o) => {
    const [a, b] = env.points;
    if (!b) return;
    const step = b.x - a.x;
    const top = env.bounds.top;
    const bottom = env.bounds.top + env.bounds.height;
    const zones = o.levels()
      .map((level) => ({ level, x: a.x + step * level.value }))
      .filter((zone, index) => (Math.abs(step) >= 1 || index === 0) && zone.x >= -env.bounds.width && zone.x <= env.bounds.width * 2);
    const opacity = backgroundOpacity(o);
    if (opacity > 0) {
      for (let index = 0; index + 1 < zones.length; index++) g.rect({ x: zones[index].x, y: top }, { x: zones[index + 1].x, y: bottom }, area(env, zones[index + 1].level.color, opacity));
    }
    for (const { level, x } of zones) {
      g.line({ x, y: top }, { x, y: bottom }, levelStroke(env, level.color));
      if (o.bool('showLevels')) label(g, { x: isLeft(o) ? x - 3 : x + 3, y: bottom - 10 }, trim(level.value), env, { align: isLeft(o) ? 'right' : 'left', color: level.color, size: 10 });
    }
  }, { fields: fibFields(timeZoneLevels, { prices: false }) }),
  two('fib-speed-fan', (g, env, o) => {
    const [a, b] = env.points;
    if (!b) return;
    const [p0, p1] = env.anchors;
    const priceEnd = (value: number) => ({ x: b.x, y: a.y + (b.y - a.y) * value });
    const timeEnd = (value: number) => ({ x: a.x + (b.x - a.x) * value, y: b.y });
    const prices = o.levels('levels');
    const times = o.levels('timeLevels');
    const opacity = backgroundOpacity(o);
    if (opacity > 0) {
      for (let index = 0; index + 1 < prices.length; index++) g.poly([a, priceEnd(prices[index].value), priceEnd(prices[index + 1].value)], true, area(env, prices[index + 1].color, opacity));
      for (let index = 0; index + 1 < times.length; index++) g.poly([a, timeEnd(times[index].value), timeEnd(times[index + 1].value)], true, area(env, times[index + 1].color, opacity / 2));
    }
    if (o.bool('showGrid')) {
      for (const level of prices) g.line({ x: a.x, y: priceEnd(level.value).y }, priceEnd(level.value), { color: level.color, width: 1, opacity: 0.4 });
      for (const level of times) g.line({ x: timeEnd(level.value).x, y: a.y }, timeEnd(level.value), { color: level.color, width: 1, opacity: 0.4 });
    } else {
      g.rect(a, b, { color: env.theme.muted, width: 1, dash: [3, 3] });
    }
    const left = isLeft(o);
    for (const level of prices) {
      const end = priceEnd(level.value);
      g.line(...extend(a, end, env.bounds, false, true), levelStroke(env, level.color));
      const text = levelText(env, o, level.value, p0.price + (p1.price - p0.price) * level.value, level.text);
      if (text) label(g, { x: (left ? Math.min(a.x, b.x) : Math.max(a.x, b.x)) + (left ? -4 : 4), y: end.y }, text, env, { align: left ? 'right' : 'left', color: level.color, size: 10 });
    }
    for (const level of times) {
      const end = timeEnd(level.value);
      if (level.value > 0) g.line(...extend(a, end, env.bounds, false, true), levelStroke(env, level.color, { opacity: 0.7 }));
      if (o.bool('showLevels')) label(g, { x: end.x, y: b.y + (b.y >= a.y ? 10 : -10) }, trim(level.value), env, { align: 'center', color: level.color, size: 10 });
    }
  }, { fields: fibFields(speedLevels, { label: 'Price levels', extra: [levelsField('timeLevels', 'Time levels', speedLevels), checkbox('showGrid', 'Grid', true)] }) }),
  two('fib-circles', (g, env, o) => {
    const [a, b] = env.points;
    if (!b) return;
    g.line(a, b, guide(env));
    radialLevels(g, env, o, a, distance(a, b), 0, Math.PI * 2);
  }, { fields: fibFields(circleLevels, { prices: false }) }),
  two('fib-arcs', (g, env, o) => {
    const [a, b] = env.points;
    if (!b) return;
    g.line(a, b, guide(env));
    const isUp = a.y > b.y;
    radialLevels(g, env, o, b, distance(a, b), isUp ? 0 : Math.PI, isUp ? Math.PI : Math.PI * 2);
  }, { fields: fibFields(arcLevels, { prices: false }) }),
  three('fib-wedge', (g, env, o) => {
    const [a, b, c] = env.points;
    if (!b) return;
    g.line(a, b, stroke(env));
    if (!c) return;
    g.line(a, c, stroke(env));
    const [start, end] = sweep(Math.atan2(b.y - a.y, b.x - a.x), Math.atan2(c.y - a.y, c.x - a.x));
    radialLevels(g, env, o, a, distance(a, b), start, end);
  }, { fields: fibFields(wedgeLevels, { prices: false }) }),
  two('fib-spiral', (g, env, o) => {
    const [a, b] = env.points;
    if (!b) return;
    const radius = distance(a, b);
    g.line(a, b, guide(env));
    if (radius < 1) return;
    // A golden spiral: the radius grows by φ every quarter turn and passes through the second anchor.
    const growth = Math.log((1 + Math.sqrt(5)) / 2) / (Math.PI / 2);
    const direction = o.bool('counterclockwise') ? -1 : 1;
    const start = Math.atan2(b.y - a.y, b.x - a.x);
    const far = 2 * (env.bounds.width + env.bounds.height) + distance(a, { x: env.bounds.width / 2, y: env.bounds.height / 2 });
    const from = Math.log(0.5 / radius) / growth;
    const to = Math.log(far / radius) / growth;
    const steps = Math.min(1200, Math.ceil((to - from) / 0.05));
    const points: Pt[] = [];
    for (let index = 0; index <= steps; index++) {
      const turnAngle = from + (to - from) * index / steps;
      const r = radius * Math.exp(growth * turnAngle);
      const angle = start + direction * turnAngle;
      points.push({ x: a.x + r * Math.cos(angle), y: a.y + r * Math.sin(angle) });
    }
    g.poly(points, false, stroke(env));
  }, { fields: [checkbox('counterclockwise', 'Counterclockwise')] }),

  // Gann
  two('gann-box', (g, env, o) => {
    const [a, b] = env.points;
    if (!b) return;
    const yAt = (value: number) => a.y + (b.y - a.y) * value;
    const xAt = (value: number) => a.x + (b.x - a.x) * value;
    const prices = o.levels('priceLevels');
    const times = o.levels('timeLevels');
    const opacity = backgroundOpacity(o);
    g.rect(a, b, { color: env.theme.muted, width: 1, opacity: 0.5 });
    if (opacity > 0) {
      for (let index = 0; index + 1 < prices.length; index++) g.rect({ x: a.x, y: yAt(prices[index].value) }, { x: b.x, y: yAt(prices[index + 1].value) }, area(env, prices[index + 1].color, opacity));
      for (let index = 0; index + 1 < times.length; index++) g.rect({ x: xAt(times[index].value), y: a.y }, { x: xAt(times[index + 1].value), y: b.y }, area(env, times[index + 1].color, opacity / 2));
    }
    const left = Math.min(a.x, b.x);
    const below = Math.max(a.y, b.y);
    for (const level of prices) {
      g.line({ x: a.x, y: yAt(level.value) }, { x: b.x, y: yAt(level.value) }, levelStroke(env, level.color));
      if (o.bool('showLevels')) label(g, { x: left - 4, y: yAt(level.value) }, trim(level.value), env, { align: 'right', color: level.color, size: 10 });
    }
    for (const level of times) {
      g.line({ x: xAt(level.value), y: a.y }, { x: xAt(level.value), y: b.y }, levelStroke(env, level.color));
      if (o.bool('showLevels')) label(g, { x: xAt(level.value), y: below + 10 }, trim(level.value), env, { align: 'center', color: level.color, size: 10 });
    }
    if (o.bool('showAngles')) {
      const style = stroke(env, { width: 1, dash: [3, 3] });
      g.line(a, b, style);
      g.line({ x: a.x, y: b.y }, { x: b.x, y: a.y }, style);
      for (const level of prices) if (level.value > 0 && level.value < 1) g.line(a, { x: b.x, y: yAt(level.value) }, { color: level.color, width: 1, opacity: 0.7 });
      for (const level of times) if (level.value > 0 && level.value < 1) g.line(a, { x: xAt(level.value), y: b.y }, { color: level.color, width: 1, opacity: 0.7 });
    }
  }, {
    fields: [
      levelsField('priceLevels', 'Price levels', gannBoxLevels), levelsField('timeLevels', 'Time levels', gannBoxLevels),
      checkbox('showAngles', 'Angles'), checkbox('showLevels', 'Levels labels', true), ...backgroundFields(),
    ],
  }),
  two('gann-square', (g, env) => {
    const [a, b] = env.points;
    if (!b) return;
    g.rect(a, b, stroke(env, { width: 1 }));
    for (const value of [1 / 3, 2 / 3]) {
      g.line(lerp(a, { x: b.x, y: a.y }, value), lerp({ x: a.x, y: b.y }, b, value), stroke(env, { width: 1, opacity: 0.6 }));
      g.line(lerp(a, { x: a.x, y: b.y }, value), lerp({ x: b.x, y: a.y }, b, value), stroke(env, { width: 1, opacity: 0.6 }));
    }
    g.line(a, b, stroke(env, { width: 1 }));
    g.line({ x: a.x, y: b.y }, { x: b.x, y: a.y }, stroke(env, { width: 1 }));
    g.ellipse(a.x, a.y, Math.abs(b.x - a.x), Math.abs(b.y - a.y), stroke(env, { width: 1, opacity: 0.6 }), 0, 0, Math.PI * 2);
  }),
  two('gann-square-fixed', (g, env, o) => {
    const [a, b] = env.points;
    if (!b) return;
    // The square keeps equal sides on screen; the second anchor sets its size and quadrant.
    const side = Math.abs(b.x - a.x) || Math.abs(b.y - a.y);
    if (side < 1) return;
    const sx = Math.sign(b.x - a.x) || 1;
    const sy = Math.sign(b.y - a.y) || -1;
    const at = (u: number, v: number): Pt => ({ x: a.x + sx * side * u, y: a.y + sy * side * v });
    const grid = o.levels().filter((level) => level.value > 0 && level.value < 1);
    const opacity = backgroundOpacity(o);
    if (opacity > 0) {
      let previous = 0;
      for (const level of [...grid, { value: 1, color: env.style.lineColor, isVisible: true }]) {
        g.rect(at(0, previous), at(1, level.value), area(env, level.color, opacity));
        previous = level.value;
      }
    }
    g.rect(a, at(1, 1), stroke(env, { width: 1 }));
    for (const level of grid) {
      g.line(at(level.value, 0), at(level.value, 1), { color: level.color, width: 1, opacity: 0.7 });
      g.line(at(0, level.value), at(1, level.value), { color: level.color, width: 1, opacity: 0.7 });
    }
    if (o.bool('showArcs')) {
      const [start, end] = sweep(Math.atan2(0, sx), Math.atan2(sy, 0));
      for (const level of [...grid, { value: 1, color: env.style.lineColor, isVisible: true }]) g.ellipse(a.x, a.y, side * level.value, side * level.value, { color: level.color, width: 1, opacity: 0.8 }, 0, start, end);
    }
    for (const level of o.levels('fanLevels')) {
      const end = level.value <= 1 ? at(1, level.value) : at(1 / level.value, 1);
      g.line(a, end, levelStroke(env, level.color));
      label(g, { x: end.x + sx * 4, y: end.y + (level.value > 1 ? sy * 8 : 0) }, gannName(level.value), env, { align: sx > 0 ? 'left' : 'right', color: level.color, size: 10 });
    }
    g.line(at(0, 1), at(1, 0), { color: env.theme.muted, width: 1, dash: [3, 3] });
  }, { fields: [levelsField('levels', 'Levels', gannGridLevels), levelsField('fanLevels', 'Fans', gannFixedFanLevels), checkbox('showArcs', 'Arcs', true), ...backgroundFields(5)] }),
  two('gann-fan', (g, env, o) => {
    const [a, b] = env.points;
    if (!b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // Each ray meets the box spanned by the anchors; slopes above 1/1 meet its top or bottom edge.
    const endOf = (value: number): Pt => (value <= 1 ? { x: a.x + dx, y: a.y + dy * value } : { x: a.x + dx / value, y: a.y + dy });
    const levels = o.levels().filter((level) => level.value > 0);
    const opacity = backgroundOpacity(o);
    if (opacity > 0) for (let index = 0; index + 1 < levels.length; index++) g.poly([a, endOf(levels[index].value), ...(levels[index].value < 1 && levels[index + 1].value > 1 ? [b] : []), endOf(levels[index + 1].value)], true, area(env, levels[index + 1].color, opacity));
    for (const level of levels) {
      const end = endOf(level.value);
      g.line(...extend(a, end, env.bounds, false, true), levelStroke(env, level.color));
      if (o.bool('showLabels')) label(g, { x: end.x + 4, y: end.y }, gannName(level.value), env, { size: 10, color: level.color });
    }
  }, { fields: [levelsField('levels', 'Levels', gannFanLevels), checkbox('showLabels', 'Labels', true), ...backgroundFields()] }),

  // Patterns
  define('xabcd-pattern', 5, (g, env) => {
    waves(g, env, ['X', 'A', 'B', 'C', 'D'], { fill: true });
    const p = env.anchors.map((anchor) => anchor.price);
    ratioLegs(g, env, [
      [0, 2, p.length > 2 ? ratio(p[2] - p[1], p[1] - p[0]) : ''],
      [1, 3, p.length > 3 ? ratio(p[3] - p[2], p[2] - p[1]) : ''],
      [2, 4, p.length > 4 ? ratio(p[4] - p[3], p[3] - p[2]) : ''],
      [0, 4, p.length > 4 ? ratio(p[4] - p[1], p[1] - p[0]) : ''],
    ]);
  }, { isFillable: true }),
  define('cypher-pattern', 5, (g, env) => {
    waves(g, env, ['X', 'A', 'B', 'C', 'D'], { fill: true });
    const p = env.anchors.map((anchor) => anchor.price);
    // Cypher rules: B retraces XA, C extends AB, and D retraces the whole X→C move.
    ratioLegs(g, env, [
      [0, 2, p.length > 2 ? ratio(p[2] - p[1], p[1] - p[0]) : ''],
      [1, 3, p.length > 3 ? ratio(p[3] - p[2], p[2] - p[1]) : ''],
      [2, 4, p.length > 4 ? ratio(p[4] - p[3], p[3] - p[2]) : ''],
      [0, 4, p.length > 4 ? ratio(p[4] - p[3], p[3] - p[0]) : ''],
    ]);
  }, { isFillable: true }),
  define('abcd-pattern', 4, (g, env) => {
    waves(g, env, ['A', 'B', 'C', 'D']);
    const p = env.anchors.map((anchor) => anchor.price);
    ratioLegs(g, env, [
      [0, 2, p.length > 2 ? ratio(p[2] - p[1], p[1] - p[0]) : ''],
      [1, 3, p.length > 3 ? ratio(p[3] - p[2], p[2] - p[1]) : ''],
    ]);
  }),
  define('head-shoulders', 7, (g, env) => {
    const p = env.points;
    if (p.length >= 3) g.poly([p[0], p[1], p[2]], true, area(env));
    if (p.length >= 5) g.poly([p[2], p[3], p[4]], true, area(env));
    if (p.length >= 7) g.poly([p[4], p[5], p[6]], true, area(env));
    g.poly(p, false, stroke(env));
    if (p.length >= 5) {
      g.line(...extend(p[2], p[4], env.bounds, true, true), stroke(env, { dash: [5, 4], width: 1 }));
      const x = (p[6] ?? p[4]).x + 12;
      const y = p[4].x === p[2].x ? p[4].y : p[2].y + (p[4].y - p[2].y) * (x - p[2].x) / (p[4].x - p[2].x);
      label(g, { x, y: y - 3 }, 'Neckline', env, { baseline: 'bottom', size: 11 });
    }
    const names: [number, string][] = [[1, 'Left Shoulder'], [3, 'Head'], [5, 'Right Shoulder']];
    for (const [index, name] of names) if (p[index]) label(g, { x: p[index].x, y: p[index].y - 14 }, name, env, { align: 'center', background: env.style.lineColor, size: 11 });
  }, { isFillable: true }),
  define('triangle-pattern', 4, (g, env) => {
    const p = env.points;
    waves(g, env, ['A', 'B', 'C', 'D']);
    if (p.length >= 3) g.line(...extend(p[0], p[2], env.bounds, false, true), stroke(env, { width: 1, dash: [4, 4] }));
    if (p.length >= 4) g.line(...extend(p[1], p[3], env.bounds, false, true), stroke(env, { width: 1, dash: [4, 4] }));
  }, { isFillable: true }),
  define('three-drives', 7, (g, env) => {
    // Start, then drive 1, correction, drive 2, correction, drive 3 (points 2, 4 and 6 are the drives).
    waves(g, env, ['', '', '1', '', '2', '', '3']);
    const p = env.anchors.map((anchor) => anchor.price);
    const legs: [number, number, string][] = [];
    for (let index = 3; index < p.length; index++) legs.push([index - 2, index, ratio(p[index] - p[index - 1], p[index - 1] - p[index - 2])]);
    ratioLegs(g, env, legs);
  }),
  define('elliott-impulse', 6, (g, env) => waves(g, env, ['', '1', '2', '3', '4', '5'], { circled: true }), { defaults: { lineColor: '#2962ff' } }),
  define('elliott-correction', 4, (g, env) => waves(g, env, ['', 'A', 'B', 'C'], { circled: true }), { defaults: { lineColor: '#2962ff' } }),
  define('elliott-triangle', 6, (g, env) => waves(g, env, ['', 'A', 'B', 'C', 'D', 'E'], { circled: true }), { defaults: { lineColor: '#ff9800' } }),
  define('elliott-double-combo', 4, (g, env) => waves(g, env, ['', 'W', 'X', 'Y'], { circled: true }), { defaults: { lineColor: '#4caf50' } }),
  define('elliott-triple-combo', 6, (g, env) => waves(g, env, ['', 'W', 'X', 'Y', 'X', 'Z'], { circled: true }), { defaults: { lineColor: '#4caf50' } }),

  // Cycles
  two('cyclic-lines', (g, env) => {
    const [a, b] = env.points;
    if (!b) return;
    const step = b.x - a.x;
    const top = env.bounds.top;
    const bottom = env.bounds.top + env.bounds.height;
    g.line(a, b, stroke(env, { width: 1, dash: [3, 3], opacity: 0.6 }));
    if (Math.abs(step) < 2) { g.line({ x: a.x, y: top }, { x: a.x, y: bottom }, stroke(env, { width: 1 })); return; }
    // Lines repeat from the first anchor in the direction of the second, across the visible plot.
    for (let n = 0; n < 2000; n++) {
      const x = a.x + n * step;
      if (x < -Math.abs(step) || x > env.bounds.width + Math.abs(step)) break;
      g.line({ x, y: top }, { x, y: bottom }, stroke(env, { width: 1 }));
    }
  }),
  two('time-cycles', (g, env) => {
    const [a, b] = env.points;
    if (!b) return;
    const step = b.x - a.x;
    if (Math.abs(step) < 2) { g.ellipse(a.x, a.y, 2, 2, stroke(env, { width: 1 })); return; }
    // Half-ellipses of one cycle's width, as tall as the second anchor is high, repeating forward.
    const rx = Math.abs(step) / 2;
    const ry = Math.abs(b.y - a.y) || rx;
    const isUp = b.y <= a.y;
    let last = a.x;
    for (let n = 0; n < 2000; n++) {
      const cx = a.x + step * (n + 0.5);
      if (cx < -rx * 2 || cx > env.bounds.width + rx * 2) break;
      g.ellipse(cx, a.y, rx, ry, stroke(env, { width: 1 }), 0, isUp ? Math.PI : 0, isUp ? Math.PI * 2 : Math.PI);
      last = cx + step / 2;
    }
    g.line(a, { x: last, y: a.y }, stroke(env, { width: 1, dash: [3, 3], opacity: 0.5 }));
  }),
  two('sine-line', (g, env) => {
    const [a, b] = env.points;
    if (!b) return;
    const half = b.x - a.x;
    if (Math.abs(half) < 2) { g.line(a, b, stroke(env)); return; }
    // The first anchor is a crest (or trough) and the second the next trough (or crest).
    const amplitude = (b.y - a.y) / 2;
    const centre = (a.y + b.y) / 2;
    const step = clamp(Math.abs(half) / 16, 1, 4);
    const points: Pt[] = [];
    for (let x = 0; x <= env.bounds.width + step; x += step) points.push({ x, y: centre - amplitude * Math.cos(Math.PI * (x - a.x) / half) });
    g.poly(points, false, stroke(env));
  }),

  // Forecasting
  three('long-position', position(true), { create: positionCreate(true), handles: positionHandles, fields: positionFields }),
  three('short-position', position(false), { create: positionCreate(false), handles: positionHandles, fields: positionFields }),
  two('forecast', (g, env) => {
    const [a, b] = env.points;
    const [p0, p1] = env.anchors;
    // The forecast starts from the close of the bar under the first anchor.
    const sourceIndex = Math.round(env.indexOf(p0.time));
    const sourceBar = Number.isFinite(sourceIndex) ? env.bars[sourceIndex] : undefined;
    const sourcePrice = sourceBar ? sourceBar.close : p0.price;
    const source = { x: a.x, y: env.priceToY(sourcePrice) };
    g.ellipse(source.x, source.y, 3.5, 3.5, { color: env.style.lineColor, width: 1, dash: [], fill: env.style.lineColor });
    if (!b) return;
    g.line(source, b, stroke(env));
    g.arrowHead(source, b, 9 + env.style.lineWidth * 2, { color: env.style.lineColor });
    const change = p1.price - sourcePrice;
    const isUp = change >= 0;
    const lines = [`${signed(env, change)} (${percent(change, sourcePrice)})`, `${barsBetween(env, p0.time, p1.time)} bars, ${env.formatDuration(Math.abs(p1.time - p0.time))}`];
    let background = env.style.lineColor;
    const lastBar = env.bars[env.bars.length - 1];
    if (lastBar && lastBar.time >= p1.time) {
      const range = barRange(env, p0.time, p1.time);
      let isReached = false;
      if (range) for (let index = range[0]; index <= range[1] && !isReached; index++) isReached = isUp ? env.bars[index].high >= p1.price : env.bars[index].low <= p1.price;
      lines.push(isReached ? 'Success' : 'Failure');
      background = isReached ? env.theme.up : env.theme.down;
    }
    label(g, { x: b.x, y: b.y + (b.y < source.y ? -10 : 10) }, lines.join('\n'), env, { align: 'center', baseline: b.y < source.y ? 'bottom' : 'top', background, size: 11 });
  }, { defaults: { lineColor: '#2962ff' } }),
  three('bars-pattern', (g, env, o) => {
    const [a, b, c] = env.points;
    if (!b) return;
    const [p0, p1, p2] = env.anchors;
    const range = barRange(env, p0.time, p1.time);
    if (!range) { g.line(a, b, guide(env)); return; }
    const source = env.bars.slice(range[0], range[1] + 1);
    const high = Math.max(...source.map((bar) => bar.high));
    const low = Math.min(...source.map((bar) => bar.low));
    const x0 = env.timeToX(source[0].time);
    const x1 = env.timeToX(source[source.length - 1].time);
    g.poly([{ x: x0, y: env.priceToY(high) }, { x: x1, y: env.priceToY(high) }, { x: x1, y: env.priceToY(low) }, { x: x0, y: env.priceToY(low) }], true, guide(env));
    if (!c) return;
    // The copy starts at the third anchor: its first open sits on that anchor's price. Mirrored
    // runs the bars backwards in time; flipped turns them upside down around that price.
    const isMirrored = o.bool('mirrored');
    const isFlipped = o.bool('flipped');
    const ordered = isMirrored ? [...source].reverse() : source;
    const base = isMirrored ? ordered[0].close : ordered[0].open;
    const at = (price: number) => (isFlipped ? p2.price - (price - base) : p2.price + (price - base));
    const pixelStep = source.length > 1 ? (x1 - x0) / (source.length - 1) : 6;
    const xAt = (index: number) => {
      const x = env.intervalMs > 0 ? env.timeToX(p2.time + index * env.intervalMs) : NaN;
      return Number.isFinite(x) ? x : c.x + index * pixelStep;
    };
    const list = ordered.map((bar, index): Candle => {
      const open = at(isMirrored ? bar.close : bar.open);
      const close = at(isMirrored ? bar.open : bar.close);
      const ends = [at(bar.high), at(bar.low)];
      return { x: xAt(index), open, close, high: Math.max(...ends), low: Math.min(...ends) };
    });
    candles(g, env, list, list.length > 1 ? Math.abs(list[1].x - list[0].x) : Math.abs(pixelStep), o.str('mode'), 0.5);
  }, { fields: [selectField('mode', 'Mode', ['Candles', 'Bars', 'Line']), checkbox('mirrored', 'Mirrored'), checkbox('flipped', 'Flipped')] }),
  define('ghost-feed', 'multi', (g, env, o) => {
    const { points, anchors } = env;
    if (points.length < 2) {
      if (points[0]) g.ellipse(points[0].x, points[0].y, 3, 3, { color: env.style.lineColor, width: 1, dash: [] });
      return;
    }
    const randomness = o.num('randomness') / 100;
    const wicks = o.num('wickSize') / 100;
    const list: Candle[] = [];
    let open = anchors[0].price;
    let seed = 1;
    let spacing = Infinity;
    // Each leg between anchors becomes one candle per bar it spans, closing on the leg's line
    // (with some deterministic noise) and landing exactly on the next anchor.
    for (let leg = 1; leg < anchors.length; leg++) {
      const from = anchors[leg - 1];
      const to = anchors[leg];
      const span = Math.abs(env.indexOf(to.time) - env.indexOf(from.time));
      const steps = clamp(Number.isFinite(span) ? Math.round(span) : 1, 1, 500);
      const dx = points[leg].x - points[leg - 1].x;
      spacing = Math.min(spacing, Math.abs(dx) / steps);
      const move = Math.abs(to.price - from.price) / steps || Math.abs(from.price) * 0.001 || 1;
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        const target = from.price + (to.price - from.price) * t;
        const close = step === steps ? target : target + (noise(seed++) - 0.5) * 2 * randomness * move * 1.5;
        const high = Math.max(open, close) + move * wicks * noise(seed++);
        const low = Math.min(open, close) - move * wicks * noise(seed++);
        list.push({ x: points[leg - 1].x + dx * t, open, high, low, close });
        open = close;
      }
    }
    if (env.isDraft) g.poly(points, false, stroke(env, { width: 1, dash: [3, 3], opacity: 0.5 }));
    candles(g, env, list, Number.isFinite(spacing) && spacing > 0 ? spacing : 6, 'Candles', 0.6);
  }, { fields: [numberField('randomness', 'Randomness (%)', 40, 0, 100, 5), numberField('wickSize', 'Wick size (%)', 60, 0, 300, 5)] }),
  three('projection', (g, env) => {
    const [a, b, c] = env.points;
    if (!b) return;
    g.line(a, b, stroke(env));
    if (!c) return;
    g.poly([a, b, c], true, area(env));
    g.line(b, c, stroke(env));
    // The third anchor's swing is swung back onto the first leg around B: the arc shows how far
    // the move B→C reaches along A–B, and the label gives it as a percentage of that leg.
    const radius = distance(b, c);
    if (radius > 0 && distance(a, b) > 0) {
      const towardsA = Math.atan2(a.y - b.y, a.x - b.x);
      const [start, end] = sweep(Math.atan2(c.y - b.y, c.x - b.x), towardsA);
      g.ellipse(b.x, b.y, radius, radius, stroke(env, { width: 1, dash: [4, 4] }), 0, start, end);
      const projected = { x: b.x + radius * Math.cos(towardsA), y: b.y + radius * Math.sin(towardsA) };
      g.ellipse(projected.x, projected.y, 2.5, 2.5, { color: env.style.lineColor, width: 1, dash: [], fill: env.style.lineColor });
    }
    const [p0, p1, p2] = env.anchors;
    const move = p1.price - p0.price;
    const share = move ? Math.abs((p2.price - p1.price) / move) : 0;
    label(g, { x: c.x + 8, y: c.y }, `${(share * 100).toFixed(1)}%`, env, { background: env.style.lineColor, size: 11 });
  }, { isFillable: true }),

  // Volume-based
  one('anchored-vwap', (g, env, o) => {
    const start = Math.max(0, Math.ceil(env.indexOf(env.anchors[0].time)));
    const source = sourceOf(o.str('source'));
    const showBands = o.bool('bands');
    let volume = 0;
    let value = 0;
    let squares = 0;
    const line: Pt[] = [];
    const bands: Pt[][] = [[], [], [], []];
    for (let index = start; index < env.bars.length; index++) {
      const bar = env.bars[index];
      const weight = bar.volume || 1;
      const price = source(bar);
      volume += weight;
      value += price * weight;
      squares += price * price * weight;
      const vwap = value / volume;
      const x = env.timeToX(bar.time);
      line.push({ x, y: env.priceToY(vwap) });
      if (showBands) {
        const deviation = Math.sqrt(Math.max(0, squares / volume - vwap * vwap));
        [-2, -1, 1, 2].forEach((k, band) => bands[band].push({ x, y: env.priceToY(vwap + k * deviation) }));
      }
    }
    if (line.length < 2) { g.line(env.points[0], { x: env.points[0].x + 1, y: env.points[0].y }, stroke(env)); return; }
    if (showBands) {
      g.poly([...bands[3], ...[...bands[0]].reverse()], true, area(env, env.style.lineColor, 0.05));
      g.poly([...bands[2], ...[...bands[1]].reverse()], true, area(env, env.style.lineColor, 0.06));
      for (const band of bands) g.poly(band, false, stroke(env, { width: 1, opacity: 0.7 }));
    }
    g.poly(line, false, stroke(env));
  }, { defaults: { lineColor: '#2962ff' }, fields: [selectField('source', 'Source', ['hlc3', 'hl2', 'close', 'ohlc4']), checkbox('bands', 'Bands (±1σ, ±2σ)')] }),
  two('fixed-range-volume-profile', (g, env, o) => {
    const [a0, a1] = env.anchors;
    if (!a1) return;
    const range = barRange(env, a0.time, a1.time);
    if (!range) return;
    const [start, end] = range;
    let low = Infinity;
    let high = -Infinity;
    for (let index = start; index <= end; index++) { low = Math.min(low, env.bars[index].low); high = Math.max(high, env.bars[index].high); }
    const rows = Math.round(clamp(o.num('rows'), 1, 500));
    const size = (high - low) / rows || 1;
    const up = new Array<number>(rows).fill(0);
    const down = new Array<number>(rows).fill(0);
    // Each bar's volume is spread evenly over the rows its range covers.
    for (let index = start; index <= end; index++) {
      const bar = env.bars[index];
      const first = clamp(Math.floor((bar.low - low) / size), 0, rows - 1);
      const last = clamp(Math.floor((bar.high - low) / size), 0, rows - 1);
      const share = (bar.volume || 1) / (last - first + 1);
      for (let row = first; row <= last; row++) (bar.close >= bar.open ? up : down)[row] += share;
    }
    const totals = up.map((value, row) => value + down[row]);
    const total = totals.reduce((sum, value) => sum + value, 0);
    let poc = 0;
    for (let row = 1; row < rows; row++) if (totals[row] > totals[poc]) poc = row;
    // The value area grows from the point of control towards the heavier neighbour.
    let vaLow = poc;
    let vaHigh = poc;
    let inside = totals[poc];
    const goal = total * clamp(o.num('valueAreaPercent'), 1, 100) / 100;
    while (inside < goal && (vaLow > 0 || vaHigh < rows - 1)) {
      const below = vaLow > 0 ? totals[vaLow - 1] : -1;
      const above = vaHigh < rows - 1 ? totals[vaHigh + 1] : -1;
      if (above >= below) inside += totals[++vaHigh];
      else inside += totals[--vaLow];
    }
    const largest = Math.max(...totals) || 1;
    const x0 = env.timeToX(env.bars[start].time);
    const x1 = env.timeToX(env.bars[end].time);
    const isRight = o.str('placement') === 'Right';
    const width = Math.max(20, Math.abs(x1 - x0) * clamp(o.num('widthPercent'), 1, 100) / 100);
    const base = isRight ? Math.max(x0, x1) : Math.min(x0, x1);
    const sign = isRight ? -1 : 1;
    for (let row = 0; row < rows; row++) {
      const y0 = env.priceToY(low + row * size);
      const y1 = env.priceToY(low + (row + 1) * size);
      const opacity = row >= vaLow && row <= vaHigh ? 0.6 : 0.25;
      const upWidth = up[row] / largest * width;
      const downWidth = down[row] / largest * width;
      g.rect({ x: base, y: y0 - 0.5 }, { x: base + sign * upWidth, y: y1 + 0.5 }, { width: 0, fill: env.theme.up, fillOpacity: opacity });
      g.rect({ x: base + sign * upWidth, y: y0 - 0.5 }, { x: base + sign * (upWidth + downWidth), y: y1 + 0.5 }, { width: 0, fill: env.theme.down, fillOpacity: opacity });
    }
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const levelLine = (price: number, name: string, color: string, dash: readonly number[]) => {
      const y = env.priceToY(price);
      g.line({ x: left, y }, { x: right, y }, { color, width: 1, dash });
      label(g, { x: right + 4, y }, `${name} ${env.formatPrice(price)}`, env, { color, size: 10 });
    };
    levelLine(low + (poc + 0.5) * size, 'POC', '#f23645', []);
    levelLine(low + (vaHigh + 1) * size, 'VAH', '#2962ff', [4, 3]);
    levelLine(low + vaLow * size, 'VAL', '#2962ff', [4, 3]);
    g.rect({ x: left, y: env.priceToY(high) }, { x: right, y: env.priceToY(low) }, { color: env.theme.muted, width: 1, dash: [2, 3] });
  }, {
    fields: [
      numberField('rows', 'Row size (rows)', 24, 1, 500, 1), numberField('valueAreaPercent', 'Value area volume (%)', 70, 1, 100, 1),
      selectField('placement', 'Placement', ['Left', 'Right']), numberField('widthPercent', 'Width (% of range)', 35, 1, 100, 1),
    ],
  }),

  // Measurer
  two('price-range', (g, env) => {
    const [a, b] = env.points;
    if (!b) return;
    g.rect(a, b, area(env, env.style.lineColor, 0.12));
    const x = (a.x + b.x) / 2;
    g.line({ x, y: a.y }, { x, y: b.y }, stroke(env, { width: 1 }));
    g.arrowHead({ x, y: a.y }, { x, y: b.y }, 7, { color: env.style.lineColor });
    const [p0, p1] = env.anchors;
    const change = p1.price - p0.price;
    const isUp = b.y < a.y;
    label(g, { x, y: b.y + (isUp ? -8 : 8) }, `${signed(env, change)} (${percent(change, p0.price)})\n${env.formatPrice(p0.price)} → ${env.formatPrice(p1.price)}`, env, { align: 'center', baseline: isUp ? 'bottom' : 'top', background: env.style.lineColor, size: 11 });
  }, { defaults: { lineColor: '#2962ff' } }),
  two('date-range', (g, env) => {
    const [a, b] = env.points;
    if (!b) return;
    g.rect(a, b, area(env, env.style.lineColor, 0.12));
    const y = (a.y + b.y) / 2;
    g.line({ x: a.x, y }, { x: b.x, y }, stroke(env, { width: 1 }));
    g.arrowHead({ x: a.x, y }, { x: b.x, y }, 7, { color: env.style.lineColor });
    const [p0, p1] = env.anchors;
    const text = `${barsBetween(env, p0.time, p1.time)} bars, ${env.formatDuration(Math.abs(p1.time - p0.time))}\nVol ${compact(volumeBetween(env, p0.time, p1.time))}`;
    label(g, { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + 8 }, text, env, { align: 'center', baseline: 'top', background: env.style.lineColor, size: 11 });
  }, { defaults: { lineColor: '#2962ff' } }),
  two('date-price-range', (g, env) => {
    const [a, b] = env.points;
    if (!b) return;
    const [p0, p1] = env.anchors;
    const isUp = p1.price >= p0.price;
    const color = isUp ? '#2962ff' : '#f23645';
    g.rect(a, b, area(env, color, 0.15));
    g.line({ x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, { color, width: 1 });
    g.line({ x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, { color, width: 1 });
    const change = p1.price - p0.price;
    const lines = [
      `${signed(env, change)} (${percent(change, p0.price)})`,
      `${barsBetween(env, p0.time, p1.time)} bars, ${env.formatDuration(Math.abs(p1.time - p0.time))}`,
      `Vol ${compact(volumeBetween(env, p0.time, p1.time))}`,
    ];
    const above = b.y < a.y;
    label(g, { x: (a.x + b.x) / 2, y: b.y + (above ? -8 : 8) }, lines.join('\n'), env, { align: 'center', baseline: above ? 'bottom' : 'top', background: color, size: 11 });
  }),

  // Brushes
  define('brush', 'free', (g, env) => g.poly(env.points, false, stroke(env)), { defaults: { lineWidth: 2 } }),
  define('highlighter', 'free', (g, env) => g.poly(env.points, false, stroke(env, { opacity: 0.35 })), { defaults: { lineColor: '#ffeb3b', lineWidth: 12 } }),

  // Arrows
  two('arrow-marker', (g, env) => {
    const [a, b] = env.points;
    if (!b) return;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const length = distance(a, b);
    const head = Math.min(26, length * 0.45);
    const shaft = 5;
    const along = (d: number, side: number): Pt => ({ x: a.x + Math.cos(angle) * d - Math.sin(angle) * side, y: a.y + Math.sin(angle) * d + Math.cos(angle) * side });
    g.poly([along(0, -shaft), along(length - head, -shaft), along(length - head, -head * 0.55), b, along(length - head, head * 0.55), along(length - head, shaft), along(0, shaft)], true, { color: env.style.lineColor, width: 1, fill: env.style.lineColor, fillOpacity: 0.85 });
  }, { defaults: { lineColor: '#2962ff' } }),
  two('arrow', (g, env) => {
    const [a, b] = env.points;
    if (!b) return;
    g.line(a, b, stroke(env));
    g.arrowHead(a, b, 10 + env.style.lineWidth * 2, { color: env.style.lineColor });
  }),
  one('arrow-mark-up', (g, env) => {
    const [a] = env.points;
    const color = env.style.lineColor;
    g.poly([{ x: a.x, y: a.y + 2 }, { x: a.x + 9, y: a.y + 12 }, { x: a.x + 4, y: a.y + 12 }, { x: a.x + 4, y: a.y + 24 }, { x: a.x - 4, y: a.y + 24 }, { x: a.x - 4, y: a.y + 12 }, { x: a.x - 9, y: a.y + 12 }], true, { color, width: 1, fill: color });
    if (env.drawing.text) label(g, { x: a.x, y: a.y + 30 }, env.drawing.text, env, { align: 'center', baseline: 'top' });
  }, { defaults: { lineColor: '#089981' }, hasText: true, defaultText: '' }),
  one('arrow-mark-down', (g, env) => {
    const [a] = env.points;
    const color = env.style.lineColor;
    g.poly([{ x: a.x, y: a.y - 2 }, { x: a.x + 9, y: a.y - 12 }, { x: a.x + 4, y: a.y - 12 }, { x: a.x + 4, y: a.y - 24 }, { x: a.x - 4, y: a.y - 24 }, { x: a.x - 4, y: a.y - 12 }, { x: a.x - 9, y: a.y - 12 }], true, { color, width: 1, fill: color });
    if (env.drawing.text) label(g, { x: a.x, y: a.y - 30 }, env.drawing.text, env, { align: 'center', baseline: 'bottom' });
  }, { defaults: { lineColor: '#f23645' }, hasText: true, defaultText: '' }),

  // Shapes
  two('rectangle', (g, env, o) => {
    const [a, b] = env.points;
    if (!b) return;
    const right = env.style.extendRight ? { x: env.bounds.width, y: b.y } : b;
    // Fill and border apart, so a transparent border leaves the fill as it is.
    g.rect(a, right, { width: 0, fill: env.style.fillColor ?? env.style.lineColor, fillOpacity: env.style.fillOpacity ?? 0.15 });
    g.rect(a, right, stroke(env));
    if (o.bool('showMiddleLine')) g.line({ x: a.x, y: (a.y + b.y) / 2 }, { x: right.x, y: (a.y + b.y) / 2 }, stroke(env, { width: 1, dash: [4, 4], opacity: 1 }));
    textInBox(g, env, o, a, right);
  }, { ...lineText, isFillable: true, fields: [checkbox('showMiddleLine', 'Middle line'), ...boxTextFields] }),
  three('rotated-rectangle', (g, env) => {
    const [a, b, c] = env.points;
    if (!b) return;
    if (!c) { g.line(a, b, stroke(env)); return; }
    const length = distance(a, b) || 1;
    const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
    const offset = (c.x - a.x) * normal.x + (c.y - a.y) * normal.y;
    g.poly([a, b, add(b, scale(normal, offset)), add(a, scale(normal, offset))], true, { ...stroke(env), fill: env.style.fillColor ?? env.style.lineColor, fillOpacity: env.style.fillOpacity ?? 0.15 });
  }, { isFillable: true }),
  define('path', 'multi', (g, env) => {
    g.poly(env.points, false, stroke(env));
    const p = env.points;
    if (p.length >= 2) g.arrowHead(p[p.length - 2], p[p.length - 1], 10 + env.style.lineWidth * 2, { color: env.style.lineColor });
  }),
  two('circle', (g, env) => {
    const [a, b] = env.points;
    if (!b) return;
    const radius = distance(a, b);
    g.ellipse(a.x, a.y, radius, radius, { ...stroke(env), fill: env.style.fillColor ?? env.style.lineColor, fillOpacity: env.style.fillOpacity ?? 0.15 });
  }, { isFillable: true }),
  two('ellipse', (g, env) => {
    const [a, b] = env.points;
    if (!b) return;
    g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, { ...stroke(env), fill: env.style.fillColor ?? env.style.lineColor, fillOpacity: env.style.fillOpacity ?? 0.15 });
  }, { isFillable: true }),
  define('polyline', 'multi', (g, env) => g.poly(env.points, false, stroke(env)), { isFillable: true }),
  three('triangle', (g, env) => {
    if (env.points.length < 3) { g.poly(env.points, false, stroke(env)); return; }
    g.poly(env.points, true, { ...stroke(env), fill: env.style.fillColor ?? env.style.lineColor, fillOpacity: env.style.fillOpacity ?? 0.15 });
  }, { isFillable: true }),
  three('arc', (g, env) => {
    const [a, b, c] = env.points;
    if (!b) return;
    if (!c) { g.line(a, b, stroke(env, { dash: [3, 3] })); return; }
    // The arc passes through the third point: its control point is placed accordingly.
    const control = { x: 2 * c.x - (a.x + b.x) / 2, y: 2 * c.y - (a.y + b.y) / 2 };
    g.poly(quadratic(a, control, b), true, { ...stroke(env), fill: env.style.fillColor ?? env.style.lineColor, fillOpacity: env.style.fillOpacity ?? 0.15 });
  }, { isFillable: true }),
  three('curve', (g, env) => {
    const [a, b, c] = env.points;
    if (!b) return;
    if (!c) { g.line(a, b, stroke(env)); return; }
    const control = { x: 2 * c.x - (a.x + b.x) / 2, y: 2 * c.y - (a.y + b.y) / 2 };
    g.poly(quadratic(a, control, b), false, stroke(env));
  }),
  define('double-curve', 4, (g, env) => {
    const [a, b, c, d] = env.points;
    if (!b) return;
    if (!c) { g.line(a, b, stroke(env)); return; }
    g.poly(cubic(a, c, d ?? c, b), false, stroke(env));
  }),

  // Text and notes. Multi-line text is stacked line by line; only bold is offered as the shapes
  // have no italic face.
  one('text', (g, env, o) => label(g, env.points[0], textOf(env, 'Text'), env, {
    color: env.style.textColor ?? env.style.lineColor,
    size: fontSize(env),
    bold: o.bool('bold'),
    italic: o.bool('italic'),
    baseline: 'middle',
    background: o.bool('showBackground') ? o.str('backgroundColor') : undefined,
    border: o.bool('showBorder') ? o.str('borderColor') : undefined,
  }), {
    hasText: true,
    defaultText: 'Text',
    defaults: { lineColor: '#2962ff' },
    fields: [...fontFields, checkbox('showBackground', 'Background'), colorField('backgroundColor', 'Background colour', '#2962ff'), checkbox('showBorder', 'Border'), colorField('borderColor', 'Border colour', '#2962ff')],
  }),
  one('anchored-text', (g, env, o) => label(g, env.points[0], textOf(env, 'Text'), env, { size: fontSize(env), bold: o.bool('bold'), background: env.theme.background, color: env.style.textColor ?? env.theme.text }), { hasText: true, defaultText: 'Text', fields: textFields }),
  one('note', (g, env, o) => {
    const [a] = env.points;
    g.ellipse(a.x, a.y, 4, 4, { color: env.style.lineColor, width: 1, fill: env.style.lineColor });
    g.line(a, { x: a.x, y: a.y - 18 }, { color: env.style.lineColor, width: 1 });
    label(g, { x: a.x, y: a.y - 20 }, textOf(env, 'Note'), env, { align: 'center', baseline: 'bottom', background: env.style.lineColor, size: fontSize(env), bold: o.bool('bold') });
  }, { hasText: true, defaultText: 'Note', defaults: { lineColor: '#2962ff' }, fields: textFields }),
  two('price-note', (g, env, o) => {
    const [a, b] = env.points;
    g.ellipse(a.x, a.y, 3, 3, { color: env.style.lineColor, width: 1, fill: env.style.lineColor });
    if (!b) return;
    g.line(a, b, { color: env.style.lineColor, width: 1 });
    const text = textOf(env, '');
    const price = env.formatPrice(env.anchors[0].price);
    const content = !text ? price : text.includes('\n') ? `${text}\n${price}` : `${text} ${price}`;
    label(g, b, content, env, { align: b.x >= a.x ? 'left' : 'right', background: env.style.lineColor, size: fontSize(env), bold: o.bool('bold') });
  }, { hasText: true, defaultText: '', defaults: { lineColor: '#2962ff' }, fields: textFields }),
  one('pin', (g, env, o) => {
    const [a] = env.points;
    const color = env.style.lineColor;
    g.poly([a, { x: a.x - 7, y: a.y - 12 }, { x: a.x - 7, y: a.y - 20 }, { x: a.x, y: a.y - 26 }, { x: a.x + 7, y: a.y - 20 }, { x: a.x + 7, y: a.y - 12 }], true, { color, width: 1, fill: color });
    if (env.drawing.text) label(g, { x: a.x + 12, y: a.y - 18 }, env.drawing.text, env, { background: env.theme.background, color: env.theme.text, size: fontSize(env), bold: o.bool('bold') });
  }, { hasText: true, defaultText: '', defaults: { lineColor: '#f23645' }, fields: textFields }),
  two('callout', (g, env, o) => {
    const [a, b] = env.points;
    if (!b) { g.ellipse(a.x, a.y, 3, 3, { fill: env.style.lineColor, width: 0 }); return; }
    g.line(a, b, { color: env.style.lineColor, width: 1 });
    label(g, b, textOf(env, 'Callout'), env, { align: 'center', background: env.style.lineColor, size: fontSize(env), bold: o.bool('bold') });
  }, { hasText: true, defaultText: 'Callout', defaults: { lineColor: '#2962ff' }, fields: textFields }),
  one('comment', (g, env, o) => {
    const [a] = env.points;
    g.poly([a, { x: a.x + 6, y: a.y - 10 }, { x: a.x + 14, y: a.y - 10 }], true, { color: env.style.lineColor, width: 1, fill: env.style.lineColor });
    label(g, { x: a.x, y: a.y - 10 }, textOf(env, 'Comment'), env, { baseline: 'bottom', background: env.style.lineColor, size: fontSize(env), bold: o.bool('bold') });
  }, { hasText: true, defaultText: 'Comment', defaults: { lineColor: '#2962ff' }, fields: textFields }),
  one('price-label', (g, env) => {
    const [a] = env.points;
    g.poly([a, { x: a.x + 8, y: a.y - 9 }, { x: a.x + 8, y: a.y + 9 }], true, { color: env.style.lineColor, width: 1, fill: env.style.lineColor });
    label(g, { x: a.x + 8, y: a.y }, env.formatPrice(env.anchors[0].price), env, { background: env.style.lineColor, size: fontSize(env) });
  }, { defaults: { lineColor: '#2962ff' } }),
  one('signpost', (g, env, o) => {
    const [a] = env.points;
    g.line(a, { x: a.x, y: a.y - 40 }, { color: env.style.lineColor, width: 1 });
    g.ellipse(a.x, a.y, 3, 3, { color: env.style.lineColor, width: 1, fill: env.style.lineColor });
    label(g, { x: a.x, y: a.y - 40 }, textOf(env, 'Signpost'), env, { align: 'center', baseline: 'bottom', background: env.style.lineColor, size: fontSize(env), bold: o.bool('bold') });
  }, { hasText: true, defaultText: 'Signpost', defaults: { lineColor: '#2962ff' }, fields: textFields }),
  one('flag-mark', (g, env) => {
    const [a] = env.points;
    const color = env.style.lineColor;
    g.line(a, { x: a.x, y: a.y - 26 }, { color, width: 1.5 });
    g.poly([{ x: a.x, y: a.y - 26 }, { x: a.x + 16, y: a.y - 21 }, { x: a.x, y: a.y - 15 }], true, { color, width: 1, fill: color });
  }, { defaults: { lineColor: '#2962ff' } }),
];

export const toolDefinitions: ReadonlyMap<string, ToolDefinition> = new Map(definitions.map((definition) => [definition.type, definition]));

export const defaultStyle: DrawingStyle = { lineColor: '#2962ff', lineWidth: 2, lineStyle: 'solid', fillOpacity: 0.15 };

export function styleFor(type: string): DrawingStyle {
  const defaults = toolDefinitions.get(type)?.defaults ?? {};
  const thin = /^(fib-|gann-|pitchfan)/.test(type) ? { lineWidth: 1 } : {};
  return { ...defaultStyle, ...thin, ...defaults };
}
