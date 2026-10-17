import { defineIndicator, timeframeMs, type Bar, type StudyOutput, type StudyRequest } from '@meridian/charts';
import { mt5Provider } from '../mt5-provider';
import { removeFavoriteIndicators } from '../indicator-favorites';
import { log, session } from '../session';
import { Store } from '../store';
import { resolverFor } from '../watchlists';
import { newId, updateChart, workspace, type ChartConfig } from '../workspace';
import { pineOverrides, readPineInputs, studyInputs, type PineInput } from './pine-inputs';
import { inspectPine, runPine, setPineBarSource } from './pine-runtime';
import { chartTimeframeOf, pineSourceProblem, pineStudyType, pineTimeframeOf, readPineHeader } from './pine-script';
import { deleteScripts, loadScriptRecords, loadSource, saveScript } from './pine-storage';

// Pine scripts the user imported, each registered as a chart study that runs in the Pine
// workers. They load from IndexedDB at startup; charts wait for `pineScriptsReady` before
// restoring their studies, or a saved Pine study would be dropped as unknown.

export type PineOrigin =
  // `author` is the TradingView user who published the script. `rank` and `likes` come from the
  // popular list when the script was imported from it.
  | { kind: 'tradingview'; rank?: number; likes?: number; version: number; url: string; author: string; scriptId: string }
  | { kind: 'pasted' };

// The source itself is kept apart (pine-storage.ts) and loaded when a chart first runs the script.
export interface PineScript {
  id: string;
  name: string;
  shortName: string;
  author: string | null;
  license: string | null;
  importedAt: number;
  overlay: boolean;
  origin: PineOrigin;
  inputs: readonly PineInput[];
}

export { pineStudyPrefix, pineStudyType } from './pine-script';

// Bars fetched for request.security(): at most this many per request.
const SECURITY_BARS = 5000;

const registered = new Map<string, () => void>();

const noticed = new Set<string>();

const sources = new Map<string, Promise<string>>();

const isText = (value: unknown): value is string => typeof value === 'string';

function restore(value: readonly unknown[]): PineScript[] {
  return value.flatMap((entry): PineScript[] => {
    if (!entry || typeof entry !== 'object') return [];
    const script = entry as Record<string, unknown>;
    const origin = script.origin as PineOrigin | undefined;
    if (!isText(script.id) || !isText(script.name) || !origin || (origin.kind !== 'tradingview' && origin.kind !== 'pasted')) return [];
    return [{
      id: script.id,
      name: script.name,
      shortName: isText(script.shortName) ? script.shortName : '',
      author: isText(script.author) ? script.author : null,
      license: isText(script.license) ? script.license : null,
      importedAt: typeof script.importedAt === 'number' ? script.importedAt : 0,
      overlay: script.overlay === true,
      origin,
      inputs: readPineInputs(script.inputs),
    }];
  });
}

export const pineScripts = new Store<{ scripts: readonly PineScript[] }>({ scripts: [] });

function sourceOf(id: string): Promise<string> {
  let source = sources.get(id);
  if (!source) {
    source = loadSource(id).then((found) => found ?? Promise.reject(new Error('The script\'s source is missing; import it again.')));
    source.catch(() => sources.delete(id));
    sources.set(id, source);
  }
  return source;
}

// One run at a time per script, chart symbol and inputs, and not straight after the last one:
// ticks arrive faster than a script runs, and the chart only wants the newest result. `running`
// holds the worker's run itself, which an aborted request cannot cut short.
const running = new Map<string, Promise<unknown>>();

const lastRuns = new Map<string, { startedAt: number; durationMs: number }>();

// The newest request per key; an older one still waiting to start is skipped.
const latest = new Map<string, number>();

let requestCount = 0;

// The gap between runs for one key: at least this, and at least the last run's own length, so a
// slow script keeps a worker at most half busy.
const MIN_GAP_MS = 500;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    promise.then(resolve, reject);
  });
}

async function compute(script: PineScript, request: StudyRequest): Promise<StudyOutput> {
  const key = JSON.stringify([script.id, request.symbol, request.timeframe, request.inputs]);
  const order = ++requestCount;
  latest.set(key, order);
  for (;;) {
    while (running.has(key)) await running.get(key)!.catch(() => undefined);
    const last = lastRuns.get(key);
    const wait = last ? last.startedAt + Math.max(MIN_GAP_MS, last.durationMs) - Date.now() : 0;
    if (wait > 0) await delay(wait);
    if (request.signal.aborted) throw request.signal.reason;
    if (latest.get(key) !== order) throw new Error('A newer request replaced this one.');
    if (!running.has(key)) break;
  }
  const source = await sourceOf(script.id);
  const spec = session.get().symbols[request.symbol];
  const startedAt = Date.now();
  const job = runPine({
    bars: [...request.bars],
    source,
    symbol: request.symbol,
    timeframe: pineTimeframeOf(request.timeframe),
    intervalMs: timeframeMs(request.timeframe),
    info: { tickSize: spec ? spec.tickSize || spec.point || 10 ** -spec.digits : 0, description: spec?.description ?? request.symbol },
    inputs: pineOverrides(script.inputs, request.inputs),
  });
  running.set(key, job);
  void job.catch(() => undefined).finally(() => {
    lastRuns.set(key, { startedAt, durationMs: Date.now() - startedAt });
    if (running.get(key) === job) running.delete(key);
  });
  const { output, unsupported } = await abortable(job, request.signal);
  if (unsupported.length && !noticed.has(script.id)) {
    noticed.add(script.id);
    log(`${script.name}: ${unsupported.join(' and ')} ${unsupported.length > 1 ? 'are' : 'is'} not drawn yet.`, 'Charts');
  }
  return output;
}

function register(script: PineScript): void {
  registered.get(script.id)?.();
  registered.set(script.id, defineIndicator({
    type: pineStudyType(script.id),
    title: script.name,
    ...(script.shortName && script.shortName !== script.name ? { shortTitle: script.shortName } : {}),
    overlay: script.overlay,
    inputs: studyInputs(script.inputs),
    computeAsync: (request) => compute(script, request),
  }));
}

// Resolves once saved scripts are registered, failed loads included: charts must not wait forever.
export const pineScriptsReady: Promise<void> = (typeof indexedDB === 'undefined' ? Promise.resolve([]) : loadScriptRecords())
  .then((records) => {
    const scripts = restore(records).sort(byRank);
    scripts.forEach(register);
    pineScripts.set({ scripts });
  })
  .catch((error: unknown) => log(`Pine scripts could not be loaded: ${(error as Error).message}`, 'Charts'));

// Popular-list scripts in their list order, then everything else by name.
export function byRank(left: PineScript, right: PineScript): number {
  const rankOf = (script: PineScript) => (script.origin.kind === 'tradingview' && script.origin.rank ? script.origin.rank : Infinity);
  return rankOf(left) - rankOf(right) || left.name.localeCompare(right.name);
}

// The broker's bars for request.security(), from the symbol the script names (an exchange prefix
// such as OANDA: is dropped) or the broker's own name for the same instrument.
async function securityBars(symbol: string, pineTimeframe: string, limit?: number, from?: number, to?: number): Promise<Bar[]> {
  const timeframe = chartTimeframeOf(pineTimeframe);
  const { symbols } = session.get();
  const name = resolverFor(symbols)(symbol);
  if (!name) throw new Error(`${symbol} is not available on this account.`);
  const span = from && to ? Math.ceil((to - from) / timeframeMs(timeframe)) + 2 : 0;
  const bars = await mt5Provider.getBars(name, timeframe, { limit: Math.min(SECURITY_BARS, Math.max(limit ?? 0, span, 500)), ...(to ? { to: to + 1 } : {}) });
  return from ? bars.filter((bar) => bar.time >= from) : bars;
}

export function startPineScripts(): void {
  setPineBarSource(securityBars);
}

type Indicators = ChartConfig['indicators'];

function forEachChartStudy(type: string, change: (indicators: Indicators, type: string) => Indicators): void {
  for (const chart of workspace.get().charts) {
    if (chart.indicators.some((indicator) => indicator.kind === type)) updateChart(chart.id, (current) => ({ indicators: change(current.indicators, type) }));
  }
}

export function findTradingViewScript(scriptId: string): PineScript | undefined {
  return pineScripts.get().scripts.find((script) => script.origin.kind === 'tradingview' && script.origin.scriptId === scriptId);
}

// Checks, reads, saves and registers a script. A script imported again from the same TradingView
// page replaces the earlier copy and keeps its id, so charts showing it pick up the new version.
// `isQuiet` leaves the list as it is, for a bulk import to refresh it in batches (`showPineScripts`).
export async function importPineScript(source: string, origin: PineOrigin, isQuiet = false): Promise<PineScript> {
  const problem = pineSourceProblem(source);
  if (problem) throw new Error(problem);
  const declaration = await inspectPine(source);
  const header = readPineHeader(source);
  const existing = origin.kind === 'tradingview' ? findTradingViewScript(origin.scriptId) : undefined;
  const script: PineScript = {
    id: existing?.id ?? newId(),
    name: declaration.title,
    shortName: declaration.shortTitle,
    // The copyright line names who the licence's attribution is owed to; the publisher may differ.
    author: header.author ?? (origin.kind === 'tradingview' && origin.author ? origin.author : null),
    license: header.license,
    importedAt: Date.now(),
    overlay: declaration.overlay,
    origin,
    inputs: declaration.inputs,
  };
  await saveScript(script, source);
  sources.set(script.id, Promise.resolve(source));
  noticed.delete(script.id);
  register(script);
  pending.set(script.id, script);
  if (!isQuiet) showPineScripts();
  // A chart keeps the definition its study was added with; new ids make charts add it afresh.
  if (existing) forEachChartStudy(pineStudyType(script.id), (indicators, type) => indicators.map((indicator) => (indicator.kind === type ? { ...indicator, id: newId() } : indicator)));
  return script;
}

// Scripts registered but not yet in the list.
const pending = new Map<string, PineScript>();

export function showPineScripts(): void {
  if (!pending.size) return;
  const added = [...pending.values()];
  pending.clear();
  pineScripts.set((state) => ({ scripts: [...state.scripts.filter((script) => !added.some((candidate) => candidate.id === script.id)), ...added].sort(byRank) }));
}

// Removes the scripts and takes their studies off every chart.
export function removePineScripts(ids: readonly string[]): void {
  const types = new Set(ids.map(pineStudyType));
  removeFavoriteIndicators([...types]);
  for (const chart of workspace.get().charts) {
    if (chart.indicators.some((indicator) => types.has(indicator.kind))) updateChart(chart.id, (current) => ({ indicators: current.indicators.filter((indicator) => !types.has(indicator.kind)) }));
  }
  for (const id of ids) {
    registered.get(id)?.();
    registered.delete(id);
    sources.delete(id);
    pending.delete(id);
  }
  const removed = new Set(ids);
  pineScripts.set((state) => ({ scripts: state.scripts.filter((script) => !removed.has(script.id)) }));
  deleteScripts(ids).catch((error: unknown) => log(`Pine scripts could not be removed from disk: ${(error as Error).message}`, 'Charts'));
}
