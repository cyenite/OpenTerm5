import { timeUnits } from './timeframes';

// Horizontal geometry. Bars are placed by index ("logical" position), so market closures leave
// no gaps; times outside the loaded bars are extrapolated with the bar interval.

export class TimeScale {
  spacing = 8;
  // Logical index at the right edge of the plot.
  rightEdge = 0;
  width = 0;
  interval = 60_000;
  private times: number[] = [];
  readonly minSpacing = 0.5;
  rightMarginBars = 5;

  // As TradingView: zoomed in until two bars fill the plot.
  get maxSpacing(): number {
    return Math.max(this.minSpacing, this.width / 2);
  }

  get count(): number {
    return this.times.length;
  }

  get lastIndex(): number {
    return this.times.length - 1;
  }

  // `added` bars were prepended (older history); the view stays on the same bars.
  setTimes(times: number[], interval: number, added = 0): void {
    const isFirst = this.times.length === 0;
    this.times = times;
    this.interval = interval;
    if (isFirst) this.scrollToEnd();
    else this.rightEdge += added;
  }

  // A new bar arrived at the end; follow it when the latest bar was in view.
  append(time: number): void {
    const wasFollowing = this.rightEdge >= this.lastIndex;
    this.times.push(time);
    if (wasFollowing) this.rightEdge += 1;
  }

  indexToX(index: number): number {
    return this.width - (this.rightEdge - index) * this.spacing;
  }

  xToIndex(x: number): number {
    return this.rightEdge - (this.width - x) / this.spacing;
  }

  timeAt(index: number): number {
    const times = this.times;
    if (!times.length) return 0;
    if (index <= 0) return times[0] + index * this.interval;
    if (index >= times.length - 1) return times[times.length - 1] + (index - times.length + 1) * this.interval;
    const lower = Math.floor(index);
    return times[lower] + (index - lower) * (times[lower + 1] - times[lower]);
  }

  indexOf(time: number): number {
    const times = this.times;
    if (!times.length) return 0;
    if (time <= times[0]) return (time - times[0]) / this.interval;
    const last = times.length - 1;
    if (time >= times[last]) return last + (time - times[last]) / this.interval;
    let low = 0;
    let high = last;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (times[middle] <= time) low = middle;
      else high = middle;
    }
    return low + (time - times[low]) / (times[high] - times[low]);
  }

  timeToX(time: number): number {
    return this.indexToX(this.indexOf(time));
  }

  xToTime(x: number): number {
    return this.timeAt(this.xToIndex(x));
  }

  // The loaded bar whose span holds `time`, so another chart's time lands on this chart's own bar
  // whatever the intervals. A time in a market closure belongs to the first bar after it.
  barContaining(time: number): number | null {
    const times = this.times;
    const last = times.length - 1;
    if (last < 0 || time < times[0]) return null;
    // Calendar months outlast the nominal 30 days of a month interval.
    const span = this.interval >= 28 * timeUnits.DAY ? this.interval * 31 / 30 : this.interval;
    let low = 0;
    let high = last;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (times[middle] <= time) low = middle;
      else high = middle - 1;
    }
    if (time < times[low] + span) return low;
    return low === last ? null : low + 1;
  }

  // The bar index nearest to x, clamped to the loaded bars.
  barAt(x: number): number {
    return Math.max(0, Math.min(this.lastIndex, Math.round(this.xToIndex(x))));
  }

  visible(): { from: number; to: number } {
    return { from: Math.max(0, Math.floor(this.xToIndex(0))), to: Math.min(this.lastIndex, Math.ceil(this.rightEdge)) };
  }

  // Fits the logical range [from, to] into the width, within the spacing limits.
  fit(from: number, to: number): void {
    if (!(to > from)) return;
    this.spacing = Math.max(this.minSpacing, Math.min(this.maxSpacing, this.width / (to - from)));
    this.rightEdge = to;
    this.clamp();
  }

  centerOn(index: number): void {
    this.rightEdge = index + this.width / this.spacing / 2;
    this.clamp();
  }

  pan(dx: number): void {
    this.rightEdge -= dx / this.spacing;
    this.clamp();
  }

  zoom(factor: number, anchorX = this.width): void {
    const anchor = this.xToIndex(anchorX);
    this.spacing = Math.max(this.minSpacing, Math.min(this.maxSpacing, this.spacing * factor));
    this.rightEdge = anchor + (this.width - anchorX) / this.spacing;
    this.clamp();
  }

  // One wheel step, TradingView's way: `step` in [-1, 1] changes the spacing by up to a tenth, so a
  // burst of fast notches (or a large delta from a free-spinning wheel) cannot leap several zoom
  // levels at once.
  zoomStep(step: number, anchorX = this.width): void {
    const clamped = Math.max(-1, Math.min(1, step));
    this.zoom(1 + clamped / 10, anchorX);
  }

  scrollToEnd(): void {
    this.rightEdge = this.lastIndex + this.rightMarginBars;
  }

  isAtEnd(): boolean {
    return this.rightEdge >= this.lastIndex;
  }

  // Keeps at least a few bars on screen whichever way the chart is dragged.
  private clamp(): void {
    const visibleBars = this.width / this.spacing;
    const keep = Math.min(5, this.count);
    this.rightEdge = Math.max(keep - 1, Math.min(this.lastIndex + visibleBars - keep, this.rightEdge));
  }
}
