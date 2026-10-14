const currencies = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD', 'SGD', 'HKD', 'NOK', 'SEK', 'DKK', 'ZAR', 'TRY', 'MXN',
  'PLN', 'CNH', 'CNY', 'HUF', 'CZK', 'RUB', 'INR', 'THB', 'ILS', 'KRW', 'BRL', 'XAU', 'XAG', 'XPT', 'XPD',
  'BTC', 'ETH', 'LTC', 'XRP', 'BCH',
]);

// Brokers name the same instrument differently. Each group is one instrument; the first name is its key.
const aliasGroups = [
  ['XAUUSD', 'GOLD'],
  ['XAGUSD', 'SILVER'],
  ['XPTUSD', 'PLATINUM'],
  ['XPDUSD', 'PALLADIUM'],
  ['USOIL', 'WTI', 'XTIUSD', 'USCRUDE', 'CRUDEOIL'],
  ['UKOIL', 'BRENT', 'XBRUSD', 'UKBRENT'],
  ['XNGUSD', 'NATGAS', 'NGAS', 'USNATGAS'],
  ['US30', 'DJ30', 'WS30', 'DOW30', 'USA30', 'DJI30'],
  ['NAS100', 'USTEC', 'US100', 'NDX100', 'USTECH', 'NQ100', 'NASDAQ100', 'USA100'],
  ['US500', 'SPX500', 'SP500', 'USA500'],
  ['GER40', 'DE40', 'DAX40', 'GER30', 'DE30', 'DAX30', 'GERMANY40'],
  ['UK100', 'FTSE100'],
  ['JP225', 'JPN225', 'NIKKEI225', 'JAP225', 'NIK225'],
  ['FRA40', 'FR40', 'CAC40'],
  ['AUS200', 'AU200', 'ASX200'],
  ['EU50', 'EUSTX50', 'STOXX50', 'EUSTOXX50'],
  ['USDX', 'DXY', 'USDINDEX'],
  ['BTCUSD', 'BITCOIN'],
  ['ETHUSD', 'ETHEREUM'],
];

const aliases = new Map(aliasGroups.flatMap((group) => group.map((name) => [name, group[0]] as const)));

const isPair = (text: string) => text.length === 6 && currencies.has(text.slice(0, 3)) && currencies.has(text.slice(3));

interface SymbolIndex {
  readonly names: ReadonlySet<string>;
  readonly byCore: ReadonlyMap<string, readonly string[]>;
  readonly byInstrument: ReadonlyMap<string, readonly string[]>;
  readonly decorations: ReadonlyMap<string, number>;
}

const indexes = new WeakMap<readonly string[], SymbolIndex>();

// The instrument a broker symbol names, without the account-type decoration brokers add:
// EURUSD.m, EURUSDm, mEURUSD, #EURUSD, EURUSD-STD and FXEURUSD are all EURUSD; US30.cash is US30.
// A single capital after a short ticker is a share class, not decoration: BRK.B and BRK-B stay BRK.B.
export function symbolCore(name: string): string {
  let core = name.trim().replace(/^[^A-Za-z0-9]+/, '');
  const shareClass = /^([A-Z]{1,5})[.\-/]([A-Z])(?:$|[^A-Za-z0-9])/.exec(core);
  if (shareClass) return `${shareClass[1]}.${shareClass[2]}`;
  core = core.replace(/^([A-Za-z0-9]{2,}?)[^A-Za-z0-9].*$/, '$1');
  if (/[A-Z]/.test(core) && /[a-z]/.test(core)) {
    core = core.replace(/^[a-z]{1,4}(?=[A-Z0-9]{3})/, '').replace(/(?<=[A-Z0-9]{3})[a-z]{1,4}$/, '');
  }
  core = core.toUpperCase();
  if (core.length > 6 && core.length <= 12 && isPair(core.slice(0, 6))) return core.slice(0, 6);
  if (core.length > 6 && core.length <= 12 && isPair(core.slice(-6))) return core.slice(-6);
  return core;
}

// Like symbolCore, but names of one instrument agree across brokers: GOLD.m and XAUUSD are both XAUUSD.
export function instrumentKey(name: string): string {
  const core = symbolCore(name);
  return aliases.get(core) ?? core;
}

function decoration(name: string, core: string): string {
  const at = name.toUpperCase().indexOf(core);
  return at < 0 ? name : `${name.slice(0, at)}*${name.slice(at + core.length)}`;
}

function append(map: Map<string, string[]>, key: string, name: string): void {
  const list = map.get(key);
  if (list) list.push(name);
  else map.set(key, [name]);
}

// Built once per symbol-list array; callers that match repeatedly must pass the same array.
function indexOf(available: readonly string[]): SymbolIndex {
  let found = indexes.get(available);
  if (found) return found;
  const byCore = new Map<string, string[]>();
  const byInstrument = new Map<string, string[]>();
  const decorations = new Map<string, number>();
  for (const name of available) {
    const core = symbolCore(name);
    const key = decoration(name, core);
    append(byCore, core, name);
    append(byInstrument, aliases.get(core) ?? core, name);
    decorations.set(key, (decorations.get(key) ?? 0) + 1);
  }
  found = { byCore, decorations, byInstrument, names: new Set(available) };
  indexes.set(available, found);
  return found;
}

// Finds the account's symbol for an instrument named on another account or broker. When several
// share the instrument, the one decorated like the request wins, then the account's most common
// decoration, so a .pro account keeps choosing .pro symbols. A different name for the same
// instrument (GOLD for XAUUSD) is only used when no symbol shares the request's own name.
export function matchSymbol(name: string, available: readonly string[]): string | null {
  const index = indexOf(available);
  if (index.names.has(name)) return name;
  const core = symbolCore(name);
  if (!core) return null;
  const candidates = index.byCore.get(core) ?? index.byInstrument.get(aliases.get(core) ?? core) ?? [];
  if (candidates.length <= 1) return candidates[0] ?? null;
  const wanted = decoration(name, core);
  const rank = (candidate: string) => {
    const key = decoration(candidate, symbolCore(candidate));
    return [key === wanted ? 0 : 1, -(index.decorations.get(key) ?? 0), candidate.length] as const;
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
