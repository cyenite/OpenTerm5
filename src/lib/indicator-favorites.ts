import { log } from './session';
import { Store } from './store';

// Favourite indicators by study type, from any source, as TradingView keeps one favourites list
// for built-ins and Pine scripts alike. They fill the toolbar's favourites menu.

const STORAGE_KEY = 'openterm.indicator-favorites.v1';

function load(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    return Array.isArray(value) ? value.filter((type): type is string => typeof type === 'string') : [];
  } catch {
    return [];
  }
}

export const indicatorFavorites = new Store<{ types: readonly string[] }>({ types: load() });

export function toggleFavoriteIndicator(type: string): void {
  indicatorFavorites.set((state) => ({ types: state.types.includes(type) ? state.types.filter((candidate) => candidate !== type) : [...state.types, type] }));
}

export function removeFavoriteIndicators(types: readonly string[]): void {
  const removed = new Set(types);
  if (indicatorFavorites.get().types.some((type) => removed.has(type))) indicatorFavorites.set((state) => ({ types: state.types.filter((type) => !removed.has(type)) }));
}

export function startIndicatorFavorites(): void {
  indicatorFavorites.subscribe(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(indicatorFavorites.get().types));
    } catch (error) {
      log(`Favourite indicators could not be saved: ${(error as Error).message}`, 'Charts');
    }
  });
}
