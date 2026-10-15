import { MONTHS } from './format';
import { timeUnits } from './timeframes';

const { SECOND, MINUTE, HOUR, DAY } = timeUnits;
const steps = [SECOND, 5 * SECOND, 15 * SECOND, 30 * SECOND, MINUTE, 5 * MINUTE, 15 * MINUTE, 30 * MINUTE, HOUR, 2 * HOUR, 4 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 7 * DAY];

export interface TimeTick {
  index: number;
  label: string;
  // Day, month and year boundaries are emphasised.
  isMajor: boolean;
}

const pad = (value: number) => (value < 10 ? `0${value}` : String(value));

// Labels at round times, placed on the first bar at or after each boundary. Calendar labels
// (day, month, year) replace clock labels where a bar starts a new period.
export function timeTicks(times: readonly number[], from: number, to: number, pixelsPerBar: number, minGap = 90): TimeTick[] {
  if (to < from || !times.length) return [];
  const barsPerLabel = Math.max(1, minGap / pixelsPerBar);
  const typical = times.length > 1 ? (times[Math.min(to, times.length - 1)] - times[Math.max(0, from)]) / Math.max(1, Math.min(to, times.length - 1) - Math.max(0, from)) : MINUTE;
  const wanted = typical * barsPerLabel;
  const step = steps.find((candidate) => candidate >= wanted);
  const ticks: TimeTick[] = [];
  let lastIndex = -Infinity;
  for (let index = Math.max(1, from); index <= Math.min(to, times.length - 1); index++) {
    const time = times[index];
    const previous = times[index - 1];
    const date = new Date(time);
    const before = new Date(previous);
    const isNewYear = date.getUTCFullYear() !== before.getUTCFullYear();
    const isNewMonth = isNewYear || date.getUTCMonth() !== before.getUTCMonth();
    const isNewDay = isNewMonth || date.getUTCDate() !== before.getUTCDate();
    let label: string | null = null;
    let isMajor = false;
    if (step === undefined) {
      // Wider than a week per label: months, then years.
      if (isNewYear) { label = String(date.getUTCFullYear()); isMajor = true; }
      else if (isNewMonth && (wanted < 120 * DAY || date.getUTCMonth() % 3 === 0)) label = MONTHS[date.getUTCMonth()];
    } else if (isNewYear) { label = String(date.getUTCFullYear()); isMajor = true; }
    else if (isNewMonth) { label = MONTHS[date.getUTCMonth()]; isMajor = true; }
    else if (isNewDay) { label = String(date.getUTCDate()); isMajor = step < DAY; }
    else if (step < DAY && Math.floor(time / step) !== Math.floor(previous / step)) {
      label = step < MINUTE ? `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}` : `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
    } else if (step >= DAY && step < 7 * DAY && isNewDay) label = String(date.getUTCDate());
    if (label === null) continue;
    // Keep labels apart; a calendar label may displace the clock label just before it.
    if (index - lastIndex < barsPerLabel * 0.8) {
      if (isMajor && ticks.length && !ticks[ticks.length - 1].isMajor) ticks.pop();
      else continue;
    }
    ticks.push({ index, label, isMajor });
    lastIndex = index;
  }
  return ticks;
}
