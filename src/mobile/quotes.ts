import { setWatchedSymbols } from '../lib/session';
import { Store } from '../lib/store';

// The phone's own quote list. It starts from the symbols of the computer's charts.
const STORAGE_KEY = 'openterm.mobile.quotes.v1';

function load(): string[] | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown;
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;
  } catch {
    return null;
  }
}

export const quotes = new Store<{ symbols: string[]; isSaved: boolean }>({ symbols: load() ?? [], isSaved: load() !== null });

export function setQuoteSymbols(symbols: readonly string[]): void {
  const unique = [...new Set(symbols)].slice(0, 100);
  quotes.set({ symbols: unique, isSaved: true });
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(unique)); }
  catch { /* kept for this visit */ }
}

// Until the list is edited, it follows whatever the computer's charts show.
export function suggestQuoteSymbols(symbols: readonly string[]): void {
  if (!quotes.get().isSaved) quotes.set({ symbols: [...new Set(symbols)] });
}

export function startQuotes(): void {
  const apply = () => setWatchedSymbols(quotes.get().symbols);
  quotes.subscribe(apply);
  apply();
}
