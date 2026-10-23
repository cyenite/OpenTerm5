import type { MenuItem } from '../components/MenuBar';
import { Store } from './store';
import { focusTab, marketTabs, moveTab, workspace } from './workspace';

// Chart tabs popped out of the main window into their own always-on-top windows, with their whole
// layout, so they can sit on another monitor. The window is a child of this renderer (window.open
// on about:blank), so the charts in it are the same React tree, stores and engine registry as the
// main window: edits made there are the tab's edits.

export const popoutModes = [
  { key: 'lite', label: 'Lite', description: 'The charts alone, for watching the price.', width: 640, height: 420 },
  { key: 'full', label: 'Full', description: 'The charts with their toolbar, drawing tools and trading panels.', width: 1100, height: 720 },
] as const;

export type PopoutMode = (typeof popoutModes)[number]['key'];

export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

export interface Popout {
  readonly tabId: string;
  readonly mode: PopoutMode;
  // Where a tab dragged out of the tab bar was dropped; the window opens there.
  readonly at?: ScreenPoint;
}

export interface PopoutsState {
  readonly list: readonly Popout[];
}

export const popouts = new Store<PopoutsState>({ list: [] });

// The drag type of a chart tab, from the main window's tab bar or a pop-out's handle.
export const tabDragType = 'text/x-openterm-tab';

const windows = new Map<string, Window>();

export const popoutModeOf = (key: PopoutMode) => popoutModes.find((mode) => mode.key === key)!;

export function popoutOf(state: PopoutsState, tabId: string): Popout | undefined {
  return state.list.find((popout) => popout.tabId === tabId);
}

export function isPoppedOut(tabId: string): boolean {
  return !!popoutOf(popouts.get(), tabId);
}

// The tab the main window shows: the active tab while it is in the main window, otherwise the one it
// showed before (working in a pop-out makes that tab active), otherwise the first tab left.
export function dockedTabId(dockedIds: readonly string[], activeId: string | undefined, previousId: string | undefined): string | undefined {
  if (activeId && dockedIds.includes(activeId)) return activeId;
  if (previousId && dockedIds.includes(previousId)) return previousId;
  return dockedIds[0];
}

export function popOutTab(tabId: string, mode: PopoutMode, at?: ScreenPoint): void {
  const state = workspace.get();
  if (popoutOf(popouts.get(), tabId)) setPopoutMode(tabId, mode);
  else popouts.set((current) => ({ list: [...current.list, { tabId, mode, ...(at ? { at } : {}) }] }));
  // The main window moves on to a tab it still shows.
  if (state.activeTabId === tabId) {
    const next = marketTabs(state).find((tab) => !isPoppedOut(tab.id));
    if (next) focusTab(next.id);
  }
  windows.get(tabId)?.focus();
}

export function setPopoutMode(tabId: string, mode: PopoutMode): void {
  popouts.set((state) => ({ list: state.list.map((popout) => popout.tabId === tabId ? { ...popout, mode } : popout) }));
}

// Back into the main window's tab bar, in front of `beforeTabId` when it was dropped there.
export function dockTab(tabId: string, beforeTabId?: string | null): void {
  if (popoutOf(popouts.get(), tabId)) popouts.set((state) => ({ list: state.list.filter((popout) => popout.tabId !== tabId) }));
  if (beforeTabId !== undefined) moveTab(tabId, beforeTabId);
  if (workspace.get().tabs.some((tab) => tab.id === tabId)) focusTab(tabId);
}

// A pop-out window closed by the user: the tab goes back without taking the main window's focus.
export function forgetPopout(tabId: string): void {
  if (popoutOf(popouts.get(), tabId)) popouts.set((state) => ({ list: state.list.filter((popout) => popout.tabId !== tabId) }));
}

export function registerPopoutWindow(tabId: string, view: Window): () => void {
  windows.set(tabId, view);
  return () => { if (windows.get(tabId) === view) windows.delete(tabId); };
}

// The pop-out window the user is working in, if any: dialogs opened from it show there.
export function focusedPopoutWindow(): Window | null {
  for (const view of windows.values()) if (!view.closed && view.document.hasFocus()) return view;
  return null;
}

export function popoutMenuItems(tabId: string): MenuItem[] {
  const current = popoutOf(popouts.get(), tabId);
  return [
    ...popoutModes.map((mode) => ({ label: `Picture in Picture: ${mode.label}`, isChecked: current?.mode === mode.key, action: () => popOutTab(tabId, mode.key) })),
    ...(current ? [{ label: 'Return to Main Window', action: () => dockTab(tabId) }] : []),
  ];
}
