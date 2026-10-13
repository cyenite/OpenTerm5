import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { plannerRiskModes, type RiskOrderOutcome, type RiskOrderRequest } from '../../../shared/automation';
import { decidePlan, validateDrag, type PlanLines } from '../../../shared/order-plan';
import { orderType, type Order, type Position } from '../../../shared/protocol';
import { automation } from '../../lib/automation';
import { formatMoney, formatPrice, formatVolume } from '../../lib/format';
import { riskPreferences, setRiskPreferences } from '../../lib/risk-preferences';
import { log, sendOrder, session } from '../../lib/session';
import { useStore } from '../../lib/store';
import { workspace } from '../../lib/workspace';
import { Segmented, Switch } from '../ui/Controls';
import type { ChartController } from './controller';

type LineRole = 'entry' | 'stop' | 'target' | 'pending';

interface OverlayLine {
  id: string;
  role: LineRole;
  price: number;
  label: string;
  isDraggable: boolean;
  onMove?: (price: number) => void;
  onDrop?: (price: number) => void;
}

interface Edit {
  id: string;
  price: number;
  error?: string;
  apply: (price: number) => Promise<void>;
}

const HANDLE = 6;

interface LineHandleProps {
  line: OverlayLine;
  y: number;
  width: number;
  edit?: Edit;
  digits: number;
  onStartDrag: (line: OverlayLine, event: ReactPointerEvent) => void;
  onApply: () => void;
  onDiscard: () => void;
}

function LineHandle({ line, y, width, edit, digits, onStartDrag, onApply, onDiscard }: LineHandleProps) {
  return (
    <div
      className={`overlay-line is-${line.role}${line.isDraggable ? ' is-draggable' : ''}${edit ? ' is-edited' : ''}`}
      style={{ top: y - HANDLE, width }}
      onPointerDown={line.isDraggable ? (event) => onStartDrag(line, event) : undefined}
      role={line.isDraggable ? 'slider' : undefined}
      aria-label={line.label}
      aria-valuenow={line.price}
    >
      <span className="overlay-rule" />
      <span className="overlay-label">
        {line.label} {formatPrice(line.price, digits)}
        {edit && (
          <span className="overlay-actions" onPointerDown={(event) => event.stopPropagation()}>
            {edit.error ? <em>{edit.error}</em> : <button type="button" onClick={onApply}>Apply</button>}
            <button type="button" onClick={onDiscard}>Cancel</button>
          </span>
        )}
      </span>
    </div>
  );
}

interface PlannerPanelProps {
  symbol: string;
  lines: PlanLines;
  digits: number;
  error?: string;
  title: string;
  preview: RiskOrderOutcome | null;
  isBusy: boolean;
  isMarketForced: boolean;
  onMarket: (isOn: boolean) => void;
  onPlace: () => void;
  onCancel: () => void;
}

function PlannerPanel({ symbol, lines, digits, error, title, preview, isBusy, isMarketForced, onMarket, onPlace, onCancel }: PlannerPanelProps) {
  const preferences = useStore(riskPreferences, (state) => state);
  const currency = useStore(session, (state) => state.account?.currency ?? '');
  const balance = useStore(session, (state) => state.account?.balance ?? 0);
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
        <button type="button" className="is-primary" disabled={!!error || !preview || isBusy} onClick={onPlace}>{isBusy ? 'Sending…' : 'Place order'}</button>
      </div>
    </div>
  );
}

interface TradeOverlayProps {
  controller: ChartController | null;
  symbol: string;
  digits: number;
}

export function TradeOverlay({ controller, symbol, digits }: TradeOverlayProps) {
  const tool = useStore(workspace, (state) => state.tool);
  const tick = useStore(session, (state) => state.ticks[symbol]);
  const spec = useStore(session, (state) => state.symbols[symbol]);
  const canTrade = useStore(session, (state) => !!state.account && state.status?.capabilities?.trading === true && state.link.state === 'open');
  const positions = useStore(session, (state) => state.positions);
  const orders = useStore(session, (state) => state.orders);
  const preferences = useStore(riskPreferences, (state) => state);
  const [plan, setPlan] = useState<Partial<PlanLines>>({});
  const [isMarketForced, setIsMarketForced] = useState(false);
  const [preview, setPreview] = useState<RiskOrderOutcome | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isPlacing, setIsPlacing] = useState(false);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [geometry, setGeometry] = useState<{ ys: Record<string, number | null>; width: number; height: number }>({ ys: {}, width: 0, height: 0 });
  const drag = useRef<{ line: OverlayLine; pointerId: number } | null>(null);
  const linesRef = useRef<OverlayLine[]>([]);
  const isPlanning = tool === 'riskOrder';
  const stage = plan.entry === undefined ? 'entry' : plan.stop === undefined ? 'stop' : plan.target === undefined ? 'target' : 'ready';
  const point = spec?.point ?? 10 ** -digits;
  const round = (price: number) => {
    const step = spec?.tickSize && spec.tickSize > 0 ? spec.tickSize : point;
    return Number((Math.round(price / step) * step).toFixed(digits));
  };
  const decision = plan.entry !== undefined ? decidePlan(plan as PlanLines, tick, isMarketForced, (spec?.stopsLevel ?? 0) * point) : null;
  const hasPlan = plan.entry !== undefined;

  useEffect(() => {
    if (!isPlanning && !hasPlan) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setPlan({}); setIsMarketForced(false); if (workspace.get().tool === 'riskOrder') workspace.set({ tool: 'cursor' }); }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [isPlanning, hasPlan]);

  const request: RiskOrderRequest | null = decision?.type && plan.stop ? {
    type: decision.type, symbol, mode: preferences.mode, value: preferences.value,
    ...(decision.isMarket ? {} : { price: decision.entry }),
    stopLoss: { unit: 'price', value: plan.stop },
    ...(plan.target ? { takeProfits: [{ distance: { unit: 'price', value: plan.target }, share: 100 }] } : {}),
    commissionPerLot: preferences.commissionPerLot || undefined,
    comment: 'T5 chart risk',
  } : null;
  const signature = request ? JSON.stringify({ ...request, ...(decision?.isMarket ? { quote: Math.round((tick?.bid ?? 0) / point / 5) } : {}) }) : '';

  useEffect(() => {
    if (!request) { setPreview(null); setPreviewError(null); return; }
    const timer = setTimeout(() => {
      automation.request('manager.risk', { ...request, isDryRun: true })
        .then((outcome) => { setPreview(outcome); setPreviewError(null); })
        .catch((error: Error) => { setPreview(null); setPreviewError(error.message); });
    }, 200);
    return () => clearTimeout(timer);
    // The request is rebuilt every render, so its serialised form is the dependency.
  }, [signature]);

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
  const quoteFor = (side: 'buy' | 'sell') => (side === 'buy' ? tick?.bid : tick?.ask) ?? 0;
  const modifyPosition = (position: Position, kind: 'sl' | 'tp', label: string): OverlayLine => ({
    id: `pos-${position.ticket}-${kind}`, role: kind === 'sl' ? 'stop' : 'target', price: kind === 'sl' ? position.sl : position.tp, label: `#${position.ticket} ${label}`, isDraggable: canTrade,
    onDrop: (price) => setEdit({
      id: `pos-${position.ticket}-${kind}`, price, error: validateDrag({ kind, side: position.side, price, reference: quoteFor(position.side) }) ?? undefined,
      apply: async (value) => {
        const result = await sendOrder({ action: 'sltp', symbol: position.symbol, position: position.ticket, sl: kind === 'sl' ? value : position.sl, tp: kind === 'tp' ? value : position.tp });
        log(`#${position.ticket} ${label} to ${formatPrice(value, digits)}: ${result.isSuccess ? 'done' : result.comment}`, 'Trades');
      },
    }),
  });
  const modifyOrder = (order: Order, kind: 'price' | 'sl' | 'tp'): OverlayLine => {
    const definition = orderType(order.type)!;
    const side = definition.isBuy ? 'buy' : 'sell';
    const price = kind === 'price' ? order.priceOpen : kind === 'sl' ? order.sl : order.tp;
    const id = `ord-${order.ticket}-${kind}`;
    return {
      id, role: kind === 'price' ? 'pending' : kind === 'sl' ? 'stop' : 'target', price, isDraggable: canTrade,
      label: kind === 'price' ? `#${order.ticket} ${definition.label} ${formatVolume(order.volume)}` : `#${order.ticket} ${kind}`,
      onDrop: (value) => setEdit({
        id, price: value, error: validateDrag({ kind, side, price: value, reference: order.priceOpen }) ?? undefined,
        apply: async (next) => {
          const result = await sendOrder({ action: 'modify', order: order.ticket, symbol: order.symbol, price: kind === 'price' ? next : order.priceOpen, sl: kind === 'sl' ? next : order.sl, tp: kind === 'tp' ? next : order.tp, expiration: order.expiration });
          log(`Order #${order.ticket} ${kind} to ${formatPrice(next, digits)}: ${result.isSuccess ? 'done' : result.comment}`, 'Trades');
        },
      }),
    };
  };
  for (const position of positions.filter((item) => item.symbol === symbol)) {
    if (position.sl) lines.push(modifyPosition(position, 'sl', 'sl'));
    if (position.tp) lines.push(modifyPosition(position, 'tp', 'tp'));
  }
  for (const order of orders.filter((item) => item.symbol === symbol && orderType(item.type)?.isPending)) {
    lines.push(modifyOrder(order, 'price'));
    if (order.sl) lines.push(modifyOrder(order, 'sl'));
    if (order.tp) lines.push(modifyOrder(order, 'tp'));
  }
  const shown = lines.map((line) => (edit?.id === line.id ? { ...line, price: edit.price } : line));
  linesRef.current = shown;

  // Price-to-pixel mapping changes with every scroll, zoom and autoscale, which the
  // chart does not announce, so positions are re-read each frame.
  useEffect(() => {
    if (!controller) return;
    let frame = 0;
    let last = '';
    const update = () => {
      const box = controller.paneBox();
      const ys: Record<string, number | null> = {};
      for (const line of linesRef.current) ys[line.id] = controller.priceToY(line.price);
      const key = JSON.stringify([ys, box]);
      if (key !== last) { last = key; setGeometry({ ys, width: box.width, height: box.height }); }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [controller]);

  const priceAt = (clientY: number, element: HTMLElement) => {
    const bounds = element.closest('.chart-window')!.querySelector('.chart-canvas')!.getBoundingClientRect();
    const price = controller?.yToPrice(clientY - bounds.top);
    return price === null || price === undefined ? null : round(price);
  };

  const startDrag = (line: OverlayLine, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    drag.current = { line, pointerId: event.pointerId };
    controller?.setDragging(true);
  };

  const moveDrag = (event: ReactPointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const price = priceAt(event.clientY, event.currentTarget as HTMLElement);
    if (price === null) return;
    if (active.line.onMove) active.line.onMove(price);
    else setEdit((current) => ({ ...(current?.id === active.line.id ? current : { apply: async () => undefined }), id: active.line.id, price }));
  };

  const endDrag = (event: ReactPointerEvent) => {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    drag.current = null;
    controller?.setDragging(false);
    const price = priceAt(event.clientY, event.currentTarget as HTMLElement);
    if (price === null) return;
    if (active.line.onDrop) active.line.onDrop(price);
    if (isPlacing) {
      setIsPlacing(false);
      if (stage === 'ready' && workspace.get().tool === 'riskOrder') workspace.set({ tool: 'cursor' });
    }
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
      const outcome = await automation.request('manager.risk', request);
      const failed = outcome.results.find((result) => !result.isSuccess);
      log(`${request.type} ${outcome.lots} ${symbol} from chart, risk ${formatMoney(outcome.riskMoney)}: ${failed ? failed.comment : 'done'}`, 'Trades');
      if (!failed) { setPlan({}); setIsMarketForced(false); if (workspace.get().tool === 'riskOrder') workspace.set({ tool: 'cursor' }); }
      else setPreviewError(failed.comment);
    } catch (error) {
      setPreviewError((error as Error).message);
    } finally { setIsBusy(false); }
  };

  const title = decision?.type ? `${orderType(decision.type)!.label}${decision.isMarket ? ' at market' : ''}` : 'Risk order';
  const panelError = !canTrade ? 'Log in to an account that allows trading.' : decision?.error ?? previewError ?? undefined;

  return (
    <div className="trade-overlay" onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      {isPlanning && (stage !== 'ready' || isPlacing) && (
        <div className="overlay-capture" style={{ width: geometry.width, height: geometry.height }} onPointerDown={place}>
          <span className="overlay-prompt">{stage === 'entry' ? 'Drag to place the entry' : stage === 'stop' ? 'Click or drag to place the stop loss' : 'Click or drag to place the take profit'} · Esc cancels</span>
        </div>
      )}
      {shown.map((line) => {
        const y = geometry.ys[line.id];
        if (y === null || y === undefined || y < 0 || y > geometry.height) return null;
        return <LineHandle key={line.id} line={line} y={y} width={geometry.width} digits={digits} edit={edit?.id === line.id && !drag.current ? edit : undefined} onStartDrag={startDrag} onApply={() => { const current = edit!; setEdit(null); void current.apply(current.price); }} onDiscard={() => setEdit(null)} />;
      })}
      {hasPlan && plan.stop !== undefined && (
        <PlannerPanel symbol={symbol} lines={plan as PlanLines} digits={digits} error={panelError} title={title} preview={preview} isBusy={isBusy} isMarketForced={isMarketForced} onMarket={setIsMarketForced} onPlace={() => void submit()} onCancel={() => { setPlan({}); setIsMarketForced(false); if (workspace.get().tool === 'riskOrder') workspace.set({ tool: 'cursor' }); }} />
      )}
    </div>
  );
}
