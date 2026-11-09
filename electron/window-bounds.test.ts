import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { BrowserWindow } from 'electron';
import { parsePlacement, restoredBounds, WindowBounds } from './window-bounds';

const minimum = { width: 960, height: 600 };
const laptop = { x: 0, y: 25, width: 1440, height: 875 };
const monitor = { x: 1440, y: 0, width: 2560, height: 1440 };

test('a window comes back where it was left while that place is on a display', () => {
  assert.deepEqual(restoredBounds({ x: 1600, y: 100, width: 1800, height: 1100 }, [laptop, monitor], minimum), { x: 1600, y: 100, width: 1800, height: 1100 });
});

test('a window left on a display that is gone opens centred on the primary one, shrunk to fit', () => {
  assert.deepEqual(restoredBounds({ x: 1600, y: 100, width: 1800, height: 1100 }, [laptop], minimum), { width: 1440, height: 875 });
});

test('saved bounds never go below the minimum size', () => {
  assert.deepEqual(restoredBounds({ x: 10, y: 40, width: 200, height: 100 }, [laptop], minimum), { x: 10, y: 40, width: 960, height: 600 });
});

test('an unreadable placement is ignored', () => {
  assert.equal(parsePlacement({ bounds: { x: 0, y: 0, width: 'wide' } }), null);
  assert.equal(parsePlacement(null), null);
  assert.deepEqual(parsePlacement({ bounds: { x: 1, y: 2, width: 3, height: 4 }, isMaximized: true }), { bounds: { x: 1, y: 2, width: 3, height: 4 }, isMaximized: true, isFullScreen: false });
});

test('without a saved placement the window keeps its default size', async () => {
  const bounds = new WindowBounds(path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'openterm-window-')), 'window.json'));
  await bounds.load();
  assert.deepEqual(bounds.options([laptop], minimum), {});
});

test('the size a window is closed at is the size it opens at next time, maximised included', async () => {
  const file = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'openterm-window-')), 'window.json');
  const handlers = new Map<string, () => void>();
  const window = {
    isDestroyed: () => false, isMinimized: () => false, isMaximized: () => true, isFullScreen: () => false,
    getNormalBounds: () => ({ x: 100, y: 80, width: 1200, height: 800 }),
    on(name: string, handler: () => void) { handlers.set(name, handler); return this; },
    once(name: string, handler: () => void) { handlers.set(name, handler); return this; },
  };
  const first = new WindowBounds(file);
  await first.load();
  first.track(window as unknown as BrowserWindow);
  handlers.get('close')!();
  const deadline = Date.now() + 10_000;
  while (!await fs.stat(file).then(() => true, () => false)) {
    if (Date.now() > deadline) throw new Error('window.json was never written');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const next = new WindowBounds(file);
  await next.load();
  assert.deepEqual(next.options([laptop], minimum), { x: 100, y: 80, width: 1200, height: 800 });
  let isMaximized = false;
  next.track({ ...window, maximize: () => { isMaximized = true; } } as unknown as BrowserWindow);
  handlers.get('ready-to-show')!();
  assert.equal(isMaximized, true);
});
