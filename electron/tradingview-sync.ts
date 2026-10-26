import { randomBytes } from 'node:crypto';
import type { TradingViewChanges, TradingViewPush, TradingViewStreamStatus, TradingViewWatchedLayout } from '../shared/tradingview';
import { EventStreamParser, TradingViewClient, type Fetcher } from './tradingview-client';

// Follows TradingView's change streams for the linked layouts and saves the app's edits. One client
// for the whole run keeps layout tokens and price series ids between requests.

export interface TradingViewSyncEvents {
  changes: (changes: TradingViewChanges) => void;
  status: (status: TradingViewStreamStatus) => void;
}

const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 60_000;

// TradingView's keep-alive interval is unknown; a stream silent this long is treated as dropped,
// and the reconnect makes the renderer reload what it may have missed.
const IDLE_MS = 10 * 60_000;

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

export class TradingViewSync {
  private client: TradingViewClient;
  private readonly streams = new Map<string, AbortController>();
  // Word characters only: TradingView reads a client id with /(\w+)\/(\w+)\/(\w+)/.
  private readonly clientId = `openterm${randomBytes(6).toString('hex')}`;

  constructor(private readonly fetcher: Fetcher, private readonly events: TradingViewSyncEvents) {
    this.client = new TradingViewClient(fetcher);
  }

  push(push: TradingViewPush): Promise<{ serverUpdateTime: number }> {
    return this.client.push(push, this.clientId);
  }

  // Follows exactly these layouts: streams for others stop, new ones start.
  async watch(layouts: readonly TradingViewWatchedLayout[]): Promise<boolean> {
    const wanted = new Map(layouts.map((layout) => [layout.layoutId, layout]));
    for (const [layoutId, controller] of this.streams) {
      if (wanted.has(layoutId)) continue;
      controller.abort();
      this.streams.delete(layoutId);
    }
    const fresh = [...wanted.values()].filter((layout) => !this.streams.has(layout.layoutId));
    if (!fresh.length) return true;
    await this.client.watchLayouts(fresh);
    for (const layout of fresh) {
      const controller = new AbortController();
      this.streams.set(layout.layoutId, controller);
      void this.follow(layout.layoutId, controller.signal);
    }
    return true;
  }

  // After signing out the cookies are gone; a new client starts from a fresh chart page.
  reset(): void {
    for (const controller of this.streams.values()) controller.abort();
    this.streams.clear();
    this.client = new TradingViewClient(this.fetcher);
  }

  private async follow(layoutId: string, signal: AbortSignal): Promise<void> {
    let delay = RETRY_MIN_MS;
    while (!signal.aborted) {
      this.events.status({ layoutId, state: 'connecting' });
      const attempt = new AbortController();
      const abort = () => attempt.abort();
      signal.addEventListener('abort', abort, { once: true });
      let idle: NodeJS.Timeout | undefined;
      const restartIdle = () => {
        clearTimeout(idle);
        idle = setTimeout(abort, IDLE_MS);
      };
      try {
        const url = await this.client.streamUrl(layoutId);
        if (!url) throw new Error('TradingView did not name a change stream for this layout.');
        restartIdle();
        const response = await this.fetcher(url, { headers: { Accept: 'text/event-stream' }, signal: attempt.signal });
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          throw new Error(`TradingView answered ${response.status} when following your drawings.`);
        }
        this.events.status({ layoutId, state: 'live' });
        delay = RETRY_MIN_MS;
        const parser = new EventStreamParser();
        const decoder = new TextDecoder();
        const reader = response.body.getReader();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          restartIdle();
          for (const data of parser.feed(decoder.decode(value, { stream: true }))) this.deliver(layoutId, data);
        }
        throw new Error('TradingView closed the change stream.');
      } catch (error) {
        if (signal.aborted) return;
        const reason = attempt.signal.aborted ? 'The change stream went quiet.' : (error as Error).message;
        this.events.status({ layoutId, state: 'down', reason });
        await sleep(delay, signal);
        delay = Math.min(RETRY_MAX_MS, delay * 2);
      } finally {
        clearTimeout(idle);
        signal.removeEventListener('abort', abort);
      }
    }
  }

  private deliver(layoutId: string, data: string): void {
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    const changes = this.client.changesOf(layoutId, message, this.clientId);
    if (changes.length) this.events.changes({ layoutId, changes });
  }
}
