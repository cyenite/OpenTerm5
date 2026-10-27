import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { WebContents } from 'electron';
import { AppZoom } from './app-zoom';

type KeyHandler = (event: { preventDefault: () => void }, input: object) => void;

function fakeWindow(isLoading = false) {
  const handlers = new Map<string, (...args: never[]) => void>();
  const contents = {
    factor: 1,
    isDestroyed: () => false,
    isLoading: () => isLoading,
    setZoomFactor(factor: number) { this.factor = factor; },
    on(name: string, handler: (...args: never[]) => void) { handlers.set(name, handler); return this; },
    once(name: string, handler: (...args: never[]) => void) { handlers.set(name, handler); return this; },
  };
  const press = (key: string) => (handlers.get('before-input-event') as unknown as KeyHandler)({ preventDefault: () => undefined }, { type: 'keyDown', key, code: '', alt: false, meta: false, control: true });
  return { contents, press, destroy: () => (handlers.get('destroyed') as unknown as () => void)() };
}

test('a zoom key in any attached window zooms every window, pop-outs included', async () => {
  const zoom = new AppZoom(path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'openterm-zoom-')), 'zoom.json'), () => undefined);
  const main = fakeWindow(true);
  const popout = fakeWindow();
  zoom.attach(main.contents as unknown as WebContents, false);
  zoom.step('in');
  zoom.attach(popout.contents as unknown as WebContents, false);
  assert.equal(popout.contents.factor, 1.1, 'a pop-out opens at the current level');
  popout.press('=');
  assert.equal(main.contents.factor, 1.25, 'Ctrl+= in the pop-out zooms the main window');
  assert.equal(popout.contents.factor, 1.25);
  main.press('-');
  assert.equal(popout.contents.factor, 1.1);
  popout.destroy();
  popout.contents.factor = 0;
  main.press('0');
  assert.equal(main.contents.factor, 1);
  assert.equal(popout.contents.factor, 0, 'a closed pop-out is forgotten');
});
