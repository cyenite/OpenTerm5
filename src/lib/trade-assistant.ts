import type { RiskOrderRequest, RiskPreferences } from '../../shared/automation';
import type { OrderTypeKey } from '../../shared/protocol';
import { distanceUnits, floorToStep, type DistanceUnit, type VolumeLimits } from '../../shared/risk';
import { pipFactor } from '../../shared/valuation';
import { Store } from './store';

export const assistantTabs = [
  { key: 'trade', label: 'Trade' },
  { key: 'close', label: 'Close' },
  { key: 'manage', label: 'Manage' },
] as const;

export type AssistantTab = (typeof assistantTabs)[number]['key'];

export const entryKinds = [
  { key: 'market', label: 'Market', suffix: '' },
  { key: 'limit', label: 'Limit', suffix: 'Limit' },
  { key: 'stop', label: 'Stop', suffix: 'Stop' },
] as const;

export type EntryKind = (typeof entryKinds)[number]['key'];

export const closeScopes = [
  { key: 'symbol', label: 'This symbol' },
  { key: 'account', label: 'All symbols' },
] as const;

export type CloseScope = (typeof closeScopes)[number]['key'];

// Which side's plan the charts draw.
export const chartSides = [
  { key: 'off', label: 'Off' },
  { key: 'buy', label: 'Buy' },
  { key: 'sell', label: 'Sell' },
] as const;

export type ChartSide = (typeof chartSides)[number]['key'];

// Risk mode, amount and commission are not here: they are the shared risk settings
// (`risk-preferences.ts`), so the assistant and the chart planner always size alike.
export interface AssistantPreferences {
  tab: AssistantTab;
  unit: DistanceUnit;
  entry: EntryKind;
  scope: CloseScope;
  chartSide: ChartSide;
  stop: number;
  trailing: number;
  breakEvenR: number;
  closePercent: number;
  targets: string;
  comment: string;
  isStealth: boolean;
  isBreakEvenAfterFirst: boolean;
}

export const defaultAssistantPreferences: AssistantPreferences = {
  tab: 'trade',
  unit: 'pips',
  entry: 'market',
  scope: 'symbol',
  chartSide: 'buy',
  stop: 20,
  trailing: 0,
  breakEvenR: 0,
  closePercent: 50,
  targets: '2',
  comment: '',
  isStealth: false,
  isBreakEvenAfterFirst: true,
};

const STORAGE_KEY = 'openterm.tradeAssistant.v1';

function isKeyOf<T extends string>(options: readonly { key: T }[], value: unknown): value is T {
  return options.some((option) => option.key === value);
}

function amount(value: unknown, fallback: number, max = Number.POSITIVE_INFINITY): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : fallback;
}

export function restoreAssistantPreferences(value: unknown): AssistantPreferences {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof AssistantPreferences, unknown>>;
  const fallback = defaultAssistantPreferences;
  return {
    tab: isKeyOf(assistantTabs, raw.tab) ? raw.tab : fallback.tab,
    unit: isKeyOf(distanceUnits, raw.unit) ? raw.unit : fallback.unit,
    entry: isKeyOf(entryKinds, raw.entry) ? raw.entry : fallback.entry,
    scope: isKeyOf(closeScopes, raw.scope) ? raw.scope : fallback.scope,
    chartSide: isKeyOf(chartSides, raw.chartSide) ? raw.chartSide : fallback.chartSide,
    stop: amount(raw.stop, fallback.stop),
    trailing: amount(raw.trailing, fallback.trailing),
    breakEvenR: amount(raw.breakEvenR, fallback.breakEvenR),
    closePercent: amount(raw.closePercent, fallback.closePercent, 100),
    targets: typeof raw.targets === 'string' ? raw.targets : fallback.targets,
    comment: typeof raw.comment === 'string' ? raw.comment : fallback.comment,
    isStealth: typeof raw.isStealth === 'boolean' ? raw.isStealth : fallback.isStealth,
    isBreakEvenAfterFirst: typeof raw.isBreakEvenAfterFirst === 'boolean' ? raw.isBreakEvenAfterFirst : fallback.isBreakEvenAfterFirst,
  };
}

function loadPreferences(): AssistantPreferences {
  try { return restoreAssistantPreferences(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')); }
  catch { return { ...defaultAssistantPreferences }; }
}

export const assistantPreferences = new Store<AssistantPreferences>(loadPreferences());

assistantPreferences.subscribe(() => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(assistantPreferences.get())); }
  catch { /* preferences are a convenience */ }
});

// The pending entry price, shared by the panel and the chart's plan lines; not saved.
export const assistantEntry = new Store<{ price: number }>({ price: 0 });

// The plan the charts of `symbol` draw while the Trade tab is open, from the risk preview.
export interface AssistantPlan {
  side: 'buy' | 'sell';
  symbol: string;
  lots: number;
  entry: number;
  stopLoss: number;
  riskMoney: number;
  takeProfits: number[];
  isPending: boolean;
}

export const assistantPlan = new Store<{ plan: AssistantPlan | null }>({ plan: null });

// Up to five R multiples; "1, 2" splits the volume evenly across two targets.
export function parseTargets(text: string): number[] {
  return text.split(',').map((item) => Number(item.trim())).filter((value) => Number.isFinite(value) && value > 0).slice(0, 5);
}

export function orderTypeFor(side: 'buy' | 'sell', entry: EntryKind): OrderTypeKey {
  return `${side}${entryKinds.find((kind) => kind.key === entry)!.suffix}` as OrderTypeKey;
}

interface AssistantOrder {
  side: 'buy' | 'sell';
  symbol: string;
  risk: RiskPreferences;
  preferences: AssistantPreferences;
  // The entry for a limit or stop order; market orders fill at the current price.
  price?: number;
}

export function assistantRequest({ side, symbol, risk, preferences, price }: AssistantOrder): RiskOrderRequest {
  const targets = parseTargets(preferences.targets);
  const hasStop = preferences.stop > 0;
  const comment = preferences.comment.trim();
  return {
    type: orderTypeFor(side, preferences.entry),
    mode: risk.mode,
    value: risk.value,
    symbol,
    ...(preferences.entry !== 'market' && price ? { price } : {}),
    ...(hasStop ? { stopLoss: { unit: preferences.unit, value: preferences.stop } } : {}),
    ...(hasStop && targets.length ? { takeProfitR: targets } : {}),
    ...(comment ? { comment } : {}),
    ...(risk.commissionPerLot > 0 ? { commissionPerLot: risk.commissionPerLot } : {}),
    management: {
      isStealth: preferences.isStealth,
      isBreakEvenAfterFirstTarget: preferences.isBreakEvenAfterFirst && targets.length > 1,
      ...(preferences.breakEvenR > 0 ? { breakEvenR: preferences.breakEvenR } : {}),
      ...(preferences.trailing > 0 ? { trailing: { startPoints: preferences.trailing, distancePoints: preferences.trailing, stepPoints: 10 } } : {}),
    },
  };
}

// The volume to close for `percent` of a position, or null when no valid part is that small. A
// part that would leave less than the minimum volume open leaves exactly the minimum instead.
export function partialVolume(volume: number, percent: number, limits: Pick<VolumeLimits, 'volumeMin' | 'volumeStep'>): number | null {
  if (percent >= 100) return volume;
  let part = floorToStep(volume * percent / 100, limits.volumeStep);
  if (volume - part < limits.volumeMin - 1e-9) part = floorToStep(volume - limits.volumeMin, limits.volumeStep);
  return part >= limits.volumeMin - 1e-9 && part > 0 ? part : null;
}

// The stop setting that puts the stop at `price`, in the preference's unit, or null when the price
// is on the wrong side of the entry.
export function stopForPrice(side: 'buy' | 'sell', entry: number, price: number, unit: DistanceUnit, limits: Pick<VolumeLimits, 'digits' | 'point'>): number | null {
  if ((side === 'buy') !== (price < entry)) return null;
  if (unit === 'price') return price;
  const size = limits.point * (unit === 'pips' ? pipFactor(limits.digits) : 1);
  return size > 0 ? Number((Math.abs(entry - price) / size).toFixed(1)) : null;
}

// The targets text with target `index` moved to `price`, as an R multiple of the stop distance.
export function targetsForPrice(text: string, index: number, entry: number, stopLoss: number, price: number): string | null {
  const risk = Math.abs(entry - stopLoss);
  const isAhead = (price - entry) * (entry - stopLoss) > 0;
  if (!(risk > 0) || !isAhead) return null;
  const targets = parseTargets(text);
  if (index >= targets.length) return null;
  targets[index] = Number((Math.abs(price - entry) / risk).toFixed(2));
  return targets.join(', ');
}
