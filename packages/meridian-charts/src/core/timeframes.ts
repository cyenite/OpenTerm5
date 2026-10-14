// Meridian timeframe strings: '5s' (seconds), '15' (minutes), '4h' (hours), '1D', '1W', '1M'
// (month). A bare unit means one: 'D', 'W', 'M'.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const units: Record<string, number> = { s: SECOND, '': MINUTE, h: HOUR, D: DAY, W: 7 * DAY, M: 30 * DAY };

export function timeframeMs(timeframe: string): number {
  const match = /^(\d*)([shDWM]?)$/.exec(timeframe.trim());
  if (!match) throw new Error(`"${timeframe}" is not a timeframe.`);
  const count = match[1] ? Number(match[1]) : 1;
  if (!match[1] && !match[2]) throw new Error(`"${timeframe}" is not a timeframe.`);
  return count * units[match[2]];
}

export function isTimeframe(timeframe: string): boolean {
  try {
    return timeframeMs(timeframe) > 0;
  } catch {
    return false;
  }
}

export const timeUnits = { SECOND, MINUTE, HOUR, DAY };
