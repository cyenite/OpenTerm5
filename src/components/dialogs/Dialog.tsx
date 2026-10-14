import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { closeDialog } from '../../lib/workspace';

interface DialogProps {
  title: string;
  width?: number;
  children: ReactNode;
}

interface Offset {
  readonly x: number;
  readonly y: number;
}

// Outside clicks no longer dismiss a dialog: a stray click used to throw away a half-filled order ticket.
export function Dialog({ title, width = 420, children }: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startY: number; origin: Offset } | null>(null);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && closeDialog();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const begin = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startY: event.clientY, origin: offset };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    const rect = box.current?.getBoundingClientRect();
    if (!current || !rect) return;
    const x = current.origin.x + event.clientX - current.startX;
    const y = current.origin.y + event.clientY - current.startY;
    const limitX = (window.innerWidth - rect.width) / 2;
    const limitY = (window.innerHeight - rect.height) / 2;
    setOffset({ x: Math.max(-limitX, Math.min(limitX, x)), y: Math.max(-limitY, Math.min(limitY, y)) });
  };
  const end = () => { drag.current = null; };

  return (
    <div className="dialog-backdrop">
      <div ref={box} className="dialog" role="dialog" aria-modal="true" aria-label={title} style={{ width, transform: `translate(${offset.x}px, ${offset.y}px)` }}>
        <header className="dialog-title is-draggable" onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onDoubleClick={() => setOffset({ x: 0, y: 0 })}>
          <span>{title}</span>
          <button className="panel-close" onClick={closeDialog} aria-label="Close">×</button>
        </header>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  );
}
