import { useEffect, useRef, useState } from 'react';
import { MeridianChart, type MeridianPriceLine, type PriceStyle, type SerializedDrawing } from '@meridian/charts';
import type { HubChartDocument, HubIndicator } from '../../../shared/hub';
import { formatPrice } from '../../lib/format';
import { mt5Provider } from '../../lib/mt5-provider';
import { toChartTimeframe, type ChartTimeframe } from '../../lib/mt5-timeframes';
import { requireSymbols, session } from '../../lib/session';
import { useStore } from '../../lib/store';
import { bridge, canTrade, onChartsChanged, onReady, requestChart } from '../bridge';
import { navigation, openSheet } from '../navigation';
import { mobileTheme } from '../theme';

export const phoneTimeframes = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'] as const;

export const phoneTools = [
  { key: null, label: 'Pan' },
  { key: 'trend-line', label: 'Trend' },
  { key: 'horizontal-line', label: 'Level' },
  { key: 'horizontal-ray', label: 'Ray' },
  { key: 'rectangle', label: 'Box' },
  { key: 'fib-retracement', label: 'Fib' },
  { key: 'long-position', label: 'Long' },
  { key: 'short-position', label: 'Short' },
  { key: 'text', label: 'Text' },
] as const;

const persistent = (drawings: readonly SerializedDrawing[]) => drawings.filter((drawing) => !drawing.props?.isTransient);
const studiesKey = (indicators: readonly HubIndicator[]) => JSON.stringify(indicators.map((indicator) => [indicator.kind, indicator.params]));
const title = (chart: HubChartDocument) => `${chart.symbol} · ${chart.timeframe}`;

function sameDrawings(left: readonly SerializedDrawing[], right: readonly SerializedDrawing[]): boolean {
  const byId = new Map(right.map((drawing) => [drawing.id, JSON.stringify(drawing)]));
  return left.length === right.length && left.every((drawing) => byId.get(drawing.id) === JSON.stringify(drawing));
}

interface ChartCanvasProps {
  initial: HubChartDocument;
  tool: string | null;
  onDocument: (chart: HubChartDocument) => void;
  onToolEnd: () => void;
  onError: (message: string) => void;
}

// One Meridian chart kept in step with a chart on the computer: drawings made here are sent as
// edits by id, and the computer's changes replace what is shown.
function ChartCanvas({ initial, tool, onDocument, onToolEnd, onError }: ChartCanvasProps) {
  const container = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<MeridianChart | null>(null);
  const symbol = useRef(initial.symbol);
  const positions = useStore(session, (state) => state.positions);
  const theme = useStore(mobileTheme, (state) => state.theme);

  useEffect(() => {
    const chartId = initial.id;
    const meridian = new MeridianChart(container.current!, {
      symbol: initial.symbol,
      timeframe: toChartTimeframe(initial.timeframe as ChartTimeframe),
      provider: mt5Provider,
      title: title(initial),
      theme: mobileTheme.get().theme,
      priceStyle: initial.type as PriceStyle,
      isVolumeShown: initial.isVolumeShown,
      isDrawingToolbarShown: false,
      digits: session.get().symbols[initial.symbol]?.digits ?? 5,
    });
    let current = initial;
    let studies = '';
    let isLoaded = false;
    const synced = new Map<string, string>();
    const remember = (drawings: readonly SerializedDrawing[]) => {
      synced.clear();
      for (const drawing of drawings) synced.set(drawing.id, JSON.stringify(drawing));
    };
    const applyStudies = (indicators: readonly HubIndicator[]) => {
      const key = studiesKey(indicators);
      if (key === studies) return;
      studies = key;
      for (const indicator of meridian.indicators()) meridian.removeIndicator(indicator.id);
      // Pine studies run in the computer's script workers; the phone shows the others.
      for (const indicator of indicators) meridian.addIndicator(indicator.kind, Object.keys(indicator.params).length ? { ...indicator.params } : undefined);
    };
    const adopt = (next: HubChartDocument) => {
      const isMarketChanged = next.symbol !== current.symbol || next.timeframe !== current.timeframe;
      current = next;
      symbol.current = next.symbol;
      onDocument(next);
      if (isMarketChanged) {
        void requireSymbols([next.symbol]);
        meridian.setDigits(session.get().symbols[next.symbol]?.digits ?? 5);
        void meridian.setMarket(next.symbol, toChartTimeframe(next.timeframe as ChartTimeframe), title(next));
      }
      meridian.setPriceStyle(next.type as PriceStyle);
      meridian.setVolume(next.isVolumeShown);
      if (!isLoaded) return;
      applyStudies(next.indicators);
      const drawings = next.drawings as unknown as SerializedDrawing[];
      remember(drawings);
      if (!sameDrawings(persistent(meridian.drawings()), drawings)) meridian.setDrawings(drawings);
    };
    const refresh = () => void requestChart('charts.get', { chartId }).then(adopt).catch((error: Error) => onError(error.message));
    const push = () => {
      const drawings = persistent(meridian.drawings());
      const ids = new Set(drawings.map((drawing) => drawing.id));
      const upserts = drawings.filter((drawing) => synced.get(drawing.id) !== JSON.stringify(drawing));
      const removals = [...synced.keys()].filter((id) => !ids.has(id));
      if (!upserts.length && !removals.length) return;
      remember(drawings);
      void requestChart('charts.editDrawings', { chartId, upserts, removals }).then(adopt).catch((error: Error) => {
        onError(error.message);
        refresh();
      });
    };
    void requireSymbols([initial.symbol]);
    void meridian.ready().then(() => {
      applyStudies(initial.indicators);
      const drawings = initial.drawings as unknown as SerializedDrawing[];
      meridian.setDrawings(drawings);
      remember(drawings);
      meridian.clearHistory();
      isLoaded = true;
    });
    const stopDrawings = meridian.onDrawingsChange(() => { if (isLoaded) push(); });
    const stopTool = meridian.onToolChange((type) => { if (type === null) onToolEnd(); });
    const stopChanges = onChartsChanged(({ chartIds }) => { if (chartIds.includes(chartId)) refresh(); });
    // A new connection holds none of the old one's bar subscriptions, so the chart loads again.
    const stopReady = onReady(() => {
      void meridian.setMarket(current.symbol, toChartTimeframe(current.timeframe as ChartTimeframe), title(current));
      refresh();
    });
    setEngine(meridian);
    return () => {
      stopDrawings();
      stopTool();
      stopChanges();
      stopReady();
      setEngine(null);
      meridian.destroy();
    };
  }, [initial.id]);

  useEffect(() => { engine?.setDrawingTools({ tool }); }, [engine, tool]);
  useEffect(() => { engine?.setTheme(theme); }, [engine, theme]);

  useEffect(() => {
    if (!engine) return;
    const lines: MeridianPriceLine[] = positions.filter((position) => position.symbol === symbol.current).flatMap((position) => [
      { id: `open-${position.ticket}`, price: position.priceOpen, color: position.side === 'buy' ? theme.ui.buy : theme.ui.sell, label: `${position.side === 'buy' ? 'Buy' : 'Sell'} ${position.volume}` },
      ...(position.sl ? [{ id: `sl-${position.ticket}`, price: position.sl, color: theme.ui.loss, style: 'dashed' as const, label: 'SL' }] : []),
      ...(position.tp ? [{ id: `tp-${position.ticket}`, price: position.tp, color: theme.ui.profit, style: 'dashed' as const, label: 'TP' }] : []),
    ]);
    engine.setPriceLines(lines);
  }, [engine, positions, theme]);

  return <div ref={container} className="phone-chart-canvas" />;
}

interface TradeBarProps {
  symbol: string;
}

function TradeBar({ symbol }: TradeBarProps) {
  const tick = useStore(session, (state) => state.ticks[symbol]);
  const digits = useStore(session, (state) => state.symbols[symbol]?.digits ?? 5);
  return (
    <div className="phone-trade-bar">
      <button type="button" className="is-sell" onClick={() => openSheet({ kind: 'order', symbol, side: 'sell' })}>Sell<span>{formatPrice(tick?.bid, digits)}</span></button>
      <button type="button" className="is-buy" onClick={() => openSheet({ kind: 'order', symbol, side: 'buy' })}>Buy<span>{formatPrice(tick?.ask, digits)}</span></button>
    </div>
  );
}

interface ChartViewProps {
  chartId: string;
}

export function ChartView({ chartId }: ChartViewProps) {
  const [chart, setChart] = useState<HubChartDocument | null>(null);
  const [initial, setInitial] = useState<HubChartDocument | null>(null);
  const [tool, setTool] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [isToolsShown, setIsToolsShown] = useState(false);
  const isTrader = useStore(bridge, canTrade);

  useEffect(() => {
    let isActive = true;
    setInitial(null);
    void requestChart('charts.get', { chartId }).then((value) => {
      if (!isActive) return;
      setInitial(value);
      setChart(value);
    }).catch((reason: Error) => isActive && setError(reason.message));
    return () => { isActive = false; };
  }, [chartId]);

  const setTimeframe = (timeframe: string) => {
    setError('');
    void requestChart('charts.setMarket', { chartId, timeframe }).then(setChart).catch((reason: Error) => setError(reason.message));
  };

  return (
    <div className="phone-chart">
      <header className="phone-chart-head">
        <button type="button" className="phone-icon-button" aria-label="All charts" onClick={() => navigation.set({ chartId: null })}>‹</button>
        <button type="button" className="phone-symbol-button" onClick={() => openSheet({ kind: 'symbol', chartId })}>{chart?.symbol ?? '…'}</button>
        <div className="phone-chips" role="radiogroup" aria-label="Timeframe">
          {phoneTimeframes.map((timeframe) => (
            <button key={timeframe} type="button" role="radio" aria-checked={chart?.timeframe === timeframe} className={chart?.timeframe === timeframe ? 'is-active' : ''} onClick={() => setTimeframe(timeframe)}>{timeframe}</button>
          ))}
        </div>
        <button type="button" className={`phone-icon-button${isToolsShown ? ' is-active' : ''}`} aria-label="Drawing tools" aria-pressed={isToolsShown} onClick={() => setIsToolsShown(!isToolsShown)}>✎</button>
      </header>
      {isToolsShown && (
        <div className="phone-chips phone-tools" role="radiogroup" aria-label="Drawing tool">
          {phoneTools.map((item) => (
            <button key={item.label} type="button" role="radio" aria-checked={tool === item.key} className={tool === item.key ? 'is-active' : ''} onClick={() => setTool(item.key)}>{item.label}</button>
          ))}
        </div>
      )}
      {error && <p className="phone-error" role="alert" onClick={() => setError('')}>{error}</p>}
      {initial ? <ChartCanvas initial={initial} tool={tool} onDocument={setChart} onToolEnd={() => setTool(null)} onError={setError} /> : <div className="phone-chart-canvas phone-placeholder">Loading the chart…</div>}
      {isTrader && chart && <TradeBar symbol={chart.symbol} />}
    </div>
  );
}
