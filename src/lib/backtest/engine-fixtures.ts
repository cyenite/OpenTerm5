import assert from 'node:assert/strict';
import { advance } from './engine';
import { defaultBacktestSettings, newBook, type BacktestSettings, type Book, type Simulation, type SymbolTerms } from './model';
import type { Series, SimBar } from './series';

export const MINUTE = 60_000;
export const T0 = Date.UTC(2026, 0, 5, 10, 0);

export const eurusd: SymbolTerms = { name: 'EURUSD', currencyBase: 'EUR', currencyProfit: 'USD', point: 0.00001, digits: 5, volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01, spreadPoints: 10, contractSize: 100_000, profitRate: 1 };
export const usdjpy: SymbolTerms = { name: 'USDJPY', currencyBase: 'USD', currencyProfit: 'JPY', point: 0.001, digits: 3, volumeMin: 0.01, volumeMax: 100, volumeStep: 0.01, spreadPoints: 10, contractSize: 100_000, profitRate: 0.0067 };

export function simulation(settings: Partial<BacktestSettings> = {}): Simulation {
  return { currency: 'USD', settings: { ...defaultBacktestSettings, ...settings }, terms: { EURUSD: eurusd, USDJPY: usdjpy } };
}

export const bar = (minute: number, open: number, high: number, low: number, close: number): SimBar => ({ time: T0 + minute * MINUTE, open, high, low, close });
export const m1 = (...bars: SimBar[]): Series => ({ interval: MINUTE, bars });

// A book whose clock stands at the end of minute `minute`.
export function started(minute = 0, balance = 10_000): Book {
  return advance(newBook(balance), simulation(), () => undefined, T0 + minute * MINUTE);
}

export const ok = (outcome: { book: Book; error: string | null }) => {
  assert.equal(outcome.error, null);
  return outcome.book;
};
