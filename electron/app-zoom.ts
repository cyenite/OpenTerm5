import type { WebContents } from 'electron';
import { restoreZoom, steppedZoom, zoomStepForKey, type ZoomStep } from '../shared/zoom';
import { JsonStore } from './json-store';

interface ZoomFile {
  zoomFactor: number;
}

// Zooms the whole interface and remembers the level in `zoom.json`. Keys are caught before the
// page sees them, so zoom works in dialogs and text fields too, where the renderer's shortcuts
// are off.
export class AppZoom {
  private factor = 1;
  private readonly store: JsonStore<ZoomFile>;

  constructor(file: string, private readonly onChange: (factor: number) => void) {
    this.store = new JsonStore(file, (value) => ({ zoomFactor: restoreZoom((value as Partial<ZoomFile> | null)?.zoomFactor) }), () => ({ zoomFactor: 1 }));
  }

  async load(): Promise<void> {
    try { this.factor = (await this.store.load()).zoomFactor; }
    catch { this.factor = 1; }
  }

  attach(contents: WebContents, isMac: boolean): void {
    // Chromium keeps zoom per origin and resets it on navigation, so it is applied on every load.
    contents.on('did-finish-load', () => this.apply(contents));
    contents.on('before-input-event', (event, input) => {
      const step = zoomStepForKey(input, isMac);
      if (!step) return;
      event.preventDefault();
      this.step(contents, step);
    });
  }

  step(contents: WebContents, step: ZoomStep): number {
    const next = steppedZoom(this.factor, step);
    if (next !== this.factor) {
      this.factor = next;
      void this.store.save({ zoomFactor: next }).catch(() => undefined);
    }
    this.apply(contents);
    return this.factor;
  }

  private apply(contents: WebContents): void {
    contents.setZoomFactor(this.factor);
    this.onChange(this.factor);
  }
}
