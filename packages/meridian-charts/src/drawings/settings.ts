import type { DrawingTemplate, SerializedDrawing } from '../types';
import type { Field, FieldValues, LevelValue } from '../ui/dialog';
import type { ToolDefinition } from './tools';

// Timeframe bands a drawing can be shown on, as in the Visibility tab.
export const visibilityBands = [
  { key: 'seconds', label: 'Seconds', below: 60_000 },
  { key: 'minutes', label: 'Minutes', below: 3_600_000 },
  { key: 'hours', label: 'Hours', below: 86_400_000 },
  { key: 'days', label: 'Days', below: 7 * 86_400_000 },
  { key: 'weeks', label: 'Weeks', below: 28 * 86_400_000 },
  { key: 'months', label: 'Months', below: Infinity },
] as const;

export function isShownOn(drawing: SerializedDrawing, intervalMs: number): boolean {
  const visibility = drawing.props?.visibility as Record<string, boolean> | undefined;
  if (!visibility) return true;
  const band = visibilityBands.find((candidate) => intervalMs < candidate.below)!;
  return visibility[band.key] !== false;
}

const extendable: Record<string, { left: boolean; right: boolean }> = {
  'trend-line': { left: true, right: true },
  rectangle: { left: false, right: true },
  'fib-retracement': { left: false, right: true },
  'fib-extension': { left: false, right: true },
};

// The Style, Text, Coordinates and Visibility tabs of a drawing's settings, plus the tool's own
// fields (levels go on a tab of their own).
export function drawingFields(drawing: SerializedDrawing, definition: ToolDefinition): Field[] {
  const { style } = drawing;
  const fields: Field[] = [
    { key: 'lineColor', label: 'Line', tab: 'Style', type: 'color', value: style.lineColor },
    { key: 'lineWidth', label: 'Width', tab: 'Style', type: 'number', value: style.lineWidth, min: 1, max: 12, step: 1 },
    { key: 'lineStyle', label: 'Line style', tab: 'Style', type: 'select', value: style.lineStyle, options: ['solid', 'dashed', 'dotted'] },
    { key: 'lineOpacity', label: 'Line opacity (%)', tab: 'Style', type: 'number', value: Math.round((style.lineOpacity ?? 1) * 100), min: 0, max: 100, step: 5 },
  ];
  if (definition.isFillable) {
    fields.push({ key: 'fillColor', label: 'Background', tab: 'Style', type: 'color', value: style.fillColor ?? style.lineColor });
    fields.push({ key: 'fillOpacity', label: 'Background opacity (%)', tab: 'Style', type: 'number', value: Math.round((style.fillOpacity ?? 0.15) * 100), min: 0, max: 100, step: 5 });
  }
  const extend = extendable[drawing.type];
  if (extend?.left) fields.push({ key: 'extendLeft', label: 'Extend left', tab: 'Style', type: 'checkbox', value: !!style.extendLeft });
  if (extend?.right) fields.push({ key: 'extendRight', label: 'Extend right', tab: 'Style', type: 'checkbox', value: !!style.extendRight });
  // The Text tab leads with the text itself, then the tool's own text options.
  if (definition.hasText) {
    fields.push({ key: 'text', label: 'Text', tab: 'Text', type: 'text', value: drawing.text ?? '', isMultiline: true });
    fields.push({ key: 'textColor', label: 'Text colour', tab: 'Text', type: 'color', value: style.textColor ?? style.lineColor });
    fields.push({ key: 'fontSize', label: 'Font size', tab: 'Text', type: 'number', value: style.fontSize ?? 13, min: 8, max: 40, step: 1 });
  }
  for (const field of definition.fields ?? []) {
    const saved = drawing.props?.[field.key];
    const tab = field.tab ?? 'Style';
    if (field.type === 'levels') fields.push({ key: `field:${field.key}`, label: field.label, tab: field.tab ?? 'Levels', type: 'levels', value: (saved as LevelValue[] | undefined) ?? field.default });
    else if (field.type === 'checkbox') fields.push({ key: `field:${field.key}`, label: field.label, tab, type: 'checkbox', value: typeof saved === 'boolean' ? saved : field.default });
    else if (field.type === 'number') fields.push({ key: `field:${field.key}`, label: field.label, tab, type: 'number', value: typeof saved === 'number' ? saved : field.default, min: field.min, max: field.max, step: field.step });
    else if (field.type === 'select') fields.push({ key: `field:${field.key}`, label: field.label, tab, type: 'select', value: typeof saved === 'string' ? saved : field.default, options: field.options });
    else fields.push({ key: `field:${field.key}`, label: field.label, tab, type: 'color', value: typeof saved === 'string' ? saved : field.default });
  }
  if (definition.anchors !== 'free') {
    drawing.anchors.forEach((anchor, index) => {
      const name = drawing.anchors.length > 1 ? `#${index + 1} ` : '';
      fields.push({ key: `price:${index}`, label: `${name}Price`, tab: 'Coordinates', type: 'number', value: anchor.price });
      fields.push({ key: `time:${index}`, label: `${name}Time (UTC)`, tab: 'Coordinates', type: 'datetime', value: anchor.time });
    });
  }
  const visibility = (drawing.props?.visibility ?? {}) as Record<string, boolean>;
  for (const band of visibilityBands) fields.push({ key: `visible:${band.key}`, label: band.label, tab: 'Visibility', type: 'checkbox', value: visibility[band.key] !== false });
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
  const visibility = Object.fromEntries(visibilityBands.map((band) => [band.key, values[`visible:${band.key}`] !== false]));
  if (Object.values(visibility).every(Boolean)) delete props.visibility;
  else props.visibility = visibility;
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
