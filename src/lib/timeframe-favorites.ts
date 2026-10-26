import type { MenuItem } from '../components/MenuBar';
import { chartTimeframes, isChartTimeframe, type ChartTimeframe } from './mt5-timeframes';
import { log } from './session';
import { Store } from './store';

// The timeframes starred in a timeframe menu, which the chart bar shows as buttons, as TradingView
// does. Until the user stars any, the common ones are shown.

const STORAGE_KEY = 'openterm.timeframe-favorites.v1';

const defaultFavorites = chartTimeframes.filter((timeframe) => timeframe.isOnToolbar).map((timeframe) => timeframe.label);

function load(): ChartTimeframe[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return Array.isArray(value) ? value.filter(isChartTimeframe) : defaultFavorites;
  } catch {
    return defaultFavorites;
  }
}

export const timeframeFavorites = new Store<{ labels: readonly ChartTimeframe[] }>({ labels: load() });

export function toggleFavoriteTimeframe(timeframe: ChartTimeframe): void {
  timeframeFavorites.set((state) => ({ labels: state.labels.includes(timeframe) ? state.labels.filter((label) => label !== timeframe) : [...state.labels, timeframe] }));
}

// The chart bar's buttons in timeframe order, with the chart's own timeframe among them even when
// it is not a favourite, so the current choice always shows.
export function toolbarTimeframes(favorites: readonly ChartTimeframe[], current: ChartTimeframe | undefined): ChartTimeframe[] {
  return chartTimeframes.filter((timeframe) => favorites.includes(timeframe.label) || timeframe.label === current).map((timeframe) => timeframe.label);
}

export function timeframeMenuItems(current: ChartTimeframe | undefined, pick: (timeframe: ChartTimeframe) => void): MenuItem[] {
  const favorites = timeframeFavorites.get().labels;
  return chartTimeframes.map((timeframe) => ({
    label: timeframe.label,
    isChecked: timeframe.label === current,
    isFavorite: favorites.includes(timeframe.label),
    onToggleFavorite: () => toggleFavoriteTimeframe(timeframe.label),
    action: () => pick(timeframe.label),
  }));
}

export function startTimeframeFavorites(): void {
  timeframeFavorites.subscribe(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(timeframeFavorites.get().labels));
    } catch (error) {
      log(`Favourite timeframes could not be saved: ${(error as Error).message}`, 'Charts');
    }
  });
}
