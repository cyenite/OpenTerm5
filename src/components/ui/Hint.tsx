import { useLayoutEffect, useRef } from 'react';
import { Store, useStore } from '../../lib/store';

export interface HintContent {
  title: string;
  shortcut?: string;
  description?: string;
}

interface HintState {
  top: number;
  left: number;
  content: HintContent | null;
}

const hint = new Store<HintState>({ top: 0, left: 0, content: null });

const showDelay = 380;
const graceMs = 400;

let timer: number | undefined;
let hiddenAt = 0;

// Native title tooltips wait about a second and cannot show shortcuts; this one appears quickly,
// follows keyboard focus and, once one is open, switches instantly as the pointer moves along.
export function hintProps(content: HintContent) {
  const show = (target: HTMLElement, isImmediate: boolean) => {
    window.clearTimeout(timer);
    const place = () => {
      const box = target.getBoundingClientRect();
      hint.set({ content, top: box.bottom + 6, left: box.left + box.width / 2 });
    };
    if (isImmediate || hint.get().content || Date.now() - hiddenAt < graceMs) place();
    else timer = window.setTimeout(place, showDelay);
  };
  const hide = () => {
    window.clearTimeout(timer);
    if (hint.get().content) hiddenAt = Date.now();
    hint.set({ content: null });
  };
  return {
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => show(event.currentTarget, false),
    onPointerLeave: hide,
    onPointerDown: hide,
    onFocus: (event: React.FocusEvent<HTMLElement>) => { if (event.currentTarget.matches(':focus-visible')) show(event.currentTarget, true); },
    onBlur: hide,
  };
}

export function HintBubble() {
  const state = useStore(hint, (current) => current);
  const bubble = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const element = bubble.current;
    if (!element) return;
    const width = element.offsetWidth;
    element.style.left = `${Math.min(window.innerWidth - width - 8, Math.max(8, state.left - width / 2))}px`;
  }, [state]);

  if (!state.content) return null;
  return (
    <div ref={bubble} className="hint-bubble" role="tooltip" style={{ top: state.top }}>
      <div className="hint-title">
        <span>{state.content.title}</span>
        {state.content.shortcut && <kbd>{state.content.shortcut}</kbd>}
      </div>
      {state.content.description && <div className="hint-description">{state.content.description}</div>}
    </div>
  );
}
