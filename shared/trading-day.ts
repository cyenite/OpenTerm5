export const resetZones = [
  { key: 'server', label: 'Broker server time', zone: undefined },
  { key: 'prague', label: 'Prague time (FTMO)', zone: 'Europe/Prague' },
  { key: 'newYork', label: 'New York time', zone: 'America/New_York' },
  { key: 'utc', label: 'UTC', zone: 'UTC' },
  { key: 'local', label: 'This computer', zone: undefined },
] as const;

export type ResetZone = (typeof resetZones)[number]['key'];

export const lossBases = [
  { key: 'higher', label: 'Higher of balance and equity', hint: 'The most cautious reading, used by The5ers.' },
  { key: 'balance', label: 'Balance at day start', hint: 'Open positions at the reset do not move the limit, as at FTMO.' },
  { key: 'equity', label: 'Equity at day start', hint: 'Includes floating profit or loss at the reset.' },
] as const;

export type LossBasis = (typeof lossBases)[number]['key'];

const formatters = new Map<string, Intl.DateTimeFormat>();

function namedZoneOffsetMs(zone: string, time: number): number {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    formatters.set(zone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(time).map((part) => [part.type, Number(part.value)]));
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return wall - Math.floor(time / 1000) * 1000;
}

// The server offset comes from the broker's account record; until one is known the
// server day is read as UTC.
export function zoneOffsetMs(zone: ResetZone, time: number, serverOffsetSeconds?: number): number {
  if (zone === 'server') return (serverOffsetSeconds ?? 0) * 1000;
  if (zone === 'local') return -new Date(time).getTimezoneOffset() * 60_000;
  return namedZoneOffsetMs(resetZones.find((item) => item.key === zone)!.zone!, time);
}

export function tradingDayKey(time: number, zone: ResetZone, resetHour: number, serverOffsetSeconds?: number): string {
  const shifted = new Date(time + zoneOffsetMs(zone, time, serverOffsetSeconds) - resetHour * 3_600_000);
  return `${shifted.getUTCFullYear()}-${shifted.getUTCMonth() + 1}-${shifted.getUTCDate()}`;
}

export function dayReference(basis: LossBasis, balance: number, equity: number): number {
  if (basis === 'balance') return balance;
  if (basis === 'equity') return equity;
  return Math.max(balance, equity);
}

export function isResetZone(value: unknown): value is ResetZone {
  return resetZones.some((item) => item.key === value);
}

export function isLossBasis(value: unknown): value is LossBasis {
  return lossBases.some((item) => item.key === value);
}
