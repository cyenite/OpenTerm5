import { planRisk, type RiskMode } from '../../../shared/risk';
import { activeTab, activeChart, setChartSymbol, workspace } from '../workspace';
import { visibleChartIds } from '../chart-tabs';
import { exitReplay, pickReplayStart, replay, replayFrom, replayInterval, setReplayLimit } from '../replay';
import { timeframeSeconds } from '../mt5-timeframes';
import { log, session, terminal } from '../session';
import { Store, useStore } from '../store';
import { brokerClock } from '../broker-clock';
import { nextSessionOpenOnChart, type MarketSessionKey } from '../market-sessions';
import type { ServerClock } from '../server-clock';
import * as engine from './engine';
import { clearFeed, feedSeries } from './feed';
import type { Book, Side, SimPosition, SimOrder, SymbolTerms } from './model';
import { bidAt, type Series } from './series';
import { makeSession, restartedSession, restoreSession, simulationOf, type BacktestSession, type NewSession } from './session-model';
import { deleteSessionRecord, loadSessionRecords, saveSessionRecord } from './storage';
import { tradesCsv } from './stats';

// The running backtest. It follows the bar replay's clock: each time the replay moves on, the
// bars that ended on the way fill, stop and expire the session's orders. The clock only moves
// forward; a replay picked further back is put back where the backtest stands.

export const backtestPanelTabs = [
  { key: 'positions', label: 'Positions' },
  { key: 'orders', label: 'Orders' },
  { key: 'history', label: 'History' },
  { key: 'statistics', label: 'Statistics' },
  { key: 'journal', label: 'Journal' },
] as const;

export type BacktestPanelTab = (typeof backtestPanelTabs)[number]['key'];

export interface BacktestState {
  readonly activeId: string | null;
  // Starting resumes the replay, which may first load history.
  readonly isStarting: boolean;
  readonly notice: string | null;
  readonly panelTab: BacktestPanelTab;
  readonly isPanelCollapsed: boolean;
  // Bids at the active session's time, for every symbol it prices.
  readonly bids: Readonly<Record<string, number>>;
  // Why a symbol cannot be backtested, by symbol.
  readonly problems: Readonly<Record<string, string>>;
  readonly sessions: readonly BacktestSession[];
}

const PANEL_KEY = 'openterm.backtest-panel.v1';

function savedPanel(): Pick<BacktestState, 'panelTab' | 'isPanelCollapsed'> {
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_KEY) ?? 'null') as Partial<BacktestState> | null;
    return { panelTab: backtestPanelTabs.find((tab) => tab.key === saved?.panelTab)?.key ?? 'positions', isPanelCollapsed: saved?.isPanelCollapsed === true };
  } catch {
    return { panelTab: 'positions', isPanelCollapsed: false };
  }
}

export const backtest = new Store<BacktestState>({ activeId: null, isStarting: false, notice: null, bids: {}, problems: {}, sessions: [], ...savedPanel() });

export const activeBacktest = (state: BacktestState): BacktestSession | undefined => state.sessions.find((candidate) => candidate.id === state.activeId);

export function useActiveBacktest(): BacktestSession | undefined {
  return useStore(backtest, activeBacktest);
}

// Sessions load from IndexedDB at start-up; newest first.
export const backtestsReady: Promise<void> = (typeof indexedDB === 'undefined' ? Promise.resolve([]) : loadSessionRecords())
  .then((records) => {
    const sessions = records.map(restoreSession).filter((candidate): candidate is BacktestSession => !!candidate).sort((left, right) => right.updatedAt - left.updatedAt);
    backtest.set((state) => ({ sessions: [...state.sessions, ...sessions.filter((candidate) => !state.sessions.some((existing) => existing.id === candidate.id))] }));
  })
  .catch((error: Error) => log(`Saved backtests could not be read: ${error.message}`, 'Backtest'));

const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();

function save(id: string, isNow = false): void {
  clearTimeout(pendingSaves.get(id));
  const write = () => {
    pendingSaves.delete(id);
    const current = backtest.get().sessions.find((candidate) => candidate.id === id);
    if (current) void saveSessionRecord(current).catch((error: Error) => log(`The backtest could not be saved: ${error.message}`, 'Backtest'));
  };
  if (isNow) write();
  else pendingSaves.set(id, setTimeout(write, 1000));
}

function updateSession(id: string, patch: Partial<BacktestSession>, extra: Partial<BacktestState> = {}): void {
  backtest.set((state) => ({ ...extra, sessions: state.sessions.map((candidate) => candidate.id === id ? { ...candidate, ...patch, updatedAt: Date.now() } : candidate) }));
  save(id);
}

export function setBacktestPanel(patch: Partial<Pick<BacktestState, 'panelTab' | 'isPanelCollapsed'>>): void {
  backtest.set(patch);
  const { panelTab, isPanelCollapsed } = backtest.get();
  try {
    localStorage.setItem(PANEL_KEY, JSON.stringify({ panelTab, isPanelCollapsed }));
  } catch {
    // The panel's layout is a convenience.
  }
}

export function dismissBacktestNotice(): void {
  backtest.set({ notice: null });
}

// The charts of the replay trade in the backtest; every other chart stays on the live account.
export function isBacktestingChart(chartId: string | undefined): boolean {
  const replaying = replay.get().session;
  return !!chartId && !!backtest.get().activeId && !!replaying?.chartIds.includes(chartId);
}

export function useIsBacktestingChart(chartId: string | undefined): boolean {
  const isActive = useStore(backtest, (state) => !!state.activeId);
  const isReplaying = useStore(replay, (state) => !!chartId && !!state.session?.chartIds.includes(chartId));
  return isActive && isReplaying;
}

// The symbols of the charts taking part in the replay.
function chartSymbols(): string[] {
  const chartIds = replay.get().session?.chartIds ?? [];
  const charts = workspace.get().charts;
  return [...new Set(chartIds.map((id) => charts.find((chart) => chart.id === id)?.symbol).filter((symbol): symbol is string => !!symbol))];
}

interface TermsProblem {
  readonly message: string;
  // A lasting problem is not asked about again this session; a passing one (the broker has not
  // sent the conversion rates yet) is retried on the next step.
  readonly isLasting: boolean;
}

// Captures what the simulation needs about a symbol from the broker, once per session.
async function captureTerms(current: BacktestSession, symbol: string): Promise<SymbolTerms | TermsProblem> {
  const spec = session.get().symbols[symbol];
  if (!spec) return { message: `${symbol} is not offered by the account you are logged in to.`, isLasting: true };
  let profitRate: number;
  try {
    const valuation = await terminal.request('symbols.valuation', { symbol });
    if (!(valuation.moneyPerUnit > 0)) return { message: `${symbol} is priced by exchange rules the backtest cannot value.`, isLasting: true };
    if (valuation.accountCurrency !== current.currency && spec.currencyProfit !== current.currency && spec.currencyBase !== current.currency) return { message: `${symbol} profits cannot be converted to ${current.currency} on this account.`, isLasting: true };
    profitRate = valuation.rate;
  } catch (error) {
    return { message: `${symbol} cannot be valued yet: ${(error as Error).message}`, isLasting: false };
  }
  const spreadPoints = current.settings.spreadPoints ?? spec.spread;
  return {
    name: symbol,
    currencyBase: spec.currencyBase,
    currencyProfit: spec.currencyProfit,
    point: spec.point,
    digits: spec.digits,
    volumeMin: spec.volumeMin,
    volumeMax: spec.volumeMax,
    volumeStep: spec.volumeStep,
    spreadPoints: Math.max(0, spreadPoints),
    contractSize: spec.contractSize,
    profitRate,
  };
}

const lastingProblems = new Set<string>();

// Terms for the symbols the charts show and the book holds, captured where missing.
async function prepareTerms(id: string, symbols: readonly string[]): Promise<void> {
  for (const symbol of new Set(symbols)) {
    const current = backtest.get().sessions.find((candidate) => candidate.id === id);
    if (!current || current.terms[symbol] || lastingProblems.has(symbol)) continue;
    const terms = await captureTerms(current, symbol);
    if ('message' in terms) {
      if (terms.isLasting) lastingProblems.add(symbol);
      backtest.set((state) => ({ problems: { ...state.problems, [symbol]: terms.message } }));
      continue;
    }
    const latest = backtest.get().sessions.find((candidate) => candidate.id === id);
    if (latest) updateSession(id, { terms: { ...latest.terms, [symbol]: terms } }, { problems: Object.fromEntries(Object.entries(backtest.get().problems).filter(([key]) => key !== symbol)) });
  }
}

function stepSeconds(): number {
  const interval = replayInterval();
  return interval ? timeframeSeconds(interval) : 60;
}

function bookSymbols(book: Book): string[] {
  return [...book.positions.map((position) => position.symbol), ...book.orders.map((order) => order.symbol)];
}

async function seriesFor(symbols: readonly string[], time: number): Promise<Map<string, Series>> {
  const series = new Map<string, Series>();
  const step = stepSeconds();
  await Promise.all(symbols.map(async (symbol) => {
    try {
      series.set(symbol, await feedSeries(symbol, time, step));
    } catch (error) {
      backtest.set((state) => ({ problems: { ...state.problems, [symbol]: `${symbol} history could not be loaded: ${(error as Error).message}` } }));
    }
  }));
  return series;
}

let queue: Promise<void> = Promise.resolve();
// The latest replay time handed to the queue; the book catches up with it.
let clock: number | null = null;

async function moveTo(id: string, to: number): Promise<void> {
  const before = backtest.get().sessions.find((candidate) => candidate.id === id);
  if (!before || backtest.get().activeId !== id) return;
  const from = before.book.time ?? to;
  await prepareTerms(id, [...chartSymbols(), ...bookSymbols(before.book)]);
  const priced = Object.keys(backtest.get().sessions.find((candidate) => candidate.id === id)?.terms ?? {});
  const series = await seriesFor(priced, from);
  const current = backtest.get().sessions.find((candidate) => candidate.id === id);
  if (!current || backtest.get().activeId !== id) return;
  const book = engine.advance(current.book, simulationOf(current), (symbol) => series.get(symbol), to);
  const bids: Record<string, number> = {};
  for (const [symbol, values] of series) {
    const bid = bidAt(values, to);
    if (bid !== null) bids[symbol] = bid;
  }
  if (book.trades.length > current.book.trades.length || book.journal.length !== current.book.journal.length) {
    for (const line of book.journal.slice(current.book.journal.length)) log(line.message, 'Backtest');
  }
  updateSession(id, { book }, { bids });
}

function follow(to: number): void {
  const id = backtest.get().activeId;
  if (!id) return;
  clock = to;
  queue = queue.then(() => moveTo(id, to)).catch((error: Error) => log(`Backtest step failed: ${error.message}`, 'Backtest'));
}

// Waits until the book has caught up with the replay.
export function backtestSettled(): Promise<void> {
  return queue;
}

replay.subscribe(() => {
  const state = backtest.get();
  if (!state.activeId || state.isStarting) return;
  const current = replay.get().session;
  if (!current) {
    suspend('The replay ended, so the backtest was saved. Resume it from Backtesting.');
    return;
  }
  if (current.time === null || current.isSelecting || current.time === clock) return;
  if (clock !== null && current.time < clock) {
    const back = clock;
    backtest.set({ notice: 'A backtest only moves forward. Restart the session to test an earlier period.' });
    queueMicrotask(() => pickReplayStart(back));
    return;
  }
  follow(current.time);
});

terminal.on('accountChanged', () => {
  clearFeed();
  lastingProblems.clear();
  backtest.set({ problems: {} });
});

function suspend(notice: string | null): void {
  const id = backtest.get().activeId;
  if (!id) return;
  backtest.set({ activeId: null, isStarting: false, bids: {}, problems: {}, notice });
  lastingProblems.clear();
  clock = null;
  save(id, true);
}

// Waits for React to hand a changed chart to its engine.
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

async function start(id: string): Promise<void> {
  if (!session.get().account) throw new Error('Log in to an account first: a backtest replays its symbols and history.');
  const target = backtest.get().sessions.find((candidate) => candidate.id === id);
  if (!target) throw new Error('This backtest no longer exists.');
  if (backtest.get().activeId) endBacktest();
  backtest.set({ activeId: id, isStarting: true, notice: null, bids: {}, problems: {} });
  clock = null;
  try {
    const state = workspace.get();
    const tab = activeTab(state);
    const shown = tab ? visibleChartIds(tab).map((chartId) => state.charts.find((chart) => chart.id === chartId)?.symbol) : [];
    const chart = activeChart(state);
    if (chart && !shown.includes(target.symbol)) {
      setChartSymbol(chart.id, target.symbol);
      await settle();
    }
    const requested = target.book.time ?? target.startTime;
    const started = await replayFrom(requested, target.endTime);
    if (started === null) throw new Error('Open a chart to backtest on.');
    if (target.book.time === null && started > requested + 86_400_000) {
      backtest.set({ notice: `The charts' history starts later than the session, so it begins at the first available bar.` });
    }
  } catch (error) {
    backtest.set({ activeId: null, isStarting: false });
    throw error;
  }
  backtest.set({ isStarting: false });
  const time = replay.get().session?.time;
  if (time !== null && time !== undefined) follow(time);
}

export async function createBacktest(input: NewSession): Promise<void> {
  const created = makeSession(input, crypto.randomUUID(), Date.now());
  backtest.set((state) => ({ sessions: [created, ...state.sessions] }));
  save(created.id, true);
  await start(created.id);
}

export function resumeBacktest(id: string): Promise<void> {
  return start(id);
}

// Saves the session and leaves the replay.
export function endBacktest(): void {
  const id = backtest.get().activeId;
  if (!id) return;
  suspend(null);
  exitReplay();
}

export function deleteBacktest(id: string): void {
  if (backtest.get().activeId === id) endBacktest();
  clearTimeout(pendingSaves.get(id));
  backtest.set((state) => ({ sessions: state.sessions.filter((candidate) => candidate.id !== id) }));
  void deleteSessionRecord(id).catch((error: Error) => log(`The backtest could not be deleted: ${error.message}`, 'Backtest'));
}

export function renameBacktest(id: string, name: string): void {
  if (name.trim()) updateSession(id, { name: name.trim() });
}

// Starts the session over from its start date with its starting balance.
export async function restartBacktest(id: string): Promise<void> {
  const target = backtest.get().sessions.find((candidate) => candidate.id === id);
  if (!target) return;
  if (backtest.get().activeId === id) endBacktest();
  updateSession(id, restartedSession(target, Date.now()));
  await start(id);
}

export function setBacktestEnd(endTime: number | null): void {
  const current = activeBacktest(backtest.get());
  if (!current) return;
  updateSession(current.id, { endTime });
  setReplayLimit(endTime);
}

let cachedClock: { key: string; clock: Promise<ServerClock> } | null = null;

function serverClock(): Promise<ServerClock> {
  const account = session.get().account;
  const key = `${account?.server}:${account?.login}`;
  if (cachedClock?.key !== key) cachedClock = { key, clock: brokerClock().then((result) => result.clock) };
  return cachedClock.clock;
}

// Moves the replay on to the next opening of a market session, on the broker's clock.
export async function jumpToSession(key: MarketSessionKey): Promise<void> {
  const time = replay.get().session?.time;
  if (time === null || time === undefined) return;
  pickReplayStart(nextSessionOpenOnChart(await serverClock(), key, time));
}

export function jumpForward(time: number): void {
  const current = replay.get().session?.time;
  if (current !== null && current !== undefined && time > current) pickReplayStart(time);
}

// Trading. Each returns null when done, or why it was refused.

function act(apply: (book: Book, current: BacktestSession) => engine.Outcome): string | null {
  const current = activeBacktest(backtest.get());
  if (!current) return 'No backtest is running.';
  if (backtest.get().isStarting) return 'The backtest is still starting.';
  const outcome = apply(current.book, current);
  if (outcome.error) return outcome.error;
  updateSession(current.id, { book: outcome.book });
  for (const line of outcome.book.journal.slice(current.book.journal.length)) log(line.message, 'Backtest');
  return null;
}

// Terms and a bid for the symbol at the book's time, so it can trade straight away.
export async function prepareSymbol(symbol: string): Promise<string | null> {
  const current = activeBacktest(backtest.get());
  if (!current) return 'No backtest is running.';
  await queue;
  await prepareTerms(current.id, [symbol]);
  const problem = backtest.get().problems[symbol];
  if (problem) return problem;
  const latest = activeBacktest(backtest.get());
  if (!latest || latest.book.time === null) return 'The backtest starts once the replay has a start.';
  if (backtest.get().bids[symbol] === undefined) {
    const series = await seriesFor([symbol], latest.book.time);
    const bid = series.get(symbol) ? bidAt(series.get(symbol)!, latest.book.time) : null;
    if (bid === null) return `${symbol} has no price at this point of the replay.`;
    backtest.set((state) => ({ bids: { ...state.bids, [symbol]: bid } }));
  }
  return null;
}

export async function backtestMarket(request: engine.MarketRequest): Promise<string | null> {
  return await prepareSymbol(request.symbol) ?? act((book, current) => engine.placeMarket(book, simulationOf(current), backtest.get().bids, request));
}

export async function backtestPending(request: engine.PendingRequest): Promise<string | null> {
  return await prepareSymbol(request.symbol) ?? act((book, current) => engine.placePending(book, simulationOf(current), backtest.get().bids, request));
}

export function modifyBacktestPosition(ticket: number, sl: number, tp: number): string | null {
  return act((book, current) => engine.modifyPosition(book, simulationOf(current), backtest.get().bids, ticket, sl, tp));
}

export function modifyBacktestOrder(ticket: number, change: engine.OrderChange): string | null {
  return act((book, current) => engine.modifyOrder(book, simulationOf(current), backtest.get().bids, ticket, change));
}

export function cancelBacktestOrder(ticket: number): string | null {
  return act((book) => engine.cancelOrder(book, ticket));
}

export function closeBacktestPosition(ticket: number, volume?: number): string | null {
  return act((book, current) => engine.closePosition(book, simulationOf(current), backtest.get().bids, ticket, volume));
}

export function closeBacktestPositions(isIncluded?: (position: SimPosition) => boolean): string | null {
  return act((book, current) => engine.closePositions(book, simulationOf(current), backtest.get().bids, isIncluded));
}

export function cancelBacktestOrders(isIncluded?: (order: SimOrder) => boolean): string | null {
  return act((book) => ({ book: engine.cancelOrders(book, isIncluded), error: null }));
}

// Closes the position and opens the same volume the other way.
export async function reverseBacktestPosition(ticket: number): Promise<string | null> {
  const position = activeBacktest(backtest.get())?.book.positions.find((candidate) => candidate.ticket === ticket);
  if (!position) return `Position #${ticket} is no longer open.`;
  return closeBacktestPosition(ticket) ?? backtestMarket({ side: position.side === 'buy' ? 'sell' : 'buy', symbol: position.symbol, volume: position.volume });
}

export function breakEvenBacktestPositions(): string | null {
  const current = activeBacktest(backtest.get());
  if (!current) return 'No backtest is running.';
  let error: string | null = null;
  for (const position of current.book.positions) {
    const result = modifyBacktestPosition(position.ticket, position.priceOpen, position.tp);
    error ??= result;
  }
  return error;
}

export interface BacktestQuote {
  readonly bid: number;
  readonly ask: number;
  readonly digits: number;
}

export function backtestQuote(state: BacktestState, symbol: string): BacktestQuote | null {
  const terms = activeBacktest(state)?.terms[symbol];
  const bid = state.bids[symbol];
  if (!terms || bid === undefined) return null;
  return { ...engine.quoteOf(terms, bid), digits: terms.digits };
}

// Lots for a risk-sized trade in the running backtest, as the live risk ticket sizes them.
export function backtestRiskLots(symbol: string, side: Side, entry: number, stopLoss: number, mode: RiskMode, value: number): { lots: number; riskMoney: number; error: string | null } {
  const state = backtest.get();
  const current = activeBacktest(state);
  const terms = current?.terms[symbol];
  if (!current || !terms) return { lots: 0, riskMoney: 0, error: `${symbol} is not priced in this backtest yet.` };
  const figures = engine.accountFigures(current.book, simulationOf(current), state.bids);
  const plan = planRisk({
    side, mode, value, entry, stopLoss,
    limits: { digits: terms.digits, point: terms.point, volumeMin: terms.volumeMin, volumeMax: terms.volumeMax, volumeStep: terms.volumeStep },
    takeProfits: [],
    equity: figures.equity,
    balance: figures.balance,
    moneyPerUnit: engine.moneyPerUnit(simulationOf(current), terms, stopLoss || entry),
    commissionPerLot: current.settings.commissionPerLot * 2,
  });
  return { lots: plan.lots, riskMoney: plan.riskMoney, error: plan.isValid ? null : plan.warnings[0] ?? 'The trade cannot be sized.' };
}

export function downloadBacktestTrades(target: BacktestSession): void {
  const csv = tradesCsv(target.book.trades, (symbol) => target.terms[symbol]?.digits ?? 5);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${target.name.replace(/[^\w.-]+/g, '-')}-trades.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Shows why a backtest action was refused under the replay toolbar, and in the journal.
export function reportBacktest(error: string | null): void {
  if (!error) return;
  backtest.set({ notice: error });
  log(error, 'Backtest');
}
