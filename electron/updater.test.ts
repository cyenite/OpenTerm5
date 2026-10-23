import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import type { UpdateState } from '../shared/updates';
import { checkIntervalMs, UpdateService, type Updater } from './updater';

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  checks = 0;
  installs = 0;
  downloads = 0;
  // What the next check finds: a newer version, nothing, or null when the build cannot update itself.
  next: string | null | undefined = undefined;

  async checkForUpdates() {
    this.checks += 1;
    if (this.next === null) return null;
    this.emit('checking-for-update');
    if (this.next) {
      this.emit('update-available', { version: this.next });
      if (this.autoDownload) this.finishDownload();
    } else this.emit('update-not-available', { version: '0.5.0' });
    return { isUpdateAvailable: !!this.next } as never;
  }

  async downloadUpdate() {
    this.downloads += 1;
    this.finishDownload();
    return [];
  }

  quitAndInstall() {
    this.installs += 1;
  }

  private finishDownload() {
    for (const percent of [10, 30, 60, 100]) this.emit('download-progress', { percent });
    this.emit('update-downloaded', { version: this.next });
  }
}

async function harness(options: { canInstall?: boolean; file?: string; next?: string | null; isConfirmed?: boolean } = {}) {
  const file = options.file ?? path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'openterm-updates-')), 'updates.json');
  const updater = new FakeUpdater();
  updater.next = options.next;
  const journal: string[] = [];
  const opened: string[] = [];
  const states: UpdateState[] = [];
  const confirmations: string[] = [];
  const service = new UpdateService({
    file,
    updater: updater as unknown as Updater,
    canInstall: options.canInstall ?? true,
    isPasswordAsked: false,
    send: (state) => states.push(state),
    journal: (message) => journal.push(message),
    openExternal: async (url) => { opened.push(url); },
    confirmRestart: async (version) => { confirmations.push(version); return options.isConfirmed ?? false; },
  });
  return { file, service, updater, journal, opened, states, confirmations };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('downloads an update in the background but never restarts on its own', async () => {
  const { service, updater, journal } = await harness({ next: '0.6.0' });
  await service.init();
  await settle();
  assert.equal(updater.checks, 1);
  assert.equal(service.current().phase, 'downloaded');
  assert.equal(service.current().version, '0.6.0');
  assert.equal(updater.installs, 0);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.ok(journal.some((line) => line.includes('Restart to update')));
  assert.deepEqual(journal.filter((line) => line.startsWith('Downloading')), ['Downloading OpenTerm5 0.6.0: 25%.', 'Downloading OpenTerm5 0.6.0: 50%.']);
  service.shutdown();
});

test('installs only after the user confirms the restart', async () => {
  const declined = await harness({ next: '0.6.0', isConfirmed: false });
  await declined.service.init();
  await settle();
  await declined.service.handle('updates.install', {});
  assert.deepEqual(declined.confirmations, ['0.6.0']);
  assert.equal(declined.updater.installs, 0);
  declined.service.shutdown();

  const accepted = await harness({ next: '0.6.0', isConfirmed: true });
  await accepted.service.init();
  await settle();
  await accepted.service.handle('updates.install', {});
  assert.equal(accepted.updater.installs, 1);
  accepted.service.shutdown();
});

test('refuses to install before an update is downloaded', async () => {
  const { service, updater, confirmations } = await harness({ next: undefined, isConfirmed: true });
  await service.init();
  await settle();
  assert.equal(service.current().phase, 'current');
  await service.handle('updates.install', {});
  assert.equal(updater.installs, 0);
  assert.deepEqual(confirmations, []);
  service.shutdown();
});

test('checks again every few hours while automatic updates are on', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const { service, updater } = await harness();
    await service.init();
    await settle();
    assert.equal(updater.checks, 1);
    mock.timers.tick(checkIntervalMs);
    await settle();
    assert.equal(updater.checks, 2);
    service.shutdown();
  } finally { mock.timers.reset(); }
});

test('the setting turns off automatic checks and downloads and is remembered', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const first = await harness();
    await first.service.init();
    await settle();
    const state = await first.service.handle('updates.setAutomatic', { isAutomatic: false });
    assert.equal(state.isAutomatic, false);
    assert.equal(first.updater.autoDownload, false);
    mock.timers.tick(checkIntervalMs * 3);
    await settle();
    assert.equal(first.updater.checks, 1);
    first.service.shutdown();
    assert.deepEqual(JSON.parse(await fs.readFile(first.file, 'utf8')), { isAutomatic: false });

    const second = await harness({ file: first.file, next: '0.6.0' });
    await second.service.init();
    await settle();
    assert.equal(second.updater.checks, 0);
    assert.equal(second.service.current().isAutomatic, false);
    await second.service.handle('updates.check', {});
    assert.equal(second.service.current().phase, 'available');
    assert.equal(second.updater.downloads, 0);
    await second.service.handle('updates.download', {});
    assert.equal(second.service.current().phase, 'downloaded');
    assert.equal(second.updater.installs, 0);
    second.service.shutdown();
  } finally { mock.timers.reset(); }
});

test('automatic updates default to on', async () => {
  const { service, updater } = await harness();
  await service.init();
  assert.equal(service.current().isAutomatic, true);
  assert.equal(updater.autoDownload, true);
  service.shutdown();
});

test('without installation support it links to the release page instead', async () => {
  const { service, updater, journal, opened } = await harness({ canInstall: false, next: '0.6.0' });
  await service.init();
  await settle();
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(service.current().phase, 'available');
  await service.handle('updates.download', {});
  assert.equal(updater.downloads, 0);
  await service.handle('updates.openRelease', {});
  assert.deepEqual(opened, ['https://github.com/cyenite/OpenTerm5/releases/tag/v0.6.0']);
  assert.ok(journal.some((line) => line.includes('releases/tag/v0.6.0')));
  service.shutdown();
});

test('reports builds that cannot update themselves', async () => {
  const { service } = await harness({ next: null });
  await service.init();
  await service.handle('updates.check', {});
  assert.equal(service.current().phase, 'unsupported');
  service.shutdown();
});

test('a failed download returns to available so the user can retry', async () => {
  const { service, updater, journal } = await harness({ next: undefined });
  await service.init();
  await settle();
  updater.emit('update-available', { version: '0.6.0' });
  updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED\nstack'));
  assert.equal(service.current().phase, 'available');
  assert.equal(service.current().error, 'net::ERR_INTERNET_DISCONNECTED');
  assert.equal(journal.at(-1), 'Update download failed: net::ERR_INTERNET_DISCONNECTED');
  assert.equal(updater.installs, 0);
  service.shutdown();
});
