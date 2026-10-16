export const newsImpacts = [
  { key: 'high', label: 'High', feed: 'High' },
  { key: 'medium', label: 'Medium', feed: 'Medium' },
  { key: 'low', label: 'Low', feed: 'Low' },
] as const;

export type NewsImpact = (typeof newsImpacts)[number]['key'];

export interface NewsEvent {
  time: number;
  title: string;
  impact: NewsImpact;
  currency: string;
}

export interface NewsStatus {
  error?: string;
  fetchedAt?: number;
  isActive: boolean;
  isCovering: boolean;
}

export interface NewsView {
  status: NewsStatus;
  events: NewsEvent[];
}

export const ALL_CURRENCIES = 'All';

const majors = ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF', 'CNY'];

export function isNewsImpact(value: unknown): value is NewsImpact {
  return newsImpacts.some((item) => item.key === value);
}

export function meetsImpact(impact: NewsImpact, minimum: NewsImpact): boolean {
  const rank = (key: NewsImpact) => newsImpacts.findIndex((item) => item.key === key);
  return rank(impact) <= rank(minimum);
}

// A broker's symbol record names the currencies that move it (an index's profit currency,
// both legs of a pair). Without one, currency codes inside the name are the fallback, which
// misses indices such as US30.
export function symbolCurrencies(symbol: string, spec?: { currencyBase: string; currencyProfit: string }): string[] {
  if (spec) return [...new Set([spec.currencyBase, spec.currencyProfit].filter(Boolean))];
  const name = symbol.toUpperCase();
  return majors.filter((code) => name.includes(code));
}

export function isAffected(event: NewsEvent, currencies: readonly string[]): boolean {
  return event.currency === ALL_CURRENCIES || currencies.includes(event.currency);
}
