import type { MouseEvent as ReactMouseEvent } from 'react';
import type { MenuItem } from '../components/MenuBar';
import { Store } from './store';

export interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly items: readonly MenuItem[];
  // The window the menu opens in: a chart's pop-out window or the main one.
  readonly view: Window;
}

export const contextMenu = new Store<{ menu: ContextMenuState | null }>({ menu: null });

export function openContextMenu(event: ReactMouseEvent | MouseEvent, items: readonly MenuItem[]): void {
  event.preventDefault();
  event.stopPropagation();
  const view = (event.target as Node | null)?.ownerDocument?.defaultView ?? window;
  if (items.length) contextMenu.set({ menu: { x: event.clientX, y: event.clientY, items, view } });
}

export function closeContextMenu(): void {
  contextMenu.set({ menu: null });
}

export function openMenuAt(x: number, y: number, items: readonly MenuItem[], view: Window = window): void {
  if (items.length) contextMenu.set({ menu: { x, y, items, view } });
}
