import { timeframes, type Timeframe } from '../../shared/protocol';

// MetaTrader serves bars from one minute up. Seconds charts are built in the terminal from the
// quotes it receives (see tick-bars.ts), so they sit next to the broker's timeframes here.
export const secondsTimeframes = [
  { label: 'S1', seconds: 1, isOnToolbar: false },
  { label: 'S5', seconds: 5, isOnToolbar: false },
  { label: 'S15', seconds: 15, isOnToolbar: false },
  { label: 'S30', seconds: 30, isOnToolbar: false },
] as const;

export type SecondsTimeframe = (typeof secondsTimeframes)[number]['label'];

export type ChartTimeframe = Timeframe | SecondsTimeframe;

export const chartTimeframes: readonly { label: ChartTimeframe; seconds: number; isOnToolbar: boolean }[] = [...secondsTimeframes, ...timeframes];

export function isSecondsTimeframe(timeframe: string): timeframe is SecondsTimeframe {
  return secondsTimeframes.some((candidate) => candidate.label === timeframe);
}

export function isChartTimeframe(value: unknown): value is ChartTimeframe {
  return chartTimeframes.some((candidate) => candidate.label === value);
}

export function timeframeSeconds(timeframe: ChartTimeframe): number {
  return chartTimeframes.find((candidate) => candidate.label === timeframe)!.seconds;
}

// Meridian names timeframes in seconds ('5s'), minutes ('1', '60', '240') and calendar periods
// ('1D', '1W', '1M').
export function toChartTimeframe(timeframe: ChartTimeframe): string {
  if (isSecondsTimeframe(timeframe)) return `${timeframeSeconds(timeframe)}s`;
  if (timeframe === 'D1') return '1D';
  if (timeframe === 'W1') return '1W';
  if (timeframe === 'MN1') return '1M';
  return String(timeframeSeconds(timeframe) / 60);
}

export function fromChartTimeframe(value: string): ChartTimeframe | null {
  return chartTimeframes.find((candidate) => toChartTimeframe(candidate.label) === value)?.label ?? null;
}
