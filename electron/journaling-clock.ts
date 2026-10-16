const MINUTE = 60_000;
const STEP = 15 * MINUTE;
const FRESH_MS = 60_000;
const MIN_MINUTES = -720;
const MAX_MINUTES = 840;
const AGREEING_TICKS = 3;

// A tick's server time minus now is the server's offset from UTC plus the tick's age. Offsets are
// whole quarter hours, so rounding to 15 minutes leaves the age; only ticks under a minute old
// count, which drops snapshot quotes left over from a closed market.
export function offsetFromTick(tickTime: number, now: number): number | null {
  if (!Number.isFinite(tickTime) || tickTime <= 0) return null;
  const difference = tickTime - now;
  const rounded = Math.round(difference / STEP) * STEP;
  if (Math.abs(difference - rounded) > FRESH_MS) return null;
  const minutes = rounded / MINUTE || 0;
  return minutes >= MIN_MINUTES && minutes <= MAX_MINUTES ? minutes : null;
}

// Settles a server's offset once several fresh ticks in a row agree, so one stale quote that
// happens to land near a quarter hour cannot set it. A daylight saving change is picked up the same
// way once live ticks show the new offset.
export class ServerClockEstimator {
  private candidate: { server: string; minutes: number; count: number } | null = null;

  constructor(private readonly known: Map<string, number> = new Map()) {}

  offset(server: string): number | null {
    return this.known.get(server) ?? null;
  }

  // Returns the offset when it becomes known or changes, otherwise null.
  observe(server: string, tickTime: number, now: number): number | null {
    const minutes = offsetFromTick(tickTime, now);
    if (minutes === null) return null;
    if (this.known.get(server) === minutes) {
      this.candidate = null;
      return null;
    }
    const isSame = this.candidate?.server === server && this.candidate.minutes === minutes;
    this.candidate = { server, minutes, count: isSame ? this.candidate!.count + 1 : 1 };
    if (this.candidate.count < AGREEING_TICKS) return null;
    this.known.set(server, minutes);
    this.candidate = null;
    return minutes;
  }

  entries(): Record<string, number> {
    return Object.fromEntries(this.known);
  }
}
