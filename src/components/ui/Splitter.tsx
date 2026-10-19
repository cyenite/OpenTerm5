import { useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

interface SplitterProps {
  // 'columns' sits between side-by-side areas and drags sideways; 'rows' between stacked ones.
  axis: 'columns' | 'rows';
  label: string;
  onBegin: () => void;
  onDrag: (delta: number) => void;
  onEnd: () => void;
  onStep: (delta: number) => void;
  onReset?: () => void;
}

const keyStep = 16;

export function Splitter({ axis, label, onBegin, onDrag, onEnd, onStep, onReset }: SplitterProps) {
  const start = useRef<number | null>(null);
  const isColumns = axis === 'columns';
  const position = (event: ReactPointerEvent) => isColumns ? event.clientX : event.clientY;
  const finish = () => {
    if (start.current === null) return;
    start.current = null;
    onEnd();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const keys = isColumns ? { ArrowLeft: -keyStep, ArrowRight: keyStep } : { ArrowUp: -keyStep, ArrowDown: keyStep };
    const delta = keys[event.key as keyof typeof keys];
    if (delta === undefined) return;
    event.preventDefault();
    onStep(delta);
  };
  return (
    <div
      className={`splitter is-${axis}`}
      role="separator"
      aria-orientation={isColumns ? 'vertical' : 'horizontal'}
      aria-label={label}
      title={`${label}. Drag to resize${onReset ? ', double-click to reset' : ''}.`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = position(event);
        onBegin();
      }}
      onPointerMove={(event) => {
        if (start.current !== null) onDrag(position(event) - start.current);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={onReset}
    />
  );
}
