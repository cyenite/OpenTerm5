import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { AutoscaleInfo, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, Logical, SeriesAttachedParameter, Time, UTCTimestamp } from 'lightweight-charts';
import { ichimoku, type IchimokuResult, type RangeCandle, type ShiftedPoint } from '../../lib/indicators';

export class IchimokuCloud implements ISeriesPrimitive<Time>, IPrimitivePaneView, IPrimitivePaneRenderer {
  private data: IchimokuResult = { tenkan: [], kijun: [], chikou: [], spanA: [], spanB: [] };
  private attachment?: SeriesAttachedParameter<Time>;
  private startTime?: number;
  private readonly views = [this];

  constructor(private readonly periods: { tenkan: number; kijun: number; senkou: number }, private readonly colors: { upper: string; lower: string }) {}

  attached(attachment: SeriesAttachedParameter<Time>): void {
    this.attachment = attachment;
  }

  detached(): void {
    this.attachment = undefined;
  }

  update(candles: RangeCandle[]): void {
    this.startTime = candles[0]?.time;
    this.data = ichimoku(candles, this.periods.tenkan, this.periods.kijun, this.periods.senkou);
    this.attachment?.requestUpdate();
  }

  paneViews(): readonly IPrimitivePaneView[] { return this.views; }
  renderer(): IPrimitivePaneRenderer { return this; }
  zOrder(): 'bottom' { return 'bottom'; }

  autoscaleInfo(start: Logical, end: Logical): AutoscaleInfo | null {
    const origin = this.origin();
    if (origin === null) return null;
    const values = [...this.data.spanA, ...this.data.spanB].filter((point) => point.index + origin >= start && point.index + origin <= end).map((point) => point.value);
    return values.length ? { priceRange: { minValue: Math.min(...values), maxValue: Math.max(...values) } } : null;
  }

  valuesAt(time: number): { label: string; value: number }[] {
    const origin = this.origin();
    const logical = this.attachment?.chart.timeScale().timeToIndex(time as UTCTimestamp);
    if (origin === null || logical === undefined || logical === null) return [];
    const index = logical - origin;
    const label = `Ichimoku(${this.periods.tenkan},${this.periods.kijun},${this.periods.senkou})`;
    const upper = this.data.spanA.find((point) => point.index === index);
    const lower = this.data.spanB.find((point) => point.index === index);
    return [...(upper ? [{ label: `${label} Senkou A`, value: upper.value }] : []), ...(lower ? [{ label: `${label} Senkou B`, value: lower.value }] : [])];
  }

  draw(target: CanvasRenderingTarget2D): void {
    const origin = this.origin();
    const attachment = this.attachment;
    if (origin === null || !attachment) return;
    const position = (point: ShiftedPoint) => {
      const x = attachment.chart.timeScale().logicalToCoordinate((origin + point.index) as Logical);
      const y = attachment.series.priceToCoordinate(point.value);
      return x === null || y === null ? null : { x, y };
    };
    target.useMediaCoordinateSpace(({ context }) => {
      context.save();
      const lower = new Map(this.data.spanB.map((point) => [point.index, point]));
      for (let index = 1; index < this.data.spanA.length; index++) {
        const first = this.data.spanA[index - 1];
        const second = this.data.spanA[index];
        const firstLower = lower.get(first.index);
        const secondLower = lower.get(second.index);
        if (!firstLower || !secondLower) continue;
        const corners = [position(first), position(second), position(secondLower), position(firstLower)];
        if (corners.some((corner) => !corner)) continue;
        context.globalAlpha = 0.16;
        context.fillStyle = second.value >= secondLower.value ? this.colors.upper : this.colors.lower;
        context.beginPath();
        corners.forEach((corner, cursor) => cursor === 0 ? context.moveTo(corner!.x, corner!.y) : context.lineTo(corner!.x, corner!.y));
        context.closePath();
        context.fill();
      }
      context.globalAlpha = 1;
      for (const [points, color] of [[this.data.spanA, this.colors.upper], [this.data.spanB, this.colors.lower]] as const) {
        context.strokeStyle = color;
        context.lineWidth = 1;
        context.beginPath();
        let hasStarted = false;
        for (const point of points) {
          const coordinate = position(point);
          if (!coordinate) { hasStarted = false; continue; }
          if (hasStarted) context.lineTo(coordinate.x, coordinate.y);
          else context.moveTo(coordinate.x, coordinate.y);
          hasStarted = true;
        }
        context.stroke();
      }
      context.restore();
    });
  }

  private origin(): number | null {
    if (this.startTime === undefined || !this.attachment) return null;
    return this.attachment.chart.timeScale().timeToIndex(this.startTime as UTCTimestamp);
  }
}
