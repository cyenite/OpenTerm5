import { matchSymbol } from '../../shared/symbol-match';
import { log, session, terminal } from './session';
import { readServerClock, type ServerClock } from './server-clock';

export interface ClockSource {
  // The forex symbol whose history gave the server's clock, or null when only its report was used.
  symbol: string | null;
  weeks: number;
  reportedMs: number | null;
}

// Majors trade on every broker that offers forex and open on the New York schedule.
const clockSymbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCHF'];

// The broker's server clock, read from a forex major's hourly history and checked against what
// the server reports. Outside times (TradingView drawings, market session hours) are UTC; the
// broker's bars are stamped with its own clock.
export async function brokerClock(): Promise<{ clock: ServerClock; source: ClockSource }> {
  const { account, symbols } = session.get();
  const reported = account?.utcOffsetSeconds;
  const reportedMs = typeof reported === 'number' && Number.isFinite(reported) ? reported * 1000 : null;
  const names = Object.keys(symbols);
  const symbol = clockSymbols.map((name) => matchSymbol(name, names)).find((name): name is string => !!name) ?? null;
  let times: number[] = [];
  if (symbol) {
    try {
      times = (await terminal.request('rates.get', { symbol, timeframe: 'H1', count: 5000 })).map((bar) => bar.time * 1000);
    } catch (error) {
      log(`${symbol} history could not be read (${(error as Error).message}); using the server's reported clock.`, 'Charts');
    }
  }
  const clock = readServerClock(times, reportedMs);
  return { clock, source: { symbol: clock.weeks.length ? symbol : null, weeks: clock.weeks.length, reportedMs } };
}
