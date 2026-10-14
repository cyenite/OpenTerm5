import type { MouseEvent as ReactMouseEvent } from 'react';
import type { MenuItem } from '../components/MenuBar';
import { Store } from './store';

export interface ContextMenuState {
  readonly x: number;
  readonly y: number;
  readonly items: readonly MenuItem[];
}

export const contextMenu = new Store<{ menu: ContextMenuState | null }>({ menu: null });

export function openContextMenu(event: ReactMouseEvent | MouseEvent, items: readonly MenuItem[]): void {
  event.preventDefault();
  event.stopPropagation();
  if (items.length) contextMenu.set({ menu: { x: event.clientX, y: event.clientY, items } });
}

export function closeContextMenu(): void {
  contextMenu.set({ menu: null });
}
