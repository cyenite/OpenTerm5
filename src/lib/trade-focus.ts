import { Store } from './store';

// The trade whose lines stand out on the charts: hovered (a chart label or a Toolbox row) or
// pinned by a click. A group names one trade's lines: its entry, stop and targets.
export const tradeFocus = new Store<{ hovered: string | null; pinned: string | null }>({ hovered: null, pinned: null });

export const positionGroup = (ticket: number) => `pos-${ticket}`;
export const orderGroup = (ticket: number) => `ord-${ticket}`;

export function hoverTrade(group: string): void {
  tradeFocus.set({ hovered: group });
}

// Only the hover this element set: moving straight from a Toolbox row to a chart label fires the
// label's pointerenter before the row's mouseleave.
export function leaveTrade(group: string): void {
  tradeFocus.set((state) => (state.hovered === group ? { hovered: null } : {}));
}

export function pinTrade(group: string): void {
  tradeFocus.set({ pinned: group });
}

export function togglePinnedTrade(group: string): void {
  tradeFocus.set((state) => ({ pinned: state.pinned === group ? null : group }));
}

export function clearPinnedTrade(): void {
  tradeFocus.set({ pinned: null });
}

// The group a chart highlights. Hover wins over the pin; a group the chart does not show
// highlights nothing there, so other symbols' charts are not dimmed.
export function focusedGroup(state: { hovered: string | null; pinned: string | null }, shown: ReadonlySet<string>): string | null {
  if (state.hovered && shown.has(state.hovered)) return state.hovered;
  return state.pinned && shown.has(state.pinned) ? state.pinned : null;
}
