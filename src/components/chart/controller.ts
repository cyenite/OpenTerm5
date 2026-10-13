import {
  BarSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Bar } from '../../../shared/protocol';
import { ichimoku, parabolicSar, adxWilder, atr, cci, mfi, momentum, obv, roc, stochastic, williams, bollinger, describeIndicator, ema, indicatorKind, macd, rsi, sma, type IndicatorConfig, type Point } from '../../lib/indicators';
import type { ChartType, Drawing, Tool } from '../../lib/workspace';
import type { ChartTheme } from './theme';
import { IchimokuCloud } from './IchimokuCloud';
import { DrawingPrimitive } from './drawing-primitive';

export interface TradeLevel {
  label: string;
  price: number;
  kind: 'entry' | 'stop' | 'pending';
}

export interface Build {
  type: ChartType;
  theme: ChartTheme;
  digits: number;
  indicators: IndicatorConfig[];
  isVolumeShown: boolean;
}

export interface Pick {
  time: number;
  price: number;
}

export interface Hover {
  bar: Bar | null;
  values: { label: string; value: number }[];
}

interface IndicatorSeries {
  label: string;
  series: ISeriesApi<SeriesType>;
  compute: (bars: Bar[]) => Point[];
}

const asTime = (seconds: number) => seconds as UTCTimestamp;
const toLine = (points: Point[]) => points.map((point) => ({ time: asTime(point.time), value: point.value }));

export class ChartController {
  readonly chart: IChartApi;
  private bars: Bar[] = [];
  private main?: ISeriesApi<SeriesType>;
  private volumes?: ISeriesApi<'Histogram'>;
  private indicators: IndicatorSeries[] = [];
  private clouds: IchimokuCloud[] = [];
  private trendSeries: ISeriesApi<'Line'>[] = [];
  private levelLines: IPriceLine[] = [];
  private drawingLines: IPriceLine[] = [];
  private askLine?: IPriceLine;
  private build?: Build;
  private drawings: Drawing[] = [];
  private drawingPrimitive?: DrawingPrimitive;
  private levels: TradeLevel[] = [];
  private ask = 0;
  private tool: Tool = 'cursor';
  private pointerStart?: { x: number; y: number };

  constructor(private readonly container: HTMLElement, private readonly onPick: (pick: Pick) => void, private readonly onHover: (hover: Hover) => void) {
    this.chart = createChart(container, {
      autoSize: true,
      layout: { attributionLogo: false, fontFamily: 'Tahoma, Segoe UI, sans-serif', fontSize: 11 },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 8 },
      rightPriceScale: { scaleMargins: { top: 0.1, bottom: 0.1 } },
    });
    container.addEventListener('mousedown', this.handleDown, true);
    container.addEventListener('mouseup', this.handleUp, true);
    this.chart.subscribeCrosshairMove(this.handleMove);
  }

  destroy(): void {
    this.container.removeEventListener('mousedown', this.handleDown, true);
    this.container.removeEventListener('mouseup', this.handleUp, true);
    this.chart.unsubscribeCrosshairMove(this.handleMove);
    this.chart.remove();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.pointerStart = undefined;
    this.chart.applyOptions({ handleScroll: { pressedMouseMove: tool === 'cursor' || tool === 'crosshair' } });
    this.chart.applyOptions({ crosshair: { mode: tool === 'cursor' ? CrosshairMode.Hidden : CrosshairMode.Normal } });
  }

  priceToY(price: number): number | null {
    return this.main?.priceToCoordinate(price) ?? null;
  }

  yToPrice(y: number): number | null {
    return this.main?.coordinateToPrice(y) ?? null;
  }

  paneBox(): { width: number; height: number } {
    const pane = this.chart.paneSize(0);
    return { width: pane.width, height: pane.height };
  }

  // Line dragging owns the pointer; the chart must not pan or scale underneath it.
  setDragging(isDragging: boolean): void {
    const isPanTool = this.tool === 'cursor' || this.tool === 'crosshair';
    this.chart.applyOptions({ handleScroll: { pressedMouseMove: !isDragging && isPanTool }, handleScale: { axisPressedMouseMove: !isDragging } });
  }

  setGrid(isShown: boolean, theme: ChartTheme): void {
    const line = { color: theme.grid, style: LineStyle.Dotted, visible: isShown };
    this.chart.applyOptions({ grid: { vertLines: line, horzLines: line } });
  }

  zoom(factor: number): void {
    const spacing = this.chart.timeScale().options().barSpacing;
    this.chart.timeScale().applyOptions({ barSpacing: Math.min(60, Math.max(1, spacing * factor)) });
  }

  scrollToEnd(): void {
    this.chart.timeScale().scrollToRealTime();
  }

  rebuild(build: Build): void {
    const range = this.chart.timeScale().getVisibleLogicalRange();
    for (const series of [this.main, this.volumes, ...this.indicators.map((indicator) => indicator.series), ...this.trendSeries]) {
      if (series) {
        this.chart.removeSeries(series);
      }
    }
    this.indicators = [];
    this.clouds = [];
    this.trendSeries = [];
    this.levelLines = [];
    this.drawingLines = [];
    this.askLine = undefined;
    this.build = build;

    const { theme } = build;
    this.chart.applyOptions({
      layout: { background: { type: ColorType.Solid, color: theme.background }, textColor: theme.text, panes: { separatorColor: theme.grid } },
      rightPriceScale: { borderColor: theme.text },
      timeScale: { borderColor: theme.text },
      crosshair: { vertLine: { color: theme.text, labelBackgroundColor: theme.bidLine }, horzLine: { color: theme.text, labelBackgroundColor: theme.bidLine } },
    });
    const priceFormat = { type: 'price' as const, precision: build.digits, minMove: 10 ** -build.digits };
    const common = { priceFormat, priceLineColor: theme.bidLine, priceLineStyle: LineStyle.Solid };
    if (build.type === 'candles') {
      this.main = this.chart.addSeries(CandlestickSeries, {
        ...common,
        upColor: theme.candleBull,
        downColor: theme.candleBear,
        borderUpColor: theme.barUp,
        borderDownColor: theme.barDown,
        wickUpColor: theme.barUp,
        wickDownColor: theme.barDown,
      });
    } else if (build.type === 'bars') {
      this.main = this.chart.addSeries(BarSeries, { ...common, upColor: theme.barUp, downColor: theme.barDown, thinBars: true });
    } else {
      this.main = this.chart.addSeries(LineSeries, { ...common, color: theme.line, lineWidth: 1 });
    }
    if (build.isVolumeShown) {
      this.volumes = this.chart.addSeries(HistogramSeries, { color: theme.volumes, priceScaleId: 'volumes', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
      this.volumes.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    } else {
      this.volumes = undefined;
    }
    this.drawingPrimitive = new DrawingPrimitive((time) => this.chart.timeScale().timeToCoordinate(asTime(this.snap(time))), (price) => this.main?.priceToCoordinate(price) ?? null);
    this.main.attachPrimitive(this.drawingPrimitive);
    this.addIndicators(build);
    this.render();
    this.applyLevels();
    this.applyDrawings();
    if (range) {
      this.chart.timeScale().setVisibleLogicalRange(range as LogicalRange);
    }
  }

  private addIndicators(build: Build): void {
    let pane = 0;
    let color = 0;
    const next = () => build.theme.indicators[color++ % build.theme.indicators.length];
    const line = (paneIndex: number, lineColor: string, label: string, compute: (bars: Bar[]) => Point[], precision = build.digits) => {
      const series = this.chart.addSeries(
        LineSeries,
        { color: lineColor, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: false, priceFormat: { type: 'price', precision, minMove: 10 ** -precision } },
        paneIndex,
      );
      this.indicators.push({ label, series, compute });
    };
    for (const indicator of build.indicators) {
      const params = indicator.params as Record<string, number> & { isExponential?: boolean };
      const label = describeIndicator(indicator);
      const paneIndex = indicatorKind(indicator.kind).isOverlay ? 0 : ++pane;
      switch (indicator.kind) {
        case 'ma':
          line(paneIndex, next(), label, (bars) => (indicator.params.isExponential ? ema(bars, params.period) : sma(bars, params.period)));
          break;
        case 'bands': {
          const bandColor = next();
          line(paneIndex, bandColor, `${label} upper`, (bars) => bollinger(bars, params.period, params.deviations).upper);
          line(paneIndex, bandColor, `${label} middle`, (bars) => bollinger(bars, params.period, params.deviations).middle);
          line(paneIndex, bandColor, `${label} lower`, (bars) => bollinger(bars, params.period, params.deviations).lower);
          break;
        }
        case 'rsi':
          line(paneIndex, next(), label, (bars) => rsi(bars, params.period), 2);
          break;
        case 'ichimoku': {
          line(paneIndex, next(), `${label} Tenkan`, (bars) => ichimoku(bars, params.tenkan, params.kijun, params.senkou).tenkan);
          line(paneIndex, next(), `${label} Kijun`, (bars) => ichimoku(bars, params.tenkan, params.kijun, params.senkou).kijun);
          line(paneIndex, next(), `${label} Chikou (lagged close)`, (bars) => ichimoku(bars, params.tenkan, params.kijun, params.senkou).chikou);
          const cloud = new IchimokuCloud({ tenkan: params.tenkan, kijun: params.kijun, senkou: params.senkou }, { upper: next(), lower: next() });
          this.main!.attachPrimitive(cloud);
          this.clouds.push(cloud);
          break;
        }
        case 'sar': {
          const series = this.chart.addSeries(LineSeries, { color: next(), lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: 'price', precision: build.digits, minMove: 10 ** -build.digits } });
          this.indicators.push({ label, series, compute: (bars) => parabolicSar(bars, params.acceleration, params.maxAcceleration) });
          break;
        }
        case 'atr':
          line(paneIndex, next(), label, (bars) => atr(bars, params.period));
          break;
        case 'stochastic':
          line(paneIndex, next(), `${label} %K`, (bars) => stochastic(bars, params.period, params.slowing, params.signal).main, 2);
          line(paneIndex, next(), `${label} %D`, (bars) => stochastic(bars, params.period, params.slowing, params.signal).signal, 2);
          break;
        case 'cci':
          line(paneIndex, next(), label, (bars) => cci(bars, params.period), 2);
          break;
        case 'momentum':
          line(paneIndex, next(), label, (bars) => momentum(bars, params.period), 2);
          break;
        case 'roc':
          line(paneIndex, next(), label, (bars) => roc(bars, params.period), 2);
          break;
        case 'wpr':
          line(paneIndex, next(), label, (bars) => williams(bars, params.period), 2);
          break;
        case 'adxWilder':
          line(paneIndex, next(), `${label} ADX`, (bars) => adxWilder(bars, params.period).main, 2);
          line(paneIndex, next(), `${label} +DI`, (bars) => adxWilder(bars, params.period).plus, 2);
          line(paneIndex, next(), `${label} -DI`, (bars) => adxWilder(bars, params.period).minus, 2);
          break;
        case 'obv':
          line(paneIndex, next(), label, obv, 0);
          break;
        case 'mfi':
          line(paneIndex, next(), label, (bars) => mfi(bars, params.period), 2);
          break;
        case 'macd': {
          const histogram = this.chart.addSeries(
            HistogramSeries,
            { color: build.theme.bidLine, priceLineVisible: false, priceFormat: { type: 'price', precision: build.digits + 1, minMove: 10 ** -(build.digits + 1) } },
            paneIndex,
          );
          this.indicators.push({ label: `${label} main`, series: histogram, compute: (bars) => macd(bars, params.fast, params.slow, params.signal).main });
          line(paneIndex, build.theme.askLine, `${label} signal`, (bars) => macd(bars, params.fast, params.slow, params.signal).signal, build.digits + 1);
          break;
        }
      }
    }
    // Stretch factors, not pixel heights: setHeight before the first layout pass
    // collapses the main pane to zero in a chart that has not been sized yet.
    for (const [index, chartPane] of this.chart.panes().entries()) {
      chartPane.setStretchFactor(index === 0 ? 4 : 1);
    }
  }

  setBars(bars: Bar[]): void {
    const isFirstLoad = this.bars.length === 0;
    this.bars = bars;
    this.render();
    if (isFirstLoad) {
      this.chart.timeScale().scrollToRealTime();
    }
  }

  pushBar(bar: Bar): void {
    const last = this.bars.at(-1);
    if (last && bar.time < last.time) {
      return;
    }
    if (last && last.time === bar.time) {
      this.bars[this.bars.length - 1] = bar;
    } else {
      this.bars.push(bar);
    }
    this.main?.update(this.mainPoint(bar));
    this.volumes?.update({ time: asTime(bar.time), value: bar.volume });
    for (const indicator of this.indicators) {
      indicator.series.setData(toLine(indicator.compute(this.bars)));
    }
    for (const cloud of this.clouds) cloud.update(this.bars);
  }

  private mainPoint(bar: Bar) {
    const time = asTime(bar.time);
    return this.build?.type === 'line' ? { time, value: bar.close } : { time, open: bar.open, high: bar.high, low: bar.low, close: bar.close };
  }

  private render(): void {
    if (!this.main) {
      return;
    }
    this.main.setData(this.bars.map((bar) => this.mainPoint(bar)));
    this.volumes?.setData(this.bars.map((bar) => ({ time: asTime(bar.time), value: bar.volume })));
    for (const indicator of this.indicators) {
      indicator.series.setData(toLine(indicator.compute(this.bars)));
    }
    for (const cloud of this.clouds) cloud.update(this.bars);
    this.renderTrends();
  }

  screenshot(): HTMLCanvasElement { return this.chart.takeScreenshot(true, false); }

  setAsk(ask: number): void {
    this.ask = ask;
    if (!this.main || !this.build) {
      return;
    }
    if (!ask) {
      return;
    }
    if (this.askLine) {
      this.askLine.applyOptions({ price: ask });
    } else {
      this.askLine = this.main.createPriceLine({ price: ask, color: this.build.theme.askLine, lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '' });
    }
  }

  setLevels(levels: TradeLevel[]): void {
    this.levels = levels;
    this.applyLevels();
  }

  private applyLevels(): void {
    if (!this.main || !this.build) {
      return;
    }
    for (const line of this.levelLines) {
      this.main.removePriceLine(line);
    }
    const { theme } = this.build;
    this.levelLines = this.levels.map((level) =>
      this.main!.createPriceLine({
        price: level.price,
        title: level.label,
        color: level.kind === 'stop' ? theme.stopLevel : theme.tradeLevel,
        lineWidth: 1,
        lineStyle: level.kind === 'entry' ? LineStyle.Dashed : LineStyle.Dotted,
        axisLabelVisible: true,
      }),
    );
    this.setAsk(this.ask);
  }

  setDrawings(drawings: Drawing[]): void {
    this.drawings = drawings;
    this.applyDrawings();
  }

  private applyDrawings(): void {
    if (!this.main || !this.build) {
      return;
    }
    for (const line of this.drawingLines) {
      this.main.removePriceLine(line);
    }
    this.drawingLines = this.drawings
      .filter((drawing) => drawing.kind === 'hline')
      .map((drawing) => this.main!.createPriceLine({ price: drawing.price, color: this.build!.theme.indicators[0], lineWidth: 1, lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '' }));
    this.drawingPrimitive?.update(this.drawings, this.build.theme.indicators[0], this.build.digits);
    this.renderTrends();
  }

  private snap(time: number): number {
    let best = this.bars[0]?.time ?? time;
    for (const bar of this.bars) {
      if (bar.time > time) {
        break;
      }
      best = bar.time;
    }
    return best;
  }

  private renderTrends(): void {
    if (!this.build) {
      return;
    }
    const trends = this.drawings.filter((drawing): drawing is Extract<Drawing, { from: unknown; to: unknown }> => drawing.kind === 'trend');
    while (this.trendSeries.length > trends.length) {
      this.chart.removeSeries(this.trendSeries.pop()!);
    }
    while (this.trendSeries.length < trends.length) {
      this.trendSeries.push(this.chart.addSeries(LineSeries, { color: this.build.theme.indicators[0], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }));
    }
    if (this.bars.length === 0) {
      return;
    }
    trends.forEach((trend, index) => {
      const start = { time: this.snap(trend.from.time), value: trend.from.price };
      const end = { time: this.snap(trend.to.time), value: trend.to.price };
      const ordered = start.time <= end.time ? [start, end] : [end, start];
      const points = ordered[0].time === ordered[1].time ? [ordered[0]] : ordered;
      this.trendSeries[index].setData(points.map((point) => ({ time: asTime(point.time), value: point.value })));
    });
  }

  private handleDown = (event: MouseEvent): void => {
    if (event.button === 0) this.pointerStart = { x: event.clientX, y: event.clientY };
  };

  private handleUp = (event: MouseEvent): void => {
    const start = this.pointerStart;
    this.pointerStart = undefined;
    if (!start || event.button !== 0 || this.tool === 'cursor' || this.tool === 'crosshair' || !this.main || Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y) > 5) return;
    const bounds = this.container.getBoundingClientRect();
    const pane = this.chart.paneSize(0);
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (x < 0 || y < 0 || x > pane.width || y > pane.height) return;
    const time = this.chart.timeScale().coordinateToTime(x);
    const price = this.main.coordinateToPrice(y);
    if (typeof time === 'number' && price !== null) this.onPick({ time, price });
  };

  private handleMove = (param: MouseEventParams<Time>): void => {
    if (param.time === undefined) {
      this.onHover({ bar: null, values: [] });
      return;
    }
    const time = param.time as number;
    const bar = this.bars.find((candidate) => candidate.time === time) ?? null;
    const values = this.indicators.flatMap((indicator) => {
      const point = param.seriesData.get(indicator.series) as { value?: number } | undefined;
      return point?.value === undefined ? [] : [{ label: indicator.label, value: point.value }];
    });
    this.onHover({ bar, values: [...values, ...this.clouds.flatMap((cloud) => cloud.valuesAt(time))] });
  };
}
