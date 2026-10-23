import type { Position } from '../../shared/protocol';
import { Store } from '../lib/store';

export const mobileTabs = [
  { key: 'charts', label: 'Charts' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'trade', label: 'Trade' },
  { key: 'more', label: 'More' },
] as const;

export type MobileTab = (typeof mobileTabs)[number]['key'];

export type MobileSheet =
  | { kind: 'order'; symbol: string; side: Position['side'] }
  | { kind: 'position'; ticket: number }
  | { kind: 'symbol'; chartId: string };

export interface NavigationState {
  tab: MobileTab;
  chartId: string | null;
  sheet: MobileSheet | null;
}

export const navigation = new Store<NavigationState>({ tab: 'charts', chartId: null, sheet: null });

export const openSheet = (sheet: MobileSheet) => navigation.set({ sheet });
export const closeSheet = () => navigation.set({ sheet: null });
