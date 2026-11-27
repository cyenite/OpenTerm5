import type { Bar, DrawingPoint, DrawingStyle, SerializedDrawing } from '@meridian/charts';

export const agentDrawingPrefix = 'agent-';

export type AnchorSpec = number | 'free' | 'multi';

const pad = (value: number) => String(value).padStart(2, '0');

// The chart's own clock: Meridian formats bar times with UTC getters, so an MT5 bar reads in broker
// server time, exactly as the user sees it on the axis.
export function formatChartTime(time: number): string {
  const date = new Date(time);
  const day = `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  const clock = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  return date.getUTCSeconds() ? `${day} ${clock}:${pad(date.getUTCSeconds())}` : `${day} ${clock}`;
}

export function parseChartTime(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?Z?$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0));
  const time = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  return new Date(time).getUTCDate() === day ? time : null;
}

// The open of the bar nearest `time`. Past either end of the loaded bars the interval's grid goes
// on, so a projection into the future lands on the slot the crosshair would show.
export function snapToBar(time: number, times: readonly number[], interval: number): number {
  if (!times.length) return time;
  const first = times[0];
  const last = times[times.length - 1];
  if (time >= last) return last + Math.round((time - last) / interval) * interval;
  if (time <= first) return first - Math.round((first - time) / interval) * interval;
  let low = 0;
  let high = times.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (times[middle] <= time) low = middle;
    else high = middle;
  }
  return time - times[low] <= times[high] - time ? times[low] : times[high];
}

export function barInterval(bars: readonly Bar[], fallback: number): number {
  let interval = Number.POSITIVE_INFINITY;
  for (let index = 1; index < bars.length; index++) interval = Math.min(interval, bars[index].time - bars[index - 1].time);
  return Number.isFinite(interval) && interval > 0 ? interval : fallback;
}

// A simple mean of the true ranges, enough to size a level or a zone; null with too few bars.
export function averageTrueRange(bars: readonly Bar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  let total = 0;
  for (let index = bars.length - period; index < bars.length; index++) {
    const bar = bars[index];
    const close = bars[index - 1].close;
    total += Math.max(bar.high - bar.low, Math.abs(bar.high - close), Math.abs(bar.low - close));
  }
  return total / period;
}

export function barRows(bars: readonly Bar[]): (string | number)[][] {
  return bars.map((bar) => [formatChartTime(bar.time), bar.open, bar.high, bar.low, bar.close, bar.volume ?? 0]);
}

export function barSummary(bars: readonly Bar[]) {
  if (!bars.length) return null;
  const last = bars[bars.length - 1];
  return {
    from: formatChartTime(bars[0].time),
    to: formatChartTime(last.time),
    count: bars.length,
    high: Math.max(...bars.map((bar) => bar.high)),
    low: Math.min(...bars.map((bar) => bar.low)),
    lastClose: last.close,
    atr14: averageTrueRange(bars),
  };
}

// Why these points cannot make the tool, or null when they can.
export function pointsProblem(type: string, anchors: AnchorSpec, count: number): string | null {
  if (typeof anchors === 'number') return count === anchors ? null : `${type} takes ${anchors} point${anchors === 1 ? '' : 's'}, not ${count}.`;
  return count >= 2 ? null : `${type} takes at least 2 points.`;
}

export const isAgentDrawing = (drawing: Pick<SerializedDrawing, 'id'>) => drawing.id.startsWith(agentDrawingPrefix);

export interface AgentDrawingSpec {
  readonly id: string;
  readonly type: string;
  readonly style: DrawingStyle;
  readonly anchors: readonly DrawingPoint[];
  readonly zIndex: number;
  readonly createdAt: number;
  readonly text?: string;
}

export function agentDrawing(spec: AgentDrawingSpec): SerializedDrawing {
  return {
    id: spec.id,
    type: spec.type,
    paneId: 'price',
    anchors: spec.anchors.map((anchor) => ({ time: anchor.time, price: anchor.price })),
    style: { ...spec.style },
    ...(spec.text === undefined ? {} : { text: spec.text }),
    locked: false,
    visible: true,
    zIndex: spec.zIndex,
    createdAt: spec.createdAt,
  };
}

export function describeDrawing(drawing: SerializedDrawing) {
  return {
    id: drawing.id,
    type: drawing.type,
    points: drawing.anchors.map((anchor) => ({ time: formatChartTime(anchor.time), price: anchor.price })),
    ...(drawing.text ? { text: drawing.text } : {}),
    isAgent: isAgentDrawing(drawing),
  };
}

export const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
