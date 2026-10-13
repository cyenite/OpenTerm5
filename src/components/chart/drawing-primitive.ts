import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, SeriesAttachedParameter } from 'lightweight-charts';
import { fibonacciLevels, rectangleBounds } from '../../lib/drawing-geometry';
import type { Drawing } from '../../lib/workspace';

export class DrawingPrimitive implements ISeriesPrimitive, IPrimitivePaneView, IPrimitivePaneRenderer {
  private color = '#e4b34c';
  private digits = 5;
  private drawings: readonly Drawing[] = [];
  private requestUpdate?: () => void;
  private readonly views: readonly IPrimitivePaneView[] = [this];

  constructor(private readonly x: (time: number) => number | null, private readonly y: (price: number) => number | null) {}

  attached(parameters: SeriesAttachedParameter): void { this.requestUpdate = parameters.requestUpdate; }
  detached(): void { this.requestUpdate = undefined; }
  paneViews(): readonly IPrimitivePaneView[] { return this.views; }
  renderer(): IPrimitivePaneRenderer { return this; }
  zOrder(): 'top' { return 'top'; }

  update(drawings: readonly Drawing[], color: string, digits: number): void {
    this.drawings = drawings;
    this.color = color;
    this.digits = digits;
    this.requestUpdate?.();
  }

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    target.useMediaCoordinateSpace(({ context, mediaSize }) => {
      context.save();
      context.strokeStyle = this.color;
      context.fillStyle = this.color;
      context.lineWidth = 1;
      context.font = '10px Tahoma, sans-serif';
      for (const drawing of this.drawings) {
        if (drawing.kind === 'vline') {
          const x = this.x(drawing.time);
          if (x === null) continue;
          context.beginPath(); context.moveTo(x, 0); context.lineTo(x, mediaSize.height); context.stroke();
        } else if (drawing.kind === 'ray') {
          const x = this.x(drawing.from.time);
          const y = this.y(drawing.from.price);
          if (x === null || y === null) continue;
          context.beginPath(); context.moveTo(x, y); context.lineTo(mediaSize.width, y); context.stroke();
        } else if (drawing.kind === 'rectangle') {
          const bounds = rectangleBounds(drawing.from, drawing.to);
          const left = this.x(bounds.startTime);
          const right = this.x(bounds.endTime);
          const top = this.y(bounds.highPrice);
          const bottom = this.y(bounds.lowPrice);
          if (left === null || right === null || top === null || bottom === null) continue;
          context.globalAlpha = 0.12;
          context.fillRect(left, top, right - left, bottom - top);
          context.globalAlpha = 1;
          context.strokeRect(left, top, right - left, bottom - top);
        } else if (drawing.kind === 'fibonacci') {
          const start = this.x(drawing.from.time);
          const end = this.x(drawing.to.time);
          const first = this.y(drawing.from.price);
          const last = this.y(drawing.to.price);
          if (start === null || end === null || first === null || last === null) continue;
          context.setLineDash([3, 3]);
          context.beginPath(); context.moveTo(start, first); context.lineTo(end, last); context.stroke();
          context.setLineDash([]);
          const left = Math.min(start, end);
          for (const level of fibonacciLevels(drawing.from, drawing.to)) {
            const y = this.y(level.price);
            if (y === null || y < 0 || y > mediaSize.height) continue;
            context.beginPath(); context.moveTo(left, y); context.lineTo(mediaSize.width, y); context.stroke();
            context.fillText(`${(level.ratio * 100).toFixed(1)}%  ${level.price.toFixed(this.digits)}`, Math.max(2, left + 4), y - 3);
          }
        }
      }
      context.restore();
    });
  }
}
