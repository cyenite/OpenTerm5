import type { Bar, LineStyle, StudyBox, StudyExtend, StudyHorizontalAlign, StudyLabel, StudyLabelStyle, StudyLine, StudyMarker, StudyObjects, StudyPolyline, StudyShape, StudySize, StudyTable, StudyVerticalAlign } from '../types';

// Painters for what script studies draw beyond plots: markers, objects and tables. Sizes follow
// TradingView's rendering of Pine's size.* constants closely enough to read the same.

export interface StudyView {
  top: number;
  width: number;
  height: number;
  spacing: number;
  font: string;
  isPricePane: boolean;
  bars: readonly Bar[];
  ctx: CanvasRenderingContext2D;
  indexToX: (index: number) => number;
  priceToY: (price: number) => number;
}

const shapeSizes: Record<StudySize, number> = { tiny: 6, small: 9, normal: 13, large: 19, huge: 27 };

const textSizes: Record<StudySize, number> = { tiny: 8, small: 10, normal: 12, large: 15, huge: 20 };

const GAP = 4;
const POINTER = 6;
const PADDING = 4;

export const isVisibleColor = (color: string | null | undefined): color is string => !!color && color !== 'transparent' && !/^#[0-9a-f]{6}00$/i.test(color);

const dash = (style: LineStyle, width: number): number[] => (style === 'dashed' ? [width * 4, width * 3] : style === 'dotted' ? [width, width * 2] : []);

const lines = (text: string): string[] => text.split('\n');

function setFont(view: StudyView, size: StudySize, isBold = false): number {
  const px = textSizes[size];
  view.ctx.font = `${isBold ? '600 ' : ''}${px}px ${view.font}`;
  return px;
}

function textWidth(view: StudyView, text: string): number {
  return Math.max(0, ...lines(text).map((line) => view.ctx.measureText(line).width));
}

// Draws text lines with their block's top at `y`, aligned to `x` as `align` says.
function fillLines(view: StudyView, text: string, x: number, y: number, px: number, align: StudyHorizontalAlign, color: string): void {
  const { ctx } = view;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  lines(text).forEach((line, index) => ctx.fillText(line, x, y + index * Math.round(px * 1.25)));
}

const blockHeight = (text: string, px: number) => lines(text).length * Math.round(px * 1.25) - Math.round(px * 0.25);

function barAt(view: StudyView, index: number): Bar | undefined {
  return view.bars[Math.max(0, Math.min(view.bars.length - 1, Math.round(index)))];
}

function shapePath(ctx: CanvasRenderingContext2D, shape: StudyShape, x: number, y: number, size: number): 'fill' | 'stroke' {
  const half = size / 2;
  ctx.beginPath();
  switch (shape) {
    case 'triangleUp':
      ctx.moveTo(x, y - half);
      ctx.lineTo(x + half, y + half);
      ctx.lineTo(x - half, y + half);
      ctx.closePath();
      return 'fill';
    case 'triangleDown':
      ctx.moveTo(x, y + half);
      ctx.lineTo(x + half, y - half);
      ctx.lineTo(x - half, y - half);
      ctx.closePath();
      return 'fill';
    case 'arrowUp':
    case 'arrowDown': {
      const direction = shape === 'arrowUp' ? -1 : 1;
      const shaft = size * 0.18;
      ctx.moveTo(x, y + direction * half);
      ctx.lineTo(x + half, y);
      ctx.lineTo(x + shaft, y);
      ctx.lineTo(x + shaft, y - direction * half);
      ctx.lineTo(x - shaft, y - direction * half);
      ctx.lineTo(x - shaft, y);
      ctx.lineTo(x - half, y);
      ctx.closePath();
      return 'fill';
    }
    case 'circle':
      ctx.arc(x, y, half, 0, Math.PI * 2);
      return 'fill';
    case 'diamond':
      ctx.moveTo(x, y - half);
      ctx.lineTo(x + half, y);
      ctx.lineTo(x, y + half);
      ctx.lineTo(x - half, y);
      ctx.closePath();
      return 'fill';
    case 'square':
      ctx.rect(x - half, y - half, size, size);
      return 'fill';
    case 'flag':
      ctx.moveTo(x - half, y + half);
      ctx.lineTo(x - half, y - half);
      ctx.lineTo(x + half, y - half * 0.4);
      ctx.lineTo(x - half, y + half * 0.2);
      return 'stroke';
    case 'cross':
      ctx.moveTo(x - half, y);
      ctx.lineTo(x + half, y);
      ctx.moveTo(x, y - half);
      ctx.lineTo(x, y + half);
      return 'stroke';
    case 'xcross':
      ctx.moveTo(x - half, y - half);
      ctx.lineTo(x + half, y + half);
      ctx.moveTo(x + half, y - half);
      ctx.lineTo(x - half, y + half);
      return 'stroke';
  }
}

function paintShape(view: StudyView, shape: StudyShape, x: number, y: number, size: number, color: string): void {
  const { ctx } = view;
  const mode = shapePath(ctx, shape, x, y, size);
  if (mode === 'fill') {
    ctx.fillStyle = color;
    ctx.fill();
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size / 7);
  ctx.setLineDash([]);
  ctx.stroke();
}

export function paintMarkers(view: StudyView, markers: readonly StudyMarker[], from: number, to: number): void {
  const { ctx } = view;
  for (const marker of markers) {
    if (marker.index < from - 1 || marker.index > to + 1 || !isVisibleColor(marker.color)) continue;
    const x = view.indexToX(marker.index);
    const size = shapeSizes[marker.size];
    const bar = barAt(view, marker.index);
    const location = view.isPricePane ? marker.location : marker.location === 'aboveBar' ? 'top' : marker.location === 'belowBar' ? 'bottom' : marker.location;
    let y: number;
    if (location === 'absolute') {
      if (marker.price === undefined || !Number.isFinite(marker.price)) continue;
      y = view.priceToY(marker.price);
    } else if (location === 'aboveBar') y = (bar ? view.priceToY(bar.high) : view.top) - GAP - size / 2;
    else if (location === 'belowBar') y = (bar ? view.priceToY(bar.low) : view.top + view.height) + GAP + size / 2;
    else if (location === 'top') y = view.top + GAP + size / 2;
    else y = view.top + view.height - GAP - size / 2;
    if (marker.shape === 'labelUp' || marker.shape === 'labelDown') {
      const px = setFont(view, marker.size === 'tiny' || marker.size === 'small' ? marker.size : 'small');
      const tip = marker.shape === 'labelUp' ? y - size / 2 : y + size / 2;
      paintCallout(view, x, tip, marker.shape, px, marker.text ?? '', marker.color, marker.textColor ?? '#ffffff', 'center');
      continue;
    }
    if (marker.char) {
      ctx.font = `${size}px ${view.font}`;
      ctx.fillStyle = marker.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(marker.char, x, y);
    } else paintShape(view, marker.shape ?? 'circle', x, y, size, marker.color);
    if (!marker.text) continue;
    const px = setFont(view, 'small');
    const isBelow = location === 'belowBar' || location === 'bottom';
    const height = blockHeight(marker.text, px);
    fillLines(view, marker.text, x, isBelow ? y + size / 2 + GAP : y - size / 2 - GAP - height, px, 'center', marker.textColor ?? marker.color);
  }
}

// The segment through the two points, carried on to the pane's edges where it extends.
function extended(view: StudyView, x1: number, y1: number, x2: number, y2: number, extend: StudyExtend): [number, number, number, number] {
  if (extend === 'none') return [x1, y1, x2, y2];
  const isLeft = extend === 'left' || extend === 'both';
  const isRight = extend === 'right' || extend === 'both';
  if (x1 === x2) {
    const [upper, lower] = y1 <= y2 ? [y1, y2] : [y2, y1];
    return [x1, isLeft || isRight ? view.top : upper, x2, isLeft || isRight ? view.top + view.height : lower];
  }
  const slope = (y2 - y1) / (x2 - x1);
  const [leftX, leftY, rightX, rightY] = x1 < x2 ? [x1, y1, x2, y2] : [x2, y2, x1, y1];
  const startX = isLeft ? Math.min(leftX, 0) : leftX;
  const endX = isRight ? Math.max(rightX, view.width) : rightX;
  return [startX, leftY + (startX - leftX) * slope, endX, rightY + (endX - rightX) * slope];
}

function arrowHead(ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, size: number): void {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - size * Math.cos(angle - Math.PI / 7), toY - size * Math.sin(angle - Math.PI / 7));
  ctx.lineTo(toX - size * Math.cos(angle + Math.PI / 7), toY - size * Math.sin(angle + Math.PI / 7));
  ctx.closePath();
  ctx.fill();
}

function paintLine(view: StudyView, line: StudyLine): void {
  if (!isVisibleColor(line.color) || line.width <= 0) return;
  const { ctx } = view;
  const x1 = view.indexToX(line.startIndex);
  const y1 = view.priceToY(line.startPrice);
  const x2 = view.indexToX(line.endIndex);
  const y2 = view.priceToY(line.endPrice);
  const [startX, startY, endX, endY] = extended(view, x1, y1, x2, y2, line.extend);
  ctx.strokeStyle = line.color;
  ctx.fillStyle = line.color;
  ctx.lineWidth = line.width;
  ctx.setLineDash(dash(line.lineStyle, line.width));
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.setLineDash([]);
  const head = 6 + line.width * 2;
  if (line.hasEndArrow) arrowHead(ctx, x1, y1, x2, y2, head);
  if (line.hasStartArrow) arrowHead(ctx, x2, y2, x1, y1, head);
}

const alignedX = (align: StudyHorizontalAlign, left: number, right: number) => (align === 'left' ? left : align === 'right' ? right : (left + right) / 2);

function alignedY(align: StudyVerticalAlign, top: number, bottom: number, height: number): number {
  if (align === 'top') return top;
  if (align === 'bottom') return bottom - height;
  return (top + bottom - height) / 2;
}

function paintBox(view: StudyView, box: StudyBox): void {
  const { ctx } = view;
  let left = view.indexToX(Math.min(box.leftIndex, box.rightIndex));
  let right = view.indexToX(Math.max(box.leftIndex, box.rightIndex));
  if (box.extend === 'left' || box.extend === 'both') left = Math.min(left, 0);
  if (box.extend === 'right' || box.extend === 'both') right = Math.max(right, view.width);
  const top = view.priceToY(Math.max(box.topPrice, box.bottomPrice));
  const bottom = view.priceToY(Math.min(box.topPrice, box.bottomPrice));
  if (right < 0 || left > view.width) return;
  if (isVisibleColor(box.fillColor)) {
    ctx.fillStyle = box.fillColor;
    ctx.fillRect(left, top, right - left, bottom - top);
  }
  if (isVisibleColor(box.borderColor) && box.borderWidth > 0) {
    ctx.strokeStyle = box.borderColor;
    ctx.lineWidth = box.borderWidth;
    ctx.setLineDash(dash(box.borderStyle, box.borderWidth));
    ctx.strokeRect(left, top, right - left, bottom - top);
    ctx.setLineDash([]);
  }
  if (!box.text || !isVisibleColor(box.textColor)) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, right - left, bottom - top);
  ctx.clip();
  const px = setFont(view, box.textSize);
  const height = blockHeight(box.text, px);
  fillLines(view, box.text, alignedX(box.textHalign, left + PADDING, right - PADDING), alignedY(box.textValign, top + PADDING, bottom - PADDING, height), px, box.textHalign, box.textColor);
  ctx.restore();
}

function roundedRect(ctx: CanvasRenderingContext2D, left: number, top: number, width: number, height: number, radius: number): void {
  ctx.moveTo(left + radius, top);
  ctx.arcTo(left + width, top, left + width, top + height, radius);
  ctx.arcTo(left + width, top + height, left, top + height, radius);
  ctx.arcTo(left, top + height, left, top, radius);
  ctx.arcTo(left, top, left + width, top, radius);
  ctx.closePath();
}

function labelAnchor(view: StudyView, label: StudyLabel): number {
  if (label.location === 'price') return view.priceToY(label.price);
  const bar = barAt(view, label.index);
  if (!bar) return view.priceToY(label.price);
  return label.location === 'aboveBar' ? view.priceToY(bar.high) - GAP : view.priceToY(bar.low) + GAP;
}

function paintLabel(view: StudyView, label: StudyLabel): void {
  const x = view.indexToX(label.index);
  if (x < -400 || x > view.width + 400) return;
  const y = labelAnchor(view, label);
  if (!Number.isFinite(y)) return;
  const px = setFont(view, label.size);
  const { style } = label;
  if (style === 'none') {
    if (label.text) fillLines(view, label.text, x, y - blockHeight(label.text, px) / 2, px, label.textAlign, label.textColor);
    return;
  }
  if (!style.startsWith('label')) {
    const size = shapeSizes[label.size];
    if (isVisibleColor(label.color)) paintShape(view, style as StudyShape, x, y, size, label.color);
    if (!label.text) return;
    const isBelow = style === 'triangleUp' || style === 'arrowUp';
    fillLines(view, label.text, x, isBelow ? y + size / 2 + GAP : y - size / 2 - GAP - blockHeight(label.text, px), px, 'center', label.textColor);
    return;
  }
  paintCallout(view, x, y, style, px, label.text, label.color, label.textColor, label.textAlign);
}

// A filled box holding the text, its pointer touching (x, y). The font must already be set.
function paintCallout(view: StudyView, x: number, y: number, style: StudyLabelStyle, px: number, text: string, color: string, textColor: string, align: StudyHorizontalAlign): void {
  const { ctx } = view;
  const height = text ? blockHeight(text, px) : 0;
  const boxWidth = (text ? textWidth(view, text) : 0) + PADDING * 3;
  const boxHeight = Math.max(height + PADDING * 2, px + PADDING * 2);
  let left = x - boxWidth / 2;
  let top = y - boxHeight / 2;
  // Each callout sits on the far side of its pointer.
  if (style === 'labelDown') top = y - POINTER - boxHeight;
  else if (style === 'labelUp') top = y + POINTER;
  else if (style === 'labelLeft') left = x + POINTER;
  else if (style === 'labelRight') left = x - POINTER - boxWidth;
  else if (style === 'labelUpperLeft') { left = x; top = y; }
  else if (style === 'labelUpperRight') { left = x - boxWidth; top = y; }
  else if (style === 'labelLowerLeft') { left = x; top = y - boxHeight; }
  else if (style === 'labelLowerRight') { left = x - boxWidth; top = y - boxHeight; }
  if (isVisibleColor(color)) {
    ctx.fillStyle = color;
    ctx.beginPath();
    roundedRect(ctx, left, top, boxWidth, boxHeight, 3);
    ctx.fill();
    ctx.beginPath();
    if (style === 'labelDown') { ctx.moveTo(x - POINTER, top + boxHeight); ctx.lineTo(x, y); ctx.lineTo(x + POINTER, top + boxHeight); }
    else if (style === 'labelUp') { ctx.moveTo(x - POINTER, top); ctx.lineTo(x, y); ctx.lineTo(x + POINTER, top); }
    else if (style === 'labelLeft') { ctx.moveTo(left, y - POINTER); ctx.lineTo(x, y); ctx.lineTo(left, y + POINTER); }
    else if (style === 'labelRight') { ctx.moveTo(left + boxWidth, y - POINTER); ctx.lineTo(x, y); ctx.lineTo(left + boxWidth, y + POINTER); }
    ctx.closePath();
    ctx.fill();
  }
  if (text) fillLines(view, text, alignedX(align, left + PADDING * 1.5, left + boxWidth - PADDING * 1.5), top + (boxHeight - height) / 2, px, align, textColor);
}

function paintPolyline(view: StudyView, polyline: StudyPolyline): void {
  const { ctx } = view;
  const points = polyline.points.map((point) => ({ x: view.indexToX(point.index), y: view.priceToY(point.price) })).filter((point) => Number.isFinite(point.y));
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  if (polyline.isCurved && points.length > 2) {
    // Catmull-Rom through every point, as cubic Bézier segments.
    const at = (index: number) => points[Math.max(0, Math.min(points.length - 1, index))];
    for (let index = 0; index < points.length - 1; index++) {
      const [p0, p1, p2, p3] = [at(index - 1), at(index), at(index + 1), at(index + 2)];
      ctx.bezierCurveTo(p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y);
    }
  } else for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  if (polyline.isClosed) ctx.closePath();
  if (isVisibleColor(polyline.fillColor)) {
    ctx.fillStyle = polyline.fillColor;
    ctx.fill();
  }
  if (isVisibleColor(polyline.lineColor) && polyline.lineWidth > 0) {
    ctx.strokeStyle = polyline.lineColor;
    ctx.lineWidth = polyline.lineWidth;
    ctx.setLineDash(dash(polyline.lineStyle, polyline.lineWidth));
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

// Pine's drawing order: polylines and fills, boxes, lines, then labels on top.
export function paintObjects(view: StudyView, objects: StudyObjects): void {
  for (const polyline of objects.polylines) paintPolyline(view, polyline);
  for (const box of objects.boxes) paintBox(view, box);
  for (const line of objects.lines) paintLine(view, line);
  for (const label of objects.labels) paintLabel(view, label);
}

export function paintTables(view: StudyView, tables: readonly StudyTable[]): void {
  for (const table of tables) paintTable(view, table);
}

function paintTable(view: StudyView, table: StudyTable): void {
  const { ctx } = view;
  const columnCount = Math.max(0, ...table.rows.map((row) => row.length));
  if (!table.rows.length || !columnCount) return;
  const columnWidths = new Array<number>(columnCount).fill(0);
  const rowHeights = new Array<number>(table.rows.length).fill(0);
  table.rows.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
    if (!cell) return;
    const px = setFont(view, cell.textSize);
    const width = cell.width > 0 ? (cell.width / 100) * view.width : textWidth(view, cell.text) + PADDING * 3;
    const height = cell.height > 0 ? (cell.height / 100) * view.height : blockHeight(cell.text || ' ', px) + PADDING * 2;
    columnWidths[columnIndex] = Math.max(columnWidths[columnIndex], width);
    rowHeights[rowIndex] = Math.max(rowHeights[rowIndex], height);
  }));
  const border = Math.max(0, table.borderWidth);
  const frame = Math.max(0, table.frameWidth);
  const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0) + border * (columnCount - 1) + frame * 2;
  const totalHeight = rowHeights.reduce((sum, height) => sum + height, 0) + border * (table.rows.length - 1) + frame * 2;
  const [vertical, horizontal] = table.position.split('-');
  const margin = 8;
  const left = horizontal === 'left' ? margin : horizontal === 'right' ? view.width - totalWidth - margin : (view.width - totalWidth) / 2;
  const top = vertical === 'top' ? view.top + margin : vertical === 'bottom' ? view.top + view.height - totalHeight - margin : view.top + (view.height - totalHeight) / 2;
  if (isVisibleColor(table.fillColor)) {
    ctx.fillStyle = table.fillColor;
    ctx.fillRect(left, top, totalWidth, totalHeight);
  }
  let y = top + frame;
  table.rows.forEach((row, rowIndex) => {
    let x = left + frame;
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex++) {
      const cell = row[columnIndex];
      const width = columnWidths[columnIndex];
      const height = rowHeights[rowIndex];
      if (cell && isVisibleColor(cell.fillColor)) {
        ctx.fillStyle = cell.fillColor;
        ctx.fillRect(x, y, width, height);
      }
      if (cell?.text && isVisibleColor(cell.textColor)) {
        const px = setFont(view, cell.textSize);
        const textHeight = blockHeight(cell.text, px);
        fillLines(view, cell.text, alignedX(cell.textHalign, x + PADDING * 1.5, x + width - PADDING * 1.5), alignedY(cell.textValign, y + PADDING, y + height - PADDING, textHeight), px, cell.textHalign, cell.textColor);
      }
      x += width + border;
    }
    y += rowHeights[rowIndex] + border;
  });
  if (isVisibleColor(table.borderColor) && border > 0) {
    ctx.fillStyle = table.borderColor;
    let x = left + frame;
    for (const width of columnWidths.slice(0, -1)) {
      x += width;
      ctx.fillRect(x, top + frame, border, totalHeight - frame * 2);
      x += border;
    }
    let lineY = top + frame;
    for (const height of rowHeights.slice(0, -1)) {
      lineY += height;
      ctx.fillRect(left + frame, lineY, totalWidth - frame * 2, border);
      lineY += border;
    }
  }
  if (isVisibleColor(table.frameColor) && frame > 0) {
    ctx.strokeStyle = table.frameColor;
    ctx.lineWidth = frame;
    ctx.strokeRect(left + frame / 2, top + frame / 2, totalWidth - frame, totalHeight - frame);
  }
}
