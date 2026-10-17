import type { LineStyle, StudyBand, StudyBox, StudyExtend, StudyGradient, StudyHorizontalAlign, StudyLabel, StudyLabelStyle, StudyLevel, StudyLine, StudyMarker, StudyMarkerLocation, StudyObjects, StudyOutput, StudyPlot, StudyPolyline, StudyShape, StudySize, StudyTable, StudyTableCell, StudyVerticalAlign } from '@meridian/charts';

// PineTS results (`context.plots`) as Meridian study output. Shapes as observed from PineTS
// 0.11.1: every plot has one data entry per bar keyed by bar time, styles name the Pine call, and
// drawing objects arrive as the final object lists under `__lines__`, `__boxes__` and so on.

export interface PineDatum {
  time: number;
  value: unknown;
  options?: Record<string, unknown>;
}

export interface PinePlot {
  title?: string;
  plot1?: string;
  plot2?: string;
  options?: Record<string, unknown>;
  data?: readonly PineDatum[];
}

export interface PineConversion {
  output: StudyOutput;
  // Pine calls the chart cannot draw yet, by style, for one notice per script.
  unsupported: string[];
}

type Fields = Record<string, unknown>;

const pineBlue = '#2962ff';
const pineGray = '#787b86';

const isRecord = (value: unknown): value is Fields => value !== null && typeof value === 'object' && !Array.isArray(value);

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const text = (value: unknown): string => (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value));

// Pine's na colour hides what it paints; an empty colour means the call's default.
function color(value: unknown, fallback: string): string {
  if (value === null) return 'transparent';
  return typeof value === 'string' && value ? value : fallback;
}

const lineStyles: Record<string, LineStyle> = { dashed: 'dashed', dotted: 'dotted', solid: 'solid' };

const lineStyleOf = (value: unknown, fallback: LineStyle = 'solid'): LineStyle => lineStyles[text(value).replace(/^style_/, '')] ?? fallback;

const extendOf = (value: unknown): StudyExtend => ({ b: 'both', both: 'both', r: 'right', right: 'right', l: 'left', left: 'left' } as Record<string, StudyExtend>)[text(value)] ?? 'none';

function sizeOf(value: unknown): StudySize {
  if (typeof value === 'number') return value <= 8 ? 'tiny' : value <= 10 ? 'small' : value <= 13 ? 'normal' : value <= 17 ? 'large' : 'huge';
  const size = text(value).replace(/^size_/, '');
  return size === 'tiny' || size === 'small' || size === 'large' || size === 'huge' ? size : 'normal';
}

const halignOf = (value: unknown): StudyHorizontalAlign => (/left/.test(text(value)) ? 'left' : /right/.test(text(value)) ? 'right' : 'center');

const valignOf = (value: unknown): StudyVerticalAlign => (/top/.test(text(value)) ? 'top' : /bottom/.test(text(value)) ? 'bottom' : 'center');

const shapes: Record<string, StudyShape | 'labelUp' | 'labelDown'> = {
  triangleup: 'triangleUp', triangledown: 'triangleDown', arrowup: 'arrowUp', arrowdown: 'arrowDown', circle: 'circle', cross: 'cross',
  xcross: 'xcross', diamond: 'diamond', square: 'square', flag: 'flag', labelup: 'labelUp', labeldown: 'labelDown',
};

const shapeOf = (value: unknown) => shapes[text(value).replace(/^(shape|style)_/, '').replace(/_/g, '')];

const markerLocations: Record<string, StudyMarkerLocation> = { abovebar: 'aboveBar', belowbar: 'belowBar', top: 'top', bottom: 'bottom', absolute: 'absolute' };

const labelStyles: Record<string, StudyLabelStyle> = {
  none: 'none', textoutline: 'none', labelup: 'labelUp', labeldown: 'labelDown', labelleft: 'labelLeft', labelright: 'labelRight',
  labelcenter: 'labelCenter', labelupperleft: 'labelUpperLeft', labelupperright: 'labelUpperRight', labellowerleft: 'labelLowerLeft', labellowerright: 'labelLowerRight',
};

const labelStyleOf = (value: unknown): StudyLabelStyle => labelStyles[text(value).replace(/^style_/, '').replace(/_/g, '')] ?? (shapeOf(value) as StudyShape | undefined) ?? 'labelDown';

// Pine joins display flags into one string ('panedata_window'); a plot is drawn only with 'pane' in it.
const isOffPane = (display: unknown) => typeof display === 'string' && display !== '' && display !== 'all' && !display.includes('pane');

const plotKinds: Record<string, StudyPlot['kind']> = {
  style_histogram: 'histogram', style_columns: 'columns', style_circles: 'circles', style_cross: 'cross', style_area: 'area', style_areabr: 'area',
  style_stepline: 'stepline', style_steplinebr: 'stepline', style_stepline_diamond: 'stepline',
};

// Bar indexes of the chart's bars, with times between or beyond them placed proportionally, as
// Pine objects with xloc.bar_time may point into the future.
export class BarClock {
  private readonly indexes: Map<number, number>;

  constructor(private readonly times: readonly number[], private readonly intervalMs: number) {
    this.indexes = new Map(times.map((time, index) => [time, index]));
  }

  get length(): number {
    return this.times.length;
  }

  exact(time: number): number | undefined {
    return this.indexes.get(time);
  }

  index(time: number): number {
    const exact = this.indexes.get(time);
    if (exact !== undefined) return exact;
    const { times, intervalMs } = this;
    if (!times.length) return 0;
    if (time > times[times.length - 1]) return times.length - 1 + (time - times[times.length - 1]) / intervalMs;
    if (time < times[0]) return (time - times[0]) / intervalMs;
    let low = 0;
    let high = times.length - 1;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (times[middle] <= time) low = middle;
      else high = middle;
    }
    return low + (time - times[low]) / Math.max(1, times[high] - times[low]);
  }

  // An object's x: a bar index, or a bar time when the object was placed with xloc.bar_time.
  x(value: unknown, xloc: unknown): number | null {
    const number = finite(value);
    if (number === null) return null;
    return xloc === 'bt' ? this.index(number) : number;
  }
}

function perBar<T>(clock: BarClock, plot: PinePlot, read: (datum: PineDatum) => T | null): (T | null)[] {
  const values = new Array<T | null>(clock.length).fill(null);
  for (const datum of plot.data ?? []) {
    const index = clock.exact(datum.time);
    if (index !== undefined) values[index] = read(datum);
  }
  return values;
}

// Per-bar colours, or none when every bar has the plot's own colour.
function perBarColors(clock: BarClock, plot: PinePlot, base: string): (string | null)[] | undefined {
  let isUniform = true;
  const colors = perBar(clock, plot, (datum) => {
    const value = datum.options && 'color' in datum.options ? color(datum.options.color, base) : base;
    if (value !== base) isUniform = false;
    return value;
  });
  return isUniform ? undefined : colors;
}

// fill(plot1, plot2, top_value, bottom_value, top_color, bottom_color) on one bar.
function gradientOf(datum: PineDatum): StudyGradient | null {
  const options = datum.options ?? {};
  const topPrice = finite(options.top_value);
  const bottomPrice = finite(options.bottom_value);
  if (topPrice === null || bottomPrice === null) return null;
  return { topPrice, bottomPrice, topColor: color(options.top_color, 'transparent'), bottomColor: color(options.bottom_color, 'transparent') };
}

const latestObjects = (plot: PinePlot | undefined): Fields[] => {
  const value = plot?.data?.[plot.data.length - 1]?.value;
  return Array.isArray(value) ? value.filter((item): item is Fields => isRecord(item) && item._deleted !== true) : [];
};

function toLine(clock: BarClock, line: Fields): StudyLine | null {
  const startIndex = clock.x(line.x1, line.xloc);
  const endIndex = clock.x(line.x2, line.xloc);
  const startPrice = finite(line.y1);
  const endPrice = finite(line.y2);
  if (startIndex === null || endIndex === null || startPrice === null || endPrice === null) return null;
  const style = text(line.style);
  return {
    width: finite(line.width) ?? 1, endIndex, endPrice, startIndex, startPrice,
    color: color(line.color, pineBlue),
    extend: extendOf(line.extend),
    lineStyle: lineStyleOf(style),
    hasEndArrow: style === 'style_arrow_right' || style === 'style_arrow_both',
    hasStartArrow: style === 'style_arrow_left' || style === 'style_arrow_both',
  };
}

function toBox(clock: BarClock, box: Fields): StudyBox | null {
  const leftIndex = clock.x(box.left, box.xloc);
  const rightIndex = clock.x(box.right, box.xloc);
  const topPrice = finite(box.top);
  const bottomPrice = finite(box.bottom);
  if (leftIndex === null || rightIndex === null || topPrice === null || bottomPrice === null) return null;
  return {
    topPrice, leftIndex, rightIndex, borderWidth: finite(box.border_width) ?? 1, bottomPrice,
    text: text(box.text), fillColor: color(box.bgcolor, pineBlue), textColor: color(box.text_color, '#000000'), borderColor: color(box.border_color, pineBlue),
    extend: extendOf(box.extend), textSize: sizeOf(box.text_size), textHalign: halignOf(box.text_halign), textValign: valignOf(box.text_valign), borderStyle: lineStyleOf(box.border_style),
  };
}

function toLabel(clock: BarClock, label: Fields): StudyLabel | null {
  const index = clock.x(label.x, label.xloc);
  if (index === null) return null;
  const yloc = text(label.yloc);
  const price = finite(label.y);
  if (price === null && yloc === 'pr') return null;
  return {
    index, price: price ?? 0,
    text: text(label.text), color: color(label.color, pineBlue), tooltip: text(label.tooltip), textColor: color(label.textcolor, '#000000'),
    size: sizeOf(label.size), style: labelStyleOf(label.style), location: yloc === 'ab' ? 'aboveBar' : yloc === 'bl' ? 'belowBar' : 'price', textAlign: halignOf(label.textalign),
  };
}

function toPolyline(clock: BarClock, polyline: Fields): StudyPolyline | null {
  const points = (Array.isArray(polyline.points) ? polyline.points : []).filter(isRecord).flatMap((point) => {
    const price = finite(point.price);
    const index = polyline.xloc === 'bt' && finite(point.time) !== null ? clock.index(finite(point.time)!) : finite(point.index) ?? (finite(point.time) !== null ? clock.index(finite(point.time)!) : null);
    return price === null || index === null ? [] : [{ index, price }];
  });
  if (points.length < 2) return null;
  return {
    lineWidth: finite(polyline.line_width) ?? 1, fillColor: color(polyline.fill_color, 'transparent'), lineColor: color(polyline.line_color, pineBlue),
    lineStyle: lineStyleOf(polyline.line_style), isCurved: polyline.curved === true, isClosed: polyline.closed === true, points,
  };
}

// A linefill as a closed polygon between its two lines, without their extensions.
function toLinefill(clock: BarClock, linefill: Fields): StudyPolyline | null {
  const isLive = (line: unknown): line is Fields => isRecord(line) && line._deleted !== true;
  const first = isLive(linefill.line1) ? toLine(clock, linefill.line1) : null;
  const second = isLive(linefill.line2) ? toLine(clock, linefill.line2) : null;
  if (!first || !second) return null;
  return {
    lineWidth: 0, fillColor: color(linefill.color, 'transparent'), lineColor: 'transparent', lineStyle: 'solid', isCurved: false, isClosed: true,
    points: [{ index: first.startIndex, price: first.startPrice }, { index: first.endIndex, price: first.endPrice }, { index: second.endIndex, price: second.endPrice }, { index: second.startIndex, price: second.startPrice }],
  };
}

function toCell(cell: unknown): StudyTableCell | null {
  if (!isRecord(cell) || cell._merged === true) return null;
  return {
    width: finite(cell.width) ?? 0, height: finite(cell.height) ?? 0,
    text: text(cell.text), fillColor: color(cell.bgcolor, 'transparent'), textColor: color(cell.text_color, '#000000'),
    textSize: sizeOf(cell.text_size), textHalign: halignOf(cell.text_halign), textValign: valignOf(cell.text_valign),
  };
}

function toTable(table: Fields): StudyTable {
  const [vertical = 'top', horizontal = 'right'] = text(table.position).split('_');
  const rows = (Array.isArray(table.cells) ? table.cells : []).map((row) => (Array.isArray(row) ? row.map(toCell) : []));
  return {
    frameWidth: finite(table.frame_width) ?? 0, borderWidth: finite(table.border_width) ?? 0,
    fillColor: color(table.bgcolor, 'transparent'), frameColor: color(table.frame_color, 'transparent'), borderColor: color(table.border_color, 'transparent'),
    position: `${vertical === 'middle' || vertical === 'bottom' ? vertical : 'top'}-${horizontal === 'left' || horizontal === 'center' ? horizontal : 'right'}`,
    rows,
  };
}

function toObjects(clock: BarClock, plots: Record<string, PinePlot>): StudyObjects {
  const keep = <T>(items: (T | null)[]) => items.filter((item): item is T => item !== null);
  return {
    lines: keep(latestObjects(plots.__lines__).map((line) => toLine(clock, line))),
    boxes: keep(latestObjects(plots.__boxes__).map((box) => toBox(clock, box))),
    labels: keep(latestObjects(plots.__labels__).map((label) => toLabel(clock, label))),
    tables: latestObjects(plots.__tables__).map(toTable),
    polylines: [...keep(latestObjects(plots.__linefills__).map((linefill) => toLinefill(clock, linefill))), ...keep(latestObjects(plots.__polylines__).map((polyline) => toPolyline(clock, polyline)))],
  };
}

function toMarkers(clock: BarClock, plot: PinePlot, isChar: boolean): StudyMarker[] {
  const options = plot.options ?? {};
  const markers: StudyMarker[] = [];
  for (const datum of plot.data ?? []) {
    const index = clock.exact(datum.time);
    const value = datum.value;
    if (index === undefined || value === null || value === false || value === undefined || (typeof value === 'number' && (!Number.isFinite(value) || value === 0))) continue;
    const merged = { ...options, ...datum.options };
    const location = markerLocations[text(merged.location).toLowerCase()] ?? 'aboveBar';
    const shape = shapeOf(merged.shape);
    const markerText = text(merged.text);
    const textColor = typeof merged.textcolor === 'string' && merged.textcolor ? merged.textcolor : undefined;
    markers.push({
      index,
      ...(location === 'absolute' && typeof value === 'number' ? { price: value } : {}),
      ...(isChar ? { char: text(merged.char) || '★' } : {}),
      ...(markerText ? { text: markerText } : {}),
      color: color(merged.color, pineBlue),
      ...(textColor ? { textColor } : {}),
      size: sizeOf(merged.size ?? 'small'),
      ...(!isChar ? { shape: shape ?? 'xcross' } : {}),
      location,
    });
  }
  return markers;
}

export function toStudyOutput(plots: Record<string, PinePlot>, clock: BarClock): PineConversion {
  const output: StudyOutput = { plots: [] };
  const bands: StudyBand[] = [];
  const levels: StudyLevel[] = [];
  const markers: StudyMarker[] = [];
  const unsupported = new Set<string>();
  for (const [key, plot] of Object.entries(plots)) {
    if (key.startsWith('__')) continue;
    const options = plot.options ?? {};
    const style = text(options.style);
    const base = color(options.color, pineBlue);
    if (style === 'fill') {
      if (!plot.plot1 || !plot.plot2) continue;
      if (options.gradient === true) {
        bands.push({ key, from: plot.plot1, to: plot.plot2, color: base, gradients: perBar(clock, plot, gradientOf) });
        continue;
      }
      const colors = perBarColors(clock, plot, base);
      bands.push({ key, from: plot.plot1, to: plot.plot2, color: base, ...(colors ? { colors } : {}) });
      continue;
    }
    if (style === 'hline') {
      const price = finite(plot.data?.[plot.data.length - 1]?.value);
      if (price === null) continue;
      levels.push({ key, price, color: color(options.color, pineGray), title: plot.title ?? key, width: finite(options.linewidth) ?? 1, lineStyle: lineStyleOf(options.linestyle, 'dashed') });
      // Hidden, but there for fill() between two hlines.
      output.plots.push({ key, title: plot.title ?? key, values: perBar(clock, plot, (datum) => finite(datum.value)), color: 'transparent', isHidden: true });
      continue;
    }
    if (style === 'shape' || style === 'char') {
      markers.push(...toMarkers(clock, plot, style === 'char'));
      continue;
    }
    if (style === 'background' || style === 'barcolor') {
      const colors = perBar(clock, plot, (datum) => (datum.value === null || datum.value === false ? null : typeof datum.options?.color === 'string' ? datum.options.color : null));
      if (style === 'background') output.backgrounds = colors;
      else output.barColors = colors;
      continue;
    }
    if (style === 'candle' || style === 'bar' || style === 'label' || style.startsWith('drawing_') || style === 'linefill' || style === 'table') {
      if (style === 'candle' || style === 'bar') unsupported.add(style === 'candle' ? 'plotcandle' : 'plotbar');
      continue;
    }
    const colors = perBarColors(clock, plot, base);
    const offset = finite(options.offset) ?? 0;
    const kind = plotKinds[style] ?? 'line';
    output.plots.push({
      key,
      title: plot.title ?? key,
      values: perBar(clock, plot, (datum) => finite(datum.value)),
      color: base,
      ...(colors ? { colors } : {}),
      width: finite(options.linewidth) ?? 1,
      ...(kind !== 'line' ? { kind } : {}),
      ...(offset ? { offset } : {}),
      ...(isOffPane(options.display) ? { isHidden: true } : {}),
    });
  }
  if (bands.length) output.bands = bands;
  if (levels.length) output.levels = levels;
  if (markers.length) output.markers = markers;
  const objects = toObjects(clock, plots);
  if (Object.values(objects).some((list) => list.length)) output.objects = objects;
  return { output, unsupported: [...unsupported] };
}
