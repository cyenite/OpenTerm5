import type { DataProvider } from '@meridian/charts';
import { feedSymbol, isBrokerSymbol } from '../../shared/feeds';
import type { Timeframe } from '../../shared/protocol';
import { feedSymbols, loadFeedSymbols } from './feed-symbols';
import { mt5Provider, toChartBar } from './mt5-provider';
import { fromChartTimeframe, isSecondsTimeframe } from './mt5-timeframes';
import { log, terminal } from './session';

// Seconds charts are built from the broker's quotes, which a data feed does not supply.
function timeframeOf(value: string): Timeframe {
  const timeframe = fromChartTimeframe(value);
  if (!timeframe || isSecondsTimeframe(timeframe)) throw new Error(`Hyperliquid has no ${value} timeframe.`);
  return timeframe;
}

export const hyperliquidProvider: DataProvider = {
  async getBars(ticker, chartTimeframe, range) {
    const timeframe = timeframeOf(chartTimeframe);
    try {
      const to = range.to === undefined ? {} : { to: Math.ceil(range.to / 1000) };
      const bars = await terminal.request('feeds.bars', { symbol: ticker, timeframe, count: range.limit, ...to });
      return bars.map(toChartBar);
    } catch (error) {
      log(`${feedSymbol(ticker)},${timeframe}: history request failed: ${(error as Error).message}`, 'Hyperliquid');
      throw error;
    }
  },

  subscribe(ticker, chartTimeframe, onBar) {
    const timeframe = timeframeOf(chartTimeframe);
    const params = { symbol: ticker, timeframe };
    void terminal.request('feeds.subscribe', params).catch((error: Error) => log(`${feedSymbol(ticker)},${timeframe}: live bars unavailable: ${error.message}`, 'Hyperliquid'));
    const off = terminal.on('feedBar', (event) => {
      if (event.symbol === ticker && event.timeframe === timeframe) onBar(toChartBar(event.bar));
    });
    return () => {
      off();
      void terminal.request('feeds.unsubscribe', params).catch(() => undefined);
    };
  },

  async getSymbolInfo(ticker) {
    await loadFeedSymbols();
    const symbol = feedSymbols.get().symbols[ticker];
    return symbol && { description: symbol.description, tickSize: 10 ** -symbol.digits };
  },
};

const providerOf = (ticker: string) => isBrokerSymbol(ticker) ? mt5Provider : hyperliquidProvider;

// Meridian keeps one provider for a chart's life, so the symbol picks the feed: a chart switches
// between the broker and Hyperliquid like any other symbol change.
export const chartProvider: DataProvider = {
  getBars: (ticker, timeframe, range) => providerOf(ticker).getBars(ticker, timeframe, range),
  subscribe: (ticker, timeframe, onBar) => providerOf(ticker).subscribe!(ticker, timeframe, onBar),
  getSymbolInfo: (ticker) => providerOf(ticker).getSymbolInfo!(ticker),
};
