export interface Quote {
  bid: number;
  ask: number;
}

export interface Conversion {
  via: string[];
  rate: number;
}

export interface Valuation {
  via: string[];
  rate: number;
  calcMode: number;
  moneyPerUnit: number;
  profitCurrency: string;
  accountCurrency: string;
  // Exchanges charge a share of the traded value instead of a fee per lot.
  takerFeeRate?: number;
}

// MT5 calculation modes whose profit is (close - open) * contract size * lots in the
// profit currency. Futures and exchange modes need a broker tick value instead.
export const linearCalcModes = new Set([0, 2, 3, 4, 5, 32, 34, 35, 36, 37, 38]);

export const pipFactor = (digits: number) => (digits === 3 || digits === 5 ? 10 : 1);

function pairSymbol(names: readonly string[], base: string, quote: string): string | undefined {
  const exact = `${base}${quote}`;
  if (names.includes(exact)) return exact;
  // Broker suffixes (EURUSD.m, EURUSDpro, EURUSD_i) never start with a capital letter;
  // one that does would be a different instrument.
  return names.filter((name) => name.startsWith(exact) && !/[A-Z]/.test(name[6])).sort((left, right) => left.length - right.length)[0];
}

export function conversionRate(from: string, to: string, names: readonly string[], quote: (symbol: string) => Quote | undefined): Conversion | null {
  if (!from || !to) return null;
  if (from === to) return { rate: 1, via: [] };
  const direct = (base: string, counter: string): Conversion | null => {
    const forward = pairSymbol(names, base, counter);
    const forwardQuote = forward ? quote(forward) : undefined;
    if (forward && forwardQuote?.bid) return { rate: forwardQuote.bid, via: [forward] };
    const inverse = pairSymbol(names, counter, base);
    const inverseQuote = inverse ? quote(inverse) : undefined;
    if (inverse && inverseQuote?.ask) return { rate: 1 / inverseQuote.ask, via: [inverse] };
    return null;
  };
  const single = direct(from, to);
  if (single) return single;
  for (const bridge of ['USD', 'EUR']) {
    if (bridge === from || bridge === to) continue;
    const first = direct(from, bridge);
    const second = first && direct(bridge, to);
    if (first && second) return { rate: first.rate * second.rate, via: [...first.via, ...second.via] };
  }
  return null;
}

export function conversionCandidates(from: string, to: string, names: readonly string[]): string[] {
  if (!from || !to || from === to) return [];
  const result = new Set<string>();
  for (const [base, counter] of [[from, to], [to, from], [from, 'USD'], ['USD', from], ['USD', to], [to, 'USD'], [from, 'EUR'], ['EUR', from], ['EUR', to], [to, 'EUR']]) {
    const name = pairSymbol(names, base, counter);
    if (name) result.add(name);
  }
  return [...result];
}

export function moneyPerUnit(calcMode: number, contractSize: number, rate: number): number | null {
  if (!linearCalcModes.has(calcMode) || !(contractSize > 0) || !(rate > 0)) return null;
  return contractSize * rate;
}

export function floatingProfit(side: 'buy' | 'sell', volume: number, priceOpen: number, quote: Quote, perUnit: number): number {
  const close = side === 'buy' ? quote.bid : quote.ask;
  const move = side === 'buy' ? close - priceOpen : priceOpen - close;
  return move * volume * perUnit;
}
