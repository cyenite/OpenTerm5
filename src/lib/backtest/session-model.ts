import { isChartTimeframe, type ChartTimeframe } from '../mt5-timeframes';
import { defaultBacktestSettings, newBook, type BacktestSettings, type Book, type Simulation, type SymbolTerms } from './model';

// A saved backtest: its settings, the symbols it has priced and everything it has traded, at the
// replay time it reached. Resuming one replays from that time with the same book.
export interface BacktestSession {
  readonly id: string;
  readonly name: string;
  readonly symbol: string;
  // The account the session was made on, for the sessions list; any account can resume it.
  readonly account: string;
  readonly currency: string;
  readonly timeframe: ChartTimeframe;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly startTime: number;
  readonly endTime: number | null;
  readonly book: Book;
  readonly terms: Readonly<Record<string, SymbolTerms>>;
  readonly settings: BacktestSettings;
}

export interface NewSession {
  readonly name: string;
  readonly symbol: string;
  readonly account: string;
  readonly currency: string;
  readonly timeframe: ChartTimeframe;
  readonly startTime: number;
  readonly endTime: number | null;
  readonly settings: BacktestSettings;
}

export function makeSession(input: NewSession, id: string, now: number): BacktestSession {
  return { ...input, id, createdAt: now, updatedAt: now, book: newBook(input.settings.balance), terms: {} };
}

// The same session from its start, with nothing traded and the symbols priced afresh.
export function restartedSession(session: BacktestSession, now: number): BacktestSession {
  return { ...session, updatedAt: now, book: newBook(session.settings.balance), terms: {} };
}

export const simulationOf = (session: BacktestSession): Simulation => ({ currency: session.currency, settings: session.settings, terms: session.terms });

export function settingsProblem(settings: BacktestSettings): string | null {
  if (!(settings.balance > 0)) return 'The starting balance must be positive.';
  if (!(settings.leverage >= 1)) return 'The leverage must be at least 1:1.';
  if (settings.spreadPoints !== null && !(settings.spreadPoints >= 0)) return 'The spread cannot be negative.';
  if (!(settings.slippagePoints >= 0)) return 'The slippage cannot be negative.';
  if (!(settings.commissionPerLot >= 0)) return 'The commission cannot be negative.';
  if (!(settings.stopOutLevel >= 0)) return 'The stop out level cannot be negative.';
  return null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const numberOr = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const listOf = <T>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);

function restoreSettings(value: unknown): BacktestSettings {
  const saved = isRecord(value) ? value : {};
  const defaults = defaultBacktestSettings;
  return {
    balance: numberOr(saved.balance, defaults.balance),
    leverage: numberOr(saved.leverage, defaults.leverage),
    stopOutLevel: numberOr(saved.stopOutLevel, defaults.stopOutLevel),
    slippagePoints: numberOr(saved.slippagePoints, defaults.slippagePoints),
    commissionPerLot: numberOr(saved.commissionPerLot, defaults.commissionPerLot),
    spreadPoints: saved.spreadPoints === null ? null : numberOr(saved.spreadPoints, 0),
  };
}

function restoreBook(value: unknown, balance: number): Book {
  if (!isRecord(value)) return newBook(balance);
  return {
    time: typeof value.time === 'number' ? value.time : null,
    balance: numberOr(value.balance, balance),
    nextTicket: numberOr(value.nextTicket, 1),
    peakEquity: numberOr(value.peakEquity, balance),
    maxDrawdown: numberOr(value.maxDrawdown, 0),
    maxDrawdownPercent: numberOr(value.maxDrawdownPercent, 0),
    deals: listOf(value.deals),
    curve: listOf(value.curve),
    orders: listOf(value.orders),
    trades: listOf(value.trades),
    journal: listOf(value.journal),
    positions: listOf(value.positions),
  };
}

// A record read back from storage, or null when it is not a session.
export function restoreSession(value: unknown): BacktestSession | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.symbol !== 'string' || typeof value.startTime !== 'number') return null;
  const settings = restoreSettings(value.settings);
  return {
    id: value.id,
    name: typeof value.name === 'string' && value.name.trim() ? value.name : value.symbol,
    symbol: value.symbol,
    account: typeof value.account === 'string' ? value.account : '',
    currency: typeof value.currency === 'string' ? value.currency : 'USD',
    timeframe: isChartTimeframe(value.timeframe) ? value.timeframe : 'H1',
    createdAt: numberOr(value.createdAt, 0),
    updatedAt: numberOr(value.updatedAt, 0),
    startTime: value.startTime,
    endTime: typeof value.endTime === 'number' ? value.endTime : null,
    book: restoreBook(value.book, settings.balance),
    terms: isRecord(value.terms) ? value.terms as Record<string, SymbolTerms> : {},
    settings,
  };
}
