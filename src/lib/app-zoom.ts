import type { ZoomStep } from '../../shared/zoom';
import { log } from './session';
import { Store } from './store';

export const appZoom = new Store<{ factor: number }>({ factor: 1 });

export function startAppZoom(): void {
  window.terminal.on('zoom', (factor) => appZoom.set({ factor }));
}

export function stepAppZoom(step: ZoomStep): void {
  window.terminal.zoom(step).then((factor) => appZoom.set({ factor })).catch((error: Error) => log(`Zoom failed: ${error.message}`));
}
