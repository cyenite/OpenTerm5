const currencies = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'NOK', 'SEK', 'DKK', 'ZAR', 'TRY', 'MXN',
  'PLN', 'CNH', 'CNY', 'HUF', 'CZK', 'RUB', 'INR', 'THB', 'ILS', 'KRW', 'BRL', 'XAU', 'XAG', 'XPT', 'XPD',
  'BTC', 'ETH', 'LTC', 'XRP', 'BCH',
]);

const isPair = (text: string) => text.length === 6 && currencies.has(text.slice(0, 3)) && currencies.has(text.slice(3));

const decorationCounts = new WeakMap<readonly string[], Map<string, number>>();

// The instrument a broker symbol names, without the account-type decoration brokers add:
// EURUSD.m, EURUSDm, mEURUSD, #EURUSD, EURUSD-STD and FXEURUSD are all EURUSD; US30.cash is US30.
export function symbolCore(name: string): string {
  let core = name.trim().replace(/^[^A-Za-z0-9]+/, '');
  core = core.replace(/^([A-Za-z0-9]{2,}?)[^A-Za-z0-9].*$/, '$1');
  if (/[A-Z]/.test(core) && /[a-z]/.test(core)) {
    core = core.replace(/^[a-z]{1,4}(?=[A-Z0-9]{3})/, '').replace(/(?<=[A-Z0-9]{3})[a-z]{1,4}$/, '');
  }
  core = core.toUpperCase();
  if (core.length > 6 && core.length <= 12 && isPair(core.slice(0, 6))) return core.slice(0, 6);
  if (core.length > 6 && core.length <= 12 && isPair(core.slice(-6))) return core.slice(-6);
  return core;
}

function decoration(name: string, core: string): string {
  const at = name.toUpperCase().indexOf(core);
  return at < 0 ? name : `${name.slice(0, at)}*${name.slice(at + core.length)}`;
}

function counts(available: readonly string[]): Map<string, number> {
  let found = decorationCounts.get(available);
  if (found) return found;
  found = new Map();
  for (const name of available) {
    const key = decoration(name, symbolCore(name));
    found.set(key, (found.get(key) ?? 0) + 1);
  }
  decorationCounts.set(available, found);
  return found;
}

// Finds the account's symbol for an instrument named on another account or broker. When several
// share the instrument, the one decorated like the request wins, then the account's most common
// decoration, so a .pro account keeps choosing .pro symbols.
export function matchSymbol(name: string, available: readonly string[]): string | null {
  if (available.includes(name)) return name;
  const core = symbolCore(name);
  if (!core) return null;
  const candidates = available.filter((candidate) => symbolCore(candidate) === core);
  if (candidates.length <= 1) return candidates[0] ?? null;
  const wanted = decoration(name, core);
  const frequency = counts(available);
  const rank = (candidate: string) => {
    const key = decoration(candidate, core);
    return [key === wanted ? 0 : 1, -(frequency.get(key) ?? 0), candidate.length] as const;
  };
  return [...candidates].sort((left, right) => {
    const [a, b] = [rank(left), rank(right)];
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || left.localeCompare(right);
  })[0];
}

// Allow and filter lists are permissions, so they never widen across decorations: an entry names
// one symbol exactly, or, written plainly (EURUSD), that instrument under any broker decoration.
// BRK.A therefore never admits BRK.B.
export function isListedSymbol(entry: string, symbol: string): boolean {
  const core = symbolCore(entry);
  return entry === symbol || entry.trim().toUpperCase() === core && symbolCore(symbol) === core;
}
