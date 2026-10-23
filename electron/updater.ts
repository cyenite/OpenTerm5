import type { AppUpdater, UpdateInfo } from 'electron-updater';
import { releaseUrl, type UpdateMethod, type UpdateMethods, type UpdateSettings, type UpdateState } from '../shared/updates';
import { JsonStore } from './json-store';

export const checkIntervalMs = 4 * 60 * 60 * 1000;

// The part of electron-updater's AppUpdater this service drives, so tests can supply a fake.
export type Updater = Pick<AppUpdater, 'on' | 'autoDownload' | 'downloadUpdate' | 'quitAndInstall' | 'checkForUpdates' | 'autoInstallOnAppQuit'>;

export interface UpdateServiceOptions {
  readonly file: string;
  readonly updater: Updater;
  readonly canInstall: boolean;
  readonly isPasswordAsked: boolean;
  readonly send: (state: UpdateState) => void;
  readonly journal: (message: string) => void;
  readonly openExternal: (url: string) => Promise<void>;
  readonly confirmRestart: (version: string) => Promise<boolean>;
}

function parseSettings(value: unknown): UpdateSettings {
  const isAutomatic = (value as Partial<UpdateSettings> | null)?.isAutomatic;
  return { isAutomatic: typeof isAutomatic === 'boolean' ? isAutomatic : true };
}

// Never quits on its own: the copier, signal API and equity guards run in this process, so an
// update installs only when the user restarts for it or quits normally.
export class UpdateService {
  private timer: ReturnType<typeof setInterval> | undefined;
  private isManualCheck = false;
  private journaledQuarter = 0;
  private state: UpdateState;
  private readonly store: JsonStore<UpdateSettings>;

  constructor(private readonly options: UpdateServiceOptions) {
    this.store = new JsonStore(options.file, parseSettings, () => parseSettings(null));
    this.state = { phase: 'idle', error: null, version: null, percent: 0, releaseUrl: releaseUrl(null), canInstall: options.canInstall, isAutomatic: true };
  }

  async init(): Promise<void> {
    let settings: UpdateSettings;
    try { settings = await this.store.load(); }
    catch (error) {
      this.options.journal(`${(error as Error).message}. Automatic updates stay on.`);
      settings = parseSettings(null);
    }
    const { updater } = this.options;
    updater.autoInstallOnAppQuit = this.options.canInstall;
    updater.on('checking-for-update', () => this.set({ phase: 'checking', error: null }));
    updater.on('update-available', (info) => this.onAvailable(info));
    updater.on('update-not-available', () => this.onCurrent());
    updater.on('download-progress', (progress) => this.onProgress(progress.percent));
    updater.on('update-downloaded', (info) => this.onDownloaded(info));
    updater.on('error', (error) => this.onError(error));
    this.applyAutomatic(settings.isAutomatic);
    if (settings.isAutomatic) void this.check(false);
  }

  shutdown(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  current(): UpdateState {
    return this.state;
  }

  async handle<M extends UpdateMethod>(method: M, params: UpdateMethods[M][0]): Promise<UpdateMethods[M][1]> {
    const run = async (): Promise<UpdateMethods[UpdateMethod][1]> => {
      if (method === 'updates.state') return this.state;
      if (method === 'updates.check') return this.check(true);
      if (method === 'updates.download') return this.download();
      if (method === 'updates.install') return this.install();
      if (method === 'updates.openRelease') { await this.options.openExternal(this.state.releaseUrl); return true; }
      if (method === 'updates.setAutomatic') return this.setAutomatic((params as UpdateMethods['updates.setAutomatic'][0]).isAutomatic);
      throw new Error(`Unknown update method ${method}`);
    };
    return run() as Promise<UpdateMethods[M][1]>;
  }

  async check(isManual: boolean): Promise<UpdateState> {
    if (['checking', 'downloading', 'downloaded'].includes(this.state.phase)) return this.state;
    this.isManualCheck = isManual;
    if (isManual) this.options.journal('Checking for updates.');
    try {
      const result = await this.options.updater.checkForUpdates();
      if (!result) {
        this.set({ phase: 'unsupported', error: null });
        if (isManual) this.options.journal(`This build cannot update itself. Download new versions from ${releaseUrl(null)}.`);
      }
    } catch { /* reported through the updater's error event */ }
    return this.state;
  }

  async download(): Promise<UpdateState> {
    if (this.state.phase !== 'available' || !this.options.canInstall) return this.state;
    this.set({ phase: 'downloading', percent: 0 });
    this.options.updater.downloadUpdate().catch(() => undefined);
    return this.state;
  }

  async install(): Promise<UpdateState> {
    const { phase, version } = this.state;
    if (phase !== 'downloaded' || !version || !this.options.canInstall) return this.state;
    if (await this.options.confirmRestart(version)) this.options.updater.quitAndInstall();
    return this.state;
  }

  async setAutomatic(isAutomatic: boolean): Promise<UpdateState> {
    await this.store.save({ isAutomatic });
    this.applyAutomatic(isAutomatic);
    this.options.journal(isAutomatic ? 'Automatic update checks are on.' : 'Automatic update checks are off. Use Help > Check for Updates.');
    if (isAutomatic) void this.check(false);
    return this.state;
  }

  private applyAutomatic(isAutomatic: boolean): void {
    this.options.updater.autoDownload = isAutomatic && this.options.canInstall;
    this.shutdown();
    if (isAutomatic) this.timer = setInterval(() => void this.check(false), checkIntervalMs);
    this.set({ isAutomatic });
  }

  private onAvailable(info: UpdateInfo): void {
    const isDownloading = this.options.updater.autoDownload;
    this.journaledQuarter = 0;
    this.set({ phase: isDownloading ? 'downloading' : 'available', version: info.version, percent: 0, releaseUrl: releaseUrl(info.version), error: null });
    const next = `OpenTerm5 ${info.version} is available`;
    if (!this.options.canInstall) this.options.journal(`${next}. Download it from ${releaseUrl(info.version)}.`);
    else this.options.journal(isDownloading ? `${next}. Downloading it in the background.` : `${next}. Download it from the status bar.`);
  }

  private onCurrent(): void {
    this.set({ phase: 'current', error: null });
    if (this.isManualCheck) this.options.journal('OpenTerm5 is up to date.');
  }

  private onProgress(percent: number): void {
    this.set({ phase: 'downloading', percent });
    const quarter = Math.floor(percent / 25);
    if (quarter <= this.journaledQuarter || quarter >= 4) return;
    this.journaledQuarter = quarter;
    this.options.journal(`Downloading OpenTerm5 ${this.state.version}: ${quarter * 25}%.`);
  }

  private onDownloaded(info: UpdateInfo): void {
    this.set({ phase: 'downloaded', version: info.version, percent: 100, releaseUrl: releaseUrl(info.version), error: null });
    const password = this.options.isPasswordAsked ? ' Installing asks for your administrator password.' : '';
    this.options.journal(`OpenTerm5 ${info.version} is downloaded. Choose Restart to update, or it installs when you quit.${password}`);
  }

  private onError(error: Error): void {
    const wasDownloading = this.state.phase === 'downloading';
    const message = error.message.split('\n')[0];
    this.set({ phase: wasDownloading && this.state.version ? 'available' : 'error', error: message, percent: 0 });
    this.options.journal(`${wasDownloading ? 'Update download' : 'Update check'} failed: ${message}`);
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.options.send(this.state);
  }
}
