// Vertical geometry of one pane. In auto mode the range follows the visible data; dragging the
// axis switches to a manual range until the axis is double-clicked.
//
// The range (`min`, `max`) is kept in scale units: prices on a normal scale, log prices on a
// logarithmic one, percent change from `base` on a percent scale, and `base` = 100 on an indexed
// one. `priceToY` and `yToPrice` always take and return prices.

export type ScaleMode = 'normal' | 'log' | 'percent' | 'indexed';

export interface ScaleTick {
  price: number;
  label: string;
}

export class PriceScale {
  min = 0;
  max = 1;
  top = 0;
  height = 1;
  isAuto = true;
  isInverted = false;
  mode: ScaleMode = 'normal';
  // The reference price of percent and indexed scales: the first visible close.
  base = 1;
  margins = { top: 0.1, bottom: 0.1 };

  toScale(price: number): number {
    switch (this.mode) {
      case 'log': return Math.log(Math.max(price, 1e-12));
      case 'percent': return (price / this.base - 1) * 100;
      case 'indexed': return price / this.base * 100;
      default: return price;
    }
  }

  fromScale(value: number): number {
    switch (this.mode) {
      case 'log': return Math.exp(value);
      case 'percent': return (value / 100 + 1) * this.base;
      case 'indexed': return value / 100 * this.base;
      default: return value;
    }
  }

  priceToY(price: number): number {
    const span = this.max - this.min || 1;
    const ratio = (this.max - this.toScale(price)) / span;
    return this.top + (this.isInverted ? 1 - ratio : ratio) * this.height;
  }

  yToPrice(y: number): number {
    const span = this.max - this.min || 1;
    const ratio = (y - this.top) / this.height;
    return this.fromScale(this.max - (this.isInverted ? 1 - ratio : ratio) * span);
  }

  fit(low: number, high: number): void {
    if (!this.isAuto || !Number.isFinite(low) || !Number.isFinite(high)) return;
    if (this.mode === 'log') low = Math.max(low, high * 1e-6, 1e-12);
    let bottom = this.toScale(low);
    let top = this.toScale(high);
    if (top - bottom < Math.abs(top) * 1e-9 || top === bottom) {
      const pad = Math.abs(top) * 0.01 || 1;
      bottom -= pad;
      top += pad;
    }
    const usable = 1 - this.margins.top - this.margins.bottom;
    const total = (top - bottom) / usable;
    this.max = top + total * this.margins.top;
    this.min = this.max - total;
  }

  // Dragging the axis down stretches the range around its centre.
  stretch(factor: number): void {
    const centre = (this.max + this.min) / 2;
    const half = (this.max - this.min) / 2 * factor;
    this.min = centre - half;
    this.max = centre + half;
    this.isAuto = false;
  }

  shift(dy: number): void {
    const delta = dy / this.height * (this.max - this.min) * (this.isInverted ? -1 : 1);
    this.min += delta;
    this.max += delta;
    this.isAuto = false;
  }

  reset(): void {
    this.isAuto = true;
  }

  setMode(mode: ScaleMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.isAuto = true;
  }

  // Axis labels at round values in the scale's own units, positioned by price.
  ticks(formatPrice: (price: number) => string, minGap = 32): ScaleTick[] {
    if (this.mode === 'log') {
      const low = this.fromScale(this.min);
      const high = this.fromScale(this.max);
      const ticks: ScaleTick[] = [];
      let lastY = Infinity;
      for (const price of priceTicks(low, high, this.height, minGap / 2)) {
        const y = this.priceToY(price);
        if (Math.abs(lastY - y) < minGap * 0.8) continue;
        lastY = y;
        ticks.push({ price, label: formatPrice(price) });
      }
      return ticks;
    }
    return priceTicks(this.min, this.max, this.height, minGap).map((value) => ({ price: this.fromScale(value), label: this.label(value, formatPrice) }));
  }

  // A price as the axis shows it: a percent change, an index value, or the price itself.
  format(price: number, formatPrice: (price: number) => string): string {
    return this.label(this.toScale(price), formatPrice);
  }

  private label(value: number, formatPrice: (price: number) => string): string {
    if (this.mode === 'percent') return `${value >= 0 ? '' : '−'}${Math.abs(value).toFixed(2)}%`;
    if (this.mode === 'indexed') return value.toFixed(2);
    return formatPrice(this.fromScale(value));
  }
}

// Round steps for axis labels: 1, 2, 2.5 and 5 times a power of ten.
export function priceTicks(min: number, max: number, height: number, minGap = 32): number[] {
  const span = max - min;
  if (!(span > 0) || !(height > 0)) return [];
  const rough = span / Math.max(1, Math.floor(height / minGap));
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((multiple) => multiple * power).find((candidate) => candidate >= rough) ?? 10 * power;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks;
}
