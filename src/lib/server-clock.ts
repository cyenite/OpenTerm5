// A broker's trade server keeps its own wall clock (often UTC+2 in winter and UTC+3 in summer) and
// stamps bars with it as if it were UTC. The clock is read from the broker's own history: forex
// opens every week at 17:00 New York time, a known UTC instant, so the first bar after each
// weekend gives that week's offset. Weeks before the history follow the broker's observed pattern
// for the same daylight saving season.

export interface ServerClockWeek {
  // When the week opened, in UTC epoch ms.
  opensAt: number;
  offsetMs: number;
}

export interface ServerClock {
  // Weeks read from history, oldest first.
  weeks: readonly ServerClockWeek[];
  // The offset by daylight saving season ('us-eu', each true or false), from those weeks.
  bySeason: Readonly<Record<string, number>>;
  // The offset the server reports now, used when history says nothing.
  reportedMs: number | null;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const HALF_HOUR = 30 * MINUTE;
const LIMIT = 14 * HOUR;

// The zone's clock minus UTC at an instant, from the platform's time zone data.
export function zoneOffsetMs(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(utcMs));
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const local = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
  return local - Math.floor(utcMs / 1000) * 1000;
}

const isNewYorkSummer = (utcMs: number) => zoneOffsetMs('America/New_York', utcMs) === -4 * HOUR;
const isEuropeSummer = (utcMs: number) => zoneOffsetMs('Europe/London', utcMs) === HOUR;
const seasonOf = (utcMs: number) => `${isNewYorkSummer(utcMs)}-${isEuropeSummer(utcMs)}`;

// Sunday 17:00 in New York, as UTC, for the Sunday that starts at `sundayUtc` (00:00 UTC).
function newYorkOpen(sundayUtc: number): number {
  const localFive = sundayUtc + 17 * HOUR;
  return localFive - zoneOffsetMs('America/New_York', localFive + 5 * HOUR);
}

// The offset of a week whose first bar opened at `serverMs` on the server's clock, or null when
// no Sunday open lies within the possible offsets.
export function weekOffsetMs(serverMs: number): number | null {
  const day = Math.floor(serverMs / DAY);
  let best: number | null = null;
  for (let candidate = day - 1; candidate <= day + 1; candidate++) {
    if (new Date(candidate * DAY).getUTCDay() !== 0) continue;
    const offset = serverMs - newYorkOpen(candidate * DAY);
    if (Math.abs(offset) <= LIMIT && (best === null || Math.abs(offset) < Math.abs(best))) best = offset;
  }
  return best === null ? null : Math.round(best / HALF_HOUR) * HALF_HOUR;
}

// Reads the clock from a forex symbol's bars (times on the server's clock, epoch ms). Weekends
// are gaps of 36 hours or more; holiday openings that disagree with the server's own report by more
// than its daylight saving hour are ignored.
export function readServerClock(barTimes: readonly number[], reportedMs: number | null): ServerClock {
  const weeks: ServerClockWeek[] = [];
  for (let index = 1; index < barTimes.length; index++) {
    if (barTimes[index] - barTimes[index - 1] < 36 * HOUR) continue;
    const offsetMs = weekOffsetMs(barTimes[index]);
    if (offsetMs === null || (reportedMs !== null && Math.abs(offsetMs - reportedMs) > HOUR)) continue;
    weeks.push({ opensAt: barTimes[index] - offsetMs, offsetMs });
  }
  const votes = new Map<string, Map<number, number>>();
  for (const week of weeks) {
    const season = seasonOf(week.opensAt + DAY);
    const tally = votes.get(season) ?? new Map<number, number>();
    tally.set(week.offsetMs, (tally.get(week.offsetMs) ?? 0) + 1);
    votes.set(season, tally);
  }
  const bySeason = Object.fromEntries([...votes].map(([season, tally]) => [season, [...tally].sort((left, right) => right[1] - left[1])[0][0]]));
  return { weeks, bySeason, reportedMs };
}

// The server's offset at a UTC instant: the week it falls in when history covers it, otherwise
// the broker's offset for that daylight saving season, otherwise what the server reports now.
export function serverOffsetAt(clock: ServerClock, utcMs: number): number {
  const { weeks } = clock;
  if (weeks.length && utcMs >= weeks[0].opensAt) {
    let low = 0;
    let high = weeks.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (weeks[middle].opensAt <= utcMs) low = middle;
      else high = middle - 1;
    }
    return weeks[low].offsetMs;
  }
  return clock.bySeason[seasonOf(utcMs)] ?? clock.reportedMs ?? weeks[0]?.offsetMs ?? 0;
}
