import type { BrowserWindow, Rectangle } from 'electron';
import { JsonStore } from './json-store';

export interface WindowPlacement {
  readonly bounds: Rectangle;
  readonly isMaximized: boolean;
  readonly isFullScreen: boolean;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

const SAVE_DELAY_MS = 500;

// A window must keep this much of its title bar on a display to come back where it was left.
const VISIBLE_PX = 100;

// Windows reports a window snapped to the top edge a few pixels above the work area.
const EDGE_PX = 8;

const isRectangle = (value: unknown): value is Rectangle => !!value && typeof value === 'object'
  && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite((value as Record<string, unknown>)[key]));

export function parsePlacement(value: unknown): WindowPlacement | null {
  const saved = value as Partial<Record<keyof WindowPlacement, unknown>> | null;
  if (!saved || !isRectangle(saved.bounds)) return null;
  return { bounds: saved.bounds, isMaximized: saved.isMaximized === true, isFullScreen: saved.isFullScreen === true };
}

// The saved bounds, fitted to the displays there are now: a window last left on a monitor that is
// gone opens centred on the primary display at its saved size, shrunk to fit.
export function restoredBounds(saved: Rectangle, workAreas: readonly Rectangle[], minimum: Size): Partial<Rectangle> {
  const isOnScreen = workAreas.some((area) => saved.x + saved.width - VISIBLE_PX >= area.x && saved.x + VISIBLE_PX <= area.x + area.width
    && saved.y >= area.y - EDGE_PX && saved.y + VISIBLE_PX / 2 <= area.y + area.height);
  const [primary] = workAreas;
  const fit = (size: number, room: number, least: number) => Math.round(Math.max(least, Math.min(size, room)));
  if (isOnScreen) return { x: Math.round(saved.x), y: Math.round(saved.y), width: fit(saved.width, Infinity, minimum.width), height: fit(saved.height, Infinity, minimum.height) };
  if (!primary) return { width: fit(saved.width, Infinity, minimum.width), height: fit(saved.height, Infinity, minimum.height) };
  return { width: fit(saved.width, primary.width, minimum.width), height: fit(saved.height, primary.height, minimum.height) };
}

// Remembers the main window's size, place and maximised or full-screen state in `window.json`.
// Bounds are the normal ones, so a maximised window still restores to the size it had before.
export class WindowBounds {
  private placement: WindowPlacement | null = null;
  private readonly store: JsonStore<WindowPlacement | null>;

  constructor(file: string) {
    this.store = new JsonStore(file, parsePlacement, () => null);
  }

  async load(): Promise<void> {
    try { this.placement = await this.store.load(); }
    catch { this.placement = null; }
  }

  options(workAreas: readonly Rectangle[], minimum: Size): Partial<Rectangle> {
    return this.placement ? restoredBounds(this.placement.bounds, workAreas, minimum) : {};
  }

  // Call before the window's own ready-to-show listener: maximising shows the window on Windows.
  track(window: BrowserWindow): void {
    const restored = this.placement;
    window.once('ready-to-show', () => {
      if (restored?.isFullScreen) window.setFullScreen(true);
      else if (restored?.isMaximized) window.maximize();
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer);
      timer = undefined;
      if (window.isDestroyed() || window.isMinimized()) return;
      this.placement = { bounds: window.getNormalBounds(), isMaximized: window.isMaximized(), isFullScreen: window.isFullScreen() };
      void this.store.save(this.placement).catch(() => undefined);
    };
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(save, SAVE_DELAY_MS);
    };
    window.on('resize', later);
    window.on('move', later);
    window.on('maximize', later);
    window.on('unmaximize', later);
    window.on('enter-full-screen', later);
    window.on('leave-full-screen', later);
    window.on('close', save);
  }
}
