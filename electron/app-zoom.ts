import type { WebContents } from 'electron';
import { restoreZoom, steppedZoom, zoomStepForKey, type ZoomStep } from '../shared/zoom';
import { JsonStore } from './json-store';

interface ZoomFile {
  zoomFactor: number;
}

// Zooms the whole interface and remembers the level in `zoom.json`. Keys are caught before the
// page sees them, so zoom works in dialogs and text fields too, where the renderer's shortcuts
// are off. Every attached window (the main one and the chart pop-outs) shares the one level.
export class AppZoom {
  private factor = 1;
  private readonly store: JsonStore<ZoomFile>;
  private readonly windows = new Set<WebContents>();

  constructor(file: string, private readonly onChange: (factor: number) => void) {
    this.store = new JsonStore(file, (value) => ({ zoomFactor: restoreZoom((value as Partial<ZoomFile> | null)?.zoomFactor) }), () => ({ zoomFactor: 1 }));
  }

  async load(): Promise<void> {
    try { this.factor = (await this.store.load()).zoomFactor; }
    catch { this.factor = 1; }
  }

  attach(contents: WebContents, isMac: boolean): void {
    this.windows.add(contents);
    contents.once('destroyed', () => this.windows.delete(contents));
    // Chromium keeps zoom per origin and resets it on navigation, so it is applied on every load.
    // A pop-out has already loaded its blank page when it is attached.
    contents.on('did-finish-load', () => this.apply(contents));
    if (!contents.isLoading()) contents.setZoomFactor(this.factor);
    contents.on('before-input-event', (event, input) => {
      const step = zoomStepForKey(input, isMac);
      if (!step) return;
      event.preventDefault();
      this.step(step);
    });
  }

  step(step: ZoomStep): number {
    const next = steppedZoom(this.factor, step);
    if (next !== this.factor) {
      this.factor = next;
      void this.store.save({ zoomFactor: next }).catch(() => undefined);
    }
    for (const contents of this.windows) if (!contents.isDestroyed()) contents.setZoomFactor(this.factor);
    this.onChange(this.factor);
    return this.factor;
  }

  private apply(contents: WebContents): void {
    contents.setZoomFactor(this.factor);
    this.onChange(this.factor);
  }
}
