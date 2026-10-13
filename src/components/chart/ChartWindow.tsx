import { useEffect, useMemo, useRef, useState } from 'react';
import { cursor } from '../../lib/cursor';
import { formatVolume } from '../../lib/format';
import { describeIndicator } from '../../lib/indicators';
import { log, requireSymbols, session, terminal } from '../../lib/session';
import { useStore } from '../../lib/store';
import { newId, updateChart, workspace, type ChartConfig } from '../../lib/workspace';
import { ChartController, type Pick, type TradeLevel } from './controller';
import { OneClickPanel } from './OneClickPanel';
import { TradeOverlay } from './TradeOverlay';
import { chartThemes } from './theme';

const HISTORY_BARS = 2000;

interface ChartWindowProps {
  chart: ChartConfig;
  isActive: boolean;
}

export function ChartWindow({ chart, isActive }: ChartWindowProps) {
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<ChartController | null>(null);
  const [instance, setInstance] = useState<ChartController | null>(null);
  const pendingTrend = useRef<Pick | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSelectingAnchor, setIsSelectingAnchor] = useState(false);
  const tool = useStore(workspace, (state) => state.tool);
  const scheme = useStore(workspace, (state) => state.scheme);
  const isOneClickEnabled = useStore(workspace, (state) => state.isOneClickEnabled);
  const isLinked = useStore(session, (state) => state.link.state === 'open' && (state.status?.mode !== 'mt5-web' || !!state.account));
  const spec = useStore(session, (state) => state.symbols[chart.symbol]);
  const tick = useStore(session, (state) => state.ticks[chart.symbol]);
  const positions = useStore(session, (state) => state.positions);
  const theme = chartThemes[scheme];
  const digits = spec?.digits ?? 5;
  const activeRef = useRef(isActive);
  activeRef.current = isActive;
  const chartRef = useRef(chart);
  chartRef.current = chart;
  const toolRef = useRef(tool);
  toolRef.current = tool;

  useEffect(() => {
    const instance = new ChartController(
      container.current!,
      (pick) => {
        const current = chartRef.current;
        const activeTool = toolRef.current;
        if (activeTool === 'hline') {
          updateChart(current.id, { drawings: [...current.drawings, { id: newId(), kind: 'hline', price: pick.price }] });
          workspace.set({ tool: 'cursor' });
        } else if (activeTool === 'vline') {
          updateChart(current.id, { drawings: [...current.drawings, { id: newId(), kind: 'vline', time: pick.time }] });
          workspace.set({ tool: 'cursor' });
        } else if (activeTool === 'ray') {
          updateChart(current.id, { drawings: [...current.drawings, { id: newId(), kind: 'ray', from: pick }] });
          workspace.set({ tool: 'cursor' });
        } else if (activeTool === 'trend' || activeTool === 'rectangle' || activeTool === 'fibonacci') {
          if (!pendingTrend.current) {
            pendingTrend.current = pick;
            setIsSelectingAnchor(true);
            return;
          }
          const from = pendingTrend.current;
          pendingTrend.current = null;
          setIsSelectingAnchor(false);
          updateChart(current.id, { drawings: [...current.drawings, { id: newId(), kind: activeTool, from, to: pick }] });
          workspace.set({ tool: 'cursor' });
        }
      },
      (hover) => {
        if (activeRef.current) {
          cursor.set({ bar: hover.bar, values: hover.values, symbol: chartRef.current.symbol });
        }
      },
    );
    controller.current = instance;
    setInstance(instance);
    return () => {
      instance.destroy();
      controller.current = null;
      setInstance(null);
    };
  }, []);

  useEffect(() => {
    controller.current?.rebuild({ type: chart.type, theme, digits, indicators: chart.indicators, isVolumeShown: chart.isVolumeShown });
  }, [chart.type, chart.indicators, chart.isVolumeShown, theme, digits]);

  useEffect(() => controller.current?.setGrid(chart.isGridShown, theme), [chart.isGridShown, theme]);
  useEffect(() => {
    controller.current?.setTool(tool);
    pendingTrend.current = null;
    setIsSelectingAnchor(false);
  }, [tool]);
  useEffect(() => controller.current?.setDrawings(chart.drawings), [chart.drawings]);
  useEffect(() => {
    if (isActive) {
      cursor.set({ digits, symbol: chart.symbol });
    }
  }, [isActive, digits, chart.symbol]);
  useEffect(() => controller.current?.setAsk(tick?.ask ?? 0), [tick?.ask]);
  useEffect(() => void requireSymbols([chart.symbol]), [chart.symbol]);

  useEffect(() => {
    if (!isLinked) {
      return;
    }
    let isCancelled = false;
    const params = { symbol: chart.symbol, timeframe: chart.timeframe };
    setIsLoading(true);
    setError(null);
    terminal
      .request('rates.get', { ...params, count: HISTORY_BARS })
      .then((bars) => {
        if (!isCancelled) {
          controller.current?.setBars(bars);
          setIsLoading(false);
        }
      })
      .catch((reason: Error) => {
        if (!isCancelled) {
          setError(reason.message);
          setIsLoading(false);
          log(`${chart.symbol},${chart.timeframe}: history request failed: ${reason.message}`, 'History');
        }
      });
    void terminal.request('rates.subscribe', params).catch(() => undefined);
    const off = terminal.on('bar', (event) => {
      if (event.symbol === params.symbol && event.timeframe === params.timeframe) {
        controller.current?.pushBar(event.bar);
      }
    });
    return () => {
      isCancelled = true;
      off();
      void terminal.request('rates.unsubscribe', params).catch(() => undefined);
    };
  }, [chart.symbol, chart.timeframe, isLinked]);

  const levels = useMemo<TradeLevel[]>(() => {
    const result: TradeLevel[] = [];
    for (const position of positions.filter((candidate) => candidate.symbol === chart.symbol)) {
      result.push({ kind: 'entry', price: position.priceOpen, label: `#${position.ticket} ${position.side} ${formatVolume(position.volume)}` });
    }
    // Stops, targets and pending orders are drawn by TradeOverlay so they can be dragged.
    return result;
  }, [positions, chart.symbol]);

  useEffect(() => controller.current?.setLevels(levels), [levels]);

  useEffect(() => {
    const zoom = (event: Event) => {
      if (activeRef.current) {
        const factor = (event as CustomEvent<number>).detail;
        if (factor === 0) {
          controller.current?.scrollToEnd();
        } else {
          controller.current?.zoom(factor);
        }
      }
    };
    window.addEventListener('terminal5:zoom', zoom);
    return () => window.removeEventListener('terminal5:zoom', zoom);
  }, []);

  useEffect(() => {
    const save = () => {
      if (!activeRef.current || !controller.current) return;
      controller.current.screenshot().toBlob((blob) => {
        if (!blob) { log('Chart image could not be created.', 'Charts'); return; }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${chartRef.current.symbol}-${chartRef.current.timeframe}.png`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    };
    window.addEventListener('terminal5:chart-image', save);
    return () => window.removeEventListener('terminal5:chart-image', save);
  }, []);

  const legend = [`${chart.symbol},${chart.timeframe}`, spec?.description, ...chart.indicators.map(describeIndicator)].filter(Boolean).join('  ');

  return (
    <div className={`chart-window${isActive ? ' is-active' : ''}`} onMouseDown={() => workspace.set({ activeChartId: chart.id })}>
      <div className="chart-canvas" ref={container} data-tool={tool} />
      <div className="chart-legend" style={{ color: theme.text }}>{legend}</div>
      {isSelectingAnchor && <div className="chart-status" style={{ color: theme.text }}>Click the second anchor point. Select Cursor to cancel.</div>}
      <TradeOverlay controller={instance} symbol={chart.symbol} digits={digits} />
      {isOneClickEnabled && <OneClickPanel symbol={chart.symbol} digits={digits} />}
      {(isLoading || error || !isLinked) && (
        <div className="chart-status" style={{ color: theme.text }}>
          {!isLinked ? 'Waiting for connection' : error ? `No data: ${error}` : 'Loading history'}
        </div>
      )}
    </div>
  );
}
