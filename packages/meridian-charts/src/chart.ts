import { formatCountdown, formatCrosshairTime, formatDuration, formatPrice, formatValue, precisionOf } from './core/format';
import { PriceScale, type ScaleMode } from './core/price-scale';
import { TimeScale } from './core/time-scale';
import { timeTicks } from './core/time-ticks';
import { timeframeMs, timeUnits } from './core/timeframes';
import { drawingToolInfo } from './drawings/catalogue';
import { applyDrawingFields, drawingFields, isShownOn } from './drawings/settings';
import { hitShape, paintShapes, ShapeList, type Pt } from './drawings/shapes';
import { styleFor, toolDefinitions, type CreateEnv, type ToolDefinition, type ToolEnv } from './drawings/tools';
import { applySettingsFields, defaultSettings, restoreSettings, settingsFields, type ChartSettings } from './settings';
import { getStudy, resolveInputs, studyCaption } from './studies/registry';
import type { MeridianTheme } from './themes';
import type { Bar, DataProvider, DrawingPoint, InputValue, PriceStyle, SerializedDrawing, StudyDefinition, StudyOutput } from './types';
import { openDialog, type Field } from './ui/dialog';
import { Legend, type LegendEntry, type LegendValue } from './ui/legend';
import { openMenu, separator, type MenuEntry } from './ui/menu';
import { ObjectTree } from './ui/object-tree';
import { ReplayBar } from './ui/replay-bar';
import { StyleBar } from './ui/stylebar';
import { ensureStyles, element } from './ui/styles';
import { DrawingToolbar, type CursorMode, type MagnetMode } from './ui/toolbar';

export interface MeridianChartOptions {
  symbol: string;
  timeframe: string;
  provider: DataProvider;
  theme: MeridianTheme;
  // Shown at the start of the legend, for example "EURUSD · H1".
  title?: string;
  priceStyle?: PriceStyle;
  isGridShown?: boolean;
  isVolumeShown?: boolean;
  isDrawingToolbarShown?: boolean;
  // Price decimals; without them the chart uses the provider's tick size.
  digits?: number;
  // Bars loaded at first, and how many more each time the oldest loaded bar scrolls into view.
  historyBars?: number;
  // The deepest history the chart will page back to.
  maxHistoryBars?: number;
  // Saved Chart Settings; anything missing or invalid takes its default.
  settings?: unknown;
  // Faint text behind the bars; defaults to the title.
  watermark?: string;
}

export interface MeridianPriceLine {
  id: string;
  price: number;
  color: string;
  style?: 'solid' | 'dashed' | 'dotted';
  // Shown on the line at the left of the plot, for example "Alert" or "TP".
  label?: string;
}

// Where the user right-clicked, for host entries in the chart's context menu.
export interface MeridianContextInfo {
  price: number | null;
  time: number | null;
}

export type { ChartSettings, MenuEntry, ScaleMode };

interface Snapshot {
  drawings: SerializedDrawing[];
  studies: { id: string; type: string; inputs: Record<string, InputValue>; isVisible: boolean }[];
}

interface Replay {
  // Bars from the first one up to `cutoff` are shown.
  cutoff: number;
  isSelecting: boolean;
  isPlaying: boolean;
  speed: number;
  timer: ReturnType<typeof setInterval> | null;
  // The full series, kept while the replay hides the later bars.
  bars: Bar[];
}

export interface MeridianIndicator {
  id: string;
  type: string;
  title: string;
  inputs: Record<string, InputValue>;
}

export interface ReadoutRow {
  label: string;
  value: string;
  color: string;
}

export interface MeridianHover {
  // Opening time of the bar under the pointer (epoch ms), or null off the bars.
  time: number | null;
  ohlc: Bar | null;
  readout: { groups: { name: string; rows: ReadoutRow[] }[] } | null;
}

export interface PlotBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Pane {
  id: string;
  weight: number;
  scale: PriceScale;
  top: number;
  height: number;
  legend: Legend;
}

interface StudyState {
  id: string;
  definition: StudyDefinition;
  inputs: Record<string, InputValue>;
  isVisible: boolean;
  paneId: string;
  output: StudyOutput | null;
}

interface Draft {
  type: string;
  definition: ToolDefinition;
  anchors: DrawingPoint[];
}

type Drag =
  | { kind: 'pan'; lastX: number; lastY: number; pane: Pane }
  | { kind: 'price-axis'; pane: Pane; lastY: number }
  | { kind: 'time-axis'; lastX: number }
  | { kind: 'separator'; upper: Pane; lower: Pane; lastY: number }
  | { kind: 'move'; id: string; origin: { index: number; price: number }; anchors: DrawingPoint[]; hasMoved: boolean }
  | { kind: 'anchor'; id: string; index: number }
  | { kind: 'place'; startX: number; startY: number; hasMoved: boolean }
  | { kind: 'freehand' }
  | { kind: 'zoom'; start: Pt; current: Pt };

const TIME_AXIS_HEIGHT = 28;
const RAIL_WIDTH = 52;
const HANDLE_RADIUS = 5;
const HIT_TOLERANCE = 5;
const MEASURE = 'measure';
const ZOOM = 'zoom-in';
const FAVORITES_KEY = 'meridian.drawing-favorites';
const HISTORY_LIMIT = 100;

let nextChartId = 0;

// Copied drawings, shared by every chart in the window so they can be pasted into another.
let clipboard: SerializedDrawing[] = [];

// Alt shortcuts for the common tools, by physical key.
const toolShortcuts: Readonly<Record<string, string>> = {
  KeyT: 'trend-line',
  KeyH: 'horizontal-line',
  KeyJ: 'horizontal-ray',
  KeyV: 'vertical-line',
  KeyC: 'cross-line',
  KeyF: 'fib-retracement',
};

const scaleModeLabels: readonly { mode: ScaleMode; label: string; shortcut?: string }[] = [
  { mode: 'normal', label: 'Regular' },
  { mode: 'percent', label: 'Percent', shortcut: 'Alt+P' },
  { mode: 'indexed', label: 'Indexed to 100' },
  { mode: 'log', label: 'Logarithmic', shortcut: 'Alt+L' },
];

function loadFavorites(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]') as unknown;
    return Array.isArray(stored) ? stored.filter((type): type is string => typeof type === 'string' && drawingToolInfo.has(type)) : [];
  } catch {
    return [];
  }
}

function heikinAshi(bars: readonly Bar[]): Bar[] {
  const result: Bar[] = [];
  for (const bar of bars) {
    const previous = result[result.length - 1];
    const close = (bar.open + bar.high + bar.low + bar.close) / 4;
    const open = previous ? (previous.open + previous.close) / 2 : (bar.open + bar.close) / 2;
    result.push({ time: bar.time, open, close, high: Math.max(bar.high, open, close), low: Math.min(bar.low, open, close), volume: bar.volume });
  }
  return result;
}

const dashOf = (style: MeridianPriceLine['style']) => (style === 'dashed' ? [6, 4] : style === 'dotted' ? [1, 3] : []);

// A financial chart: candles and other price styles, studies in their own panes, drawings, a
// crosshair and axes, fed by a DataProvider. Everything is drawn on one canvas; the toolbar,
// legend and dialogs are DOM around it.
export class MeridianChart {
  private readonly id = `meridian-${++nextChartId}`;
  private readonly root: HTMLElement;
  private readonly main: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly toolbar: DrawingToolbar;
  private readonly styleBar: StyleBar;
  private readonly resizeObserver: ResizeObserver;
  private readonly timeScale = new TimeScale();
  private readonly provider: DataProvider;
  private readonly pageBars: number;
  private readonly maxBars: number;
  private symbol: string;
  private timeframe: string;
  private title: string;
  private interval: number;
  private theme: MeridianTheme;
  private priceStyle: PriceStyle;
  private isGridShown: boolean;
  private isVolumeShown: boolean;
  private digits: number | null;
  private precision = 5;
  private barList: Bar[] = [];
  private displayBars: Bar[] = [];
  private panes: Pane[] = [];
  private studies: StudyState[] = [];
  private drawingList: SerializedDrawing[] = [];
  private priceLines: MeridianPriceLine[] = [];
  private selectedId: string | null = null;
  private tool: string | null = null;
  private cursorMode: CursorMode = 'cross';
  private magnet: MagnetMode = 'off';
  private isStayMode = false;
  private isLocked = false;
  private isHidden = false;
  private favorites = loadFavorites();
  private draft: Draft | null = null;
  private drag: Drag | null = null;
  private hover: Pt | null = null;
  private isCtrlDown = false;
  private width = 0;
  private height = 0;
  private plotWidth = 0;
  private axisWidth = 64;
  private ratio = 1;
  private frame = 0;
  private generation = 0;
  private depth: number;
  private isPaging = false;
  private isHistoryExhausted = false;
  private unsubscribe: (() => void) | null = null;
  private countdownTimer: ReturnType<typeof setInterval>;
  private readyPromise: Promise<void>;
  private closeDialog: (() => void) | null = null;
  private closeMenu: (() => void) | null = null;
  private seq = 0;
  private chartSettings: ChartSettings;
  private watermark: string | null;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private dragBefore: Snapshot | null = null;
  private replay: Replay | null = null;
  private readonly replayBar: ReplayBar;
  private objectTree: ObjectTree | null = null;
  private textEditor: HTMLTextAreaElement | null = null;
  private externalTime: number | null = null;
  private contextHandlers = new Set<(info: MeridianContextInfo, event: MouseEvent) => boolean>();
  private readonly listeners = {
    hover: new Set<(hover: MeridianHover) => void>(),
    indicators: new Set<() => void>(),
    drawings: new Set<() => void>(),
    tool: new Set<(type: string | null) => void>(),
    settings: new Set<() => void>(),
    history: new Set<() => void>(),
    replay: new Set<() => void>(),
    objectTree: new Set<() => void>(),
  };

  constructor(container: HTMLElement, options: MeridianChartOptions) {
    ensureStyles(container.ownerDocument);
    this.provider = options.provider;
    this.symbol = options.symbol;
    this.timeframe = options.timeframe;
    this.interval = timeframeMs(options.timeframe);
    this.title = options.title ?? options.symbol;
    this.theme = options.theme;
    this.priceStyle = options.priceStyle ?? 'candles';
    this.isGridShown = options.isGridShown ?? true;
    this.isVolumeShown = options.isVolumeShown ?? false;
    this.digits = options.digits ?? null;
    if (this.digits !== null) this.precision = this.digits;
    this.pageBars = options.historyBars ?? 2000;
    this.maxBars = options.maxHistoryBars ?? 20000;
    this.depth = this.pageBars;
    this.chartSettings = restoreSettings(options.settings);
    this.watermark = options.watermark ?? null;

    this.root = element('div', 'mc-root', container);
    this.root.dataset.meridianChart = this.id;
    this.main = element('div', 'mc-main', this.root);
    this.main.tabIndex = 0;
    this.main.setAttribute('role', 'application');
    this.main.setAttribute('aria-label', 'Price chart. Drag to scroll, use the mouse wheel or plus and minus to zoom.');
    this.canvas = element('canvas', 'mc-canvas', this.main);
    this.context = this.canvas.getContext('2d')!;
    this.panes = [this.makePane('price', 3)];

    this.toolbar = new DrawingToolbar(this.root, this.main, {
      selectTool: (type) => this.applyTool(type, true),
      selectCursor: (mode) => { this.cursorMode = mode; this.applyTool(null, true); },
      setMagnet: (mode) => { this.magnet = mode; this.syncToolbar(); },
      toggleStayMode: () => { this.isStayMode = !this.isStayMode; this.syncToolbar(); },
      toggleLock: () => { this.isLocked = !this.isLocked; this.syncToolbar(); },
      toggleHidden: () => { this.isHidden = !this.isHidden; this.select(null); this.syncToolbar(); this.invalidate(); },
      toggleFavorite: (type) => {
        this.favorites = this.favorites.includes(type) ? this.favorites.filter((candidate) => candidate !== type) : [...this.favorites, type];
        try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(this.favorites)); } catch { /* Favourites then last for this session. */ }
        this.syncToolbar();
      },
      removeDrawings: () => this.removeAllDrawings(),
      removeStudies: () => this.removeAllStudies(),
      toggleObjectTree: () => this.toggleObjectTree(),
    }, this.toolbarState());
    this.toolbar.setVisible(options.isDrawingToolbarShown ?? false);
    this.styleBar = new StyleBar(this.main, {
      setStyle: (patch) => this.patchSelected({ style: { ...this.selected()!.style, ...patch } }),
      openSettings: () => this.openDrawingSettings(this.selectedId!),
      toggleLock: () => this.patchSelected({ locked: !this.selected()!.locked }),
      clone: () => this.cloneSelected(),
      remove: () => this.removeSelected(),
    });
    this.replayBar = new ReplayBar(this.main, {
      togglePlay: () => this.toggleReplayPlay(),
      step: () => this.stepReplay(),
      restart: () => this.startReplay(),
      setSpeed: (speed) => this.setReplaySpeed(speed),
      exit: () => this.exitReplay(),
    });

    this.applyScaleSettings();
    this.applyThemeVariables();
    this.layoutRail();
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
    this.canvas.addEventListener('contextmenu', this.onCanvasMenu);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.main.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.root);
    this.countdownTimer = setInterval(() => { if (this.barList.length && this.interval < timeUnits.DAY) this.invalidate(); }, 1000);
    this.resize();
    this.readyPromise = this.load();
  }

  destroy(): void {
    this.generation++;
    cancelAnimationFrame(this.frame);
    clearInterval(this.countdownTimer);
    this.unsubscribe?.();
    this.closeDialog?.();
    this.closeMenu?.();
    this.stopReplayTimer();
    this.resizeObserver.disconnect();
    window.removeEventListener('keyup', this.onKeyUp);
    this.toolbar.destroy();
    this.styleBar.destroy();
    this.replayBar.destroy();
    this.objectTree?.destroy();
    for (const pane of this.panes) pane.legend.destroy();
    this.root.remove();
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  // ── Market and appearance ───────────────────────────────────────────────

  setMarket(symbol: string, timeframe: string, title?: string): Promise<void> {
    if (this.replay) this.endReplay();
    this.symbol = symbol;
    this.timeframe = timeframe;
    this.interval = timeframeMs(timeframe);
    if (title) this.title = title;
    this.depth = this.pageBars;
    this.isHistoryExhausted = false;
    this.barList = [];
    this.displayBars = [];
    this.timeScale.setTimes([], this.interval);
    this.readyPromise = this.load();
    return this.readyPromise;
  }

  setTitle(title: string): void {
    this.title = title;
    this.invalidate();
  }

  setTheme(theme: MeridianTheme): void {
    this.theme = theme;
    this.applyThemeVariables();
    this.invalidate();
  }

  setPriceStyle(style: PriceStyle): void {
    this.priceStyle = style;
    this.updateDisplayBars();
    this.invalidate();
  }

  setGrid(isShown: boolean): void {
    this.isGridShown = isShown;
    this.invalidate();
  }

  setVolume(isShown: boolean): void {
    this.isVolumeShown = isShown;
    this.invalidate();
  }

  setDigits(digits: number): void {
    this.digits = digits;
    this.precision = digits;
    this.invalidate();
  }

  setDrawingToolbar(isShown: boolean): void {
    this.toolbar.setVisible(isShown);
    this.layoutRail();
    this.resize();
  }

  zoom(factor: number): void {
    if (factor > 0) this.timeScale.zoom(factor);
    this.invalidate();
  }

  scrollToEnd(): void {
    this.timeScale.scrollToEnd();
    for (const pane of this.panes) pane.scale.reset();
    this.invalidate();
  }

  setPriceLines(lines: MeridianPriceLine[]): void {
    this.priceLines = lines;
    this.invalidate();
  }

  setWatermark(text: string | null): void {
    this.watermark = text;
    this.invalidate();
  }

  // ── Chart settings and scales ───────────────────────────────────────────

  settings(): ChartSettings {
    return { ...this.chartSettings };
  }

  setSettings(settings: Partial<ChartSettings>): void {
    this.chartSettings = restoreSettings({ ...this.chartSettings, ...settings });
    this.applyScaleSettings();
    this.applyThemeVariables();
    this.updateLegends();
    this.listeners.settings.forEach((listener) => listener());
    this.invalidate();
  }

  onSettingsChange(listener: () => void): () => void {
    this.listeners.settings.add(listener);
    return () => this.listeners.settings.delete(listener);
  }

  openChartSettings(): void {
    this.closeDialog?.();
    this.closeDialog = openDialog(this.root, {
      title: 'Chart settings',
      fields: settingsFields(this.chartSettings, this.theme),
      onApply: (values) => this.setSettings(applySettingsFields(values, this.theme)),
      onDefaults: () => Object.fromEntries(settingsFields(defaultSettings, this.theme).map((field) => [field.key, field.value as never])),
    });
  }

  setScaleMode(mode: ScaleMode): void {
    this.setSettings({ scaleMode: mode });
  }

  // Back to the latest bars with every scale fitting its data.
  resetView(): void {
    this.timeScale.spacing = 8;
    this.scrollToEnd();
  }

  // ── Crosshair sync ──────────────────────────────────────────────────────

  // Shows a vertical crosshair at `time` while the pointer is elsewhere, so linked charts follow
  // each other. Null clears it.
  setCrosshairTime(time: number | null): void {
    if (time === this.externalTime) return;
    this.externalTime = time;
    this.invalidate();
  }

  // ── Context menu ────────────────────────────────────────────────────────

  // Lets the host show its own menu for a right-click on the plot (not on a drawing or an axis).
  // A handler returning true replaces the chart's menu.
  onContextMenu(handler: (info: MeridianContextInfo, event: MouseEvent) => boolean): () => void {
    this.contextHandlers.add(handler);
    return () => this.contextHandlers.delete(handler);
  }

  // ── Undo and redo ───────────────────────────────────────────────────────

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(this.snapshot());
    this.restore(previous);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.snapshot());
    this.restore(next);
  }

  // Forgets the undo history, for example after the host restores a saved chart.
  clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.listeners.history.forEach((listener) => listener());
  }

  onHistoryChange(listener: () => void): () => void {
    this.listeners.history.add(listener);
    return () => this.listeners.history.delete(listener);
  }

  // ── Clipboard ───────────────────────────────────────────────────────────

  copySelection(): boolean {
    const drawing = this.selected();
    if (!drawing) return false;
    clipboard = [structuredClone(drawing)];
    return true;
  }

  canPaste(): boolean {
    return clipboard.length > 0;
  }

  paste(): void {
    if (!clipboard.length) return;
    this.checkpoint();
    let top = this.topZ();
    const pasted = clipboard.map((drawing) => {
      // A copy pasted over its original is nudged so both stay visible.
      const isOverOriginal = this.drawingList.some((candidate) => JSON.stringify(candidate.anchors) === JSON.stringify(drawing.anchors));
      const shift = isOverOriginal ? Math.max(1, Math.round(20 / this.timeScale.spacing)) : 0;
      return {
        ...structuredClone(drawing),
        id: this.newDrawingId(),
        anchors: drawing.anchors.map((anchor) => ({ time: shift ? this.timeScale.timeAt(this.timeScale.indexOf(anchor.time) + shift) : anchor.time, price: anchor.price })),
        locked: false,
        zIndex: ++top,
        createdAt: Date.now(),
      };
    });
    this.drawingList.push(...pasted);
    clipboard = pasted.map((drawing) => structuredClone(drawing));
    this.select(pasted[pasted.length - 1].id);
    this.emit('drawings');
  }

  // ── Object tree ─────────────────────────────────────────────────────────

  isObjectTreeShown(): boolean {
    return this.objectTree !== null;
  }

  toggleObjectTree(isShown = !this.objectTree): void {
    if (isShown === !!this.objectTree) return;
    if (isShown) {
      this.objectTree = new ObjectTree(this.root, {
        close: () => this.toggleObjectTree(false),
        select: (kind, id) => { if (kind === 'drawing') this.select(id); },
        openSettings: (kind, id) => (kind === 'drawing' ? this.openDrawingSettings(id) : this.openIndicatorSettings(id)),
        toggleVisible: (kind, id) => (kind === 'drawing' ? this.patchDrawing(id, (drawing) => ({ visible: !drawing.visible })) : this.toggleStudy(id)),
        toggleLock: (id) => this.patchDrawing(id, (drawing) => ({ locked: !drawing.locked })),
        remove: (kind, id) => (kind === 'drawing' ? this.removeDrawing(id) : this.removeIndicator(id)),
      });
      this.refreshTree();
    } else {
      this.objectTree?.destroy();
      this.objectTree = null;
    }
    this.syncToolbar();
    this.listeners.objectTree.forEach((listener) => listener());
  }

  onObjectTreeChange(listener: () => void): () => void {
    this.listeners.objectTree.add(listener);
    return () => this.listeners.objectTree.delete(listener);
  }

  // ── Bar replay ──────────────────────────────────────────────────────────

  isReplaying(): boolean {
    return this.replay !== null;
  }

  // Enters replay and waits for a click on the bar to start from; while replaying this starts
  // over from a new bar.
  startReplay(): void {
    if (!this.barList.length && !this.replay) return;
    this.stopReplayTimer();
    if (this.replay) {
      this.replay.isSelecting = true;
      this.replay.isPlaying = false;
    } else {
      this.replay = { cutoff: this.barList.length, isSelecting: true, isPlaying: false, speed: 1, timer: null, bars: this.barList };
      this.applyTool(null, true);
      this.listeners.replay.forEach((listener) => listener());
    }
    this.syncReplayBar();
    this.invalidate();
  }

  exitReplay(): void {
    if (!this.replay) return;
    this.endReplay();
    this.scrollToEnd();
  }

  onReplayChange(listener: () => void): () => void {
    this.listeners.replay.add(listener);
    return () => this.listeners.replay.delete(listener);
  }

  // The chart as an image, with its legend title.
  screenshot(): HTMLCanvasElement | null {
    this.render();
    const copy = document.createElement('canvas');
    copy.width = this.canvas.width;
    copy.height = this.canvas.height;
    const context = copy.getContext('2d');
    if (!context) return null;
    context.drawImage(this.canvas, 0, 0);
    context.scale(this.ratio, this.ratio);
    context.font = `600 13px ${this.theme.chart.fontFamily}`;
    context.fillStyle = this.theme.chart.text;
    context.textBaseline = 'top';
    context.fillText(this.title, 12, 10);
    return copy;
  }

  // ── Projection for host overlays (container coordinates) ────────────────

  priceToY(price: number): number | null {
    const pane = this.panes[0];
    return this.plotWidth > 0 && Number.isFinite(price) ? pane.scale.priceToY(price) : null;
  }

  yToPrice(y: number): number | null {
    return this.plotWidth > 0 ? this.panes[0].scale.yToPrice(y) : null;
  }

  plotBox(): PlotBox {
    const pane = this.panes[0];
    return { left: this.railOffset(), top: pane.top, width: this.plotWidth, height: pane.height };
  }

  bars(): readonly Bar[] {
    return this.barList;
  }

  onHover(listener: (hover: MeridianHover) => void): () => void {
    this.listeners.hover.add(listener);
    return () => this.listeners.hover.delete(listener);
  }

  // ── Studies ─────────────────────────────────────────────────────────────

  indicators(): MeridianIndicator[] {
    return this.studies.map((study) => ({ id: study.id, type: study.definition.type, title: study.definition.title, inputs: { ...study.inputs } }));
  }

  addIndicator(type: string, inputs?: Record<string, InputValue>): MeridianIndicator | null {
    if (!getStudy(type)) return null;
    this.checkpoint();
    const study = this.addStudy(type, inputs, `study-${++this.seq}`, true)!;
    this.emit('indicators');
    this.resize();
    return { id: study.id, type, title: study.definition.title, inputs: { ...study.inputs } };
  }

  removeIndicator(id: string): void {
    if (!this.studies.some((candidate) => candidate.id === id)) return;
    this.checkpoint();
    this.removeStudy(id);
    this.emit('indicators');
    this.resize();
  }

  private addStudy(type: string, inputs: Record<string, InputValue> | undefined, id: string, isVisible: boolean): StudyState | null {
    const definition = getStudy(type);
    if (!definition) return null;
    let paneId = 'price';
    if (!definition.overlay) {
      paneId = `pane-${id}`;
      this.panes.push(this.makePane(paneId, 1));
    }
    const study: StudyState = { id, definition, inputs: resolveInputs(definition, inputs), isVisible, paneId, output: null };
    this.compute(study);
    this.studies.push(study);
    return study;
  }

  private removeStudy(id: string): void {
    const study = this.studies.find((candidate) => candidate.id === id);
    if (!study) return;
    this.studies = this.studies.filter((candidate) => candidate !== study);
    if (study.paneId !== 'price' && !this.studies.some((candidate) => candidate.paneId === study.paneId)) {
      const pane = this.panes.find((candidate) => candidate.id === study.paneId);
      pane?.legend.destroy();
      this.panes = this.panes.filter((candidate) => candidate !== pane);
    }
  }

  private removeAllStudies(): void {
    if (!this.studies.length) return;
    this.checkpoint();
    for (const study of [...this.studies]) this.removeStudy(study.id);
    this.emit('indicators');
    this.resize();
  }

  private toggleStudy(id: string): void {
    const study = this.studies.find((candidate) => candidate.id === id);
    if (!study) return;
    this.checkpoint();
    study.isVisible = !study.isVisible;
    this.emit('indicators');
    this.invalidate();
  }

  openIndicatorSettings(id: string): void {
    const study = this.studies.find((candidate) => candidate.id === id);
    if (!study) return;
    const fields: Field[] = study.definition.inputs.map((input): Field => {
      const value = study.inputs[input.key];
      if (input.type === 'bool') return { key: input.key, label: input.title, type: 'checkbox', value: value === true };
      if (input.type === 'int' || input.type === 'float') return { key: input.key, label: input.title, type: 'number', value: Number(value), min: input.min, max: input.max, step: input.step ?? (input.type === 'int' ? 1 : undefined) };
      if (input.type === 'color') return { key: input.key, label: input.title, type: 'color', value: String(value) };
      if (input.type === 'source') return { key: input.key, label: input.title, type: 'select', value: String(value), options: ['Close', 'Open', 'High', 'Low', 'HL2', 'HLC3', 'OHLC4'] };
      return { key: input.key, label: input.title, type: 'select', value: String(value), options: input.options ?? [String(value)] };
    });
    this.closeDialog?.();
    this.closeDialog = openDialog(this.root, {
      title: study.definition.title,
      fields,
      onApply: (values) => {
        this.checkpoint();
        study.inputs = resolveInputs(study.definition, values as Record<string, InputValue>);
        this.compute(study);
        this.emit('indicators');
        this.invalidate();
      },
      onDefaults: () => resolveInputs(study.definition, {}),
    });
  }

  onIndicatorsChange(listener: () => void): () => void {
    this.listeners.indicators.add(listener);
    return () => this.listeners.indicators.delete(listener);
  }

  // ── Drawings ────────────────────────────────────────────────────────────

  drawings(): SerializedDrawing[] {
    return structuredClone(this.drawingList);
  }

  setDrawings(drawings: readonly SerializedDrawing[]): void {
    this.drawingList = structuredClone(drawings.filter((drawing) => toolDefinitions.has(drawing.type)) as SerializedDrawing[]);
    if (this.selectedId && !this.drawingList.some((drawing) => drawing.id === this.selectedId)) this.select(null);
    else if (this.selectedId) this.select(this.selectedId);
    this.invalidate();
  }

  addDrawing(type: string, anchors: DrawingPoint[]): void {
    if (toolDefinitions.has(type)) this.commit(type, anchors, false);
  }

  removeDrawing(id: string): void {
    if (!this.drawingList.some((drawing) => drawing.id === id)) return;
    this.checkpoint();
    this.drawingList = this.drawingList.filter((drawing) => drawing.id !== id);
    if (this.selectedId === id) this.select(null);
    this.emit('drawings');
    this.invalidate();
  }

  onDrawingsChange(listener: () => void): () => void {
    this.listeners.drawings.add(listener);
    return () => this.listeners.drawings.delete(listener);
  }

  setTool(type: string | null): void {
    this.applyTool(type, false);
  }

  onToolChange(listener: (type: string | null) => void): () => void {
    this.listeners.tool.add(listener);
    return () => this.listeners.tool.delete(listener);
  }

  // ── Data ────────────────────────────────────────────────────────────────

  private async load(): Promise<void> {
    const generation = ++this.generation;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.recomputeStudies();
    this.invalidate();
    try {
      const bars = await this.provider.getBars(this.symbol, this.timeframe, { limit: this.depth });
      if (generation !== this.generation) return;
      this.replaceBars(bars);
      if (bars.length < this.depth) this.isHistoryExhausted = true;
    } catch {
      if (generation !== this.generation) return;
      this.isHistoryExhausted = true;
    }
    this.unsubscribe = this.provider.subscribe?.(this.symbol, this.timeframe, (bar) => { if (generation === this.generation) this.onLiveBar(bar); }) ?? null;
    if (this.digits === null && this.provider.getSymbolInfo) {
      const info = await this.provider.getSymbolInfo(this.symbol).catch(() => undefined);
      if (generation === this.generation && info?.tickSize && this.digits === null) {
        this.precision = precisionOf(info.tickSize);
        this.invalidate();
      }
    }
  }

  private replaceBars(bars: readonly Bar[]): void {
    const sorted = [...bars].sort((left, right) => left.time - right.time).filter((bar, index, list) => index === 0 || bar.time !== list[index - 1].time);
    this.barList = sorted;
    this.timeScale.setTimes(sorted.map((bar) => bar.time), this.interval);
    this.updateDisplayBars();
    this.recomputeStudies();
    this.invalidate();
  }

  private onLiveBar(bar: Bar): void {
    if (this.replay) {
      // Live bars wait in the full series until the replay ends.
      const bars = this.replay.bars;
      const last = bars[bars.length - 1];
      if (last && bar.time === last.time) bars[bars.length - 1] = bar;
      else if (!last || bar.time > last.time) bars.push(bar);
      return;
    }
    const last = this.barList[this.barList.length - 1];
    if (!last) {
      this.replaceBars([bar]);
      return;
    }
    if (bar.time < last.time) return;
    if (bar.time === last.time) this.barList[this.barList.length - 1] = bar;
    else {
      this.barList.push(bar);
      this.timeScale.append(bar.time);
    }
    this.updateDisplayBars();
    this.recomputeStudies();
    this.invalidate();
  }

  // Fetches older bars once the oldest loaded bar is on screen. A page that brings nothing
  // older means the source has no more history.
  private pageHistory(): void {
    if (this.replay || this.isPaging || this.isHistoryExhausted || !this.barList.length || this.barList.length >= this.maxBars) return;
    if (this.timeScale.xToIndex(0) > 3) return;
    this.isPaging = true;
    const generation = this.generation;
    const oldest = this.barList[0].time;
    this.provider.getBars(this.symbol, this.timeframe, { to: oldest, limit: Math.min(this.pageBars, this.maxBars - this.barList.length) })
      .then((page) => {
        if (generation !== this.generation) return;
        const older = page.filter((bar) => bar.time < oldest).sort((left, right) => left.time - right.time);
        if (!older.length) { this.isHistoryExhausted = true; return; }
        this.barList = [...older, ...this.barList];
        this.timeScale.setTimes(this.barList.map((bar) => bar.time), this.interval, older.length);
        this.updateDisplayBars();
        this.recomputeStudies();
        this.invalidate();
      })
      .catch(() => { this.isHistoryExhausted = true; })
      .finally(() => { this.isPaging = false; });
  }

  private updateDisplayBars(): void {
    this.displayBars = this.priceStyle === 'heikinashi' ? heikinAshi(this.barList) : this.barList;
  }

  private compute(study: StudyState): void {
    try {
      study.output = study.definition.compute(this.barList, study.inputs);
    } catch {
      study.output = null;
    }
  }

  private recomputeStudies(): void {
    for (const study of this.studies) this.compute(study);
  }

  // ── Layout ──────────────────────────────────────────────────────────────

  private makePane(id: string, weight: number): Pane {
    const legend = new Legend(this.main, {
      toggle: (studyId) => this.toggleStudy(studyId),
      settings: (studyId) => this.openIndicatorSettings(studyId),
      remove: (studyId) => this.removeIndicator(studyId),
    });
    const scale = new PriceScale();
    if (id !== 'price') scale.margins = { top: 0.1, bottom: 0.1 };
    return { id, weight, scale, top: 0, height: 0, legend };
  }

  private railOffset(): number {
    return this.toolbar.isVisible ? RAIL_WIDTH : 0;
  }

  private layoutRail(): void {
    this.main.style.left = `${this.railOffset()}px`;
  }

  private resize(): void {
    const box = this.main.getBoundingClientRect();
    this.width = Math.max(0, Math.floor(box.width));
    this.height = Math.max(0, Math.floor(box.height));
    this.ratio = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.width * this.ratio);
    this.canvas.height = Math.round(this.height * this.ratio);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.layout();
    this.render();
  }

  private layout(): void {
    this.plotWidth = Math.max(0, this.width - this.axisWidth);
    this.timeScale.width = this.plotWidth;
    const available = Math.max(0, this.height - TIME_AXIS_HEIGHT);
    const totalWeight = this.panes.reduce((sum, pane) => sum + pane.weight, 0) || 1;
    let top = 0;
    for (const pane of this.panes) {
      pane.top = top;
      pane.height = Math.max(24, Math.round(available * pane.weight / totalWeight));
      pane.scale.top = top;
      pane.scale.height = pane.height;
      pane.legend.place(top);
      top += pane.height;
    }
    const last = this.panes[this.panes.length - 1];
    if (last) { last.height = Math.max(24, available - last.top); last.scale.height = last.height; }
  }

  private paneAt(y: number): Pane | undefined {
    return this.panes.find((pane) => y >= pane.top && y < pane.top + pane.height);
  }

  private applyThemeVariables(): void {
    const { ui, chart } = this.theme;
    const variables: Record<string, string> = {
      '--mc-font': chart.fontFamily,
      '--mc-text': ui.text,
      '--mc-muted': ui.muted,
      '--mc-icon': ui.text,
      '--mc-surface': ui.surfaceRaised,
      '--mc-input': ui.surface,
      '--mc-border': ui.border,
      '--mc-hover': ui.hover,
      '--mc-accent': ui.accent,
      '--mc-active-bg': ui.accentSoft,
      '--mc-legend-hover': ui.hover,
    };
    for (const [name, value] of Object.entries(variables)) this.root.style.setProperty(name, value);
    this.canvas.style.background = this.colors().background;
  }

  // The theme's chart colours with the user's Chart Settings over them.
  private colors() {
    const { chart } = this.theme;
    const settings = this.chartSettings;
    const up = settings.upColor ?? chart.up;
    const down = settings.downColor ?? chart.down;
    return {
      up,
      down,
      borderUp: settings.borderUpColor ?? up,
      borderDown: settings.borderDownColor ?? down,
      wickUp: settings.wickUpColor ?? up,
      wickDown: settings.wickDownColor ?? down,
      background: settings.background ?? chart.background,
      grid: settings.gridColor ?? chart.grid,
      crosshair: settings.crosshairColor ?? chart.crosshair,
    };
  }

  private applyScaleSettings(): void {
    const scale = this.panes[0].scale;
    scale.setMode(this.chartSettings.scaleMode);
    scale.isInverted = this.chartSettings.isScaleInverted;
    const wasAtEnd = this.timeScale.isAtEnd();
    const margin = this.chartSettings.rightMarginBars;
    if (margin !== this.timeScale.rightMarginBars) {
      this.timeScale.rightMarginBars = margin;
      if (wasAtEnd && this.barList.length) this.timeScale.scrollToEnd();
    }
  }

  // ── Events ──────────────────────────────────────────────────────────────

  private emit(kind: 'indicators' | 'drawings'): void {
    for (const listener of this.listeners[kind]) listener();
    this.refreshTree();
  }

  private refreshTree(): void {
    if (!this.objectTree) return;
    this.objectTree.update(
      this.studies.map((study) => ({ id: study.id, name: studyCaption(study.definition, study.inputs), icon: 'indicators', isVisible: study.isVisible })),
      [...this.drawingList].filter((drawing) => !drawing.props?.isTransient).sort((left, right) => right.zIndex - left.zIndex).map((drawing) => ({
        id: drawing.id,
        name: drawing.text ? `${drawingToolInfo.get(drawing.type)?.label ?? drawing.type}: ${drawing.text.split('\n')[0].slice(0, 24)}` : drawingToolInfo.get(drawing.type)?.label ?? drawing.type,
        icon: drawing.type,
        isVisible: drawing.visible,
        isLocked: drawing.locked,
        isSelected: drawing.id === this.selectedId,
      })),
    );
  }

  // ── History ─────────────────────────────────────────────────────────────

  private snapshot(): Snapshot {
    return {
      drawings: structuredClone(this.drawingList.filter((drawing) => !drawing.props?.isTransient)),
      studies: this.studies.map((study) => ({ id: study.id, type: study.definition.type, inputs: { ...study.inputs }, isVisible: study.isVisible })),
    };
  }

  // Saves the state before a change so it can be undone.
  private checkpoint(before = this.snapshot()): void {
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.listeners.history.forEach((listener) => listener());
  }

  private restore(snapshot: Snapshot): void {
    this.closeTextEditor(false);
    this.drawingList = structuredClone(snapshot.drawings);
    const wanted = new Set(snapshot.studies.map((study) => study.id));
    for (const study of [...this.studies]) if (!wanted.has(study.id)) this.removeStudy(study.id);
    for (const saved of snapshot.studies) {
      const study = this.studies.find((candidate) => candidate.id === saved.id);
      if (!study) {
        this.addStudy(saved.type, saved.inputs, saved.id, saved.isVisible);
        continue;
      }
      study.isVisible = saved.isVisible;
      if (JSON.stringify(study.inputs) !== JSON.stringify(saved.inputs)) {
        study.inputs = { ...saved.inputs };
        this.compute(study);
      }
    }
    // Studies come back in their saved order.
    this.studies.sort((left, right) => snapshot.studies.findIndex((study) => study.id === left.id) - snapshot.studies.findIndex((study) => study.id === right.id));
    this.select(this.selectedId && this.drawingList.some((drawing) => drawing.id === this.selectedId) ? this.selectedId : null);
    this.emit('drawings');
    this.emit('indicators');
    this.listeners.history.forEach((listener) => listener());
    this.resize();
  }

  private emitTool(): void {
    for (const listener of this.listeners.tool) listener(this.tool);
  }

  private emitHover(): void {
    if (!this.listeners.hover.size) return;
    const index = this.hover && this.hover.x < this.plotWidth && this.barList.length ? this.timeScale.barAt(this.hover.x) : null;
    const bar = index === null ? null : this.barList[index];
    const hover: MeridianHover = bar
      ? { time: bar.time, ohlc: bar, readout: { groups: this.studies.filter((study) => study.isVisible).map((study) => ({ name: studyCaption(study.definition, study.inputs), rows: this.studyValues(study, index!).map((value, position) => ({ label: study.output!.plots[position]?.title ?? '', value: value.text, color: value.color })) })) } }
      : { time: null, ohlc: null, readout: null };
    for (const listener of this.listeners.hover) listener(hover);
  }

  private toolbarState() {
    return { tool: this.tool, cursor: this.cursorMode, magnet: this.magnet, isStayMode: this.isStayMode, isLocked: this.isLocked, isHidden: this.isHidden, favorites: this.favorites, isObjectTreeShown: !!this.objectTree };
  }

  private syncToolbar(): void {
    this.toolbar.update(this.toolbarState());
  }

  private applyTool(type: string | null, isFromChart: boolean): void {
    const next = type && (toolDefinitions.has(type) || type === MEASURE || type === ZOOM) ? type : null;
    if (next === this.tool && !this.draft) return;
    this.tool = next;
    this.draft = null;
    if (next) this.select(null);
    this.syncToolbar();
    this.updateCursor();
    this.invalidate();
    if (isFromChart) this.emitTool();
  }

  private updateCursor(): void {
    this.canvas.style.cursor = this.tool ? 'crosshair' : this.cursorMode === 'arrow-cursor' ? 'default' : this.cursorMode === 'eraser' ? 'pointer' : this.cursorMode === 'dot' ? 'none' : 'crosshair';
  }

  private point(event: PointerEvent | MouseEvent | WheelEvent): Pt {
    const box = this.canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.closeTextEditor(true);
    this.main.focus({ preventScroll: true });
    if (event.button !== 0) return;
    const p = this.point(event);
    this.isCtrlDown = event.ctrlKey || event.metaKey;
    this.canvas.setPointerCapture(event.pointerId);
    this.removeTransient();
    const timeAxisTop = this.height - TIME_AXIS_HEIGHT;
    if (p.y >= timeAxisTop) {
      if (p.x < this.plotWidth) this.drag = { kind: 'time-axis', lastX: p.x };
      return;
    }
    if (p.x >= this.plotWidth) {
      const pane = this.paneAt(p.y);
      if (pane) this.drag = { kind: 'price-axis', pane, lastY: p.y };
      return;
    }
    const separator = this.panes.findIndex((pane, index) => index > 0 && Math.abs(p.y - pane.top) <= 3);
    if (separator > 0 && !this.tool) {
      this.drag = { kind: 'separator', upper: this.panes[separator - 1], lower: this.panes[separator], lastY: p.y };
      return;
    }
    const pane = this.paneAt(p.y)!;
    if (this.replay?.isSelecting) {
      this.setReplayStart(this.timeScale.barAt(p.x));
      return;
    }
    if (this.tool === ZOOM) { this.drag = { kind: 'zoom', start: p, current: p }; return; }
    // Shift-click measures, as in the measure tool.
    if (!this.tool && event.shiftKey && pane === this.panes[0]) this.applyTool(MEASURE, true);
    if (this.tool) {
      if (pane !== this.panes[0]) return;
      this.startPlacing(p);
      return;
    }
    if (this.cursorMode === 'eraser') {
      const hit = this.hitDrawing(p);
      if (hit && !hit.locked && !this.isLocked) this.removeDrawing(hit.id);
      return;
    }
    const selected = this.selected();
    if (selected && !selected.locked && !this.isLocked) {
      const handle = this.handlePoints(selected).findIndex((point) => Math.hypot(point.x - p.x, point.y - p.y) <= HANDLE_RADIUS + 3);
      if (handle >= 0) {
        this.dragBefore = this.snapshot();
        this.drag = { kind: 'anchor', id: selected.id, index: handle };
        return;
      }
    }
    const hit = pane === this.panes[0] ? this.hitDrawing(p) : null;
    if (hit) {
      this.select(hit.id);
      if (!hit.locked && !this.isLocked) {
        this.dragBefore = this.snapshot();
        this.drag = { kind: 'move', id: hit.id, origin: { index: this.timeScale.xToIndex(p.x), price: this.panes[0].scale.yToPrice(p.y) }, anchors: structuredClone(hit.anchors), hasMoved: false };
      }
      return;
    }
    this.select(null);
    this.drag = { kind: 'pan', lastX: p.x, lastY: p.y, pane };
  };

  private onPointerMove = (event: PointerEvent): void => {
    const p = this.point(event);
    this.isCtrlDown = event.ctrlKey || event.metaKey;
    this.hover = p;
    const drag = this.drag;
    if (drag) this.continueDrag(drag, p);
    else if (this.draft && this.tool) this.moveDraftAnchor(p);
    else this.updateHoverCursor(p);
    this.emitHover();
    this.invalidate();
  };

  private onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    this.drag = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (!drag) return;
    const p = this.point(event);
    if (drag.kind === 'place') {
      if (drag.hasMoved && this.draft) this.fixDraftAnchor(p);
    } else if (drag.kind === 'freehand' && this.draft) {
      if (this.draft.anchors.length > 1) this.commit(this.draft.type, this.draft.anchors, true);
      this.draft = null;
    } else if (drag.kind === 'move' || drag.kind === 'anchor') {
      if (drag.kind === 'anchor' || drag.hasMoved) {
        if (this.dragBefore) this.checkpoint(this.dragBefore);
        this.emit('drawings');
      }
      this.dragBefore = null;
    } else if (drag.kind === 'zoom') {
      this.zoomToBox(drag.start, drag.current);
    }
    this.invalidate();
  };

  private onPointerLeave = (): void => {
    if (this.drag) return;
    this.hover = null;
    this.emitHover();
    this.invalidate();
  };

  private onDoubleClick = (event: MouseEvent): void => {
    const p = this.point(event);
    if (this.draft?.definition.anchors === 'multi') {
      const anchors = this.draft.anchors.slice(0, -1);
      if (anchors.length >= 2) this.commit(this.draft.type, anchors, true);
      this.draft = null;
      this.invalidate();
      return;
    }
    if (p.y >= this.height - TIME_AXIS_HEIGHT) { this.timeScale.spacing = 8; this.timeScale.scrollToEnd(); this.invalidate(); return; }
    if (p.x >= this.plotWidth) { this.paneAt(p.y)?.scale.reset(); this.invalidate(); return; }
    const hit = this.hitDrawing(p);
    if (!hit) return;
    if (toolDefinitions.get(hit.type)?.hasText && !hit.locked && !this.isLocked) this.editText(hit.id);
    else this.openDrawingSettings(hit.id);
  };

  private onCanvasMenu = (event: MouseEvent): void => {
    event.preventDefault();
    this.closeMenu?.();
    this.closeTextEditor(true);
    const p = this.point(event);
    const pane = this.paneAt(p.y);
    let entries: MenuEntry[];
    if (p.y >= this.height - TIME_AXIS_HEIGHT) {
      entries = [{ label: 'Reset time scale', icon: 'reset', action: () => { this.timeScale.spacing = 8; this.timeScale.scrollToEnd(); this.invalidate(); } }];
    } else if (p.x >= this.plotWidth) {
      entries = this.scaleMenu(pane ?? this.panes[0]);
    } else {
      const hit = pane === this.panes[0] && !this.tool ? this.hitDrawing(p) : null;
      if (hit) {
        this.select(hit.id);
        entries = this.drawingMenu(hit);
      } else {
        const info = pane === this.panes[0] ? { price: this.panes[0].scale.yToPrice(p.y), time: this.barList.length ? this.timeScale.xToTime(p.x) : null } : { price: null, time: null };
        for (const handler of this.contextHandlers) if (handler(info, event)) return;
        entries = this.chartMenu();
      }
    }
    const box = this.root.getBoundingClientRect();
    this.closeMenu = openMenu(this.root, event.clientX - box.left, event.clientY - box.top, entries);
  };

  private scaleMenu(pane: Pane): MenuEntry[] {
    const scale = pane.scale;
    const entries: MenuEntry[] = [
      { label: 'Auto (fits data to screen)', isChecked: scale.isAuto, action: () => { if (scale.isAuto) scale.isAuto = false; else scale.reset(); this.invalidate(); } },
      { label: 'Reset price scale', icon: 'reset', shortcut: 'Alt+R', action: () => { scale.reset(); this.invalidate(); } },
    ];
    if (pane !== this.panes[0]) return entries;
    return [
      ...entries,
      separator,
      { label: 'Invert scale', isChecked: this.chartSettings.isScaleInverted, shortcut: 'Alt+I', action: () => this.setSettings({ isScaleInverted: !this.chartSettings.isScaleInverted }) },
      separator,
      ...scaleModeLabels.map(({ mode, label, shortcut }) => ({ label, shortcut, isChecked: this.chartSettings.scaleMode === mode, action: () => this.setScaleMode(mode) })),
      separator,
      { label: 'Settings…', icon: 'settings', action: () => this.openChartSettings() },
    ];
  }

  private drawingMenu(drawing: SerializedDrawing): MenuEntry[] {
    const definition = toolDefinitions.get(drawing.type);
    const isEditable = !drawing.locked && !this.isLocked;
    return [
      { label: 'Settings…', icon: 'settings', action: () => this.openDrawingSettings(drawing.id) },
      ...(definition?.hasText ? [{ label: 'Edit text', icon: 'text-edit', isDisabled: !isEditable, action: () => this.editText(drawing.id) }] : []),
      separator,
      { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', action: () => { this.copySelection(); } },
      { label: 'Clone', icon: 'clone', action: () => this.cloneSelected() },
      separator,
      { label: 'Bring to front', icon: 'bring-front', action: () => this.reorder(drawing.id, 'front') },
      { label: 'Bring forward', action: () => this.reorder(drawing.id, 'forward') },
      { label: 'Send backward', action: () => this.reorder(drawing.id, 'backward') },
      { label: 'Send to back', icon: 'send-back', action: () => this.reorder(drawing.id, 'back') },
      separator,
      { label: drawing.locked ? 'Unlock' : 'Lock', icon: drawing.locked ? 'unlock' : 'lock', action: () => this.patchDrawing(drawing.id, (current) => ({ locked: !current.locked })) },
      { label: 'Hide', icon: 'eye-off', action: () => this.patchDrawing(drawing.id, () => ({ visible: false })) },
      separator,
      { label: 'Remove', icon: 'trash', shortcut: 'Del', isDisabled: drawing.locked, action: () => this.removeDrawing(drawing.id) },
    ];
  }

  private chartMenu(): MenuEntry[] {
    const hasDrawings = this.drawingList.some((drawing) => !drawing.props?.isTransient);
    return [
      { label: 'Reset chart view', icon: 'reset', shortcut: 'Alt+R', action: () => this.resetView() },
      { label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V', isDisabled: !clipboard.length, action: () => this.paste() },
      { label: 'Undo', icon: 'undo', shortcut: 'Ctrl+Z', isDisabled: !this.canUndo(), action: () => this.undo() },
      { label: 'Redo', icon: 'redo', shortcut: 'Ctrl+Y', isDisabled: !this.canRedo(), action: () => this.redo() },
      separator,
      { label: 'Object tree', icon: 'object-tree', isChecked: !!this.objectTree, action: () => this.toggleObjectTree() },
      { label: this.replay ? 'Exit bar replay' : 'Bar replay', icon: 'replay', action: () => (this.replay ? this.exitReplay() : this.startReplay()) },
      separator,
      { label: 'Remove drawings', icon: 'remove-all', isDisabled: !hasDrawings, action: () => this.removeAllDrawings() },
      { label: 'Remove indicators', icon: 'trash', isDisabled: !this.studies.length, action: () => this.removeAllStudies() },
      separator,
      { label: 'Settings…', icon: 'settings', action: () => this.openChartSettings() },
    ];
  }

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const p = this.point(event);
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey) {
      this.timeScale.pan(-(event.deltaX || event.deltaY));
    } else {
      const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015));
      this.timeScale.zoom(factor, p.x < this.plotWidth ? p.x : this.plotWidth);
    }
    this.invalidate();
  };

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return;
    const isMod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (isMod && !event.altKey && (key === 'z' || key === 'y')) {
      if (key === 'y' || event.shiftKey) this.redo();
      else this.undo();
    } else if (isMod && !event.altKey && key === 'c') {
      if (!this.copySelection()) return;
    } else if (isMod && !event.altKey && key === 'v') {
      if (!clipboard.length) return;
      this.paste();
    } else if (event.altKey && !isMod && this.altShortcut(event)) {
      // Handled.
    } else if (event.key === 'Escape') {
      if (this.replay?.isSelecting && this.replay.cutoff >= this.replay.bars.length) this.exitReplay();
      else if (this.replay?.isSelecting) { this.replay.isSelecting = false; this.syncReplayBar(); }
      if (this.draft?.definition.anchors === 'multi' && this.draft.anchors.length > 2) this.commit(this.draft.type, this.draft.anchors.slice(0, -1), true);
      this.draft = null;
      if (this.tool) this.applyTool(null, true);
      else this.select(null);
      this.removeTransient();
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedId) {
      this.removeSelected();
    } else if (event.key === 'Enter' && this.draft?.definition.anchors === 'multi') {
      const anchors = this.draft.anchors.slice(0, -1);
      if (anchors.length >= 2) this.commit(this.draft.type, anchors, true);
      this.draft = null;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      this.timeScale.pan((event.key === 'ArrowLeft' ? 1 : -1) * this.timeScale.spacing * (event.shiftKey ? 10 : 1));
    } else if (event.key === 'Home') {
      this.timeScale.rightEdge = Math.min(this.timeScale.lastIndex, this.plotWidth / this.timeScale.spacing);
    } else if (event.key === 'End') {
      this.scrollToEnd();
    } else if (event.key === 'Control' || event.key === 'Meta') {
      this.isCtrlDown = true;
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
    this.invalidate();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'Control' || event.key === 'Meta') this.isCtrlDown = false;
  };

  // Alt shortcuts: tools, scale modes and reset. By physical key, since Alt changes the
  // character on some layouts.
  private altShortcut(event: KeyboardEvent): boolean {
    const tool = toolShortcuts[event.code];
    if (tool && toolDefinitions.has(tool)) {
      this.applyTool(tool, true);
      return true;
    }
    switch (event.code) {
      case 'KeyR': this.resetView(); return true;
      case 'KeyI': this.setSettings({ isScaleInverted: !this.chartSettings.isScaleInverted }); return true;
      case 'KeyL': this.setScaleMode(this.chartSettings.scaleMode === 'log' ? 'normal' : 'log'); return true;
      case 'KeyP': this.setScaleMode(this.chartSettings.scaleMode === 'percent' ? 'normal' : 'percent'); return true;
      default: return false;
    }
  }

  private updateHoverCursor(p: Pt): void {
    if (this.tool) return;
    if (p.y >= this.height - TIME_AXIS_HEIGHT) { this.canvas.style.cursor = 'ew-resize'; return; }
    if (p.x >= this.plotWidth) { this.canvas.style.cursor = 'ns-resize'; return; }
    if (this.panes.some((pane, index) => index > 0 && Math.abs(p.y - pane.top) <= 3)) { this.canvas.style.cursor = 'row-resize'; return; }
    const selected = this.selected();
    if (selected && this.handlePoints(selected).some((point) => Math.hypot(point.x - p.x, point.y - p.y) <= HANDLE_RADIUS + 3)) { this.canvas.style.cursor = 'move'; return; }
    if (this.paneAt(p.y) === this.panes[0] && this.hitDrawing(p)) { this.canvas.style.cursor = 'pointer'; return; }
    this.updateCursor();
  }

  private continueDrag(drag: Drag, p: Pt): void {
    switch (drag.kind) {
      case 'pan': {
        this.timeScale.pan(p.x - drag.lastX);
        if (!drag.pane.scale.isAuto) drag.pane.scale.shift(p.y - drag.lastY);
        drag.lastX = p.x;
        drag.lastY = p.y;
        break;
      }
      case 'price-axis':
        drag.pane.scale.stretch(Math.exp((p.y - drag.lastY) * 0.005));
        drag.lastY = p.y;
        break;
      case 'time-axis':
        this.timeScale.zoom(Math.exp((p.x - drag.lastX) * 0.01), this.plotWidth);
        drag.lastX = p.x;
        break;
      case 'separator': {
        const delta = p.y - drag.lastY;
        const total = drag.upper.height + drag.lower.height;
        const upper = Math.max(30, Math.min(total - 30, drag.upper.height + delta));
        const weights = drag.upper.weight + drag.lower.weight;
        drag.upper.weight = weights * upper / total;
        drag.lower.weight = weights - drag.upper.weight;
        drag.lastY = p.y;
        this.layout();
        break;
      }
      case 'move': {
        const drawing = this.drawingList.find((candidate) => candidate.id === drag.id);
        if (!drawing) break;
        const deltaIndex = this.timeScale.xToIndex(p.x) - drag.origin.index;
        const shift = Math.round(deltaIndex);
        const deltaPrice = this.panes[0].scale.yToPrice(p.y) - drag.origin.price;
        drawing.anchors = drag.anchors.map((anchor) => ({ time: this.timeScale.timeAt(this.timeScale.indexOf(anchor.time) + shift), price: anchor.price + deltaPrice }));
        drag.hasMoved = true;
        break;
      }
      case 'anchor': {
        const drawing = this.drawingList.find((candidate) => candidate.id === drag.id);
        const definition = drawing && toolDefinitions.get(drawing.type);
        if (!drawing || !definition) break;
        const anchors = [...drawing.anchors];
        anchors[drag.index] = this.dataPoint(p, definition.anchors !== 'free');
        drawing.anchors = definition.constrain ? definition.constrain(anchors, drag.index) : anchors;
        break;
      }
      case 'place':
        if (!drag.hasMoved && Math.hypot(p.x - drag.startX, p.y - drag.startY) > 4) drag.hasMoved = true;
        this.moveDraftAnchor(p);
        break;
      case 'freehand':
        if (this.draft) {
          const last = this.draft.anchors[this.draft.anchors.length - 1];
          const lastPoint = { x: this.timeScale.timeToX(last.time), y: this.panes[0].scale.priceToY(last.price) };
          if (Math.hypot(p.x - lastPoint.x, p.y - lastPoint.y) > 2) this.draft.anchors.push(this.dataPoint(p, false));
        }
        break;
      case 'zoom':
        drag.current = p;
        break;
    }
  }

  // ── Placing drawings ────────────────────────────────────────────────────

  private dataPoint(p: Pt, isSnapped: boolean): DrawingPoint {
    const scale = this.panes[0].scale;
    const index = this.timeScale.xToIndex(p.x);
    let time = this.timeScale.timeAt(isSnapped ? Math.round(index) : index);
    let price = scale.yToPrice(p.y);
    const barIndex = Math.round(index);
    const bar = this.displayBars[barIndex];
    const isStrong = this.magnet === 'strong' || this.isCtrlDown;
    if (bar && (isStrong || this.magnet === 'weak')) {
      const nearest = [bar.open, bar.high, bar.low, bar.close].reduce((best, value) => Math.abs(value - price) < Math.abs(best - price) ? value : best);
      if (isStrong || Math.abs(scale.priceToY(nearest) - p.y) <= 24) {
        price = nearest;
        time = bar.time;
      }
    }
    return { time, price };
  }

  private startPlacing(p: Pt): void {
    const type = this.tool === MEASURE ? 'date-price-range' : this.tool!;
    const definition = toolDefinitions.get(type);
    if (!definition) return;
    const point = this.dataPoint(p, definition.anchors !== 'free');
    if (definition.create) {
      this.commit(type, definition.create(point, this.createEnv()), true);
      return;
    }
    if (definition.anchors === 'free') {
      this.draft = { type, definition, anchors: [point] };
      this.drag = { kind: 'freehand' };
      return;
    }
    if (definition.anchors === 1) {
      this.commit(type, [point], true);
      return;
    }
    if (!this.draft) {
      this.draft = { type, definition, anchors: [point, point] };
      this.drag = { kind: 'place', startX: p.x, startY: p.y, hasMoved: false };
      return;
    }
    this.fixDraftAnchor(p);
    if (this.draft) this.drag = { kind: 'place', startX: p.x, startY: p.y, hasMoved: false };
  }

  private moveDraftAnchor(p: Pt): void {
    if (!this.draft || this.draft.definition.anchors === 'free') return;
    this.draft.anchors[this.draft.anchors.length - 1] = this.dataPoint(p, true);
  }

  // Fixes the anchor following the pointer; the drawing is complete once it has all its anchors.
  private fixDraftAnchor(p: Pt): void {
    const draft = this.draft;
    if (!draft) return;
    draft.anchors[draft.anchors.length - 1] = this.dataPoint(p, true);
    const needed = draft.definition.anchors;
    if (typeof needed === 'number' && draft.anchors.length >= needed) {
      this.draft = null;
      this.commit(draft.type, draft.anchors, true);
      return;
    }
    draft.anchors.push(draft.anchors[draft.anchors.length - 1]);
  }

  private commit(type: string, anchors: DrawingPoint[], isFromUser: boolean): void {
    const definition = toolDefinitions.get(type)!;
    const isMeasure = this.tool === MEASURE;
    if (!isMeasure) this.checkpoint();
    const drawing: SerializedDrawing = {
      id: this.newDrawingId(),
      type,
      paneId: 'price',
      anchors: structuredClone(anchors),
      style: styleFor(type),
      ...(definition.hasText ? { text: definition.defaultText ?? '' } : {}),
      locked: false,
      visible: true,
      zIndex: this.topZ() + 1,
      createdAt: Date.now(),
      ...(isMeasure ? { props: { isTransient: true } } : {}),
    };
    this.drawingList.push(drawing);
    this.draft = null;
    if (!isMeasure) {
      this.select(drawing.id);
      this.emit('drawings');
    }
    if (isFromUser && !this.isStayMode) this.applyTool(null, true);
    if (isFromUser && definition.hasText && definition.defaultText) this.editText(drawing.id, true);
    this.invalidate();
  }

  private newDrawingId(): string {
    return `drawing-${Date.now().toString(36)}-${(++this.seq).toString(36)}`;
  }

  private topZ(): number {
    return this.drawingList.reduce((top, candidate) => Math.max(top, candidate.zIndex), 0);
  }

  // A measurement disappears with the next click.
  private removeTransient(): void {
    const before = this.drawingList.length;
    this.drawingList = this.drawingList.filter((drawing) => !drawing.props?.isTransient);
    if (this.drawingList.length !== before) this.invalidate();
  }

  private createEnv(): CreateEnv {
    const scale = this.panes[0].scale;
    return {
      xToTime: (x) => this.timeScale.xToTime(x),
      yToPrice: (y) => scale.yToPrice(y),
      timeToX: (time) => this.timeScale.timeToX(time),
      priceToY: (price) => scale.priceToY(price),
      bounds: { left: 0, top: this.panes[0].top, width: this.plotWidth, height: this.panes[0].height },
    };
  }

  private zoomToBox(start: Pt, end: Pt): void {
    const from = this.timeScale.xToIndex(Math.min(start.x, end.x));
    const to = this.timeScale.xToIndex(Math.max(start.x, end.x));
    if (to - from >= 2 && Math.abs(end.y - start.y) > 8) {
      this.timeScale.spacing = Math.max(this.timeScale.minSpacing, Math.min(this.timeScale.maxSpacing, this.plotWidth / (to - from)));
      this.timeScale.rightEdge = to;
      const scale = this.panes[0].scale;
      const values = [scale.toScale(scale.yToPrice(start.y)), scale.toScale(scale.yToPrice(end.y))];
      scale.min = Math.min(...values);
      scale.max = Math.max(...values);
      scale.isAuto = false;
    }
    this.applyTool(null, true);
  }

  // ── Selection and editing ───────────────────────────────────────────────

  private selected(): SerializedDrawing | undefined {
    return this.selectedId ? this.drawingList.find((drawing) => drawing.id === this.selectedId) : undefined;
  }

  private select(id: string | null): void {
    this.selectedId = id;
    const drawing = this.selected();
    if (drawing) this.styleBar.show(drawing, { isFillable: !!toolDefinitions.get(drawing.type)?.isFillable });
    else this.styleBar.hide();
    this.invalidate();
  }

  private patchSelected(patch: Partial<SerializedDrawing>): void {
    if (this.selectedId) this.patchDrawing(this.selectedId, () => patch);
  }

  private patchDrawing(id: string, patch: (drawing: SerializedDrawing) => Partial<SerializedDrawing>): void {
    const drawing = this.drawingList.find((candidate) => candidate.id === id);
    if (!drawing) return;
    this.checkpoint();
    Object.assign(drawing, patch(drawing));
    if (!drawing.visible && this.selectedId === id) this.select(null);
    else if (this.selectedId === id) this.select(id);
    this.emit('drawings');
    this.invalidate();
  }

  private removeSelected(): void {
    const drawing = this.selected();
    if (drawing && !drawing.locked) this.removeDrawing(drawing.id);
  }

  private removeAllDrawings(): void {
    if (!this.drawingList.length) return;
    this.checkpoint();
    this.select(null);
    this.drawingList = [];
    this.emit('drawings');
    this.invalidate();
  }

  private cloneSelected(): void {
    const drawing = this.selected();
    if (!drawing) return;
    this.checkpoint();
    const shift = Math.max(1, Math.round(20 / this.timeScale.spacing));
    const copy: SerializedDrawing = {
      ...structuredClone(drawing),
      id: this.newDrawingId(),
      anchors: drawing.anchors.map((anchor) => ({ time: this.timeScale.timeAt(this.timeScale.indexOf(anchor.time) + shift), price: anchor.price })),
      zIndex: this.topZ() + 1,
      locked: false,
      createdAt: Date.now(),
    };
    this.drawingList.push(copy);
    this.select(copy.id);
    this.emit('drawings');
  }

  // Moves a drawing in the stacking order.
  private reorder(id: string, where: 'front' | 'back' | 'forward' | 'backward'): void {
    const ordered = [...this.drawingList].sort((left, right) => left.zIndex - right.zIndex);
    const index = ordered.findIndex((drawing) => drawing.id === id);
    if (index < 0) return;
    const [drawing] = ordered.splice(index, 1);
    const target = where === 'front' ? ordered.length : where === 'back' ? 0 : where === 'forward' ? Math.min(ordered.length, index + 1) : Math.max(0, index - 1);
    ordered.splice(target, 0, drawing);
    if (ordered.every((candidate, position) => candidate.zIndex === position + 1)) return;
    this.checkpoint();
    ordered.forEach((candidate, position) => { candidate.zIndex = position + 1; });
    this.emit('drawings');
    this.invalidate();
  }

  openDrawingSettings(id: string, focus?: string): void {
    const drawing = this.drawingList.find((candidate) => candidate.id === id);
    const definition = drawing && toolDefinitions.get(drawing.type);
    if (!drawing || !definition) return;
    this.closeDialog?.();
    this.closeDialog = openDialog(this.root, {
      title: drawingToolInfo.get(drawing.type)?.label ?? 'Drawing',
      fields: drawingFields(drawing, definition),
      focus,
      onApply: (values) => {
        const current = this.drawingList.find((candidate) => candidate.id === id);
        if (!current) return;
        const next = applyDrawingFields(current, definition, values);
        this.checkpoint();
        this.drawingList = this.drawingList.map((candidate) => (candidate.id === id ? next : candidate));
        if (this.selectedId === id) this.select(id);
        this.emit('drawings');
        this.invalidate();
      },
    });
  }

  // Edits a drawing's text in place, in a box over its first anchor. Enter keeps the text
  // (Shift+Enter for a new line), Escape restores it.
  private editText(id: string, isNew = false): void {
    const drawing = this.drawingList.find((candidate) => candidate.id === id);
    if (!drawing || !drawing.anchors.length) return;
    this.closeTextEditor(true);
    this.select(id);
    const before = this.snapshot();
    const original = drawing.text ?? '';
    const editor = element('textarea', 'mc-text-editor', this.main);
    editor.value = original;
    editor.rows = Math.max(1, original.split('\n').length);
    editor.setAttribute('aria-label', 'Drawing text');
    const anchor = drawing.anchors[0];
    const x = Math.max(4, Math.min(this.plotWidth - 160, this.timeScale.timeToX(anchor.time)));
    const y = Math.max(4, Math.min(this.height - TIME_AXIS_HEIGHT - 40, this.panes[0].scale.priceToY(anchor.price) - 12));
    editor.style.left = `${x}px`;
    editor.style.top = `${y}px`;
    editor.style.color = drawing.style.textColor ?? drawing.style.lineColor;
    editor.style.fontSize = `${drawing.style.fontSize ?? 13}px`;
    const fit = () => {
      editor.style.height = 'auto';
      editor.style.height = `${editor.scrollHeight}px`;
      editor.style.width = `${Math.max(80, Math.min(360, this.measure(editor.value.split('\n').reduce((long, line) => (line.length > long.length ? line : long), ''), drawing.style.fontSize ?? 13, false) + 24))}px`;
    };
    editor.addEventListener('input', () => {
      drawing.text = editor.value;
      fit();
      this.invalidate();
    });
    editor.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); this.closeTextEditor(true); }
      else if (event.key === 'Escape') { event.preventDefault(); this.closeTextEditor(false); }
    });
    editor.addEventListener('blur', () => this.closeTextEditor(true));
    editor.addEventListener('pointerdown', (event) => event.stopPropagation());
    this.textEditor = editor;
    this.textEditing = { id, original, before, isNew };
    fit();
    setTimeout(() => { editor.focus(); editor.select(); });
  }

  private textEditing: { id: string; original: string; before: Snapshot; isNew: boolean } | null = null;

  private closeTextEditor(isKept: boolean): void {
    const editor = this.textEditor;
    const editing = this.textEditing;
    if (!editor || !editing) return;
    this.textEditor = null;
    this.textEditing = null;
    editor.remove();
    const drawing = this.drawingList.find((candidate) => candidate.id === editing.id);
    if (!drawing) return;
    if (!isKept) drawing.text = editing.original;
    else if (drawing.text !== editing.original && !editing.isNew) this.checkpoint(editing.before);
    if (isKept && drawing.text !== editing.original) this.emit('drawings');
    this.main.focus({ preventScroll: true });
    this.invalidate();
  }

  // ── Replay internals ────────────────────────────────────────────────────

  private setReplayStart(index: number): void {
    const replay = this.replay;
    if (!replay) return;
    replay.cutoff = Math.max(1, Math.min(replay.bars.length, index + 1));
    replay.isSelecting = false;
    this.showReplayBars();
    this.timeScale.rightEdge = replay.cutoff - 1 + Math.max(this.timeScale.rightMarginBars, Math.round(this.plotWidth / this.timeScale.spacing / 3));
    this.syncReplayBar();
  }

  private showReplayBars(): void {
    const replay = this.replay!;
    const rightEdge = this.timeScale.rightEdge;
    this.barList = replay.bars.slice(0, replay.cutoff);
    this.timeScale.setTimes(this.barList.map((bar) => bar.time), this.interval);
    this.timeScale.rightEdge = rightEdge;
    this.updateDisplayBars();
    this.recomputeStudies();
    this.invalidate();
  }

  private stepReplay(): void {
    const replay = this.replay;
    if (!replay || replay.isSelecting) return;
    if (replay.cutoff >= replay.bars.length) {
      this.stopReplayTimer();
      replay.isPlaying = false;
      this.syncReplayBar();
      return;
    }
    const bar = replay.bars[replay.cutoff++];
    this.barList.push(bar);
    this.timeScale.append(bar.time);
    // Keep the newest bar in view.
    if (this.timeScale.indexToX(this.timeScale.lastIndex) > this.plotWidth - this.timeScale.spacing * 2) this.timeScale.rightEdge += 1;
    this.updateDisplayBars();
    this.recomputeStudies();
    this.syncReplayBar();
    this.invalidate();
  }

  private toggleReplayPlay(): void {
    const replay = this.replay;
    if (!replay || replay.isSelecting) return;
    replay.isPlaying = !replay.isPlaying;
    if (replay.isPlaying && replay.cutoff >= replay.bars.length) replay.isPlaying = false;
    this.restartReplayTimer();
    this.syncReplayBar();
  }

  private setReplaySpeed(speed: number): void {
    if (!this.replay) return;
    this.replay.speed = speed;
    this.restartReplayTimer();
  }

  private restartReplayTimer(): void {
    this.stopReplayTimer();
    const replay = this.replay;
    if (replay?.isPlaying) replay.timer = setInterval(() => this.stepReplay(), 1000 / replay.speed);
  }

  private stopReplayTimer(): void {
    if (this.replay?.timer) clearInterval(this.replay.timer);
    if (this.replay) this.replay.timer = null;
  }

  private endReplay(): void {
    const replay = this.replay;
    if (!replay) return;
    this.stopReplayTimer();
    this.replay = null;
    this.replayBar.hide();
    this.barList = replay.bars;
    this.timeScale.setTimes(this.barList.map((bar) => bar.time), this.interval);
    this.updateDisplayBars();
    this.recomputeStudies();
    this.listeners.replay.forEach((listener) => listener());
    this.invalidate();
  }

  private syncReplayBar(): void {
    const replay = this.replay;
    if (!replay) { this.replayBar.hide(); return; }
    const current = replay.bars[replay.cutoff - 1];
    const left = replay.bars.length - replay.cutoff;
    const status = replay.isSelecting ? 'Select a bar' : left ? `${current ? formatCrosshairTime(current.time, this.interval) : ''} · ${left} bars left` : 'End of data';
    this.replayBar.show({ isSelecting: replay.isSelecting, isPlaying: replay.isPlaying, status });
  }

  private toolEnv(drawing: SerializedDrawing, isDraft: boolean): ToolEnv {
    const scale = this.panes[0].scale;
    const { chart, ui } = this.theme;
    return {
      points: drawing.anchors.map((anchor) => ({ x: this.timeScale.timeToX(anchor.time), y: scale.priceToY(anchor.price) })),
      anchors: drawing.anchors,
      drawing,
      bounds: { left: 0, top: this.panes[0].top, width: this.plotWidth, height: this.panes[0].height },
      style: drawing.style,
      theme: { text: chart.text, background: ui.surfaceRaised, up: chart.up, down: chart.down, muted: ui.muted },
      formatPrice: (price) => formatPrice(price, this.precision),
      formatDuration,
      timeToX: (time) => this.timeScale.timeToX(time),
      priceToY: (price) => scale.priceToY(price),
      bars: this.barList,
      indexOf: (time) => this.timeScale.indexOf(time),
      intervalMs: this.interval,
      isDraft,
    };
  }

  private shapesOf(drawing: SerializedDrawing, isDraft = false): ShapeList {
    const shapes = new ShapeList();
    const definition = toolDefinitions.get(drawing.type);
    if (definition && drawing.anchors.length) {
      try {
        definition.build(shapes, this.toolEnv(drawing, isDraft));
      } catch {
        // A drawing whose anchors no longer make sense is left out rather than breaking the chart.
      }
    }
    return shapes;
  }

  private measure = (text: string, size: number, bold: boolean) => {
    this.context.font = `${bold ? '600 ' : ''}${size}px ${this.theme.chart.fontFamily}`;
    return this.context.measureText(text).width;
  };

  private hitDrawing(p: Pt): SerializedDrawing | null {
    if (this.isHidden) return null;
    const ordered = this.shownDrawings().sort((left, right) => right.zIndex - left.zIndex);
    for (const drawing of ordered) {
      if (this.shapesOf(drawing).shapes.some((shape) => hitShape(shape, p, HIT_TOLERANCE, this.measure))) return drawing;
    }
    return null;
  }

  // Drawings visible on this timeframe.
  private shownDrawings(): SerializedDrawing[] {
    return this.drawingList.filter((drawing) => drawing.visible && isShownOn(drawing, this.interval));
  }

  private handlePoints(drawing: SerializedDrawing): Pt[] {
    if (toolDefinitions.get(drawing.type)?.anchors === 'free') return [];
    const scale = this.panes[0].scale;
    return drawing.anchors.map((anchor) => ({ x: this.timeScale.timeToX(anchor.time), y: scale.priceToY(anchor.price) }));
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  private invalidate(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  private studyValues(study: StudyState, index: number): LegendValue[] {
    if (!study.output) return [];
    return study.output.plots.map((plot) => {
      const value = plot.values[index - (plot.offset ?? 0)];
      return { text: value === null || value === undefined ? '∅' : this.formatStudy(study, value), color: plot.colors?.[index - (plot.offset ?? 0)] ?? plot.color };
    });
  }

  private formatStudy(study: StudyState, value: number): string {
    return study.paneId === 'price' ? formatPrice(value, this.precision) : formatValue(value);
  }

  private fitScales(from: number, to: number): void {
    const price = this.panes[0];
    let low = Infinity;
    let high = -Infinity;
    for (let index = from; index <= to; index++) {
      const bar = this.displayBars[index];
      if (!bar) continue;
      if (this.priceStyle === 'line' || this.priceStyle === 'area' || this.priceStyle === 'baseline') {
        low = Math.min(low, bar.close);
        high = Math.max(high, bar.close);
      } else {
        low = Math.min(low, bar.low);
        high = Math.max(high, bar.high);
      }
    }
    const ranges = new Map<string, [number, number]>([[price.id, [low, high]]]);
    for (const study of this.studies) {
      if (!study.isVisible || !study.output) continue;
      const range = ranges.get(study.paneId) ?? [Infinity, -Infinity];
      for (const plot of study.output.plots) {
        const offset = plot.offset ?? 0;
        for (let index = from; index <= to; index++) {
          const value = plot.values[index - offset];
          if (value === null || value === undefined) continue;
          range[0] = Math.min(range[0], value);
          range[1] = Math.max(range[1], value);
        }
        if (plot.kind === 'histogram' || plot.kind === 'columns') { range[0] = Math.min(range[0], 0); range[1] = Math.max(range[1], 0); }
      }
      if (study.paneId !== 'price') for (const level of study.output.levels ?? []) { range[0] = Math.min(range[0], level.price); range[1] = Math.max(range[1], level.price); }
      ranges.set(study.paneId, range);
    }
    const base = this.barList[Math.max(0, Math.min(from, this.barList.length - 1))]?.close;
    if (base) price.scale.base = base;
    for (const pane of this.panes) {
      const range = ranges.get(pane.id);
      if (range && Number.isFinite(range[0]) && Number.isFinite(range[1])) pane.scale.fit(range[0], range[1]);
    }
  }

  private formatter(pane: Pane): (value: number) => string {
    return pane.id === 'price' ? (value) => formatPrice(value, this.precision) : formatValue;
  }

  // A value as the pane's axis shows it (percent and indexed scales on the price pane).
  private axisText(pane: Pane, value: number): string {
    return pane.scale.format(value, this.formatter(pane));
  }

  private render(): void {
    const ctx = this.context;
    const { chart } = this.theme;
    const colors = this.colors();
    const settings = this.chartSettings;
    ctx.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, this.width, this.height);
    if (!this.plotWidth || !this.height) return;

    const { from, to } = this.timeScale.visible();
    const hasBars = this.barList.length > 0;
    if (hasBars) this.fitScales(from, to);
    const axisWidth = this.measureAxis();
    if (Math.abs(axisWidth - this.axisWidth) > 1) {
      this.axisWidth = axisWidth;
      this.layout();
    }

    const times = this.barList.map((bar) => bar.time);
    const ticks = hasBars ? timeTicks(times, from, to, this.timeScale.spacing) : [];
    const timeAxisTop = this.height - TIME_AXIS_HEIGHT;

    const scaleTicks = new Map(this.panes.map((pane) => [pane, pane.scale.ticks(this.formatter(pane))]));

    // Grid
    if (this.isGridShown && (settings.isVerticalGridShown || settings.isHorizontalGridShown)) {
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (settings.isVerticalGridShown) {
        for (const tick of ticks) {
          const x = this.crisp(this.timeScale.indexToX(tick.index));
          ctx.moveTo(x, 0);
          ctx.lineTo(x, timeAxisTop);
        }
      }
      if (settings.isHorizontalGridShown) {
        for (const pane of this.panes) {
          for (const tick of scaleTicks.get(pane)!) {
            const y = this.crisp(pane.scale.priceToY(tick.price));
            if (y < pane.top + 2 || y > pane.top + pane.height - 2) continue;
            ctx.moveTo(0, y);
            ctx.lineTo(this.plotWidth, y);
          }
        }
      }
      ctx.stroke();
    }
    if (settings.isWatermarkShown) this.paintWatermark(this.panes[0]);

    // Panes
    for (const pane of this.panes) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, pane.top, this.plotWidth, pane.height);
      ctx.clip();
      if (pane.id === 'price') {
        if (hasBars) {
          if (this.isVolumeShown) this.paintVolume(pane, from, to);
          this.paintSeries(pane, from, to);
        }
        for (const study of this.studies) if (study.isVisible && study.paneId === pane.id) this.paintStudy(study, pane, from, to);
        this.paintPriceLines(pane);
        if (hasBars && settings.isLastPriceLineShown) this.paintLastPrice(pane);
        if (!this.isHidden) this.paintDrawings();
      } else {
        for (const study of this.studies) if (study.isVisible && study.paneId === pane.id) this.paintStudy(study, pane, from, to);
      }
      ctx.restore();
    }
    if (this.drag?.kind === 'zoom') {
      const { start, current } = this.drag;
      ctx.fillStyle = 'rgba(41, 98, 255, 0.12)';
      ctx.strokeStyle = this.theme.ui.accent;
      ctx.fillRect(Math.min(start.x, current.x), Math.min(start.y, current.y), Math.abs(current.x - start.x), Math.abs(current.y - start.y));
      ctx.strokeRect(Math.min(start.x, current.x) + 0.5, Math.min(start.y, current.y) + 0.5, Math.abs(current.x - start.x), Math.abs(current.y - start.y));
    }

    if (this.replay) this.paintReplay(timeAxisTop);

    // Axes
    ctx.fillStyle = colors.background;
    ctx.fillRect(this.plotWidth, 0, this.width - this.plotWidth, this.height);
    ctx.fillRect(0, timeAxisTop, this.width, TIME_AXIS_HEIGHT);
    ctx.strokeStyle = chart.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.crisp(this.plotWidth), 0);
    ctx.lineTo(this.crisp(this.plotWidth), timeAxisTop);
    ctx.moveTo(0, this.crisp(timeAxisTop));
    ctx.lineTo(this.width, this.crisp(timeAxisTop));
    for (const pane of this.panes.slice(1)) {
      ctx.moveTo(0, this.crisp(pane.top));
      ctx.lineTo(this.width, this.crisp(pane.top));
    }
    ctx.stroke();
    ctx.font = `11px ${chart.fontFamily}`;
    ctx.fillStyle = chart.text;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const pane of this.panes) {
      for (const tick of scaleTicks.get(pane)!) {
        const y = pane.scale.priceToY(tick.price);
        if (y < pane.top + 8 || y > pane.top + pane.height - 8) continue;
        ctx.fillText(tick.label, this.plotWidth + 8, y);
      }
    }
    ctx.textAlign = 'center';
    for (const tick of ticks) {
      const x = this.timeScale.indexToX(tick.index);
      if (x < 20 || x > this.plotWidth - 20) continue;
      ctx.font = `${tick.isMajor ? '600 ' : ''}11px ${chart.fontFamily}`;
      ctx.fillText(tick.label, x, timeAxisTop + TIME_AXIS_HEIGHT / 2);
    }
    ctx.font = `11px ${chart.fontFamily}`;
    this.paintAxisTags();
    this.paintCrosshair();
    this.updateLegends();
    if (hasBars) this.pageHistory();
  }

  private crisp(value: number): number {
    return (Math.round(value * this.ratio) + 0.5) / this.ratio;
  }

  private measureAxis(): number {
    const ctx = this.context;
    ctx.font = `11px ${this.theme.chart.fontFamily}`;
    let widest = 40;
    for (const pane of this.panes) {
      for (const value of [pane.scale.min, pane.scale.max]) {
        const text = this.axisText(pane, pane.scale.fromScale(value));
        widest = Math.max(widest, ctx.measureText(text).width);
      }
    }
    return Math.ceil(widest + 18);
  }

  private paintSeries(pane: Pane, from: number, to: number): void {
    const ctx = this.context;
    const { chart } = this.theme;
    const scale = pane.scale;
    const bars = this.displayBars;
    const spacing = this.timeScale.spacing;
    const start = Math.max(0, from - 1);
    const end = Math.min(bars.length - 1, to + 1);
    if (this.priceStyle === 'line' || this.priceStyle === 'area' || this.priceStyle === 'baseline') {
      const points: Pt[] = [];
      for (let index = start; index <= end; index++) points.push({ x: this.timeScale.indexToX(index), y: scale.priceToY(bars[index].close) });
      if (!points.length) return;
      if (this.priceStyle === 'area') {
        const gradient = ctx.createLinearGradient(0, pane.top, 0, pane.top + pane.height);
        gradient.addColorStop(0, `${chart.line}55`);
        gradient.addColorStop(1, `${chart.line}05`);
        ctx.beginPath();
        ctx.moveTo(points[0].x, pane.top + pane.height);
        for (const point of points) ctx.lineTo(point.x, point.y);
        ctx.lineTo(points[points.length - 1].x, pane.top + pane.height);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();
      }
      if (this.priceStyle === 'baseline') {
        const baseY = scale.priceToY(scale.fromScale((scale.max + scale.min) / 2));
        for (const [isAbove, color] of [[true, chart.up], [false, chart.down]] as const) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, isAbove ? pane.top : baseY, this.plotWidth, isAbove ? baseY - pane.top : pane.top + pane.height - baseY);
          ctx.clip();
          ctx.beginPath();
          ctx.moveTo(points[0].x, baseY);
          for (const point of points) ctx.lineTo(point.x, point.y);
          ctx.lineTo(points[points.length - 1].x, baseY);
          ctx.closePath();
          ctx.fillStyle = `${color}26`;
          ctx.fill();
          ctx.beginPath();
          points.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        }
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = chart.border;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, this.crisp(baseY));
        ctx.lineTo(this.plotWidth, this.crisp(baseY));
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }
      ctx.beginPath();
      points.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
      ctx.strokeStyle = chart.line;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      return;
    }
    const body = Math.max(1, Math.floor(spacing * 0.75) - (spacing > 4 ? 1 : 0));
    const isBars = this.priceStyle === 'bars';
    const colors = this.colors();
    const { isWickVisible, isBorderVisible } = this.chartSettings;
    const isHollow = this.priceStyle === 'hollow';
    for (const isUp of [true, false]) {
      const bodyColor = isUp ? colors.up : colors.down;
      const wickColor = isUp ? colors.wickUp : colors.wickDown;
      const borderColor = isUp ? colors.borderUp : colors.borderDown;
      ctx.lineWidth = 1;
      for (let index = start; index <= end; index++) {
        const bar = bars[index];
        if ((bar.close >= bar.open) !== isUp) continue;
        const x = Math.round(this.timeScale.indexToX(index) * this.ratio) / this.ratio;
        const high = scale.priceToY(bar.high);
        const low = scale.priceToY(bar.low);
        const open = scale.priceToY(bar.open);
        const close = scale.priceToY(bar.close);
        if (isBars) {
          const tick = Math.max(1, Math.floor(body / 2));
          ctx.fillStyle = bodyColor;
          ctx.fillRect(x - 0.5, high, 1, Math.max(1, low - high));
          ctx.fillRect(x - tick, open - 0.5, tick, 1);
          ctx.fillRect(x, close - 0.5, tick, 1);
          continue;
        }
        const top = Math.min(open, close);
        const bottom = Math.max(open, close);
        if (isWickVisible) {
          ctx.fillStyle = wickColor;
          ctx.fillRect(x - 0.5, high, 1, Math.max(0, top - high));
          ctx.fillRect(x - 0.5, bottom, 1, Math.max(0, low - bottom));
        }
        const height = Math.max(1, bottom - top);
        if (isHollow && isUp) {
          ctx.strokeStyle = bodyColor;
          ctx.strokeRect(x - body / 2 + 0.5, top + 0.5, Math.max(0, body - 1), Math.max(0, height - 1));
          continue;
        }
        ctx.fillStyle = bodyColor;
        ctx.fillRect(x - body / 2, top, body, height);
        if (isBorderVisible && body > 2) {
          ctx.strokeStyle = borderColor;
          ctx.strokeRect(x - body / 2 + 0.5, top + 0.5, body - 1, Math.max(0, height - 1));
        }
      }
    }
  }

  private paintVolume(pane: Pane, from: number, to: number): void {
    const ctx = this.context;
    let largest = 0;
    for (let index = from; index <= to; index++) largest = Math.max(largest, this.barList[index]?.volume ?? 0);
    if (!largest) return;
    const height = pane.height * 0.2;
    const bottom = pane.top + pane.height;
    const width = Math.max(1, Math.floor(this.timeScale.spacing * 0.75));
    for (let index = Math.max(0, from - 1); index <= Math.min(this.barList.length - 1, to + 1); index++) {
      const bar = this.barList[index];
      const size = (bar.volume ?? 0) / largest * height;
      ctx.fillStyle = bar.close >= bar.open ? `${this.theme.chart.up}59` : `${this.theme.chart.down}59`;
      ctx.fillRect(this.timeScale.indexToX(index) - width / 2, bottom - size, width, size);
    }
  }

  private paintStudy(study: StudyState, pane: Pane, from: number, to: number): void {
    const output = study.output;
    if (!output) return;
    const ctx = this.context;
    const scale = pane.scale;
    const start = Math.max(0, from - 1);
    const end = to + 1;
    const plotByKey = new Map(output.plots.map((plot) => [plot.key, plot]));
    for (const band of output.bands ?? []) {
      const upper = plotByKey.get(band.from);
      const lower = plotByKey.get(band.to);
      if (!upper || !lower) continue;
      ctx.fillStyle = band.color;
      let run: { x: number; top: number; bottom: number }[] = [];
      const flush = () => {
        if (run.length > 1) {
          ctx.beginPath();
          run.forEach((point, index) => (index ? ctx.lineTo(point.x, point.top) : ctx.moveTo(point.x, point.top)));
          for (let index = run.length - 1; index >= 0; index--) ctx.lineTo(run[index].x, run[index].bottom);
          ctx.closePath();
          ctx.fill();
        }
        run = [];
      };
      for (let index = start; index <= end; index++) {
        const top = upper.values[index - (upper.offset ?? 0)];
        const bottom = lower.values[index - (lower.offset ?? 0)];
        if (top === null || top === undefined || bottom === null || bottom === undefined) { flush(); continue; }
        run.push({ x: this.timeScale.indexToX(index), top: scale.priceToY(top), bottom: scale.priceToY(bottom) });
      }
      flush();
    }
    for (const level of output.levels ?? []) {
      const y = this.crisp(scale.priceToY(level.price));
      ctx.strokeStyle = level.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.plotWidth, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const width = Math.max(1, Math.floor(this.timeScale.spacing * 0.6));
    for (const plot of output.plots) {
      const offset = plot.offset ?? 0;
      const kind = plot.kind ?? 'line';
      if (kind === 'histogram' || kind === 'columns') {
        const zero = scale.priceToY(Math.max(scale.min, Math.min(scale.max, 0)));
        for (let index = start; index <= end; index++) {
          const value = plot.values[index - offset];
          if (value === null || value === undefined) continue;
          const y = scale.priceToY(value);
          ctx.fillStyle = plot.colors?.[index - offset] ?? plot.color;
          ctx.fillRect(this.timeScale.indexToX(index) - width / 2, Math.min(y, zero), width, Math.max(1, Math.abs(zero - y)));
        }
        continue;
      }
      if (kind === 'circles') {
        for (let index = start; index <= end; index++) {
          const value = plot.values[index - offset];
          if (value === null || value === undefined) continue;
          ctx.fillStyle = plot.colors?.[index - offset] ?? plot.color;
          ctx.beginPath();
          ctx.arc(this.timeScale.indexToX(index), scale.priceToY(value), Math.max(1.5, Math.min(3, this.timeScale.spacing / 4)), 0, Math.PI * 2);
          ctx.fill();
        }
        continue;
      }
      ctx.lineWidth = plot.width ?? 1.5;
      ctx.lineJoin = 'round';
      ctx.setLineDash(plot.lineStyle === 'dashed' ? [6, 4] : plot.lineStyle === 'dotted' ? [1, 3] : []);
      let previous: Pt | null = null;
      let path: Pt[] = [];
      let color = plot.color;
      const flush = () => {
        if (path.length > 1) {
          ctx.strokeStyle = color;
          ctx.beginPath();
          path.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
          ctx.stroke();
        }
        path = [];
      };
      for (let index = start; index <= end; index++) {
        const value = plot.values[index - offset];
        if (value === null || value === undefined) { flush(); previous = null; continue; }
        const point = { x: this.timeScale.indexToX(index), y: scale.priceToY(value) };
        const pointColor = plot.colors?.[index - offset] ?? plot.color;
        if (pointColor !== color) {
          flush();
          if (previous) path.push(previous);
          color = pointColor;
        }
        path.push(point);
        previous = point;
      }
      flush();
      ctx.setLineDash([]);
    }
  }

  private paintPriceLines(pane: Pane): void {
    const ctx = this.context;
    for (const line of this.priceLines) {
      const y = this.crisp(pane.scale.priceToY(line.price));
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 1;
      ctx.setLineDash(dashOf(line.style));
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.plotWidth, y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (line.label) {
        ctx.font = `11px ${this.theme.chart.fontFamily}`;
        const width = ctx.measureText(line.label).width + 12;
        ctx.fillStyle = line.color;
        ctx.fillRect(8, y - 9, width, 18);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(line.label, 14, y);
      }
    }
  }

  // The symbol and timeframe, large and faint behind the bars.
  private paintWatermark(pane: Pane): void {
    const text = this.watermark ?? this.title;
    if (!text) return;
    const ctx = this.context;
    const size = Math.max(18, Math.min(72, this.plotWidth / Math.max(6, text.length) * 1.1, pane.height / 4));
    ctx.save();
    ctx.font = `600 ${size}px ${this.theme.chart.fontFamily}`;
    ctx.fillStyle = this.theme.chart.text;
    ctx.globalAlpha = 0.07;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, this.plotWidth / 2, pane.top + pane.height / 2);
    ctx.restore();
  }

  // While picking the replay start, the bars after the pointer are shaded; while replaying, the
  // area right of the last bar is marked.
  private paintReplay(timeAxisTop: number): void {
    const replay = this.replay!;
    const ctx = this.context;
    let x: number | null = null;
    if (replay.isSelecting) x = this.hover && this.hover.x < this.plotWidth ? this.timeScale.indexToX(this.timeScale.barAt(this.hover.x)) + this.timeScale.spacing / 2 : null;
    else x = this.timeScale.indexToX(this.timeScale.lastIndex) + this.timeScale.spacing / 2;
    if (x === null || x > this.plotWidth) return;
    ctx.fillStyle = 'rgba(41, 98, 255, 0.08)';
    ctx.fillRect(x, 0, this.plotWidth - x, timeAxisTop);
    ctx.strokeStyle = this.theme.ui.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.crisp(x), 0);
    ctx.lineTo(this.crisp(x), timeAxisTop);
    ctx.stroke();
  }

  private lastBar(): Bar | undefined {
    return this.displayBars[this.displayBars.length - 1];
  }

  private paintLastPrice(pane: Pane): void {
    const bar = this.lastBar();
    if (!bar) return;
    const ctx = this.context;
    const colors = this.colors();
    const color = bar.close >= bar.open ? colors.up : colors.down;
    const y = this.crisp(pane.scale.priceToY(this.barList[this.barList.length - 1].close));
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 2]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(this.plotWidth, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Price tags on the axis: host lines, the last price with its countdown, and study values.
  private paintAxisTags(): void {
    const pane = this.panes[0];
    const settings = this.chartSettings;
    for (const line of this.priceLines) this.axisTag(pane, line.price, this.axisText(pane, line.price), line.color);
    for (const study of this.studies) {
      if (!settings.isStudyLabelsShown || !study.isVisible || !study.output) continue;
      const target = this.panes.find((candidate) => candidate.id === study.paneId);
      if (!target) continue;
      for (const plot of study.output.plots) {
        const index = this.barList.length - 1 - (plot.offset ?? 0);
        const value = plot.values[Math.min(index, plot.values.length - 1)];
        if (value === null || value === undefined || plot.kind === 'circles') continue;
        this.axisTag(target, value, this.axisText(target, value), plot.colors?.[index] ?? plot.color);
      }
    }
    const bar = this.lastBar();
    if (!bar || !settings.isLastPriceLabelShown) return;
    const colors = this.colors();
    const color = bar.close >= bar.open ? colors.up : colors.down;
    const close = this.barList[this.barList.length - 1].close;
    const remaining = settings.isCountdownShown && !this.replay && this.interval < timeUnits.DAY ? bar.time + this.interval - Date.now() : -1;
    this.axisTag(pane, close, this.axisText(pane, close), color, remaining > 0 && remaining <= this.interval ? formatCountdown(remaining) : undefined);
  }

  private axisTag(pane: Pane, price: number, text: string, color: string, subtitle?: string): void {
    const y = pane.scale.priceToY(price);
    if (y < pane.top || y > pane.top + pane.height) return;
    const ctx = this.context;
    const height = subtitle ? 30 : 17;
    const top = Math.max(pane.top, Math.min(pane.top + pane.height - height, y - 8.5));
    ctx.fillStyle = color;
    ctx.fillRect(this.plotWidth + 1, top, this.width - this.plotWidth - 1, height);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, this.plotWidth + 8, top + 8.5);
    if (subtitle) ctx.fillText(subtitle, this.plotWidth + 8, top + 22);
  }

  private paintDrawings(): void {
    const ctx = this.context;
    const defaults = { color: '#2962ff', width: 1, dash: [] as number[], font: this.theme.chart.fontFamily };
    const ordered = this.shownDrawings().sort((left, right) => left.zIndex - right.zIndex);
    for (const drawing of ordered) paintShapes(ctx, this.shapesOf(drawing).shapes, defaults);
    if (this.draft) {
      const draft: SerializedDrawing = { id: 'draft', type: this.draft.type, paneId: 'price', anchors: this.draft.anchors, style: styleFor(this.draft.type), locked: false, visible: true, zIndex: 0, createdAt: 0, ...(this.draft.definition.hasText ? { text: this.draft.definition.defaultText ?? '' } : {}) };
      paintShapes(ctx, this.shapesOf(draft, true).shapes, defaults);
      if (this.draft.definition.anchors !== 'free') this.paintHandles(this.handlePoints(draft), draft.style.lineColor);
    }
    const selected = this.selected();
    if (selected && selected.visible && isShownOn(selected, this.interval)) this.paintHandles(this.handlePoints(selected), selected.style.lineColor);
  }

  private paintHandles(points: Pt[], color: string): void {
    const ctx = this.context;
    for (const point of points) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = this.theme.chart.background;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }

  // A crosshair at another chart's time: a vertical line and its time label.
  private paintExternalCrosshair(time: number): void {
    const index = Math.round(this.timeScale.indexOf(time));
    if (index < 0 || index > this.timeScale.lastIndex) return;
    const x = this.crisp(this.timeScale.indexToX(index));
    if (x < 0 || x > this.plotWidth) return;
    const ctx = this.context;
    const timeAxisTop = this.height - TIME_AXIS_HEIGHT;
    ctx.strokeStyle = this.colors().crosshair;
    ctx.lineWidth = 1;
    ctx.setLineDash(dashOf(this.chartSettings.crosshairStyle));
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, timeAxisTop);
    ctx.stroke();
    ctx.setLineDash([]);
    this.timeTag(x, this.barList[index].time);
  }

  private timeTag(x: number, time: number): void {
    const ctx = this.context;
    const timeAxisTop = this.height - TIME_AXIS_HEIGHT;
    const label = formatCrosshairTime(time, this.interval);
    ctx.font = `11px ${this.theme.chart.fontFamily}`;
    const width = ctx.measureText(label).width + 16;
    const left = Math.max(0, Math.min(this.plotWidth - width, x - width / 2));
    ctx.fillStyle = this.theme.ui.muted;
    ctx.fillRect(left, timeAxisTop + 1, width, TIME_AXIS_HEIGHT - 2);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, left + width / 2, timeAxisTop + TIME_AXIS_HEIGHT / 2);
  }

  private paintCrosshair(): void {
    const hover = this.hover;
    const isHoverOnPlot = hover && hover.x < this.plotWidth && hover.y < this.height - TIME_AXIS_HEIGHT;
    if (!isHoverOnPlot && this.externalTime !== null && this.barList.length && !this.drag) {
      this.paintExternalCrosshair(this.externalTime);
      return;
    }
    if (!hover || !isHoverOnPlot || this.drag?.kind === 'pan' || !this.barList.length) return;
    const ctx = this.context;
    const { ui } = this.theme;
    const index = this.timeScale.barAt(hover.x);
    const x = this.crisp(this.timeScale.indexToX(index));
    const pane = this.paneAt(hover.y);
    const timeAxisTop = this.height - TIME_AXIS_HEIGHT;
    const isDot = this.cursorMode === 'dot' && !this.tool;
    const isArrow = this.cursorMode === 'arrow-cursor' && !this.tool;
    const crosshair = this.colors().crosshair;
    if (isDot) {
      ctx.fillStyle = crosshair;
      ctx.beginPath();
      ctx.arc(hover.x, hover.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (!isArrow) {
      ctx.strokeStyle = crosshair;
      ctx.lineWidth = 1;
      ctx.setLineDash(this.chartSettings.crosshairStyle === 'dashed' ? [4, 4] : dashOf(this.chartSettings.crosshairStyle));
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, timeAxisTop);
      if (pane) {
        const y = this.crisp(hover.y);
        ctx.moveTo(0, y);
        ctx.lineTo(this.plotWidth, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const tagColor = ui.muted;
    if (pane) {
      const text = this.axisText(pane, pane.scale.yToPrice(hover.y));
      ctx.fillStyle = tagColor;
      ctx.fillRect(this.plotWidth + 1, hover.y - 9, this.width - this.plotWidth - 1, 18);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, this.plotWidth + 8, hover.y);
    }
    this.timeTag(x, this.barList[index].time);
  }

  private updateLegends(): void {
    const index = this.hover && this.hover.x < this.plotWidth && this.barList.length ? this.timeScale.barAt(this.hover.x) : this.barList.length - 1;
    const bar = this.displayBars[index];
    for (const pane of this.panes) {
      const entries: LegendEntry[] = this.studies.filter((study) => study.paneId === pane.id).map((study) => ({
        id: study.id,
        title: studyCaption(study.definition, study.inputs),
        values: index >= 0 && this.chartSettings.isStudyValuesShown ? this.studyValues(study, index) : [],
        isHidden: !study.isVisible,
      }));
      let title: { text: string; values: LegendValue[] } | null = null;
      const { isTitleShown, isOhlcShown } = this.chartSettings;
      if (pane.id === 'price' && (isTitleShown || isOhlcShown)) {
        const colors = this.colors();
        const color = bar && bar.close >= bar.open ? colors.up : colors.down;
        const previous = this.displayBars[index - 1];
        const change = bar && previous ? bar.close - previous.close : 0;
        title = {
          text: isTitleShown ? this.title : '',
          values: bar && isOhlcShown ? [
            { text: `O${formatPrice(bar.open, this.precision)}`, color },
            { text: `H${formatPrice(bar.high, this.precision)}`, color },
            { text: `L${formatPrice(bar.low, this.precision)}`, color },
            { text: `C${formatPrice(bar.close, this.precision)}`, color },
            { text: previous ? `${change >= 0 ? '+' : ''}${formatPrice(change, this.precision)} (${(change / previous.close * 100).toFixed(2)}%)` : '', color },
          ] : [],
        };
      }
      pane.legend.update(title, entries);
    }
  }
}

