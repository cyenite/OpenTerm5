import type { MenuItem } from '../components/MenuBar';
import { Store } from './store';

// Charts popped out of the layout into their own always-on-top windows. The window is a child of
// this renderer (window.open on about:blank), so the chart in it is the same React tree, stores and
// engine registry as the main window: edits made there are the chart's edits.

export const popoutModes = [
  { key: 'lite', label: 'Lite', description: 'The chart alone, for watching the price.', width: 520, height: 340 },
  { key: 'full', label: 'Full', description: 'The chart with its toolbar, drawing tools and trading panels.', width: 1040, height: 680 },
] as const;

export type PopoutMode = (typeof popoutModes)[number]['key'];

export interface Popout {
  readonly chartId: string;
  readonly mode: PopoutMode;
}

export const popouts = new Store<{ list: readonly Popout[] }>({ list: [] });

const windows = new Map<string, Window>();

export const popoutModeOf = (key: PopoutMode) => popoutModes.find((mode) => mode.key === key)!;

export function popoutOf(state: { list: readonly Popout[] }, chartId: string): Popout | undefined {
  return state.list.find((popout) => popout.chartId === chartId);
}

export function popOutChart(chartId: string, mode: PopoutMode): void {
  if (popoutOf(popouts.get(), chartId)) setPopoutMode(chartId, mode);
  else popouts.set((state) => ({ list: [...state.list, { chartId, mode }] }));
  windows.get(chartId)?.focus();
}

export function setPopoutMode(chartId: string, mode: PopoutMode): void {
  popouts.set((state) => ({ list: state.list.map((popout) => popout.chartId === chartId ? { ...popout, mode } : popout) }));
}

export function dockChart(chartId: string): void {
  if (popoutOf(popouts.get(), chartId)) popouts.set((state) => ({ list: state.list.filter((popout) => popout.chartId !== chartId) }));
}

export function registerPopoutWindow(chartId: string, view: Window): () => void {
  windows.set(chartId, view);
  return () => { if (windows.get(chartId) === view) windows.delete(chartId); };
}

// The pop-out window the user is working in, if any: dialogs opened from it show there.
export function focusedPopoutWindow(): Window | null {
  for (const view of windows.values()) if (!view.closed && view.document.hasFocus()) return view;
  return null;
}

export function popoutMenuItems(chartId: string): MenuItem[] {
  const current = popoutOf(popouts.get(), chartId);
  return [
    ...popoutModes.map((mode) => ({ label: `Picture in Picture: ${mode.label}`, isChecked: current?.mode === mode.key, action: () => popOutChart(chartId, mode.key) })),
    ...(current ? [{ label: 'Return to Layout', action: () => dockChart(chartId) }] : []),
  ];
}
