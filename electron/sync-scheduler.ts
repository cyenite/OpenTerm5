// When sync runs (design 17.4). Pushes cost GitHub's 500-an-hour content limit at 3 writes each, so
// runs started by local edits draw from a bucket of 40 an hour; polls are conditional 304s and free.
export const syncTiming = {
  stampDelayMs: 1000,
  pushDelayMs: 3000,
  focusedPollMs: 15_000,
  backgroundPollMs: 120_000,
  pushesPerHour: 40,
  pushBurst: 5,
  retryMs: [30_000, 60_000, 120_000, 300_000, 600_000],
} as const;

export type RunResult = { readonly kind: 'ok' } | { readonly kind: 'retry'; readonly at?: number } | { readonly kind: 'stop' };

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface SchedulerDeps {
  readonly stamp: () => Promise<void>;
  readonly run: () => Promise<RunResult>;
  readonly now?: () => number;
  readonly timers?: Timers;
}

export const realTimers: Timers = { set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) };

export class SyncScheduler {
  private isFocused = true;
  private isRunning = false;
  private isStopped = true;
  private isRerunWanted = false;
  private failures = 0;
  private tokens: number = syncTiming.pushBurst;
  private refilledAt: number;
  private runAt: number | null = null;
  private runTimer: unknown = null;
  private stampTimer: unknown = null;
  private readonly now: () => number;
  private readonly timers: Timers;

  constructor(private readonly deps: SchedulerDeps) {
    this.now = deps.now ?? Date.now;
    this.timers = deps.timers ?? realTimers;
    this.refilledAt = this.now();
  }

  get isActive(): boolean {
    return !this.isStopped;
  }

  get nextRunAt(): number | null {
    return this.runAt;
  }

  start(): void {
    this.isStopped = false;
    this.failures = 0;
    this.schedule(0);
  }

  stop(): void {
    this.isStopped = true;
    this.timers.clear(this.runTimer);
    this.timers.clear(this.stampTimer);
    [this.runTimer, this.stampTimer, this.runAt] = [null, null, null];
  }

  // Edits are stamped about a second after they settle, offline or not, then pushed shortly after.
  localChange(): void {
    this.timers.clear(this.stampTimer);
    this.stampTimer = this.timers.set(() => {
      this.stampTimer = null;
      void this.deps.stamp().catch(() => undefined).then(() => {
        if (!this.isStopped) this.schedule(this.takeToken() ? syncTiming.pushDelayMs : this.untilNextToken());
      });
    }, syncTiming.stampDelayMs);
  }

  setFocused(isFocused: boolean): void {
    const isGained = isFocused && !this.isFocused;
    this.isFocused = isFocused;
    if (isGained) this.wake();
  }

  // Waking, unlocking or focusing the window: sync now, so a computer you sit down at catches up.
  wake(): void {
    if (this.isStopped) return;
    this.failures = 0;
    this.schedule(0);
  }

  private schedule(delay: number): void {
    if (this.isStopped) return;
    const at = this.now() + delay;
    if (this.runAt !== null && this.runAt <= at) return;
    this.timers.clear(this.runTimer);
    this.runAt = at;
    this.runTimer = this.timers.set(() => void this.execute(), delay);
  }

  private async execute(): Promise<void> {
    [this.runTimer, this.runAt] = [null, null];
    if (this.isStopped) return;
    if (this.isRunning) { this.isRerunWanted = true; return; }
    this.isRunning = true;
    let result: RunResult;
    try { result = await this.deps.run(); }
    catch { result = { kind: 'retry' }; }
    this.isRunning = false;
    if (result.kind === 'stop') { this.stop(); return; }
    if (result.kind === 'ok') this.failures = 0;
    else this.failures += 1;
    if (this.isRerunWanted) {
      this.isRerunWanted = false;
      this.schedule(0);
      return;
    }
    const backoff = syncTiming.retryMs[Math.min(this.failures - 1, syncTiming.retryMs.length - 1)];
    const delay = result.kind === 'ok' ? (this.isFocused ? syncTiming.focusedPollMs : syncTiming.backgroundPollMs) : result.at !== undefined ? Math.max(0, result.at - this.now()) : backoff;
    this.schedule(delay);
  }

  private refill(): void {
    const perToken = 3_600_000 / syncTiming.pushesPerHour;
    const earned = Math.floor((this.now() - this.refilledAt) / perToken);
    if (earned <= 0) return;
    this.tokens = Math.min(syncTiming.pushBurst, this.tokens + earned);
    this.refilledAt += earned * perToken;
  }

  private takeToken(): boolean {
    this.refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private untilNextToken(): number {
    return Math.max(syncTiming.pushDelayMs, this.refilledAt + 3_600_000 / syncTiming.pushesPerHour - this.now());
  }
}
