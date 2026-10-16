import { chartTimeframes, isSecondsTimeframe, type ChartTimeframe } from './mt5-timeframes';

export const replayModes = [
  { key: 'allCharts', label: 'All Charts', description: 'Every chart of the layout replays on one clock.' },
  { key: 'activeChart', label: 'Active Chart', description: 'Only the active chart replays; the others stay live.' },
] as const;

export type ReplayMode = (typeof replayModes)[number]['key'];

// Fastest first, as the speed menu lists them. `delay` is the time between steps.
export const replaySpeeds = [
  { key: '10x', delay: 100 },
  { key: '7x', delay: 143 },
  { key: '5x', delay: 200 },
  { key: '3x', delay: 300 },
  { key: '1x', delay: 1000 },
  { key: '0.5x', delay: 2000 },
  { key: '0.3x', delay: 3000 },
  { key: '0.2x', delay: 5000 },
  { key: '0.1x', delay: 10000 },
] as const;

export type ReplaySpeed = (typeof replaySpeeds)[number]['key'];

const daySeconds = 86_400;

// The timeframes a layout can step by: no longer than its finest chart and dividing every chart's
// timeframe, so each step ends on a bar boundary of every chart. Weekly and monthly charts step by
// days. Seconds steps come from received quotes, so they are offered only to seconds charts.
export function updateIntervals(timeframes: readonly ChartTimeframe[]): ChartTimeframe[] {
  if (!timeframes.length) return [];
  const seconds = timeframes.map((timeframe) => chartTimeframes.find((candidate) => candidate.label === timeframe)!.seconds);
  const finest = Math.min(...seconds);
  if (finest >= 7 * daySeconds) return ['D1'];
  const hasSeconds = timeframes.some(isSecondsTimeframe);
  return chartTimeframes
    .filter((candidate) => (hasSeconds || !isSecondsTimeframe(candidate.label)) && candidate.seconds <= finest && seconds.every((value) => value % candidate.seconds === 0))
    .map((candidate) => candidate.label);
}

// Auto steps by the largest candidate, which is the finest chart's own timeframe when every chart
// divides by it. A chosen interval that no longer fits falls back to the largest shorter one.
export function updateInterval(timeframes: readonly ChartTimeframe[], chosen: ChartTimeframe | null): ChartTimeframe | null {
  const candidates = updateIntervals(timeframes);
  if (!chosen) return candidates.at(-1) ?? null;
  if (candidates.includes(chosen)) return chosen;
  const limit = chartTimeframes.find((candidate) => candidate.label === chosen)?.seconds ?? 0;
  return [...candidates].reverse().find((candidate) => chartTimeframes.find((entry) => entry.label === candidate)!.seconds < limit) ?? candidates[0] ?? null;
}
