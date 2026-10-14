import { matchSymbol } from '../../shared/symbol-match';
import type { SessionState } from './session';
import { session } from './session';
import { activeChart, workspace, type WorkspaceState } from './workspace';

let seenSymbols: SessionState['symbols'] | undefined;
let seenCharts: WorkspaceState['charts'] | undefined;
let matches = new Map<string, string | null>();

function resolve(name: string, symbols: SessionState['symbols']): string {
  if (symbols[name]) return name;
  if (!matches.has(name)) matches.set(name, matchSymbol(name, Object.keys(symbols)));
  return matches.get(name) ?? name;
}

// Charts saved on one broker name their symbols the way that broker does; on a broker that adds
// prefixes or suffixes they would stay empty, so they follow the instrument instead.
function adaptCharts(): void {
  const { symbols } = session.get();
  const { charts } = workspace.get();
  if (symbols === seenSymbols && charts === seenCharts) return;
  if (symbols !== seenSymbols) matches = new Map();
  seenSymbols = symbols;
  seenCharts = charts;
  if (!Object.keys(symbols).length) return;
  const next = charts.map((chart) => {
    const symbol = resolve(chart.symbol, symbols);
    return symbol === chart.symbol ? chart : { ...chart, symbol };
  });
  if (next.some((chart, index) => chart !== charts[index])) workspace.set({ charts: next });
}

export function defaultSymbol(): string {
  const { symbols } = session.get();
  const visible = Object.values(symbols).find((spec) => spec.visible)?.name;
  return activeChart(workspace.get())?.symbol ?? visible ?? resolve('EURUSD', symbols);
}

export function startBrokerSymbols(): void {
  session.subscribe(adaptCharts);
  workspace.subscribe(adaptCharts);
}
