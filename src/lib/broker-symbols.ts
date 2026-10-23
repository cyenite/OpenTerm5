import { marketOf } from '../../shared/protocol';
import { matchSymbol } from '../../shared/symbol-match';
import type { SessionState } from './session';
import { session } from './session';
import { activePlatform, currentWatchedSpecs } from './watchlists';
import { activeChart, marketTabs, setMarket, workspace, type WorkspaceState } from './workspace';

let seenSymbols: SessionState['symbols'] | undefined;
let seenCharts: WorkspaceState['charts'] | undefined;
let matches = new Map<string, string | null>();

function resolve(name: string, symbols: SessionState['symbols']): string {
  if (symbols[name]) return name;
  if (!matches.has(name)) matches.set(name, matchSymbol(name, Object.keys(symbols)));
  return matches.get(name) ?? name;
}

// Charts saved on one broker name their symbols the way that broker does; on a broker that adds
// prefixes or suffixes they would stay empty, so they follow the instrument instead. Only charts
// of the account's market follow: a BTCUSD forex chart must not become BTCUSDT on an exchange.
function adaptCharts(): void {
  const { symbols } = session.get();
  const state = workspace.get();
  const { charts } = state;
  if (symbols === seenSymbols && charts === seenCharts) return;
  const platform = activePlatform();
  // Symbols arrive while the account is still changing, before the market follows it.
  if (!platform || marketOf(platform) !== state.market) return;
  if (symbols !== seenSymbols) matches = new Map();
  seenSymbols = symbols;
  seenCharts = charts;
  if (!Object.keys(symbols).length) return;
  const shown = new Set(marketTabs(state).flatMap((tab) => tab.chartIds));
  const next = charts.map((chart) => {
    if (!shown.has(chart.id)) return chart;
    const symbol = resolve(chart.symbol, symbols);
    return symbol === chart.symbol ? chart : { ...chart, symbol };
  });
  if (next.some((chart, index) => chart !== charts[index])) workspace.set({ charts: next });
}

export function defaultSymbol(): string {
  const { symbols } = session.get();
  return activeChart(workspace.get())?.symbol ?? currentWatchedSpecs()[0]?.name ?? resolve('EURUSD', symbols);
}

// Logged out, the last market's charts stay.
function followMarket(): void {
  const platform = activePlatform();
  if (platform) setMarket(marketOf(platform));
}

export function startBrokerSymbols(): void {
  session.subscribe(followMarket);
  session.subscribe(adaptCharts);
  workspace.subscribe(adaptCharts);
  followMarket();
}
