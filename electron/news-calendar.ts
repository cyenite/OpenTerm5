import { EventEmitter } from 'node:events';
import type { NewsEvent, NewsImpact, NewsView } from '../shared/news';
import { isAffected, isNewsImpact, meetsImpact, newsImpacts } from '../shared/news';
import { zoneOffsetMs } from '../shared/trading-day';
import type { NewsSource } from './trade-manager';

export const CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

const DAY_MS = 86_400_000;
const REFRESH_MS = 3_600_000;
const TIMEOUT_MS = 15_000;
const SHOWN_PAST_MS = 3_600_000;

export interface CalendarCache {
  fetchedAt: number;
  events: NewsEvent[];
}

export interface CalendarStore {
  load(): Promise<CalendarCache>;
  save(value: CalendarCache): Promise<void>;
}

export function parseCalendar(value: unknown): NewsEvent[] {
  if (!Array.isArray(value)) throw new Error('the calendar feed is not a list');
  return value.flatMap((item): NewsEvent[] => {
    const raw = (item ?? {}) as Record<string, unknown>;
    const impact = newsImpacts.find((entry) => entry.feed === raw.impact)?.key;
    const time = typeof raw.date === 'string' ? Date.parse(raw.date) : NaN;
    if (!impact || !Number.isFinite(time) || typeof raw.title !== 'string' || typeof raw.country !== 'string') return [];
    return [{ time, impact, title: raw.title, currency: raw.country }];
  }).sort((left, right) => left.time - right.time);
}

export function parseCalendarCache(value: unknown): CalendarCache {
  const raw = (value ?? {}) as Partial<CalendarCache>;
  const events = Array.isArray(raw.events) ? raw.events.filter((event) => Number.isFinite(event?.time) && isNewsImpact(event.impact) && typeof event.title === 'string' && typeof event.currency === 'string') : [];
  return { fetchedAt: Number.isFinite(raw.fetchedAt) ? raw.fetchedAt! : 0, events };
}

// The feed holds one calendar week, Sunday to Saturday in New York time.
export function calendarWeek(events: readonly NewsEvent[]): { start: number; end: number } | null {
  if (!events.length) return null;
  const first = events[0].time;
  const local = new Date(first + zoneOffsetMs('newYork', first));
  const sunday = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - local.getUTCDay());
  const start = sunday - zoneOffsetMs('newYork', sunday);
  return { start, end: start + 7 * DAY_MS };
}

export class NewsCalendar extends EventEmitter implements NewsSource {
  private error?: string;
  private timer?: NodeJS.Timeout;
  private fetchedAt?: number;
  private refreshing?: Promise<void>;
  private isActive = false;
  private hasWarned = false;
  private events: NewsEvent[] = [];

  constructor(
    private readonly store: CalendarStore,
    private readonly fetch: typeof globalThis.fetch,
    private readonly journal: (message: string) => void,
    private readonly now = () => Date.now(),
  ) {
    super();
  }

  async init(): Promise<void> {
    try {
      const cache = await this.store.load();
      if (cache.fetchedAt) {
        this.events = cache.events;
        this.fetchedAt = cache.fetchedAt;
      }
    } catch (error) {
      this.journal(`Saved economic calendar could not be read: ${(error as Error).message}`);
    }
  }

  // The calendar is only fetched while a guard uses a news blackout, so nobody else's
  // copy of OpenTerm5 contacts the feed.
  setActive(isActive: boolean): void {
    if (isActive === this.isActive) return;
    this.isActive = isActive;
    clearInterval(this.timer);
    this.timer = undefined;
    if (isActive) {
      if (!this.fetchedAt || this.now() - this.fetchedAt >= REFRESH_MS) void this.refresh();
      this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
      this.timer.unref?.();
    }
    this.emit('changed', this.view());
  }

  refresh(): Promise<void> {
    this.refreshing ??= (async () => {
      try {
        const response = await this.fetch(CALENDAR_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!response.ok) throw new Error(`the feed answered HTTP ${response.status}`);
        this.events = parseCalendar(await response.json());
        this.fetchedAt = this.now();
        this.error = undefined;
        await this.store.save({ fetchedAt: this.fetchedAt, events: this.events });
      } catch (error) {
        this.error = (error as Error).message;
        this.journal(`Economic calendar was not updated: ${this.error}`);
      } finally {
        this.refreshing = undefined;
        this.emit('changed', this.view());
      }
    })();
    return this.refreshing;
  }

  isCovering(time: number): boolean {
    const week = calendarWeek(this.events);
    return !!week && time >= week.start && time < week.end;
  }

  // Without a calendar for the current week nothing is blocked: failing closed would stop all
  // trading whenever the feed is down. The journal says so once until coverage returns.
  blackout(currencies: readonly string[], time: number, beforeMs: number, afterMs: number, minimum: NewsImpact): NewsEvent | undefined {
    if (!this.isCovering(time)) {
      if (!this.hasWarned) this.journal('News blackout is not enforced: the economic calendar does not cover this week yet.');
      this.hasWarned = true;
      return undefined;
    }
    this.hasWarned = false;
    return this.events.find((event) => meetsImpact(event.impact, minimum) && isAffected(event, currencies) && time >= event.time - beforeMs && time <= event.time + afterMs);
  }

  view(): NewsView {
    const now = this.now();
    return {
      status: { isActive: this.isActive, isCovering: this.isCovering(now), ...(this.fetchedAt ? { fetchedAt: this.fetchedAt } : {}), ...(this.error ? { error: this.error } : {}) },
      events: this.events.filter((event) => event.time >= now - SHOWN_PAST_MS),
    };
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
