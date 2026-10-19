import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { MeridianChart } from '@meridian/charts';
import { decidePlan, type PlanLines } from '../../../shared/order-plan';
import { orderType } from '../../../shared/protocol';
import { plannerRiskModes } from '../../../shared/automation';
import { profitAt } from '../../lib/backtest/engine';
import type { SimOrder, SimPosition } from '../../lib/backtest/model';
import {
  activeBacktest,
  backtest,
  backtestMarket,
  backtestPending,
  backtestQuote,
  backtestRiskLots,
  cancelBacktestOrder,
  closeBacktestPosition,
  modifyBacktestOrder,
  modifyBacktestPosition,
  reportBacktest,
  useActiveBacktest,
} from '../../lib/backtest/runtime';
import { simulationOf } from '../../lib/backtest/session-model';
import { formatMoney, formatPrice, formatVolume } from '../../lib/format';
import { riskPreferences, setRiskPreferences } from '../../lib/risk-preferences';
import { useStore } from '../../lib/store';
import { workspace } from '../../lib/workspace';
import { Segmented, Switch } from '../ui/Controls';
import { QuickTradePanel } from '../chart/OneClickPanel';
import { LineHandle, priceAtPointer, useLineGeometry, type OverlayLine } from '../chart/OverlayLines';
import { spreadLabels } from '../../lib/overlay-labels';

interface BacktestPlannerProps {
  symbol: string;
  lots: number;
  digits: number;
  entry: number;
  title: string;
  error: string | null;
  riskMoney: number;
  isMarketForced: boolean;
  onMarket: (isOn: boolean) => void;
  onPlace: () => void;
  onCancel: () => void;
}

function BacktestPlanner({ symbol, lots, digits, entry, title, error, riskMoney, isMarketForced, onMarket, onPlace, onCancel }: BacktestPlannerProps) {
  const preferences = useStore(riskPreferences, (state) => state);
  const currency = useStore(backtest, (state) => activeBacktest(state)?.currency ?? '');
  const mode = plannerRiskModes.find((item) => item.key === preferences.mode)!;
  return (
    <div className="planner-panel" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <strong>{title}</strong>
        <span className="is-muted">{symbol} · backtest</span>
      </header>
      <Segmented label="Risk mode" value={preferences.mode} options={plannerRiskModes} onChange={(value) => setRiskPreferences({ mode: value })} />
      <label className="planner-amount">
        <span>Risk</span>
        <input type="number" min={0} step={preferences.mode === 'money' ? 10 : 0.1} value={preferences.value} onChange={(event) => setRiskPreferences({ value: Number(event.target.value) })} aria-label={`Risk ${mode.label}`} />
        <em>{preferences.mode === 'money' ? currency : mode.unit}</em>
      </label>
      <Switch label="Execute at market" hint="Ignore the entry line and fill at the replay price." isOn={isMarketForced} onChange={onMarket} />
      <div className={`planner-figures${error ? ' is-bad' : ''}`} aria-live="polite">
        {error ? <span>{error}</span> : (
          <>
            <span>Volume <b>{formatVolume(lots)}</b></span>
            <span>Risk <b>{formatMoney(riskMoney)} {currency}</b></span>
            <span>Entry <b>{formatPrice(entry, digits)}</b></span>
          </>
        )}
      </div>
      <div className="planner-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="is-primary" disabled={!!error} onClick={onPlace}>Place order</button>
      </div>
    </div>
  );
}

interface BacktestOverlayProps {
  chart: MeridianChart | null;
  symbol: string;
  digits: number;
}

// The backtest's positions and orders on a replaying chart, with the live overlay's handling:
// drag a stop, target or order price to move it, drag SL or TP off the entry to add one, and plan
// a risk order with the Risk Order tool. Changes apply on release; the simulated broker refuses
// anything MetaTrader would.
export function BacktestOverlay({ chart: controller, symbol, digits }: BacktestOverlayProps) {
  const item = useActiveBacktest();
  const tool = useStore(workspace, (state) => state.tool);
  const quote = useStore(backtest, (state) => backtestQuote(state, symbol));
  const preferences = useStore(riskPreferences, (state) => state);
  const [plan, setPlan] = useState<Partial<PlanLines>>({});
  const [isMarketForced, setIsMarketForced] = useState(false);
  const [dragged, setDragged] = useState<{ id: string; price: number } | null>(null);
  const drag = useRef<{ line: OverlayLine; pointerId: number; startY: number; isPlacing: boolean } | null>(null);
  const linesRef = useRef<OverlayLine[]>([]);
  const geometry = useLineGeometry(controller, linesRef);
  const terms = item?.terms[symbol];
  const point = terms?.point ?? 10 ** -digits;
  const round = (price: number) => Number((Math.round(price / point) * point).toFixed(digits));
  const isPlanning = tool === 'riskOrder';
  const hasPlan = plan.entry !== undefined;
  const stage = plan.entry === undefined ? 'entry' : plan.stop === undefined ? 'stop' : plan.target === undefined ? 'target' : 'ready';
  const reset = () => {
    setPlan({});
    setIsMarketForced(false);
    if (workspace.get().tool === 'riskOrder') workspace.set({ tool: 'cursor' });
  };

  // Keyed on one flag, as in the live overlay: Escape resets the tool and re-renders first.
  const isPlannerActive = isPlanning || hasPlan;
  useEffect(() => {
    if (!isPlannerActive) return;
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') reset(); };
    window.addEventListener('keydown', cancel, true);
    return () => window.removeEventListener('keydown', cancel, true);
  }, [isPlannerActive]);

  if (!item) return null;
  const simulation = simulationOf(item);
  const moneyOf = (side: 'buy' | 'sell', priceOpen: number, volume: number) => terms ? (price: number) => profitAt(simulation, terms, side, priceOpen, volume, price) : undefined;

  const decision = hasPlan ? decidePlan(plan as PlanLines, quote ?? undefined, isMarketForced, 0) : null;
  const sizing = decision?.side && plan.stop ? backtestRiskLots(symbol, decision.side, decision.entry, plan.stop, preferences.mode, preferences.value) : null;
  const planError = decision?.error ?? sizing?.error ?? (!quote ? `${symbol} has no replay price yet.` : null);

  const lines: OverlayLine[] = [];
  if (hasPlan) {
    const label = decision?.type ? orderType(decision.type)!.label : 'Entry';
    lines.push({ id: 'plan-entry', role: 'entry', price: decision?.isMarket ? decision.entry : plan.entry!, label: sizing && !sizing.error ? `${label} ${formatVolume(sizing.lots)}` : label, isDraggable: !decision?.isMarket, onMove: (price) => setPlan((current) => ({ ...current, entry: price })) });
    if (plan.stop !== undefined) lines.push({ id: 'plan-stop', role: 'stop', price: plan.stop, label: sizing && !sizing.error ? `SL -${formatMoney(sizing.riskMoney)}` : 'SL', isDraggable: true, onMove: (price) => setPlan((current) => ({ ...current, stop: price })) });
    if (plan.target !== undefined && decision) {
      const reward = plan.stop ? Math.abs(plan.target - decision.entry) / Math.abs(decision.entry - plan.stop) : 0;
      lines.push({ id: 'plan-target', role: 'target', price: plan.target, label: reward ? `TP ${reward.toFixed(2)}R` : 'TP', isDraggable: true, onMove: (price) => setPlan((current) => ({ ...current, target: price })) });
    }
  }
  const positionLevel = (position: SimPosition, kind: 'sl' | 'tp', price = kind === 'sl' ? position.sl : position.tp): OverlayLine => ({
    id: `pos-${position.ticket}-${kind}`, role: kind === 'sl' ? 'stop' : 'target', price, label: kind.toUpperCase(), isDraggable: true,
    title: `#${position.ticket} ${position.side} ${formatVolume(position.volume)} ${kind === 'sl' ? 'stop loss' : 'take profit'}`,
    moneyAt: moneyOf(position.side, position.priceOpen, position.volume),
    onDrop: (value) => reportBacktest(modifyBacktestPosition(position.ticket, kind === 'sl' ? value : position.sl, kind === 'tp' ? value : position.tp)),
  });
  const orderLevel = (order: SimOrder, kind: 'price' | 'sl' | 'tp'): OverlayLine => {
    const definition = orderType(order.type)!;
    const side = definition.isBuy ? 'buy' : 'sell';
    const entry = order.stopLimit > 0 ? order.stopLimit : order.price;
    return {
      id: `ord-${order.ticket}-${kind}`, role: kind === 'price' ? 'pending' : kind === 'sl' ? 'stop' : 'target', price: kind === 'price' ? order.price : order[kind], isDraggable: true,
      label: kind === 'price' ? `${definition.label} ${formatVolume(order.volume)}` : kind.toUpperCase(),
      title: `Order #${order.ticket}`,
      moneyAt: kind === 'price' ? undefined : moneyOf(side, entry, order.volume),
      onDrop: (value) => reportBacktest(modifyBacktestOrder(order.ticket, { price: kind === 'price' ? value : order.price, stopLimit: order.stopLimit, sl: kind === 'sl' ? value : order.sl, tp: kind === 'tp' ? value : order.tp, expiration: order.expiration })),
    };
  };
  for (const position of item.book.positions.filter((candidate) => candidate.symbol === symbol)) {
    const money = moneyOf(position.side, position.priceOpen, position.volume);
    const current = quote ? (position.side === 'buy' ? quote.bid : quote.ask) : position.priceOpen;
    lines.push({
      id: `pos-${position.ticket}-entry`, role: 'position', price: position.priceOpen, isDraggable: false,
      label: `${position.side.toUpperCase()} ${formatVolume(position.volume)}`,
      title: `#${position.ticket} ${position.comment}`.trim(),
      moneyAt: money ? () => money(current) : undefined,
      ghosts: (['tp', 'sl'] as const).filter((kind) => !(kind === 'sl' ? position.sl : position.tp)).map((kind) => ({ kind, line: positionLevel(position, kind, position.priceOpen) })),
      onClose: () => reportBacktest(closeBacktestPosition(position.ticket)),
    });
    if (position.sl || dragged?.id === `pos-${position.ticket}-sl`) lines.push(positionLevel(position, 'sl', position.sl || position.priceOpen));
    if (position.tp || dragged?.id === `pos-${position.ticket}-tp`) lines.push(positionLevel(position, 'tp', position.tp || position.priceOpen));
  }
  for (const order of item.book.orders.filter((candidate) => candidate.symbol === symbol)) {
    lines.push({ ...orderLevel(order, 'price'), closeLabel: 'Delete order', onClose: () => reportBacktest(cancelBacktestOrder(order.ticket)) });
    if (order.sl) lines.push(orderLevel(order, 'sl'));
    if (order.tp) lines.push(orderLevel(order, 'tp'));
  }
  const shown = lines.map((line) => (dragged?.id === line.id ? { ...line, price: dragged.price } : line));
  linesRef.current = shown;

  const priceAt = (event: ReactPointerEvent) => priceAtPointer(controller, event.clientY, event.currentTarget as HTMLElement, round);

  const startDrag = (line: OverlayLine, event: ReactPointerEvent, isPlacing = false) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { line, pointerId: event.pointerId, startY: event.clientY, isPlacing };
    if (!line.onMove) setDragged({ id: line.id, price: line.price });
  };

  const moveDrag = (event: ReactPointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const price = priceAt(event);
    if (price === null) return;
    if (active.line.onMove) active.line.onMove(price);
    else setDragged({ id: active.line.id, price });
  };

  const endDrag = (event: ReactPointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragged(null);
    // Changes apply on release without an Apply step, so a click on a line must not nudge it.
    const isMoved = Math.abs(event.clientY - active.startY) >= 3;
    const price = priceAt(event);
    if (price !== null && isMoved && active.line.onDrop && price !== active.line.price) active.line.onDrop(price);
    if (active.isPlacing && stage === 'ready' && workspace.get().tool === 'riskOrder') workspace.set({ tool: 'cursor' });
  };

  const place = (event: ReactPointerEvent) => {
    if (event.button !== 0 || !isPlanning || stage === 'ready') return;
    const price = priceAt(event);
    if (price === null) return;
    const role = stage === 'entry' ? 'entry' : stage === 'stop' ? 'stop' : 'target';
    setPlan((current) => ({ ...current, [role]: price }));
    startDrag({ id: `plan-${role}`, role, price, label: role, isDraggable: true, onMove: (value) => setPlan((current) => ({ ...current, [role]: value })) }, event, true);
  };

  const submit = async () => {
    if (!decision?.side || !decision.type || !sizing || sizing.error || !plan.stop) return;
    const request = { symbol, volume: sizing.lots, sl: plan.stop, tp: plan.target ?? 0 };
    const problem = decision.isMarket
      ? await backtestMarket({ ...request, side: decision.side })
      : await backtestPending({ ...request, type: decision.type as Exclude<typeof decision.type, 'buy' | 'sell'>, price: decision.entry });
    if (problem) reportBacktest(problem);
    else reset();
  };

  // Labels of lines close together are spread apart, as on live charts.
  const isOnScreen = (y: number | null | undefined): y is number => y !== null && y !== undefined && y >= 0 && y <= geometry.height;
  const labelOffsets = spreadLabels(shown.flatMap((line) => isOnScreen(geometry.ys[line.id]) ? [{ id: line.id, y: geometry.ys[line.id]!, lane: 'trades' }] : []), 18, geometry.height);

  const title = decision?.type ? `${orderType(decision.type)!.label}${decision.isMarket ? ' at market' : ''}` : 'Risk order';

  return (
    <div className="trade-overlay" style={{ left: geometry.left, width: geometry.width }} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      {isPlanning && stage !== 'ready' && (
        <div className="overlay-capture" style={{ width: geometry.width, height: geometry.height }} onPointerDown={place}>
          <span className="overlay-prompt">{stage === 'entry' ? 'Drag to place the entry' : stage === 'stop' ? 'Click or drag to place the stop loss' : 'Click or drag to place the take profit'} · Esc cancels</span>
        </div>
      )}
      {shown.map((line) => {
        const y = geometry.ys[line.id];
        if (!isOnScreen(y)) return null;
        return <LineHandle key={line.id} line={line} y={y} left={0} width={geometry.width} labelOffset={labelOffsets.get(line.id) ?? 0} digits={digits} currency={item.currency} onStartDrag={(target, event) => startDrag(target, event)} onApply={() => undefined} onDiscard={() => undefined} />;
      })}
      {hasPlan && plan.stop !== undefined && decision && (
        <BacktestPlanner symbol={symbol} lots={sizing?.lots ?? 0} digits={digits} entry={decision.entry} title={title} error={planError} riskMoney={sizing?.riskMoney ?? 0} isMarketForced={isMarketForced} onMarket={setIsMarketForced} onPlace={() => void submit()} onCancel={reset} />
      )}
    </div>
  );
}

interface BacktestTradePanelProps {
  symbol: string;
  digits: number;
}

// Sell and buy at the replay price, on every chart of a running backtest.
export function BacktestTradePanel({ symbol, digits }: BacktestTradePanelProps) {
  const quote = useStore(backtest, (state) => backtestQuote(state, symbol));
  const terms = useStore(backtest, (state) => activeBacktest(state)?.terms[symbol]);
  const isStarting = useStore(backtest, (state) => state.isStarting);
  const trade = async (side: 'buy' | 'sell', volume: number) => reportBacktest(await backtestMarket({ side, symbol, volume }));
  return <QuickTradePanel bid={quote?.bid} ask={quote?.ask} digits={terms?.digits ?? digits} volumeMin={terms?.volumeMin ?? 0.01} volumeMax={terms?.volumeMax ?? 100} volumeStep={terms?.volumeStep ?? 0.01} canTrade={!isStarting} onTrade={trade} />;
}
