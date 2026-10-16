import type { DrawingTemplate, SerializedDrawing } from '../types';
import type { Field, FieldValues, LevelValue } from '../ui/dialog';
import type { ToolDefinition } from './tools';

const DAY = 86_400_000;

// Timeframe bands a drawing can be shown on, as in TradingView's Visibility tab. A chart's interval
// falls in one band and counts `unit`s there (a 4 hour chart is 4 hours); a drawing can be limited
// to a range of counts in each band.
export const visibilityBands = [
  { key: 'seconds', label: 'Seconds', below: 60_000, unit: 1_000, max: 59 },
  { key: 'minutes', label: 'Minutes', below: 3_600_000, unit: 60_000, max: 59 },
  { key: 'hours', label: 'Hours', below: DAY, unit: 3_600_000, max: 24 },
  { key: 'days', label: 'Days', below: 7 * DAY, unit: DAY, max: 366 },
  { key: 'weeks', label: 'Weeks', below: 28 * DAY, unit: 7 * DAY, max: 52 },
  { key: 'months', label: 'Months', below: Infinity, unit: 30 * DAY, max: 12 },
] as const;

type Band = (typeof visibilityBands)[number];

// Stored as TradingView stores `intervalsVisibilities`: `minutes: false` hides every minute chart,
// `minutesFrom`/`minutesTo` limit the minute charts it shows on.
export type Visibility = Record<string, boolean | number>;

export function intervalBand(intervalMs: number): { band: Band; count: number } {
  const band = visibilityBands.find((candidate) => intervalMs < candidate.below)!;
  return { band, count: Math.max(1, Math.round(intervalMs / band.unit)) };
}

function rangeOf(visibility: Visibility, band: Band): [number, number] {
  const from = Number(visibility[`${band.key}From`]);
  const to = Number(visibility[`${band.key}To`]);
  return [Number.isFinite(from) ? Math.max(1, from) : 1, Number.isFinite(to) ? Math.min(band.max, to) : band.max];
}

export function isShownOn(drawing: SerializedDrawing, intervalMs: number): boolean {
  const visibility = drawing.props?.visibility as Visibility | undefined;
  if (!visibility) return true;
  const { band, count } = intervalBand(intervalMs);
  if (visibility[band.key] === false) return false;
  const [from, to] = rangeOf(visibility, band);
  return count >= from && count <= to;
}

// Visibility from each band's flag and range; undefined when the drawing shows everywhere.
export function visibilityFrom(bands: Record<string, { isVisible: boolean; range?: readonly [number, number] }>): Visibility | undefined {
  const visibility: Visibility = {};
  let isEverywhere = true;
  for (const band of visibilityBands) {
    const entry = bands[band.key] ?? { isVisible: true };
    visibility[band.key] = entry.isVisible;
    if (!entry.isVisible) isEverywhere = false;
    const [from, to] = entry.range ?? [1, band.max];
    if (from > 1 || to < band.max) {
      visibility[`${band.key}From`] = from;
      visibility[`${band.key}To`] = to;
      isEverywhere = false;
    }
  }
  return isEverywhere ? undefined : visibility;
}

export type IntervalChoice = 'above' | 'below' | 'only' | 'all';

// The context menu's "Visibility on intervals": the chart's interval and above, and below, only
// it, or every interval.
export function visibilityForInterval(intervalMs: number, choice: IntervalChoice): Visibility | undefined {
  if (choice === 'all') return undefined;
  const { band, count } = intervalBand(intervalMs);
  const index = visibilityBands.indexOf(band);
  return visibilityFrom(Object.fromEntries(visibilityBands.map((candidate, at) => {
    if (at === index) return [candidate.key, { isVisible: true, range: choice === 'above' ? [count, candidate.max] : choice === 'below' ? [1, count] : [count, count] }];
    const isVisible = choice === 'above' ? at > index : choice === 'below' ? at < index : false;
    return [candidate.key, { isVisible }];
  })));
}

const extendable: Record<string, { left: boolean; right: boolean }> = {
  'trend-line': { left: true, right: true },
  rectangle: { left: false, right: true },
  'fib-retracement': { left: false, right: true },
  'fib-extension': { left: false, right: true },
};

export const fontSizes = [10, 11, 12, 14, 16, 20, 24, 28, 32, 40] as const;

const percentOf = (opacity: number | undefined, fallback: number) => Math.round((opacity ?? fallback) * 100);

// TradingView's tabs for a drawing: Style (line colour with its opacity and thickness, line style,
// background and the tool's own options and levels), Text (colour, size, bold and italic, then the
// text), the tool's own tabs, Coordinates and Visibility.
export function drawingFields(drawing: SerializedDrawing, definition: ToolDefinition): Field[] {
  const { style } = drawing;
  const toolFields = definition.fields ?? [];
  const fontLooks = definition.hasText ? toolFields.filter((field) => field.type === 'checkbox' && (field.key === 'bold' || field.key === 'italic')) : [];
  const fields: Field[] = [
    { key: 'lineColor', label: 'Line', tab: 'Style', row: 'line', type: 'color', value: style.lineColor, opacity: { key: 'lineOpacity', value: percentOf(style.lineOpacity, 1) }, thickness: { key: 'lineWidth', value: style.lineWidth } },
    { key: 'lineStyle', label: 'Line style', tab: 'Style', row: 'line', type: 'line-style', value: style.lineStyle },
  ];
  if (definition.isFillable) fields.push({ key: 'fillColor', label: 'Background', tab: 'Style', type: 'color', value: style.fillColor ?? style.lineColor, opacity: { key: 'fillOpacity', value: percentOf(style.fillOpacity, 0.15) } });
  const extend = extendable[drawing.type];
  if (extend?.left) fields.push({ key: 'extendLeft', label: 'Extend left line', tab: 'Style', type: 'checkbox', value: !!style.extendLeft });
  if (extend?.right) fields.push({ key: 'extendRight', label: 'Extend right line', tab: 'Style', type: 'checkbox', value: !!style.extendRight });
  if (definition.hasText) {
    fields.push({ key: 'textColor', label: '', tab: 'Text', row: 'font', type: 'color', value: style.textColor ?? style.lineColor });
    fields.push({ key: 'fontSize', label: 'Font size', tab: 'Text', row: 'font', type: 'number', value: style.fontSize ?? 13, options: [...new Set([...fontSizes, style.fontSize ?? 13])].sort((left, right) => left - right) });
    for (const look of fontLooks) fields.push({ key: `field:${look.key}`, label: look.label, tab: 'Text', row: 'font', type: 'checkbox', value: drawing.props?.[look.key] === true || (drawing.props?.[look.key] === undefined && look.default === true), look: look.key as 'bold' | 'italic' });
    fields.push({ key: 'text', label: 'Text', tab: 'Text', type: 'text', value: drawing.text ?? '', isMultiline: true });
  }
  for (const field of toolFields) {
    if (fontLooks.includes(field)) continue;
    const saved = drawing.props?.[field.key];
    const key = `field:${field.key}`;
    const tab = field.tab ?? 'Style';
    // A background switch and its opacity read as one row, as TradingView's "Background" does.
    const row = field.key === 'fillBackground' || field.key === 'backgroundOpacity' ? 'background' : undefined;
    if (field.type === 'levels') fields.push({ key, label: field.label, tab, type: 'levels', value: (saved as LevelValue[] | undefined) ?? field.default });
    else if (field.type === 'checkbox') fields.push({ key, label: field.label, tab, row, type: 'checkbox', value: typeof saved === 'boolean' ? saved : field.default });
    else if (field.type === 'number') fields.push({ key, label: row ? 'Opacity (%)' : field.label, tab, row, type: 'number', value: typeof saved === 'number' ? saved : field.default, min: field.min, max: field.max, step: field.step });
    else if (field.type === 'select') fields.push({ key, label: field.label, tab, type: 'select', value: typeof saved === 'string' ? saved : field.default, options: field.options });
    else fields.push({ key, label: field.label, tab, type: 'color', value: typeof saved === 'string' ? saved : field.default });
  }
  if (definition.anchors !== 'free') {
    drawing.anchors.forEach((anchor, index) => {
      const name = definition.anchorNames?.[index] ?? (drawing.anchors.length > 1 ? `#${index + 1}` : '');
      const label = name ? `${name} (price, time)` : 'Price, time';
      fields.push({ key: `price:${index}`, label, tab: 'Coordinates', row: `anchor:${index}`, type: 'number', value: anchor.price });
      fields.push({ key: `time:${index}`, label: 'Time', tab: 'Coordinates', row: `anchor:${index}`, type: 'datetime', value: anchor.time });
    });
  }
  const visibility = (drawing.props?.visibility ?? {}) as Visibility;
  for (const band of visibilityBands) {
    fields.push({ key: `visible:${band.key}`, label: band.label, tab: 'Visibility', row: `visible:${band.key}`, type: 'checkbox', value: visibility[band.key] !== false });
    fields.push({ key: `range:${band.key}`, label: band.label, tab: 'Visibility', row: `visible:${band.key}`, type: 'range', value: rangeOf(visibility, band), min: 1, max: band.max });
  }
  return fields;
}

export function applyDrawingFields(drawing: SerializedDrawing, definition: ToolDefinition, values: FieldValues): SerializedDrawing {
  const style = {
    ...drawing.style,
    lineColor: String(values.lineColor),
    lineWidth: Number(values.lineWidth),
    lineStyle: values.lineStyle as SerializedDrawing['style']['lineStyle'],
    ...(Number(values.lineOpacity) < 100 ? { lineOpacity: Math.max(0, Number(values.lineOpacity) || 0) / 100 } : {}),
    ...(definition.isFillable ? { fillColor: String(values.fillColor), fillOpacity: Number(values.fillOpacity) / 100 } : {}),
    ...('extendLeft' in values ? { extendLeft: values.extendLeft === true } : {}),
    ...('extendRight' in values ? { extendRight: values.extendRight === true } : {}),
    ...(definition.hasText ? { textColor: String(values.textColor), fontSize: Number(values.fontSize) } : {}),
  };
  // Fully opaque is the default, so it is not stored.
  if (Number(values.lineOpacity) >= 100) delete style.lineOpacity;
  const props: Record<string, unknown> = { ...drawing.props };
  for (const field of definition.fields ?? []) if (`field:${field.key}` in values) props[field.key] = values[`field:${field.key}`];
  const visibility = visibilityFrom(Object.fromEntries(visibilityBands.map((band) => {
    const range = values[`range:${band.key}`];
    return [band.key, { isVisible: values[`visible:${band.key}`] !== false, ...(Array.isArray(range) && range.length === 2 ? { range: range as [number, number] } : {}) }];
  })));
  if (visibility) props.visibility = visibility;
  else delete props.visibility;
  const anchors = definition.anchors === 'free' ? drawing.anchors : drawing.anchors.map((anchor, index) => {
    const price = Number(values[`price:${index}`]);
    const time = Number(values[`time:${index}`]);
    return { time: Number.isFinite(time) ? time : anchor.time, price: Number.isFinite(price) ? price : anchor.price };
  });
  return {
    ...drawing,
    style,
    anchors,
    ...(definition.hasText ? { text: String(values.text ?? '') } : {}),
    ...(Object.keys(props).length ? { props } : {}),
  };
}

// A drawing's look as a named template: style, options and text, never its place or visibility.
export function templateOf(drawing: SerializedDrawing, name: string): DrawingTemplate {
  const { visibility, isTransient, ...props } = drawing.props ?? {};
  return { name, style: structuredClone(drawing.style), ...(Object.keys(props).length ? { props: structuredClone(props) } : {}), ...(drawing.text ? { text: drawing.text } : {}) };
}

// The drawing restyled by a template; with no template, by the tool's defaults.
export function withTemplate(drawing: SerializedDrawing, template: DrawingTemplate | null, defaultStyle: SerializedDrawing['style']): SerializedDrawing {
  const visibility = drawing.props?.visibility;
  const props = { ...(template?.props ?? {}), ...(visibility ? { visibility } : {}) };
  return { ...drawing, style: structuredClone(template?.style ?? defaultStyle), props, ...(template?.text !== undefined ? { text: template.text } : {}) };
}

// What a new drawing of the tool starts with, remembered from the last one the user styled. Text
// carries over only for tools whose text is an optional label (a "BOS" trend line); a text note
// starts with its own placeholder, ready to be typed over.
export function lookOf(drawing: SerializedDrawing, definition: ToolDefinition): DrawingTemplate {
  const look = templateOf(drawing, '');
  if (definition.defaultText) delete look.text;
  return look;
}
