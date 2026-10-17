import type { Bar } from '@meridian/charts';
import type { PineDeclaration, PineReply, PineRequest, PineRun, PineSymbolInfo } from './pine-protocol';
import { readPineInputs } from './pine-inputs';
import { BarClock, toStudyOutput, type PinePlot } from './pine-output';
import { chartTimeframeOf } from './pine-script';

// Runs Pine scripts with PineTS. PineTS turns a script into JavaScript and runs it with `new
// Function`, which the page's CSP forbids; a worker loaded from the app's own files has no CSP.
// Pine itself cannot name JavaScript globals (PineTS rejects undeclared identifiers) and the page
// refuses PineTS's JavaScript dialect; the network and storage globals are removed as well, so a
// runtime bug still has no way out. The worker is given nothing but bars and the scripts.

interface WorkerScope {
  postMessage(message: PineReply): void;
  onmessage: ((event: MessageEvent<PineRequest>) => void) | null;
}

const scope = globalThis as unknown as WorkerScope;

for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebTransport', 'EventSource', 'Worker', 'SharedWorker', 'importScripts', 'BroadcastChannel', 'indexedDB', 'caches']) {
  try { Object.defineProperty(globalThis, name, { value: undefined, writable: false, configurable: false }); }
  catch { Reflect.deleteProperty(globalThis, name); }
}

type PineTsModule = typeof import('pinets');

let pinets: Promise<PineTsModule> | null = null;

const loadPineTs = () => (pinets ??= import('pinets'));

let barRequests = 0;

const pendingBars = new Map<number, { resolve: (bars: Bar[]) => void; reject: (error: Error) => void }>();

function hostBars(symbol: string, timeframe: string, limit?: number, from?: number, to?: number): Promise<Bar[]> {
  const id = ++barRequests;
  return new Promise((resolve, reject) => {
    pendingBars.set(id, { resolve, reject });
    scope.postMessage({ kind: 'bars', id, symbol, timeframe, ...(limit ? { limit } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) });
  });
}

// PineTS's candle shape. Bar close times are one interval on, as the chart has no close times.
function klines(bars: readonly Bar[], intervalMs: number) {
  return bars.map((bar, index) => ({
    openTime: bar.time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume ?? 0,
    closeTime: (bars[index + 1]?.time ?? bar.time + intervalMs) - 1,
    quoteAssetVolume: 0,
    numberOfTrades: 0,
    takerBuyBaseAssetVolume: 0,
    takerBuyQuoteAssetVolume: 0,
    ignore: 0,
  }));
}

function symbolInfo(symbol: string, info: PineSymbolInfo) {
  const mintick = info.tickSize > 0 ? info.tickSize : 0.00001;
  return {
    current_contract: '', description: info.description || symbol, isin: '', main_tickerid: symbol, prefix: '', root: symbol, ticker: symbol, tickerid: symbol,
    type: 'cfd', basecurrency: '', country: '', currency: '', timezone: 'Etc/UTC', employees: 0, industry: '', sector: '', shareholders: 0,
    shares_outstanding_float: 0, shares_outstanding_total: 0, expiration_date: 0, session: '24x7', volumetype: 'base', mincontract: 0, minmove: 1, mintick,
    pointvalue: 1, pricescale: Math.round(1 / mintick), recommendations_buy: 0, recommendations_buy_strong: 0, recommendations_date: 0, recommendations_hold: 0,
    recommendations_sell: 0, recommendations_sell_strong: 0, recommendations_total: 0, target_price_average: 0, target_price_date: 0, target_price_estimates: 0,
    target_price_high: 0, target_price_low: 0, target_price_median: 0,
  };
}

// The chart's own bars for its symbol and timeframe; anything else comes from the page.
function chartProvider(module: PineTsModule, run: PineRun) {
  const chartBars = klines(run.bars, run.intervalMs);
  const plain = (tickerId: string) => module.stripTickerModifier(tickerId).replace(/^[^:]*:/, '');
  return {
    configure() {},
    async getSymbolInfo(tickerId: string) {
      return symbolInfo(plain(tickerId), run.info);
    },
    async getMarketData(tickerId: string, timeframe: string, limit?: number, from?: number, to?: number) {
      const symbol = plain(tickerId);
      const inRange = (bar: { openTime: number }) => (!from || bar.openTime >= from) && (!to || bar.openTime <= to);
      if (symbol === run.symbol && (!timeframe || chartTimeframeOf(timeframe) === chartTimeframeOf(run.timeframe))) return from || to ? chartBars.filter(inRange) : chartBars;
      const bars = await hostBars(symbol, timeframe, limit ?? undefined, from ?? undefined, to ?? undefined);
      const intervalMs = bars.length > 1 ? bars[bars.length - 1].time - bars[bars.length - 2].time : run.intervalMs;
      return klines(bars, intervalMs);
    },
  };
}

// Synthetic bars for reading a script's declaration without a chart.
function sampleBars(): Bar[] {
  let price = 100;
  return Array.from({ length: 300 }, (_, index) => {
    const open = price;
    price = Math.max(1, price + Math.sin(index / 7) * 0.8 + Math.cos(index / 3) * 0.3);
    return { time: Date.UTC(2026, 0, 1) + index * 3_600_000, open, high: Math.max(open, price) + 0.5, low: Math.min(open, price) - 0.5, close: price, volume: 1000 };
  });
}

// The declaration from the source, for a script that fails on sample bars at run time.
function declaredTitle(source: string): Omit<PineDeclaration, 'inputs'> {
  const call = /^\s*indicator\s*\(([^\n]*)/m.exec(source)?.[1] ?? '';
  const title = /^\s*(?:title\s*=\s*)?(["'])(.*?)\1/.exec(call)?.[2] ?? 'Pine Script';
  const shortTitle = /shorttitle\s*=\s*(["'])(.*?)\1/.exec(call)?.[2] ?? /^\s*(["']).*?\1\s*,\s*(["'])(.*?)\2/.exec(call)?.[3] ?? '';
  return { title, shortTitle, overlay: /overlay\s*=\s*true/.test(call) };
}

async function inspect(source: string): Promise<PineDeclaration> {
  const module = await loadPineTs();
  const indicator = new module.Indicator(source);
  const inputs = readPineInputs(indicator.getInputsMeta());
  const bars = sampleBars();
  const run: PineRun = { bars, source, symbol: 'SAMPLE', timeframe: '60', intervalMs: 3_600_000, info: { tickSize: 0.01, description: 'Sample' }, inputs: {} };
  const sample = { ...chartProvider(module, run), getMarketData: async () => klines(bars, run.intervalMs) };
  try {
    const context = await new module.PineTS(sample, 'SAMPLE', '60', bars.length).run(indicator);
    const declaration = context.indicator as { title?: string; shorttitle?: string; overlay?: boolean };
    return { title: declaration.title || 'Pine Script', shortTitle: declaration.shorttitle ?? '', overlay: declaration.overlay === true, inputs };
  } catch (error) {
    // A script can fail on made-up bars and still run on real ones; a script that does not
    // compile cannot.
    if (!(error instanceof module.PineRuntimeError)) throw error;
    return { ...declaredTitle(source), inputs };
  }
}

async function execute(run: PineRun) {
  const module = await loadPineTs();
  const indicator = new module.Indicator(run.source, run.inputs);
  const context = await new module.PineTS(chartProvider(module, run), run.symbol, run.timeframe, run.bars.length).run(indicator);
  return toStudyOutput(context.plots as Record<string, PinePlot>, new BarClock(run.bars.map((bar) => bar.time), run.intervalMs));
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// One script at a time: PineTS runs share module state, and the page spreads work over workers.
let queue: Promise<unknown> = Promise.resolve();

scope.onmessage = (event) => {
  const request = event.data;
  if (request.kind === 'bars') {
    const pending = pendingBars.get(request.id);
    pendingBars.delete(request.id);
    if (request.bars) pending?.resolve(request.bars);
    else pending?.reject(new Error(request.error ?? 'No bars.'));
    return;
  }
  queue = queue.then(async () => {
    if (request.kind === 'inspect') {
      try { scope.postMessage({ kind: 'inspect', id: request.id, declaration: await inspect(request.source) }); }
      catch (error) { scope.postMessage({ kind: 'inspect', id: request.id, error: messageOf(error) }); }
      return;
    }
    try { scope.postMessage({ kind: 'run', id: request.id, conversion: await execute(request.run) }); }
    catch (error) { scope.postMessage({ kind: 'run', id: request.id, error: messageOf(error) }); }
  });
};
