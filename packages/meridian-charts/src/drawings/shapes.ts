// A drawing tool describes itself as a list of shapes in pixel space. The same list is painted
// and hit-tested, so what the user sees is exactly what they can click.

export interface Pt {
  x: number;
  y: number;
}

export interface ShapeStyle {
  color?: string;
  width?: number;
  dash?: readonly number[];
  fill?: string;
  fillOpacity?: number;
  opacity?: number;
}

export type Shape =
  | { kind: 'line'; a: Pt; b: Pt; style: ShapeStyle }
  | { kind: 'poly'; points: Pt[]; closed: boolean; style: ShapeStyle }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; style: ShapeStyle }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotation: number; start: number; end: number; style: ShapeStyle }
  // `rotation` turns the text about (x, y), in radians, so a label can follow a sloped line.
  | { kind: 'text'; x: number; y: number; text: string; align: CanvasTextAlign; baseline: CanvasTextBaseline; color: string; size: number; bold: boolean; italic: boolean; rotation: number; background?: string; border?: string; padding: number; radius: number };

export interface Bounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export class ShapeList {
  readonly shapes: Shape[] = [];

  line(a: Pt, b: Pt, style: ShapeStyle = {}): this {
    this.shapes.push({ kind: 'line', a, b, style });
    return this;
  }

  poly(points: Pt[], closed = false, style: ShapeStyle = {}): this {
    if (points.length > 1) this.shapes.push({ kind: 'poly', points, closed, style });
    return this;
  }

  rect(a: Pt, b: Pt, style: ShapeStyle = {}): this {
    this.shapes.push({ kind: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), style });
    return this;
  }

  ellipse(cx: number, cy: number, rx: number, ry: number, style: ShapeStyle = {}, rotation = 0, start = 0, end = Math.PI * 2): this {
    this.shapes.push({ kind: 'ellipse', cx, cy, rx: Math.abs(rx), ry: Math.abs(ry), rotation, start, end, style });
    return this;
  }

  text(at: Pt, text: string, options: { align?: CanvasTextAlign; baseline?: CanvasTextBaseline; color: string; size?: number; bold?: boolean; italic?: boolean; rotation?: number; background?: string; border?: string; padding?: number; radius?: number }): this {
    this.shapes.push({ kind: 'text', x: at.x, y: at.y, text, align: options.align ?? 'left', baseline: options.baseline ?? 'middle', color: options.color, size: options.size ?? 12, bold: options.bold ?? false, italic: options.italic ?? false, rotation: options.rotation ?? 0, background: options.background, border: options.border, padding: options.padding ?? 0, radius: options.radius ?? 3 });
    return this;
  }

  // A filled arrowhead pointing at `tip`, coming from `from`.
  arrowHead(from: Pt, tip: Pt, size: number, style: ShapeStyle = {}): this {
    const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
    const left = { x: tip.x - size * Math.cos(angle - 0.45), y: tip.y - size * Math.sin(angle - 0.45) };
    const right = { x: tip.x - size * Math.cos(angle + 0.45), y: tip.y - size * Math.sin(angle + 0.45) };
    return this.poly([left, tip, right], true, { ...style, fill: style.fill ?? style.color });
  }
}

// ── Geometry ────────────────────────────────────────────────────────────────

export const distance = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Extends the line through a and b to the plot edges: to the right, the left, or both.
export function extend(a: Pt, b: Pt, bounds: Bounds, left: boolean, right: boolean): [Pt, Pt] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return [a, b];
  const far = 4 * (bounds.width + bounds.height + Math.abs(a.x) + Math.abs(a.y));
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;
  return [left ? { x: a.x - ux * far, y: a.y - uy * far } : a, right ? { x: b.x + ux * far, y: b.y + uy * far } : b];
}

export function quadratic(a: Pt, control: Pt, b: Pt, steps = 32): Pt[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * control.x + t * t * b.x, y: u * u * a.y + 2 * u * t * control.y + t * t * b.y };
  });
}

export function cubic(a: Pt, c1: Pt, c2: Pt, b: Pt, steps = 40): Pt[] {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    const u = 1 - t;
    return {
      x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
      y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y,
    };
  });
}

// ── Hit testing ─────────────────────────────────────────────────────────────

function textBox(shape: Extract<Shape, { kind: 'text' }>, measure: (text: string, size: number, bold: boolean) => number) {
  const width = measure(shape.text, shape.size, shape.bold) + shape.padding * 2;
  const height = shape.size * 1.3 + shape.padding * 2;
  const x = shape.align === 'center' ? shape.x - width / 2 : shape.align === 'right' || shape.align === 'end' ? shape.x - width : shape.x;
  const y = shape.baseline === 'middle' ? shape.y - height / 2 : shape.baseline === 'bottom' || shape.baseline === 'alphabetic' ? shape.y - height : shape.y;
  return { x, y, width, height };
}

export { textBox };

export function hitShape(shape: Shape, p: Pt, tolerance: number, measure: (text: string, size: number, bold: boolean) => number): boolean {
  switch (shape.kind) {
    case 'line':
      return segmentDistance(p, shape.a, shape.b) <= tolerance + (shape.style.width ?? 1) / 2;
    case 'poly': {
      const points = shape.closed ? [...shape.points, shape.points[0]] : shape.points;
      for (let index = 1; index < points.length; index++) if (segmentDistance(p, points[index - 1], points[index]) <= tolerance + (shape.style.width ?? 1) / 2) return true;
      return !!shape.style.fill && shape.closed && insidePolygon(p, shape.points);
    }
    case 'rect': {
      const inside = p.x >= shape.x - tolerance && p.x <= shape.x + shape.w + tolerance && p.y >= shape.y - tolerance && p.y <= shape.y + shape.h + tolerance;
      if (!inside) return false;
      if (shape.style.fill) return true;
      return p.x <= shape.x + tolerance || p.x >= shape.x + shape.w - tolerance || p.y <= shape.y + tolerance || p.y >= shape.y + shape.h - tolerance;
    }
    case 'ellipse': {
      if (!shape.rx || !shape.ry) return false;
      const cos = Math.cos(-shape.rotation);
      const sin = Math.sin(-shape.rotation);
      const dx = p.x - shape.cx;
      const dy = p.y - shape.cy;
      const x = dx * cos - dy * sin;
      const y = dx * sin + dy * cos;
      const radial = Math.hypot(x / shape.rx, y / shape.ry);
      const angle = normalise(Math.atan2(y / shape.ry, x / shape.rx));
      const isFull = shape.end - shape.start >= Math.PI * 2 - 1e-6;
      const inArc = isFull || angleBetween(angle, normalise(shape.start), normalise(shape.end));
      const edge = Math.abs(radial - 1) * Math.min(shape.rx, shape.ry) <= tolerance;
      return inArc && (edge || !!shape.style.fill && radial < 1);
    }
    case 'text': {
      const box = textBox(shape, measure);
      // Into the text's own frame, where its box is upright.
      const cos = Math.cos(-shape.rotation);
      const sin = Math.sin(-shape.rotation);
      const local = { x: shape.x + (p.x - shape.x) * cos - (p.y - shape.y) * sin, y: shape.y + (p.x - shape.x) * sin + (p.y - shape.y) * cos };
      return local.x >= box.x - 2 && local.x <= box.x + box.width + 2 && local.y >= box.y - 2 && local.y <= box.y + box.height + 2;
    }
  }
}

const normalise = (angle: number) => ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
const angleBetween = (angle: number, start: number, end: number) => (start <= end ? angle >= start && angle <= end : angle >= start || angle <= end);

export function insidePolygon(p: Pt, points: readonly Pt[]): boolean {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[index];
    const b = points[previous];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ── Painting ────────────────────────────────────────────────────────────────

export function paintShapes(ctx: CanvasRenderingContext2D, shapes: readonly Shape[], defaults: { color: string; width: number; dash: readonly number[]; font: string }): void {
  for (const shape of shapes) {
    ctx.save();
    if (shape.kind === 'text') {
      ctx.font = `${shape.italic ? 'italic ' : ''}${shape.bold ? '600 ' : ''}${shape.size}px ${defaults.font}`;
      if (shape.rotation) {
        ctx.translate(shape.x, shape.y);
        ctx.rotate(shape.rotation);
        ctx.translate(-shape.x, -shape.y);
      }
      if (shape.background || shape.border) {
        const box = textBox(shape, (text) => ctx.measureText(text).width);
        roundRect(ctx, box.x, box.y, box.width, box.height, shape.radius);
        if (shape.background) { ctx.fillStyle = shape.background; ctx.fill(); }
        if (shape.border) { ctx.strokeStyle = shape.border; ctx.lineWidth = 1; ctx.stroke(); }
      }
      ctx.fillStyle = shape.color;
      ctx.textAlign = shape.align;
      ctx.textBaseline = shape.baseline === 'middle' ? 'middle' : shape.baseline;
      const offsetX = shape.align === 'left' || shape.align === 'start' ? shape.padding : shape.align === 'right' || shape.align === 'end' ? -shape.padding : 0;
      const offsetY = shape.baseline === 'top' ? shape.padding : shape.baseline === 'bottom' || shape.baseline === 'alphabetic' ? -shape.padding : 0;
      ctx.fillText(shape.text, shape.x + offsetX, shape.y + offsetY + (shape.baseline === 'middle' ? 0.5 : 0));
      ctx.restore();
      continue;
    }
    const style = shape.style;
    ctx.globalAlpha = style.opacity ?? 1;
    ctx.strokeStyle = style.color ?? defaults.color;
    ctx.lineWidth = style.width ?? defaults.width;
    ctx.setLineDash(style.dash ? [...style.dash] : [...defaults.dash]);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (shape.kind === 'line') {
      ctx.moveTo(shape.a.x, shape.a.y);
      ctx.lineTo(shape.b.x, shape.b.y);
    } else if (shape.kind === 'poly') {
      ctx.moveTo(shape.points[0].x, shape.points[0].y);
      for (const point of shape.points.slice(1)) ctx.lineTo(point.x, point.y);
      if (shape.closed) ctx.closePath();
    } else if (shape.kind === 'rect') {
      ctx.rect(shape.x, shape.y, shape.w, shape.h);
    } else {
      ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, shape.rotation, shape.start, shape.end);
    }
    if (style.fill) {
      ctx.save();
      ctx.globalAlpha = (style.opacity ?? 1) * (style.fillOpacity ?? 1);
      ctx.fillStyle = style.fill;
      ctx.fill();
      ctx.restore();
    }
    if (style.width !== 0) ctx.stroke();
    ctx.restore();
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
