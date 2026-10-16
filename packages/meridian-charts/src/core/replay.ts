import type { Bar } from '../types';
import { timeUnits } from './timeframes';

// Bar replay on a time clock: at time T only data that ended at or before T is revealed. A bar
// ends where the next one opens, capped at its interval, so a market closure ends the bar before
// it at the close rather than at the reopening.

// Index of the first bar opening after `time`, or at it when `isInclusive`.
function firstAfter(bars: readonly Bar[], time: number, isInclusive = false): number {
  let low = 0;
  let high = bars.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (bars[middle].time < time || (!isInclusive && bars[middle].time === time)) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function barEnd(bars: readonly Bar[], index: number, interval: number): number {
  const time = bars[index].time;
  const next = bars[index + 1]?.time;
  // Calendar months outlast the nominal 30 days of a month interval.
  if (interval >= 28 * timeUnits.DAY) return next ?? time + interval * 31 / 30;
  return Math.min(next ?? Infinity, time + interval);
}

// The detail is only used when it is finer than the chart's own bars.
function isDetailUsable(detail: readonly Bar[], detailInterval: number | null, interval: number): detailInterval is number {
  return detailInterval !== null && detailInterval < interval && detail.length > 0;
}

// The end of a detail bar, cut at the end of the chart bar holding it.
function detailEnd(bars: readonly Bar[], interval: number, detail: readonly Bar[], detailInterval: number, index: number): number {
  const end = barEnd(detail, index, detailInterval);
  const holder = firstAfter(bars, detail[index].time) - 1;
  if (holder < 0) return end;
  const holderEnd = barEnd(bars, holder, interval);
  return detail[index].time < holderEnd ? Math.min(end, holderEnd) : end;
}

// The complete bars at `time` plus the bar in progress, built from the detail bars that have
// ended. Without detail covering that bar's opening the bar in progress is left out.
export function revealReplay(bars: readonly Bar[], interval: number, detail: readonly Bar[], detailInterval: number | null, time: number): Bar[] {
  const started = firstAfter(bars, time, true);
  if (!started) return [];
  const last = started - 1;
  const end = barEnd(bars, last, interval);
  if (end <= time) return bars.slice(0, started);
  const complete = bars.slice(0, last);
  const opening = bars[last].time;
  if (!isDetailUsable(detail, detailInterval, interval) || detail[0].time > opening) return complete;
  let forming: Bar | null = null;
  for (let index = firstAfter(detail, opening, true); index < detail.length && detail[index].time < time; index++) {
    const part = detail[index];
    if (Math.min(barEnd(detail, index, detailInterval), end) > time) break;
    if (!forming) {
      forming = { ...part, time: opening };
      continue;
    }
    forming.high = Math.max(forming.high, part.high);
    forming.low = Math.min(forming.low, part.low);
    forming.close = part.close;
    if (part.volume !== undefined) forming.volume = (forming.volume ?? 0) + part.volume;
  }
  return forming ? [...complete, forming] : complete;
}

// The first moment after `after` at which a bar ends: a detail bar where the detail covers that
// moment, otherwise a chart bar. Null at the end of the data.
export function nextReplayTime(bars: readonly Bar[], interval: number, detail: readonly Bar[], detailInterval: number | null, after: number): number | null {
  if (isDetailUsable(detail, detailInterval, interval) && detail[0].time <= after) {
    for (let index = Math.max(0, firstAfter(detail, after) - 1); index < detail.length; index++) {
      const end = detailEnd(bars, interval, detail, detailInterval, index);
      if (end > after) return end;
    }
  }
  const index = Math.max(0, firstAfter(bars, after) - 1);
  for (let candidate = index; candidate < bars.length; candidate++) {
    const end = barEnd(bars, candidate, interval);
    if (end > after) return end;
  }
  return null;
}

// The opening of the bar in progress at `time`, or `time` itself when no bar is in progress.
export function replayOpening(bars: readonly Bar[], interval: number, time: number): number {
  const last = firstAfter(bars, time, true) - 1;
  return last >= 0 && barEnd(bars, last, interval) > time ? bars[last].time : time;
}

// Adds a fetched page to the loaded detail bars, keeping at most `max` around the page. A page
// that does not meet them replaces them, so the detail never has a hole that would pass for a
// closed market.
export function mergeDetail(loaded: readonly Bar[], page: readonly Bar[], interval: number, max = 10_000): Bar[] {
  const fetched = [...page].sort((left, right) => left.time - right.time).filter((bar, index, list) => index === 0 || bar.time !== list[index - 1].time);
  if (!fetched.length) return [...loaded];
  const first = fetched[0].time;
  const last = fetched[fetched.length - 1].time;
  const isApart = !loaded.length || first > loaded[loaded.length - 1].time + interval || last + interval < loaded[0].time;
  const merged = isApart ? fetched : [...loaded.filter((bar) => bar.time < first), ...fetched, ...loaded.filter((bar) => bar.time > last)];
  if (merged.length <= max) return merged;
  const start = Math.max(0, Math.min(merged.findIndex((bar) => bar.time === first), merged.length - max));
  return merged.slice(start, start + max);
}
