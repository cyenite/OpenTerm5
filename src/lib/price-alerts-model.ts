import type { Tick } from '../../shared/protocol';

export const alertConditions = [
  { key: 'bidAbove', label: 'Bid at or above', field: 'bid', isAbove: true },
  { key: 'bidBelow', label: 'Bid at or below', field: 'bid', isAbove: false },
  { key: 'askAbove', label: 'Ask at or above', field: 'ask', isAbove: true },
  { key: 'askBelow', label: 'Ask at or below', field: 'ask', isAbove: false },
] as const;

export type AlertCondition = typeof alertConditions[number]['key'];

export interface PriceAlert {
  readonly id: string;
  readonly symbol: string;
  readonly profileId: string;
  readonly condition: AlertCondition;
  readonly price: number;
  readonly createdAt: number;
  readonly triggeredAt: number | null;
  readonly isEnabled: boolean;
}

export function evaluateAlert(alert: PriceAlert, tick: Tick, profileId: string | null): boolean {
  if (!alert.isEnabled || alert.triggeredAt !== null || alert.profileId !== profileId || alert.symbol !== tick.symbol || tick.time < alert.createdAt) return false;
  const condition = alertConditions.find((item) => item.key === alert.condition)!;
  const value = tick[condition.field];
  return Number.isFinite(value) && value > 0 && (condition.isAbove ? value >= alert.price : value <= alert.price);
}

export function restoreAlerts(value: unknown): PriceAlert[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PriceAlert => item && typeof item === 'object' &&
    typeof item.id === 'string' && typeof item.symbol === 'string' && typeof item.profileId === 'string' &&
    alertConditions.some((condition) => condition.key === item.condition) && Number.isFinite(item.price) && item.price > 0 &&
    Number.isFinite(item.createdAt) && (item.triggeredAt === null || Number.isFinite(item.triggeredAt)) && typeof item.isEnabled === 'boolean');
}
