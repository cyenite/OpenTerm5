import type { Drawing } from './workspace';

export interface DrawingPoint { readonly time: number; readonly price: number }
export const fibonacciRatios = [0, 0.236, 0.382, 0.5, 0.618, 1, 1.618, 2.618, 4.236] as const;

export function fibonacciLevels(from: DrawingPoint, to: DrawingPoint): { ratio: number; price: number }[] {
  return fibonacciRatios.map((ratio) => ({ ratio, price: to.price + (from.price - to.price) * ratio }));
}

export function rectangleBounds(from: DrawingPoint, to: DrawingPoint) {
  return { startTime: Math.min(from.time, to.time), endTime: Math.max(from.time, to.time), lowPrice: Math.min(from.price, to.price), highPrice: Math.max(from.price, to.price) };
}

export function isDrawingPoint(value: unknown): value is DrawingPoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<DrawingPoint>;
  return Number.isFinite(point.time) && Number.isFinite(point.price);
}

export function isDrawing(value: unknown): value is Drawing {
  if (!value || typeof value !== 'object') return false;
  const drawing = value as Record<string, unknown>;
  if (typeof drawing.id !== 'string') return false;
  if (drawing.kind === 'hline') return Number.isFinite(drawing.price);
  if (drawing.kind === 'vline') return Number.isFinite(drawing.time);
  if (drawing.kind === 'ray') return isDrawingPoint(drawing.from);
  return ['trend', 'rectangle', 'fibonacci'].includes(String(drawing.kind)) && isDrawingPoint(drawing.from) && isDrawingPoint(drawing.to);
}
