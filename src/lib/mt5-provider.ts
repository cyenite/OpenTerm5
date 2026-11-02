import type { Bar as ChartBar, DataProvider } from '@meridian/charts';
import type { Bar } from '../../shared/protocol';
import { fromChartTimeframe, isSecondsTimeframe, timeframeSeconds, type ChartTimeframe } from './mt5-timeframes';
import { log, session, terminal } from './session';
import { TickBarBook } from './tick-bars';

const HISTORY_BARS = 2000;
const MAX_HISTORY_BARS = 20000;

// Seconds bars for every symbol the terminal receives quotes for, from start-up.
export const tickBars = new TickBarBook();

export function startTickBars(): void {
  terminal.on('tick', (tick) => tickBars.add(tick.symbol, tick.time, tick.bid));
  // Another account means another broker's prices.
  terminal.on('accountChanged', () => tickBars.clear());
}

export const toChartBar = (bar: Bar): ChartBar => ({ time: bar.time * 1000, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume });

const isLinked = () => {
  const state = session.get();
  return state.link.state === 'open' && (state.status?.mode !== 'mt5-web' || !!state.account);
};

// History waits for the trade server instead of failing, so a chart opened before login fills
// in once the connection is up.
function whenLinked(): Promise<void> {
  if (isLinked()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = session.subscribe(() => {
      if (isLinked()) { off(); resolve(); }
    });
  });
}

function timeframeOf(value: string): ChartTimeframe {
  const timeframe = fromChartTimeframe(value);
  if (!timeframe) throw new Error(`MetaTrader 5 has no ${value} timeframe.`);
  return timeframe;
}

const isBefore = (bar: ChartBar, to: number | undefined) => to === undefined || bar.time < to;

export const mt5Provider: DataProvider = {
  async getBars(ticker, chartTimeframe, range) {
    const timeframe = timeframeOf(chartTimeframe);
    if (isSecondsTimeframe(timeframe)) {
      return tickBars.bars(ticker, timeframeSeconds(timeframe)).filter((bar) => isBefore(bar, range.to)).slice(-Math.max(range.limit, HISTORY_BARS));
    }
    await whenLinked();
    const seconds = timeframeSeconds(timeframe);
    // The first load keeps the depth MT5 users are used to; older pages use the chart's own size.
    const limit = range.to === undefined ? Math.max(range.limit, HISTORY_BARS) : range.limit;
    // MetaTrader serves the latest bars by count, so reaching back means asking for every bar
    // since the requested end.
    const since = range.to ? Math.max(0, Math.ceil((Date.now() - range.to) / 1000 / seconds)) : 0;
    const count = Math.min(MAX_HISTORY_BARS, since + limit);
    try {
      const bars = (await terminal.request('rates.get', { symbol: ticker, timeframe, count })).map(toChartBar);
      return bars.filter((bar) => isBefore(bar, range.to)).slice(-limit);
    } catch (error) {
      log(`${ticker},${timeframe}: history request failed: ${(error as Error).message}`, 'History');
      throw error;
    }
  },

  subscribe(ticker, chartTimeframe, onBar) {
    const timeframe = timeframeOf(chartTimeframe);
    if (isSecondsTimeframe(timeframe)) {
      const seconds = timeframeSeconds(timeframe);
      return tickBars.onBar((symbol) => {
        const bar = symbol === ticker ? tickBars.current(ticker, seconds) : null;
        if (bar) onBar(bar);
      });
    }
    const params = { symbol: ticker, timeframe };
    let isActive = true;
    void whenLinked().then(() => { if (isActive) void terminal.request('rates.subscribe', params).catch(() => undefined); });
    const off = terminal.on('bar', (event) => {
      if (event.symbol === ticker && event.timeframe === timeframe) onBar(toChartBar(event.bar));
    });
    return () => {
      isActive = false;
      off();
      void terminal.request('rates.unsubscribe', params).catch(() => undefined);
    };
  },

  async getSymbolInfo(ticker) {
    const spec = session.get().symbols[ticker];
    if (!spec) return undefined;
    return { description: spec.description, tickSize: spec.tickSize && spec.tickSize > 0 ? spec.tickSize : spec.point };
  },
};
