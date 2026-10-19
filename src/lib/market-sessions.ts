import { serverOffsetAt, zoneOffsetMs, type ServerClock } from './server-clock';

// The forex sessions as traders name them, by their city's local hours, in the order they open
// through the trading day. Daylight saving follows each city's own time zone.
export const marketSessions = [
  { key: 'sydney', label: 'Sydney', zone: 'Australia/Sydney', openHour: 7, closeHour: 16 },
  { key: 'tokyo', label: 'Tokyo', zone: 'Asia/Tokyo', openHour: 9, closeHour: 18 },
  { key: 'london', label: 'London', zone: 'Europe/London', openHour: 8, closeHour: 17 },
  { key: 'newYork', label: 'New York', zone: 'America/New_York', openHour: 8, closeHour: 17 },
] as const;

export type MarketSessionKey = (typeof marketSessions)[number]['key'];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// The UTC instant of a wall-clock time in a zone, taken as UTC milliseconds.
function zoneToUtc(zone: string, localMs: number): number {
  const guess = localMs - zoneOffsetMs(zone, localMs);
  return localMs - zoneOffsetMs(zone, guess);
}

// The next weekday opening of the session after `afterUtc`, in UTC milliseconds.
export function nextSessionOpen(key: MarketSessionKey, afterUtc: number): number {
  const session = marketSessions.find((candidate) => candidate.key === key)!;
  const today = Math.floor((afterUtc + zoneOffsetMs(session.zone, afterUtc)) / DAY) * DAY;
  for (let day = 0; day < 10; day++) {
    const localOpen = today + day * DAY + session.openHour * HOUR;
    const weekday = new Date(localOpen).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const open = zoneToUtc(session.zone, localOpen);
    if (open > afterUtc) return open;
  }
  throw new Error(`No ${session.label} opening found.`);
}

// Chart times are the broker's clock written as UTC; these convert with the broker's clock as read
// from its history, so a session lands on the bar it opened in on the chart.
export function chartToUtc(clock: ServerClock, chartTime: number): number {
  const rough = chartTime - serverOffsetAt(clock, chartTime);
  return chartTime - serverOffsetAt(clock, rough);
}

export function utcToChart(clock: ServerClock, utc: number): number {
  return utc + serverOffsetAt(clock, utc);
}

export function nextSessionOpenOnChart(clock: ServerClock, key: MarketSessionKey, afterChartTime: number): number {
  return utcToChart(clock, nextSessionOpen(key, chartToUtc(clock, afterChartTime)));
}
