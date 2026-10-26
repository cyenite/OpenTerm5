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

const unitNames = { S: 'second', M: 'minute', H: 'hour', D: 'day', W: 'week', MN: 'month' } as const;

type Unit = keyof typeof unitNames;

const intradayUnitSeconds: Partial<Record<Unit, number>> = { S: 1, M: 60, H: 3600 };

// A capital M after a number is a month, as in TradingView; any other suffix ignores case.
function unitOf(suffix: string): Unit | null {
  if (suffix === 'M' || suffix.toLowerCase() === 'mn') return 'MN';
  if (!suffix) return 'M';
  const unit = suffix.toUpperCase();
  return unit in unitNames ? unit as Unit : null;
}

// A typed interval, TradingView's way ('15', '4h', '1D', '1W', '1M') or MetaTrader's ('M15', 'H4',
// 'D1', 'MN1'). A bare number is minutes. Null when it names no timeframe the terminal offers.
export function parseTimeframe(text: string): ChartTimeframe | null {
  const value = text.replace(/\s+/g, '');
  const metaTrader = /^(mn|[smhdw])(\d+)$/i.exec(value);
  const tradingView = /^(\d*)([a-z]*)$/i.exec(value);
  const unit = metaTrader ? metaTrader[1].toUpperCase() as Unit : tradingView && value ? unitOf(tradingView[2]) : null;
  const count = Number(metaTrader ? metaTrader[2] : tradingView?.[1] || 1);
  if (!unit || !count) return null;
  const unitSeconds = intradayUnitSeconds[unit];
  // Minutes add up to hours (60 is H1), but days, weeks and months are calendar periods.
  if (unitSeconds) return chartTimeframes.find((candidate) => candidate.seconds === count * unitSeconds && candidate.seconds < 86400)?.label ?? null;
  const label = `${unit}${count}`;
  return isChartTimeframe(label) ? label : null;
}

// 'M15' as '15 minutes', for the timeframe being typed.
export function timeframeDescription(timeframe: ChartTimeframe): string {
  const [, unit, count] = /^(MN|[SMHDW])(\d+)$/.exec(timeframe)!;
  return `${count} ${unitNames[unit as Unit]}${count === '1' ? '' : 's'}`;
}
