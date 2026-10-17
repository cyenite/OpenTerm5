import type { InputValue, StudyInput } from '@meridian/charts';

// A Pine input as PineTS's scanner reports it (`Indicator.getInputsMeta()`), cut down to what the
// settings dialog needs. `id` is the key PineTS takes input overrides by: titles can repeat.
export interface PineInput {
  id: string;
  type: string;
  title: string;
  defval: InputValue;
  group?: string;
  inline?: string;
  minval?: number;
  maxval?: number;
  step?: number;
  // Pine's display flags joined ('data_windowstatus_line'); without 'status_line' the input stays out of the legend.
  display?: string;
  options?: readonly InputValue[];
}

const isValue = (value: unknown): value is InputValue => typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean';

const sources = ['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'];

// Pine's '#rrggbbaa' with full opacity is plain '#rrggbb'; the dialog edits opacity beside it.
function normalColor(value: InputValue): string {
  const color = String(value);
  return /^#[0-9a-f]{6}ff$/i.test(color) ? color.slice(0, 7) : color;
}

export function readPineInputs(meta: unknown): PineInput[] {
  if (!Array.isArray(meta)) return [];
  return meta.flatMap((entry): PineInput[] => {
    if (!entry || typeof entry !== 'object') return [];
    const { id, type, title, name, defval, group, inline, minval, maxval, step, display, options } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || typeof type !== 'string') return [];
    const input: PineInput = { id, type, title: typeof title === 'string' && title ? title : typeof name === 'string' && name ? name : id, defval: isValue(defval) ? defval : '' };
    if (typeof group === 'string' && group) input.group = group;
    if (typeof inline === 'string' && inline) input.inline = inline;
    if (typeof minval === 'number') input.minval = minval;
    if (typeof maxval === 'number') input.maxval = maxval;
    if (typeof step === 'number') input.step = step;
    if (typeof display === 'string' && display) input.display = display;
    if (Array.isArray(options)) input.options = options.filter(isValue);
    return [input];
  });
}

export function studyInputs(inputs: readonly PineInput[]): StudyInput[] {
  return inputs.map((input): StudyInput => {
    const isCaptionHidden = !!input.display && input.display !== 'all' && !input.display.includes('status_line');
    const base = { key: input.id, title: input.title, ...(input.inline ? { row: `${input.group ?? ''}\u0000${input.inline}` } : {}), ...(isCaptionHidden ? { isCaptionHidden } : {}) };
    const options = input.options?.map(String);
    if (options?.length) return { ...base, type: 'select', default: String(input.defval), options };
    switch (input.type) {
      case 'int':
      case 'float':
      case 'price':
        return {
          ...base,
          type: input.type === 'int' ? 'int' : 'float',
          default: Number(input.defval) || 0,
          ...(input.minval !== undefined ? { min: input.minval } : {}),
          ...(input.maxval !== undefined ? { max: input.maxval } : {}),
          ...(input.step !== undefined ? { step: input.step } : {}),
        };
      case 'bool': return { ...base, type: 'bool', default: input.defval === true };
      case 'color': return { ...base, type: 'color', default: normalColor(input.defval) };
      case 'source': return { ...base, type: 'select', default: String(input.defval || 'close'), options: sources };
      case 'time': return { ...base, type: 'time', default: Number(input.defval) || 0 };
      default: return { ...base, type: 'text', default: String(input.defval) };
    }
  });
}

// The chart's input values as PineTS overrides, keyed by input id and typed as Pine expects.
export function pineOverrides(inputs: readonly PineInput[], values: Record<string, InputValue>): Record<string, InputValue> {
  const overrides: Record<string, InputValue> = {};
  for (const input of inputs) {
    const value = values[input.id];
    if (value === undefined) continue;
    const isNumber = input.type === 'int' || input.type === 'float' || input.type === 'price' || input.type === 'time';
    overrides[input.id] = isNumber ? Number(value) : value;
  }
  return overrides;
}
