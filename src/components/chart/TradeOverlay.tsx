import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { plannerRiskModes, type RiskOrderOutcome, type RiskOrderRequest } from '../../../shared/automation';
import { decidePlan, validateDrag, type PlanLines } from '../../../shared/order-plan';
import { orderType, type Order, type Position } from '../../../shared/protocol';
import { formatMoney, formatPrice, formatVolume } from '../../lib/format';
import { replayTradingHint } from '../../lib/replay-session';
import { riskPreferences, setRiskPreferences } from '../../lib/risk-preferences';
import { log, session, signingIn, signInName } from '../../lib/session';
import { useBacktestMoneyPerUnit } from '../../lib/backtest/runtime';
import { useVenue } from '../../lib/trading-venue';
import { moneyAt, useMoneyPerUnit } from '../../lib/valuation';
import { useStore } from '../../lib/store';
import { useRiskPreview } from '../../lib/risk-preview';
import { workspace } from '../../lib/workspace';
import { assistantEntry, assistantPlan, assistantPreferences, stopForPrice, targetsForPrice } from '../../lib/trade-assistant';
import { spreadLabels } from '../../lib/overlay-labels';
import { clearPinnedTrade, focusedGroup, orderGroup, pinTrade, positionGroup, tradeFocus } from '../../lib/trade-focus';
import { Segmented, Switch } from '../ui/Controls';
import type { MeridianChart } from '@meridian/charts';
import { LineHandle, priceAtPointer, useLineGeometry, type Edit, type OverlayLine } from './OverlayLines';

interface PlannerPanelProps {
  symbol: string;
  lines: PlanLines;
  digits: number;
  error?: string;
  title: string;
  preview: RiskOrderOutcome | null;
  currency: string;
  balance: number;
  isBusy: boolean;
  isMarketForced: boolean;
  onMarket: (isOn: boolean) => void;
  onPlace: () => void;
  onCancel: () => void;
}

function PlannerPanel({ symbol, lines, digits, error, title, preview, currency, balance, isBusy, isMarketForced, onMarket, onPlace, onCancel }: PlannerPanelProps) {
  const preferences = useStore(riskPreferences, (state) => state);
  const mode = plannerRiskModes.find((item) => item.key === preferences.mode)!;
  const reward = preview && lines.target ? preview.takeProfits[0] && Math.abs(preview.takeProfits[0] - preview.entry) / Math.abs(preview.entry - preview.stopLoss) : 0;
  return (
    <div className="planner-panel" onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <strong>{title}</strong>
        <span className="is-muted">{symbol}</span>
      </header>
      <Segmented label="Risk mode" value={preferences.mode} options={plannerRiskModes} onChange={(value) => setRiskPreferences({ mode: value })} />
      <label className="planner-amount">
        <span>Risk</span>
        <input type="number" min={0} step={preferences.mode === 'money' ? 10 : 0.1} value={preferences.value} onChange={(event) => setRiskPreferences({ value: Number(event.target.value) })} aria-label={`Risk ${mode.label}`} />
        <em>{preferences.mode === 'money' ? currency : mode.unit}</em>
      </label>
      <Switch label="Execute at market" hint="Ignore the entry line and fill at the live price." isOn={isMarketForced} onChange={onMarket} />
      <div className={`planner-figures${error ? ' is-bad' : ''}`} aria-live="polite">
        {error ? <span>{error}</span> : preview ? (
          <>
            <span>Volume <b>{formatVolume(preview.lots)}</b></span>
            <span>Risk <b>{formatMoney(preview.riskMoney)} {currency}</b>{balance > 0 && ` (${(preview.riskMoney / balance * 100).toFixed(2)}%)`}</span>
            <span>Entry <b>{formatPrice(preview.entry, digits)}</b></span>
            {reward > 0 && <span>Reward <b>{reward.toFixed(2)}R</b></span>}
            {preview.warnings.map((warning) => <small key={warning}>{warning}</small>)}
          </>
        ) : <span className="is-muted">Calculating…</span>}
      </div>
      <p className="planner-hint">{lines.target ? 'Drag any line to adjust.' : 'Click to place the take profit, or place the order without one.'}</p>
      <div className="planner-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="is-primary" disabled={!!error || !preview || isBusy} onClick={onPlace}>{isBusy ? <><span className="spinner" aria-hidden /> Sending…</> : 'Place order'}</button>
      </div>
    </div>
  );
}

interface TradeOverlayProps {
  chart: MeridianChart | null;
  symbol: string;
  digits: number;
  isReplaying: boolean;
  // The chart takes part in the running backtest, so the overlay trades its simulated account.
  isBacktesting: boolean;
}

export function TradeOverlay({ chart: controller, symbol, digits, isReplaying, isBacktesting }: TradeOverlayProps) {
  const venue = useVenue(isBacktesting);
  const tool = useStore(workspace, (state) => state.tool);
  const tick = venue.quotes[symbol];
  const spec = useStore(session, (state) => state.symbols[symbol]);
  // In analysis mode, and on a replaying chart, the overlay only shows positions and orders: no
  // dragging, closing or planning.
  const isAnalysisMode = useStore(workspace, (state) => state.isAnalysisMode);
  // A backtest trades a simulated account, so its charts trade in replay and in analysis mode.
  const isReadOnly = !isBacktesting && (isAnalysisMode || isReplaying);
  const canTrade = venue.canTrade && !isReadOnly;
  const signIn = useStore(session, signingIn);
  const { positions, orders } = venue;
  const preferences = useStore(riskPreferences, (state) => state);
  const currency = venue.account?.currency ?? '';
  // Exchange fees are a share of the traded value, which the trade manager reads from the exchange.
  const isExchange = useStore(session, (state) => state.status?.mode === 'bybit');
  const isOneClick = useStore(workspace, (state) => state.isOneClickEnabled);
  const assistant = useStore(assistantPlan, (state) => state.plan?.symbol === symbol ? state.plan : null);
  const focusState = useStore(tradeFocus, (state) => state);
  const liveMoneyPerUnit = useMoneyPerUnit(symbol);
  const backtestMoneyPerUnit = useBacktestMoneyPerUnit(symbol);
  const moneyPerUnit = isBacktesting ? backtestMoneyPerUnit : liveMoneyPerUnit;
  const [plan, setPlan] = useState<Partial<PlanLines>>({});
  const [isMarketForced, setIsMarketForced] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  // A dragged plan line follows the pointer; the assistant's preview catches up behind it.
  const [planDrag, setPlanDrag] = useState<{ id: string; price: number } | null>(null);
  const drag = useRef<{ line: OverlayLine; pointerId: number } | null>(null);
  const linesRef = useRef<OverlayLine[]>([]);
  const geometry = useLineGeometry(controller, linesRef);
  const isPlanning = tool === 'riskOrder' && !isReadOnly;
  useEffect(() => {
    if (isReadOnly) { setPlan({}); setIsMarketForced(false); setEdit(null); }
  }, [isReadOnly]);
  const stage = plan.entry === undefined ? 'entry' : plan.stop === undefined ? 'stop' : plan.target === undefined ? 'target' : 'ready';
  const point = spec?.point ?? 10 ** -digits;
  const round = (price: number) => {
    const step = spec?.tickSize && spec.tickSize > 0 ? spec.tickSize : point;
    return Number((Math.round(price / step) * step).toFixed(digits));
  };
  const positionMoney = (position: Position) => moneyPerUnit === null ? undefined : (price: number) => moneyAt(position.side, position.priceOpen, position.volume, price, moneyPerUnit);

  const decision = plan.entry !== undefined ? decidePlan(plan as PlanLines, tick, isMarketForced, (spec?.stopsLevel ?? 0) * point) : null;
  const hasPlan = plan.entry !== undefined;

  // Keyed on one flag: the global Escape shortcut resets the tool first, and a listener removed
  // mid-dispatch by that re-render would never see the same key press.
  const isPlannerActive = isPlanning || hasPlan;
  useEffect(() => {
    if (!isPlannerActive) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPlan({}); setIsMarketForced(false); if (workspace.get().tool === 'riskOrder') workspace.set({ tool: 'cursor' }); }
    };
    window.addEventListener('keydown', cancel, true);
    return () => window.removeEventListener('keydown', cancel, true);
  }, [isPlannerActive]);

  const request: RiskOrderRequest | null = decision?.type && plan.stop ? {
    type: decision.type, symbol, mode: preferences.mode, value: preferences.value,
    ...(decision.isMarket ? {} : { price: decision.entry }),
    stopLoss: { unit: 'price', value: plan.stop },
    ...(plan.target ? { takeProfits: [{ distance: { unit: 'price', value: plan.target }, share: 100 }] } : {}),
    commissionPerLot: isExchange ? undefined : preferences.commissionPerLot || undefined,
  } : null;
  const { preview, problem: previewError, setProblem: setPreviewError } = useRiskPreview(request, decision?.isMarket ? Math.round((tick?.bid ?? 0) / point / 5) : undefined, venue.previewRisk);

  const lines: OverlayLine[] = [];
  if (hasPlan) {
    const typeLabel = decision?.type ? orderType(decision.type)!.label : 'Entry';
    lines.push({ id: 'plan-entry', role: 'entry', price: decision?.isMarket ? decision.entry : plan.entry!, label: preview ? `${typeLabel} ${formatVolume(preview.lots)}` : typeLabel, isDraggable: !decision?.isMarket, onMove: (price) => setPlan((current) => ({ ...current, entry: price })) });
    if (plan.stop !== undefined) lines.push({ id: 'plan-stop', role: 'stop', price: plan.stop, label: preview ? `SL -${formatMoney(preview.riskMoney)}` : 'SL', isDraggable: true, onMove: (price) => setPlan((current) => ({ ...current, stop: price })) });
    if (plan.target !== undefined) {
      const reward = preview && preview.takeProfits[0] ? Math.abs(preview.takeProfits[0] - preview.entry) / Math.abs(preview.entry - preview.stopLoss) : 0;
      lines.push({ id: 'plan-target', role: 'target', price: plan.target, label: reward ? `TP ${reward.toFixed(2)}R` : 'TP', isDraggable: true, onMove: (price) => setPlan((current) => ({ ...current, target: price })) });
    }
  }
  // The Trade Assistant's plan, hidden while the chart's own planner runs. Dragging a line changes
  // the assistant's settings, which come back here through its preview.
  if (assistant && !hasPlan && !isPlanning) {
    const side = assistant.side;
    const isDraggable = !isReadOnly;
    lines.push({
      id: 'assistant-entry', role: 'entry', price: assistant.entry, isPlan: true, group: 'assistant', isDraggable: isDraggable && assistant.isPending,
      label: `${side === 'buy' ? 'Buy' : 'Sell'} plan ${formatVolume(assistant.lots)}`, title: 'Trade Assistant plan',
      onMove: (price) => assistantEntry.set({ price }),
    });
    if (assistant.stopLoss) lines.push({
      id: 'assistant-stop', role: 'stop', price: assistant.stopLoss, isPlan: true, group: 'assistant', isDraggable,
      label: `SL -${formatMoney(assistant.riskMoney)}`, title: 'Trade Assistant stop loss',
      onMove: (price) => {
        const preferences = assistantPreferences.get();
        const stop = stopForPrice(side, assistant.entry, price, preferences.unit, { digits, point });
        if (stop !== null && stop > 0) assistantPreferences.set({ stop });
      },
    });
    assistant.takeProfits.forEach((target, index) => {
      if (!target) return;
      const reward = Math.abs(target - assistant.entry) / Math.abs(assistant.entry - assistant.stopLoss);
      lines.push({
        id: `assistant-target-${index}`, role: 'target', price: target, isPlan: true, group: 'assistant', isDraggable,
        label: `TP${assistant.takeProfits.length > 1 ? index + 1 : ''} ${Number.isFinite(reward) ? `${reward.toFixed(2)}R` : ''}`.trim(), title: 'Trade Assistant take profit',
        onMove: (price) => {
          const targets = targetsForPrice(assistantPreferences.get().targets, index, assistant.entry, assistant.stopLoss, price);
          if (targets !== null) assistantPreferences.set({ targets });
        },
      });
    });
  }
  const quoteFor = (side: 'buy' | 'sell') => (side === 'buy' ? tick?.bid : tick?.ask) ?? 0;
  const modifyPosition = (position: Position, kind: 'sl' | 'tp', price = kind === 'sl' ? position.sl : position.tp): OverlayLine => ({
    id: `pos-${position.ticket}-${kind}`, role: kind === 'sl' ? 'stop' : 'target', price, label: kind.toUpperCase(), isDraggable: canTrade,
    group: positionGroup(position.ticket), tag: `#${position.ticket}`,
    title: `#${position.ticket} ${position.side} ${formatVolume(position.volume)} ${kind === 'sl' ? 'stop loss' : 'take profit'}`,
    moneyAt: positionMoney(position),
    onDrop: (value) => sendLevel(`pos-${position.ticket}-${kind}`, value, validateDrag({ kind, side: position.side, price: value, reference: quoteFor(position.side) }), async (next) => {
      const result = await venue.sendOrder({ action: 'sltp', symbol: position.symbol, position: position.ticket, sl: kind === 'sl' ? next : position.sl, tp: kind === 'tp' ? next : position.tp });
      log(`#${position.ticket} ${kind} to ${formatPrice(next, digits)}: ${result.isSuccess ? 'done' : result.comment}`, 'Trades');
      if (!result.isSuccess) throw new Error(result.comment);
    }),
  });
  // Sends a dropped stop or target at once. The line holds the dropped price a moment longer than
  // the reply, until the position update (published every 250 ms) catches up; a refused or failed
  // change shows why for a moment, then the line returns.
  const sendLevel = (id: string, price: number, error: string | null, apply: (price: number) => Promise<void>) => {
    const fail = (message: string) => {
      setEdit({ id, price, error: message, isAuto: true, apply });
      setTimeout(() => setEdit((current) => current?.id === id && current.error === message ? null : current), 2500);
    };
    if (error) { fail(error); return; }
    setEdit({ id, price, isAuto: true, isSending: true, apply });
    apply(price)
      .then(() => {
        setEdit((current) => current?.id === id && current.isSending ? { ...current, isSending: false } : current);
        setTimeout(() => setEdit((current) => current?.id === id && current.price === price && !current.isSending && !current.error ? null : current), 1000);
      })
      .catch((failure: Error) => fail(failure.message));
  };
  const closeFromChart = (position: Position) => {
    // A backtest closes without asking: nothing real is at stake.
    if (!isOneClick && !isBacktesting && !window.confirm(`Close #${position.ticket} ${position.side} ${formatVolume(position.volume)} ${position.symbol}?`)) return;
    void venue.closePosition(position).then((result) => log(`close #${position.ticket} from chart: ${result.isSuccess ? 'done' : result.comment}`, 'Trades'));
  };
  const entryLine = (position: Position): OverlayLine => ({
    id: `pos-${position.ticket}-entry`, role: 'position', price: position.priceOpen, isDraggable: false,
    group: positionGroup(position.ticket), tag: `#${position.ticket}`,
    label: `${position.side.toUpperCase()} ${formatVolume(position.volume)}`,
    title: `#${position.ticket} ${position.comment}`.trim(),
    moneyAt: () => position.profit + position.swap,
    ghosts: canTrade ? (['tp', 'sl'] as const).filter((kind) => !(kind === 'sl' ? position.sl : position.tp)).map((kind) => ({ kind, line: modifyPosition(position, kind, position.priceOpen) })) : [],
    onClose: canTrade ? () => closeFromChart(position) : undefined,
  });
  const modifyOrder = (order: Order, kind: 'price' | 'sl' | 'tp'): OverlayLine => {
    const definition = orderType(order.type)!;
    const side = definition.isBuy ? 'buy' : 'sell';
    const price = kind === 'price' ? order.priceOpen : kind === 'sl' ? order.sl : order.tp;
    const id = `ord-${order.ticket}-${kind}`;
    return {
      id, role: kind === 'price' ? 'pending' : kind === 'sl' ? 'stop' : 'target', price, isDraggable: canTrade,
      group: orderGroup(order.ticket), tag: `#${order.ticket}`,
      label: kind === 'price' ? `${definition.label} ${formatVolume(order.volume)}` : kind.toUpperCase(),
      title: `Order #${order.ticket}`,
      moneyAt: kind === 'price' || moneyPerUnit === null ? undefined : (value) => moneyAt(side, order.priceOpen, order.volume, value, moneyPerUnit),
      onDrop: (value) => {
        const error = validateDrag({ kind, side, price: value, reference: order.priceOpen });
        const apply = async (next: number) => {
          const result = await venue.sendOrder({ action: 'modify', order: order.ticket, symbol: order.symbol, price: kind === 'price' ? next : order.priceOpen, sl: kind === 'sl' ? next : order.sl, tp: kind === 'tp' ? next : order.tp, expiration: order.expiration });
          log(`Order #${order.ticket} ${kind} to ${formatPrice(next, digits)}: ${result.isSuccess ? 'done' : result.comment}`, 'Trades');
          if (!result.isSuccess) throw new Error(result.comment);
        };
        if (kind === 'price') setEdit({ id, price: value, error: error ?? undefined, apply: (next) => apply(next).catch(() => undefined) });
        else sendLevel(id, value, error, apply);
      },
    };
  };
  for (const position of positions.filter((item) => item.symbol === symbol)) {
    lines.push(entryLine(position));
    for (const kind of ['sl', 'tp'] as const) {
      const hasLevel = kind === 'sl' ? !!position.sl : !!position.tp;
      if (hasLevel || edit?.id === `pos-${position.ticket}-${kind}`) lines.push(modifyPosition(position, kind, hasLevel ? undefined : position.priceOpen));
    }
  }
  for (const order of orders.filter((item) => item.symbol === symbol && orderType(item.type)?.isPending)) {
    lines.push(modifyOrder(order, 'price'));
    if (order.sl) lines.push(modifyOrder(order, 'sl'));
    if (order.tp) lines.push(modifyOrder(order, 'tp'));
  }
  const shown = lines.map((line) => (edit?.id === line.id ? { ...line, price: edit.price } : planDrag?.id === line.id ? { ...line, price: planDrag.price } : line));
  linesRef.current = shown;
  const focused = focusedGroup(focusState, new Set(shown.flatMap((line) => line.group ? [line.group] : [])));
  const isPinned = focusState.pinned !== null;
  useEffect(() => {
    if (!isPinned) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') clearPinnedTrade(); };
    const onDown = (event: PointerEvent) => { if (!(event.target as Element | null)?.closest?.('.overlay-line.has-group, .trades tr')) clearPinnedTrade(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, [isPinned]);
  // The focused trade's risk and reward as bands from its entry to each stop and target.
  const focusedLines = focused ? shown.filter((line) => line.group === focused) : [];
  const anchor = focusedLines.find((line) => line.role === 'position' || line.role === 'pending' || line.role === 'entry');
  // The assistant's plan is drawn as a position box on the right part of the chart, apart from
  // the full-width lines of open trades, with its risk and reward always shaded.
  const planLeft = Math.round(geometry.width * 0.55);
  const planEntry = shown.find((line) => line.id === 'assistant-entry');
  const zoneOf = (from: OverlayLine, to: OverlayLine, left: number) => ({ id: `zone-${to.id}`, role: to.role, left, from: geometry.ys[from.id], to: geometry.ys[to.id], isPlan: left > 0, isDimmed: left > 0 && !!focused && focused !== 'assistant' });
  const zones = [
    ...(planEntry ? shown.filter((line) => line.group === 'assistant' && (line.role === 'stop' || line.role === 'target')).map((line) => zoneOf(planEntry, line, planLeft)) : []),
    ...(anchor && focused !== 'assistant' ? focusedLines.filter((line) => line.role === 'stop' || line.role === 'target').map((line) => zoneOf(anchor, line, 0)) : []),
  ];
  const isOnScreen = (y: number | null | undefined): y is number => y !== null && y !== undefined && y >= 0 && y <= geometry.height;
  const labelOffsets = spreadLabels(shown.flatMap((line) => isOnScreen(geometry.ys[line.id]) ? [{ id: line.id, y: geometry.ys[line.id]!, lane: line.isPlan ? 'plan' : 'trades' }] : []), 18, geometry.height);


  const priceAt = (clientY: number, element: HTMLElement) => priceAtPointer(controller, clientY, element, round);

  const startDrag = (line: OverlayLine, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { line, pointerId: event.pointerId };
    if (line.group) pinTrade(line.group);
    if (!line.onMove) setEdit({ id: line.id, price: line.price, apply: async () => undefined });
  };

  const moveDrag = (event: ReactPointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const price = priceAt(event.clientY, event.currentTarget as HTMLElement);
    if (price === null) return;
    if (active.line.onMove) {
      active.line.onMove(price);
      if (active.line.isPlan) setPlanDrag({ id: active.line.id, price });
    } else setEdit((current) => ({ ...(current?.id === active.line.id ? current : { apply: async () => undefined }), id: active.line.id, price }));
  };

  const endDrag = (event: ReactPointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    setPlanDrag(null);
    const price = priceAt(event.clientY, event.currentTarget as HTMLElement);
    if (price === null) return;
    if (active.line.onDrop) active.line.onDrop(price);
    if (isPlacing) {
      setIsPlacing(false);
      if (stage === 'ready' && workspace.get().tool === 'riskOrder') workspace.set({ tool: 'cursor' });
    }
  };

  // A capture lost without a release (the window lost focus, the line went away) ends the drag
  // where it stands instead of leaving it attached to the pointer.
  const loseDrag = (event: ReactPointerEvent) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setPlanDrag(null);
  };

  const place = (event: ReactPointerEvent) => {
    if (event.button !== 0 || !isPlanning || stage === 'ready') return;
    const price = priceAt(event.clientY, event.currentTarget as HTMLElement);
    if (price === null) return;
    event.preventDefault();
    const role = stage === 'entry' ? 'entry' : stage === 'stop' ? 'stop' : 'target';
    setPlan((current) => ({ ...current, [role]: price }));
    const line: OverlayLine = { id: `plan-${role}`, role, price, label: role, isDraggable: true, onMove: (value) => setPlan((current) => ({ ...current, [role]: value })) };
    setIsPlacing(true);
    startDrag(line, event);
  };

  const submit = async () => {
    if (!request) return;
    setIsBusy(true);
    try {
      const outcome = await venue.placeRiskOrder(`Risk ${orderType(request.type)?.label.toLowerCase() ?? request.type} ${preview?.lots ?? ''} ${symbol}`.replace(/\s+/g, ' '), request);
      const failed = outcome.results.find((result) => !result.isSuccess);
      log(`${request.type} ${outcome.lots} ${symbol} from chart, risk ${formatMoney(outcome.riskMoney)}: ${failed ? failed.comment : 'done'}`, 'Trades');
      if (!failed) { setPlan({}); setIsMarketForced(false); if (workspace.get().tool === 'riskOrder') workspace.set({ tool: 'cursor' }); }
      else setPreviewError(failed.comment);
    } catch (error) {
      setPreviewError((error as Error).message);
    } finally { setIsBusy(false); }
  };

  const title = decision?.type ? `${orderType(decision.type)!.label}${decision.isMarket ? ' at market' : ''}` : 'Risk order';
  const panelError = signIn && !isBacktesting ? `Signing in to ${signInName(signIn)}…` : !canTrade ? 'Log in to an account that allows trading.' : decision?.error ?? previewError ?? undefined;

  return (
    <div className="trade-overlay" style={{ left: geometry.left, width: geometry.width }} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={loseDrag}>
      {isPlanning && (stage !== 'ready' || isPlacing) && (
        <div className="overlay-capture" style={{ width: geometry.width, height: geometry.height }} onPointerDown={place}>
          <span className="overlay-prompt">{stage === 'entry' ? 'Drag to place the entry' : stage === 'stop' ? 'Click or drag to place the stop loss' : 'Click or drag to place the take profit'} · Esc cancels</span>
        </div>
      )}
      {zones.map((zone) => {
        if (zone.from === null || zone.from === undefined || zone.to === null || zone.to === undefined) return null;
        const top = Math.max(0, Math.min(zone.from, zone.to));
        const bottom = Math.min(geometry.height, Math.max(zone.from, zone.to));
        return bottom > top ? <div key={zone.id} className={`overlay-zone is-${zone.role}${zone.isPlan ? ' is-plan' : ''}${zone.isDimmed ? ' is-dimmed' : ''}`} style={{ top, height: bottom - top, left: zone.left, width: geometry.width - zone.left }} /> : null;
      })}
      {shown.map((line) => {
        // The dragged line stays mounted at the plot's edge when the pointer leaves it; unmounting
        // would drop the pointer capture and leave the drag stuck without a release.
        const isDragged = drag.current?.line.id === line.id;
        const raw = geometry.ys[line.id];
        if (!isOnScreen(raw) && !isDragged) return null;
        const y = Math.min(geometry.height, Math.max(0, raw ?? 0));
        const focus = !focused ? undefined : line.group === focused ? 'focused' : 'dimmed';
        return <LineHandle key={line.id} line={line} y={y} left={line.isPlan ? planLeft : 0} width={geometry.width} labelOffset={labelOffsets.get(line.id) ?? 0} focus={focus} digits={digits} currency={currency} edit={edit?.id === line.id && !drag.current ? edit : undefined} onStartDrag={startDrag} onApply={() => { const current = edit!; setEdit(null); void current.apply(current.price); }} onDiscard={() => setEdit(null)} />;
      })}
      {isReplaying && tool === 'riskOrder' && <span className="overlay-prompt" role="status">{replayTradingHint}</span>}
      {hasPlan && plan.stop !== undefined && (
        <PlannerPanel symbol={symbol} lines={plan as PlanLines} digits={digits} error={panelError} title={title} preview={preview} currency={currency} balance={venue.account?.balance ?? 0} isBusy={isBusy} isMarketForced={isMarketForced} onMarket={setIsMarketForced} onPlace={() => void submit()} onCancel={() => { setPlan({}); setIsMarketForced(false); if (workspace.get().tool === 'riskOrder') workspace.set({ tool: 'cursor' }); }} />
      )}
    </div>
  );
}
