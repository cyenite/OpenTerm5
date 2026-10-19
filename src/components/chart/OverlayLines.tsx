import { useEffect, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { MeridianChart } from '@meridian/charts';
import { formatMoney, formatPrice } from '../../lib/format';
import { hoverTrade, leaveTrade, togglePinnedTrade } from '../../lib/trade-focus';

// The draggable price lines the live trade overlay and the backtest overlay draw over a chart.

export type LineRole = 'entry' | 'position' | 'stop' | 'target' | 'pending';

export interface OverlayLine {
  id: string;
  role: LineRole;
  price: number;
  label: string;
  isDraggable: boolean;
  title?: string;
  // One trade's lines share a group, so focusing the trade highlights them together.
  group?: string;
  tag?: string;
  isPlan?: boolean;
  moneyAt?: (price: number) => number;
  ghosts?: { kind: 'sl' | 'tp'; line: OverlayLine }[];
  onClose?: () => void;
  // What the close button does, for its hint; closing a position unless said otherwise.
  closeLabel?: string;
  onMove?: (price: number) => void;
  onDrop?: (price: number) => void;
}

export interface Edit {
  id: string;
  price: number;
  error?: string;
  // Stop and target drags send on release; only a pending order's price waits for Apply.
  isAuto?: boolean;
  isSending?: boolean;
  apply: (price: number) => Promise<void>;
}

const HANDLE = 6;

interface LineHandleProps {
  line: OverlayLine;
  y: number;
  left: number;
  width: number;
  labelOffset: number;
  focus?: 'focused' | 'dimmed';
  edit?: Edit;
  digits: number;
  currency: string;
  onStartDrag: (line: OverlayLine, event: ReactPointerEvent) => void;
  onApply: () => void;
  onDiscard: () => void;
}

export function LineHandle({ line, y, left, width, labelOffset, focus, edit, digits, currency, onStartDrag, onApply, onDiscard }: LineHandleProps) {
  const money = line.moneyAt?.(line.price);
  const group = line.group;
  return (
    <div
      className={`overlay-line is-${line.role}${line.isPlan ? ' is-plan' : ''}${line.isDraggable ? ' is-draggable' : ''}${edit ? ' is-edited' : ''}${group ? ' has-group' : ''}${focus ? ` is-${focus}` : ''}`}
      style={{ top: y - HANDLE, left, width: width - left }}
      onPointerDown={line.isDraggable ? (event) => onStartDrag(line, event) : undefined}
      onPointerEnter={group ? () => hoverTrade(group) : undefined}
      onPointerLeave={group ? () => leaveTrade(group) : undefined}
      // Draggable lines pin their trade when the drag starts; the rest pin on a click.
      onClick={group && !line.isDraggable ? (event) => { if (!(event.target as Element).closest('button')) togglePinnedTrade(group); } : undefined}
      role={line.isDraggable ? 'slider' : undefined}
      aria-label={line.label}
      aria-valuenow={line.price}
      title={line.title}
    >
      <span className="overlay-rule" />
      <span className="overlay-label" style={labelOffset ? { transform: `translateY(${labelOffset}px)` } : undefined}>
        <span>{line.label}</span>
        {focus === 'focused' && line.tag && <span className="overlay-tag">{line.tag}</span>}
        {money !== undefined && Number.isFinite(money) && <b className={money > 0 ? 'is-up' : money < 0 ? 'is-down' : ''}>{money > 0 ? '+' : ''}{formatMoney(money)} {currency}</b>}
        <span className="overlay-price">{formatPrice(line.price, digits)}</span>
        {line.ghosts?.map((ghost) => (
          <button key={ghost.kind} type="button" className={`overlay-ghost is-${ghost.kind}`} title={`Drag ${ghost.kind === 'tp' ? 'up or down' : 'away'} to set the ${ghost.kind === 'tp' ? 'take profit' : 'stop loss'}`} onPointerDown={(event) => onStartDrag(ghost.line, event)}>{ghost.kind.toUpperCase()}</button>
        ))}
        {line.onClose && <button type="button" className="overlay-close" title={line.closeLabel ?? 'Close position'} aria-label={line.closeLabel ?? 'Close position'} onPointerDown={(event) => event.stopPropagation()} onClick={line.onClose}>×</button>}
        {edit?.isAuto && (
          <span className="overlay-actions" role="status">
            {edit.error ? <em>{edit.error}</em> : edit.isSending ? <span className="spinner" aria-label="Sending" /> : null}
          </span>
        )}
        {edit && !edit.isAuto && (
          <span className="overlay-actions" onPointerDown={(event) => event.stopPropagation()}>
            {edit.error ? <em>{edit.error}</em> : <button type="button" onClick={onApply}>Apply</button>}
            <button type="button" onClick={onDiscard}>Cancel</button>
          </span>
        )}
      </span>
    </div>
  );
}

export interface LineGeometry {
  ys: Record<string, number | null>;
  left: number;
  width: number;
  height: number;
}

// Price-to-pixel mapping changes with every scroll, zoom and autoscale, which the chart does not
// announce, so the lines' positions are re-read each frame.
export function useLineGeometry(controller: MeridianChart | null, linesRef: RefObject<readonly OverlayLine[]>): LineGeometry {
  const [geometry, setGeometry] = useState<LineGeometry>({ ys: {}, left: 0, width: 0, height: 0 });
  useEffect(() => {
    if (!controller) return;
    let frame = 0;
    let last = '';
    const update = () => {
      const box = controller.plotBox();
      const ys: Record<string, number | null> = {};
      for (const line of linesRef.current ?? []) ys[line.id] = controller.priceToY(line.price);
      const key = JSON.stringify([ys, box]);
      if (key !== last) { last = key; setGeometry({ ys, left: box.left, width: box.width, height: box.height }); }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [controller]);
  return geometry;
}

// The tick-rounded price under a pointer, read from the chart the overlay sits on.
export function priceAtPointer(controller: MeridianChart | null, clientY: number, element: HTMLElement, round: (price: number) => number): number | null {
  const bounds = element.closest('.chart-window')!.querySelector('.chart-canvas')!.getBoundingClientRect();
  const price = controller?.yToPrice(clientY - bounds.top);
  return price === null || price === undefined ? null : round(price);
}
