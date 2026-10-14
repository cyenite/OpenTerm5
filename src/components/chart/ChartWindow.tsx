import { useEffect, useRef, useState } from 'react';
import { defaultSettings, MeridianChart, type ChartSettings, type MeridianHover, type MeridianPriceLine, type SerializedDrawing } from '@meridian/charts';
import type { MenuItem } from '../MenuBar';
import { chartInstance, crosshairSync, registerChart } from '../../lib/chart-instances';
import type { IndicatorConfig } from '../../lib/chart-model';
import { formatPrice } from '../../lib/format';
import { priceAlerts, updateAlerts } from '../../lib/price-alerts';
import { cursor } from '../../lib/cursor';
import { mt5Provider, tickBars } from '../../lib/mt5-provider';
import { isSecondsTimeframe, timeframeSeconds, toChartTimeframe } from '../../lib/mt5-timeframes';
import { log, requireSymbols, session } from '../../lib/session';
import { useStore } from '../../lib/store';
import { themeStore } from '../../lib/theme';
import { tools, updateChart, workspace, type ChartConfig } from '../../lib/workspace';
import { chartMenu } from '../../lib/chart-menu';
import { openContextMenu } from '../../lib/context-menu';
import { OneClickPanel } from './OneClickPanel';
import { TradeOverlay } from './TradeOverlay';

interface ChartWindowProps {
  chart: ChartConfig;
  isActive: boolean;
}

const sameIndicators = (left: readonly IndicatorConfig[], right: readonly IndicatorConfig[]) => JSON.stringify(left) === JSON.stringify(right);
const sameDrawings = (left: readonly SerializedDrawing[], right: readonly SerializedDrawing[]) => JSON.stringify(left) === JSON.stringify(right);

function hoverToCursor(hover: MeridianHover, symbol: string) {
  const { ohlc, readout } = hover;
  const bar = ohlc ? { time: Math.floor(ohlc.time / 1000), open: ohlc.open, high: ohlc.high, low: ohlc.low, close: ohlc.close, volume: ohlc.volume ?? 0 } : null;
  const values = (readout?.groups ?? []).flatMap((group) => group.rows.map((row) => ({ label: row.label && row.label !== group.name ? `${group.name} ${row.label}` : group.name, text: row.value })));
  return { bar, values, symbol };
}

// True while a seconds chart has fewer than two bars: its history is still being recorded.
function useCollectingTicks(chart: ChartConfig): boolean {
  const seconds = isSecondsTimeframe(chart.timeframe) ? timeframeSeconds(chart.timeframe) : 0;
  const isShort = () => seconds > 0 && tickBars.coverage(chart.symbol) < seconds * 1000;
  const [isCollecting, setIsCollecting] = useState(isShort);
  useEffect(() => {
    setIsCollecting(isShort());
    if (!seconds) return;
    return tickBars.onBar((symbol) => { if (symbol === chart.symbol) setIsCollecting(isShort()); });
  }, [chart.symbol, seconds]);
  return isCollecting;
}

const chartTitle = (chart: ChartConfig, description?: string) => [chart.symbol, chart.timeframe, description].filter(Boolean).join(' · ');

const sameSettings = (left: ChartSettings | undefined, right: ChartSettings | undefined) => JSON.stringify(left ?? defaultSettings) === JSON.stringify(right ?? defaultSettings);

function addAlert(symbol: string, price: number, digits: number): void {
  const profileId = session.get().profileId;
  const bid = session.get().ticks[symbol]?.bid;
  if (!profileId) return;
  const level = Number(price.toFixed(digits));
  const condition = bid !== undefined && level < bid ? 'bidBelow' : 'bidAbove';
  try {
    updateAlerts([...priceAlerts.get().alerts, { id: crypto.randomUUID(), profileId, symbol, condition, price: level, createdAt: Date.now(), triggeredAt: null, isEnabled: true }]);
    log(`${symbol}: alert added at ${formatPrice(level, digits)}.`, 'Alerts');
  } catch {
    log('The alert could not be saved.', 'Alerts');
  }
}

// The chart engine's own commands, shown above the terminal's chart menu.
export function chartEngineItems(chartId: string, symbol: string, price: number | null, digits: number): MenuItem[] {
  const instance = chartInstance(chartId);
  if (!instance) return [];
  const separator: MenuItem = { label: '', isSeparator: true };
  const hasAccount = !!session.get().profileId;
  return [
    { label: 'Reset Chart View', shortcut: 'Alt+R', action: () => instance.resetView() },
    { label: 'Undo', shortcut: 'Ctrl+Z', isDisabled: !instance.canUndo(), action: () => instance.undo() },
    { label: 'Redo', shortcut: 'Ctrl+Y', isDisabled: !instance.canRedo(), action: () => instance.redo() },
    { label: 'Paste', shortcut: 'Ctrl+V', isDisabled: !instance.canPaste(), action: () => instance.paste() },
    separator,
    ...(price !== null && hasAccount ? [{ label: `Add Alert at ${formatPrice(price, digits)}`, action: () => addAlert(symbol, price, digits) }, separator] : []),
    { label: 'Object Tree', isChecked: instance.isObjectTreeShown(), action: () => instance.toggleObjectTree() },
    { label: instance.isReplaying() ? 'Exit Bar Replay' : 'Bar Replay', action: () => (instance.isReplaying() ? instance.exitReplay() : instance.startReplay()) },
    { label: 'Chart Settings...', action: () => instance.openChartSettings() },
    separator,
  ];
}

export function ChartWindow({ chart, isActive }: ChartWindowProps) {
  const container = useRef<HTMLDivElement>(null);
  const [instance, setInstance] = useState<MeridianChart | null>(null);
  const tool = useStore(workspace, (state) => state.tool);
  const theme = useStore(themeStore, (state) => state.theme);
  const isAnalysis = useStore(workspace, (state) => state.isAnalysisMode);
  const isOneClickEnabled = useStore(workspace, (state) => state.isOneClickEnabled && !state.isAnalysisMode);
  const isTradeOverlayShown = useStore(workspace, (state) => !state.isAnalysisMode || state.isAnalysisPositionsShown);
  const isCollectingTicks = useCollectingTicks(chart);
  const isLinked = useStore(session, (state) => state.link.state === 'open' && (state.status?.mode !== 'mt5-web' || !!state.account));
  const profileId = useStore(session, (state) => state.profileId);
  const spec = useStore(session, (state) => state.symbols[chart.symbol]);
  const ask = useStore(session, (state) => state.ticks[chart.symbol]?.ask ?? 0);
  const digits = spec?.digits ?? 5;
  const activeRef = useRef(isActive);
  activeRef.current = isActive;
  const chartRef = useRef(chart);
  chartRef.current = chart;
  const market = useRef(`${chart.symbol},${chart.timeframe}`);

  useEffect(() => {
    const current = chartRef.current;
    const meridian = new MeridianChart(container.current!, {
      symbol: current.symbol,
      timeframe: toChartTimeframe(current.timeframe),
      provider: mt5Provider,
      title: chartTitle(current, session.get().symbols[current.symbol]?.description),
      theme: themeStore.get().theme,
      priceStyle: current.type,
      isGridShown: current.isGridShown,
      isVolumeShown: current.isVolumeShown,
      isDrawingToolbarShown: workspace.get().isAnalysisMode,
      digits: session.get().symbols[current.symbol]?.digits ?? 5,
      settings: current.settings,
    });
    let isApplying = true;
    const unregister = registerChart(current.id, meridian);

    // Chart → workspace: what the user changed inside the chart (study settings, the legend's
    // remove button, drawing and editing objects) is saved with the chart.
    const saveIndicators = () => {
      if (isApplying) return;
      const indicators = meridian.indicators().map((indicator) => ({ id: indicator.id, kind: indicator.type, params: indicator.inputs }));
      if (!sameIndicators(indicators, chartRef.current.indicators)) updateChart(chartRef.current.id, { indicators });
    };
    const saveDrawings = () => {
      if (isApplying) return;
      const drawings = meridian.drawings();
      if (!sameDrawings(drawings, chartRef.current.drawings)) updateChart(chartRef.current.id, { drawings });
    };
    meridian.onIndicatorsChange(saveIndicators);
    meridian.onDrawingsChange(saveDrawings);
    meridian.onToolChange((type) => {
      const selected = tools.find((candidate) => candidate.key === workspace.get().tool);
      if (type === null && activeRef.current && selected?.drawing) workspace.set({ tool: 'cursor' });
    });
    meridian.onSettingsChange(() => {
      const settings = meridian.settings();
      if (!sameSettings(settings, chartRef.current.settings)) updateChart(chartRef.current.id, { settings });
    });
    meridian.onHover((hover) => {
      if (activeRef.current) cursor.set(hoverToCursor(hover, chartRef.current.symbol));
      const sync = crosshairSync.get();
      if (sync.time !== hover.time || sync.chartId !== chartRef.current.id) crosshairSync.set({ chartId: hover.time === null ? null : chartRef.current.id, time: hover.time });
    });
    const unsyncCrosshair = crosshairSync.subscribe(() => {
      const sync = crosshairSync.get();
      meridian.setCrosshairTime(sync.chartId !== chartRef.current.id ? sync.time : null);
    });
    // A right-click on the plot opens the terminal's chart menu with the engine's commands.
    meridian.onContextMenu((info, event) => {
      const current = chartRef.current;
      const digits = session.get().symbols[current.symbol]?.digits ?? 5;
      openContextMenu(event, [...chartEngineItems(current.id, current.symbol, info.price, digits), ...chartMenu(current.id, info.price ?? undefined)]);
      return true;
    });

    void meridian.ready().then(() => {
      // Saved studies are added afresh; the chart assigns their ids, written back below.
      for (const indicator of chartRef.current.indicators) {
        if (!meridian.addIndicator(indicator.kind, Object.keys(indicator.params).length ? indicator.params : undefined)) {
          log(`${chartRef.current.symbol}: the ${indicator.kind} study is no longer available and was removed.`, 'Charts');
        }
      }
      meridian.setDrawings(chartRef.current.drawings);
      // Restoring the saved chart is not something to undo.
      meridian.clearHistory();
      isApplying = false;
      saveIndicators();
      saveDrawings();
      setInstance(meridian);
    });
    return () => {
      setInstance(null);
      unsyncCrosshair();
      unregister();
      meridian.destroy();
    };
  }, []);

  useEffect(() => {
    if (instance && !sameSettings(instance.settings(), chart.settings)) instance.setSettings(chart.settings ?? defaultSettings);
  }, [instance, chart.settings]);

  // Workspace → chart: menus, templates and the objects list change the saved chart directly.
  useEffect(() => {
    if (!instance) return;
    const live = instance.indicators();
    const current = live.map((indicator) => ({ id: indicator.id, kind: indicator.type, params: indicator.inputs }));
    if (sameIndicators(current, chart.indicators)) return;
    const wanted = new Set(chart.indicators.map((indicator) => indicator.id));
    for (const indicator of live) if (!wanted.has(indicator.id)) instance.removeIndicator(indicator.id);
    const present = new Set(live.map((indicator) => indicator.id));
    for (const indicator of chart.indicators) {
      if (!present.has(indicator.id)) instance.addIndicator(indicator.kind, Object.keys(indicator.params).length ? indicator.params : undefined);
    }
  }, [instance, chart.indicators]);

  useEffect(() => {
    if (instance && !sameDrawings(instance.drawings(), chart.drawings)) instance.setDrawings(chart.drawings);
  }, [instance, chart.drawings]);

  useEffect(() => {
    const key = `${chart.symbol},${chart.timeframe}`;
    if (!instance || market.current === key) return;
    market.current = key;
    void instance.setMarket(chart.symbol, toChartTimeframe(chart.timeframe), chartTitle(chart, session.get().symbols[chart.symbol]?.description));
  }, [instance, chart.symbol, chart.timeframe]);

  // Another account serves other prices; reload once its connection is up.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!instance || !isLinked) return;
    const account = profileId ?? '';
    if (loadedFor.current !== null && loadedFor.current !== account) void instance.setMarket(chartRef.current.symbol, toChartTimeframe(chartRef.current.timeframe));
    loadedFor.current = account;
  }, [instance, isLinked, profileId]);

  useEffect(() => instance?.setTitle(chartTitle(chart, spec?.description)), [instance, chart, spec?.description]);
  useEffect(() => instance?.setTheme(theme), [instance, theme]);
  useEffect(() => instance?.setPriceStyle(chart.type), [instance, chart.type]);
  useEffect(() => instance?.setGrid(chart.isGridShown), [instance, chart.isGridShown]);
  useEffect(() => instance?.setVolume(chart.isVolumeShown), [instance, chart.isVolumeShown]);
  useEffect(() => instance?.setDigits(digits), [instance, digits]);
  useEffect(() => instance?.setDrawingToolbar(isAnalysis), [instance, isAnalysis]);
  const alerts = useStore(priceAlerts, (state) => state.alerts.filter((alert) => alert.symbol === chart.symbol && alert.profileId === profileId && alert.isEnabled && alert.triggeredAt === null));
  useEffect(() => {
    const lines: MeridianPriceLine[] = alerts.map((alert) => ({ id: `alert-${alert.id}`, price: alert.price, color: theme.ui.warn, style: 'dashed', label: 'Alert' }));
    if (ask) lines.push({ id: 'ask', price: ask, color: theme.chart.askLine, style: 'dotted' });
    instance?.setPriceLines(lines);
  }, [instance, ask, theme, alerts]);
  useEffect(() => void requireSymbols([chart.symbol]), [chart.symbol]);

  useEffect(() => {
    if (!instance) return;
    const drawing = isActive ? tools.find((candidate) => candidate.key === tool)?.drawing ?? null : null;
    instance.setTool(drawing);
  }, [instance, tool, isActive]);

  useEffect(() => {
    if (isActive) cursor.set({ digits, symbol: chart.symbol, hasSeconds: isSecondsTimeframe(chart.timeframe) });
  }, [isActive, digits, chart.symbol, chart.timeframe]);

  useEffect(() => {
    if (!instance) return;
    const zoom = (event: Event) => {
      if (!activeRef.current) return;
      const factor = (event as CustomEvent<number>).detail;
      if (factor === 0) instance.scrollToEnd();
      else instance.zoom(factor);
    };
    const save = () => {
      if (!activeRef.current) return;
      const canvas = instance.screenshot();
      if (!canvas) { log('Chart image could not be created.', 'Charts'); return; }
      canvas.toBlob((blob) => {
        if (!blob) { log('Chart image could not be created.', 'Charts'); return; }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${chartRef.current.symbol}-${chartRef.current.timeframe}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    };
    window.addEventListener('openterm:zoom', zoom);
    window.addEventListener('openterm:chart-image', save);
    return () => {
      window.removeEventListener('openterm:zoom', zoom);
      window.removeEventListener('openterm:chart-image', save);
    };
  }, [instance]);

  return (
    <div
      className={`chart-window${isActive ? ' is-active' : ''}`}
      onMouseDown={() => workspace.set({ activeChartId: chart.id })}
    >
      <div className="chart-canvas" ref={container} data-tool={tool} />
      {isTradeOverlayShown && <TradeOverlay chart={instance} symbol={chart.symbol} digits={digits} />}
      {isOneClickEnabled && <OneClickPanel symbol={chart.symbol} digits={digits} />}
      {!isLinked && <div className="chart-status">Waiting for connection</div>}
      {isLinked && isCollectingTicks && <div className="chart-status">Building {chart.timeframe} bars from live quotes. Seconds charts start when OpenTerm5 receives the symbol's first quotes.</div>}
    </div>
  );
}
