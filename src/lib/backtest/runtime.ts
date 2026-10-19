import type { BulkOutcome, BulkRequest, RiskOrderOutcome, RiskOrderRequest } from '../../../shared/automation';
import type { Account, Order, Position, TradeRequest, TradeResult } from '../../../shared/protocol';
import { planRiskOrder } from '../../../shared/risk-order';
import { activeTab, activeChart, isTradeDialog, setChartSymbol, toggleAnalysisMode, workspace, type WorkspaceState } from '../workspace';
import { visibleChartIds } from '../chart-tabs';
import { exitReplay, pickReplayStart, replay, replayFrom, replayInterval } from '../replay';
import { timeframeSeconds } from '../mt5-timeframes';
import { log, session, terminal } from '../session';
import { Store, useStore } from '../store';
import { brokerClock } from '../broker-clock';
import { nextSessionOpenOnChart, type MarketSessionKey } from '../market-sessions';
import type { ServerClock } from '../server-clock';
import * as engine from './engine';
import { clearFeed, feedSeries } from './feed';
import type { Book, SimPosition, SimOrder, SymbolTerms } from './model';
import { bidAt, type Series } from './series';
import { makeSession, restartedSession, restoreSession, simulationOf, type BacktestSession, type NewSession } from './session-model';
import { deleteSessionRecord, loadSessionRecords, saveSessionRecord } from './storage';
import { tradesCsv } from './stats';
import { simAccount, simOrders, simPositions, tradeResult } from './venue-model';

// The running backtest. It follows the bar replay's clock: each time the replay moves on, the
// bars that ended on the way fill, stop and expire the session's orders. The clock only moves
// forward; a replay picked further back is put back where the backtest stands.

// The Backtest panel's sections, in the order it shows them; each folds on its own.
export const backtestSections = [
  { key: 'performance', label: 'Performance' },
  { key: 'positions', label: 'Positions' },
  { key: 'orders', label: 'Orders' },
  { key: 'trades', label: 'Trades' },
  { key: 'journal', label: 'Journal' },
] as const;

export type BacktestSection = (typeof backtestSections)[number]['key'];

export interface BacktestState {
  readonly activeId: string | null;
  // Starting resumes the replay, which may first load history.
  readonly isStarting: boolean;
  readonly notice: string | null;
  readonly collapsedSections: readonly BacktestSection[];
  // Bids at the active session's time, for every symbol it prices.
  readonly bids: Readonly<Record<string, number>>;
  // Why a symbol cannot be backtested, by symbol.
  readonly problems: Readonly<Record<string, string>>;
  readonly sessions: readonly BacktestSession[];
}

const PANEL_KEY = 'openterm.backtest-panel.v2';

function savedPanel(): Pick<BacktestState, 'collapsedSections'> {
  try {
    const saved = JSON.parse(localStorage.getItem(PANEL_KEY) ?? 'null') as { collapsedSections?: unknown } | null;
    const collapsed = Array.isArray(saved?.collapsedSections) ? saved.collapsedSections : ['journal'];
    return { collapsedSections: backtestSections.map((section) => section.key).filter((key) => collapsed.includes(key)) };
  } catch {
    return { collapsedSections: ['journal'] };
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

export function toggleBacktestSection(section: BacktestSection): void {
  backtest.set((state) => ({ collapsedSections: state.collapsedSections.includes(section) ? state.collapsedSections.filter((key) => key !== section) : [...state.collapsedSections, section] }));
  try {
    localStorage.setItem(PANEL_KEY, JSON.stringify({ collapsedSections: backtest.get().collapsedSections }));
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
    suspend('The backtest ended with its charts, and was saved.');
    restoreFocus();
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

// The interface modes, in the order the app bar offers them. Backtest mode gives the whole
// interface over to backtesting: Analysis mode's chart-first layout without the watchlist, the
// Backtest panel open and the backtest's controls on the charts. The settings it replaced are kept,
// on disk too, and put back when the mode ends (with the session, or by choosing another mode), or
// at the next start if OpenTerm5 closed during it.
export const interfaceModes = [
  { key: 'trade', label: 'Trade', icon: 'trade', description: 'The full terminal: order tickets, one-click trading, the toolbox and every workspace.' },
  { key: 'analysis', label: 'Analysis', icon: 'analysis', description: 'A chart-first layout without trading controls. Accounts, copiers and signals keep running.' },
  { key: 'backtest', label: 'Backtest', icon: 'backtest', description: 'Replay history and trade it on a simulated account, with the session statistics beside the charts.' },
] as const;

export type InterfaceMode = (typeof interfaceModes)[number]['key'];

export const modeOf = (state: Pick<WorkspaceState, 'isAnalysisMode' | 'isBacktestMode'>): InterfaceMode => (state.isBacktestMode ? 'backtest' : state.isAnalysisMode ? 'analysis' : 'trade');

const FOCUS_KEY = 'openterm.backtest-focus.v1';

type FocusSettings = Pick<WorkspaceState, 'isAnalysisMode' | 'isMarketWatchShown' | 'isBacktestPanelShown'>;

let replacedSettings: FocusSettings | null = null;

function savedFocus(): FocusSettings | null {
  try {
    const saved = JSON.parse(localStorage.getItem(FOCUS_KEY) ?? 'null') as Partial<FocusSettings> | null;
    const isValid = saved && typeof saved.isAnalysisMode === 'boolean' && typeof saved.isMarketWatchShown === 'boolean' && typeof saved.isBacktestPanelShown === 'boolean';
    return isValid ? { isAnalysisMode: saved.isAnalysisMode!, isMarketWatchShown: saved.isMarketWatchShown!, isBacktestPanelShown: saved.isBacktestPanelShown! } : null;
  } catch {
    return null;
  }
}

export function enterBacktestMode(): void {
  if (workspace.get().isBacktestMode) return;
  // Bar replay and a backtest share the clock; the backtest takes it.
  if (replay.get().session) exitReplay();
  if (!replacedSettings) {
    const { isAnalysisMode, isMarketWatchShown, isBacktestPanelShown } = workspace.get();
    replacedSettings = { isAnalysisMode, isMarketWatchShown, isBacktestPanelShown };
    try {
      localStorage.setItem(FOCUS_KEY, JSON.stringify(replacedSettings));
    } catch {
      // The settings are still kept for this run.
    }
  }
  workspace.set((state) => ({
    isBacktestMode: true,
    page: 'trading',
    isAnalysisMode: true,
    isMarketWatchShown: false,
    isBacktestPanelShown: true,
    depthSymbol: null,
    tool: state.tool === 'riskOrder' ? 'cursor' : state.tool,
    dialog: state.dialog && isTradeDialog(state.dialog) ? null : state.dialog,
  }));
}

function restoreFocus(): void {
  const settings = replacedSettings ?? savedFocus();
  replacedSettings = null;
  try {
    localStorage.removeItem(FOCUS_KEY);
  } catch {
    // Nothing was kept on disk.
  }
  workspace.set((state) => ({ ...settings ?? {}, isBacktestMode: false, tool: state.tool === 'riskOrder' ? 'cursor' : state.tool }));
}

// Leaves Backtest mode, saving and ending any running session first.
export function exitBacktestMode(): void {
  if (backtest.get().activeId) {
    suspend(null);
    exitReplay();
  }
  if (workspace.get().isBacktestMode || replacedSettings || savedFocus()) restoreFocus();
}

export function chooseMode(mode: InterfaceMode): void {
  if (mode === 'backtest') {
    enterBacktestMode();
    return;
  }
  if (workspace.get().isBacktestMode) exitBacktestMode();
  if (workspace.get().isAnalysisMode !== (mode === 'analysis')) toggleAnalysisMode();
}

if (savedFocus()) restoreFocus();

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
  // Another session ends without leaving Backtest mode.
  if (backtest.get().activeId) {
    suspend(null);
    exitReplay();
  }
  enterBacktestMode();
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
    const started = await replayFrom(requested, target.endTime, 'backtest');
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

// Saves the session, returns the charts to live and leaves Backtest mode.
export function endBacktest(): void {
  exitBacktestMode();
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

// Tickets the last action opened: new positions, else new pending orders.
function newTickets(before: Book, after: Book): number[] {
  const known = new Set([...before.positions.map((position) => position.ticket), ...before.orders.map((order) => order.ticket)]);
  return [...after.positions.map((position) => position.ticket), ...after.orders.map((order) => order.ticket)].filter((ticket) => !known.has(ticket));
}

// A risk order on the backtest, planned exactly as the live trade manager plans one: the same
// entry, stop, R targets, split across parts, and management for each part.
export async function backtestRiskOrder(request: RiskOrderRequest): Promise<RiskOrderOutcome> {
  if (!request.isDryRun) await queue;
  const problem = await prepareSymbol(request.symbol);
  if (problem) throw new Error(problem);
  const state = backtest.get();
  const current = activeBacktest(state);
  const terms = current?.terms[request.symbol];
  const bid = state.bids[request.symbol];
  if (!current || !terms || bid === undefined) throw new Error(`${request.symbol} has no price at this point of the backtest.`);
  const simulation = simulationOf(current);
  const quote = engine.quoteOf(terms, bid);
  const figures = engine.accountFigures(current.book, simulation, state.bids);
  const planned = planRiskOrder(request, {
    quote,
    limits: { digits: terms.digits, point: terms.point, volumeMin: terms.volumeMin, volumeMax: terms.volumeMax, volumeStep: terms.volumeStep },
    equity: figures.equity,
    balance: figures.balance,
    moneyPerUnit: engine.moneyPerUnit(simulation, terms, quote.bid),
  });
  const outcome: RiskOrderOutcome = { lots: planned.plan.lots, warnings: planned.plan.warnings, results: [], riskMoney: planned.plan.riskMoney, stopLoss: planned.stopLoss, entry: planned.entry, takeProfits: planned.legs.map((leg) => leg.takeProfit), isDryRun: !!request.isDryRun };
  if (request.isDryRun) return outcome;
  for (const leg of planned.legs) {
    const levels = planned.isStealth ? {} : { sl: planned.stopLoss, tp: leg.takeProfit };
    const before = activeBacktest(backtest.get())!.book;
    const error = act((book, session) => planned.isPending
      ? engine.placePending(book, simulationOf(session), backtest.get().bids, { type: request.type as engine.PendingRequest['type'], symbol: request.symbol, volume: leg.lots, price: planned.entry, comment: request.comment, rule: leg.rule, ...levels, ...(request.expiration ? { expiration: request.expiration * 1000 } : {}) })
      : engine.placeMarket(book, simulationOf(session), backtest.get().bids, { side: planned.side, symbol: request.symbol, volume: leg.lots, comment: request.comment, rule: leg.rule, ...levels }));
    const after = activeBacktest(backtest.get())!.book;
    outcome.results.push(tradeResult(error, newTickets(before, after)[0]));
    if (error) break;
  }
  return outcome;
}

export async function backtestBulk(request: BulkRequest): Promise<BulkOutcome[]> {
  await queue;
  const current = activeBacktest(backtest.get());
  if (!current) throw new Error('No backtest is running.');
  const { book, results } = engine.bulkAction(current.book, simulationOf(current), backtest.get().bids, request.kind, request.symbol, request.ticket);
  if (book !== current.book) {
    updateSession(current.id, { book });
    for (const line of book.journal.slice(current.book.journal.length)) log(line.message, 'Backtest');
  }
  return results.map((result) => ({ ticket: result.ticket, symbol: result.symbol, result: tradeResult(result.error) }));
}

// A broker trade request carried out on the backtest.
export async function backtestTrade(request: TradeRequest): Promise<TradeResult> {
  const before = activeBacktest(backtest.get())?.book;
  const run = async (): Promise<string | null> => {
    switch (request.action) {
      case 'deal': {
        if (request.position) {
          const position = before?.positions.find((candidate) => candidate.ticket === request.position);
          return closeBacktestPosition(request.position, request.volume !== undefined && position && request.volume < position.volume ? request.volume : undefined);
        }
        return backtestMarket({ side: request.type === 'sell' ? 'sell' : 'buy', symbol: request.symbol ?? '', volume: request.volume ?? 0, sl: request.sl, tp: request.tp, comment: request.comment });
      }
      case 'pending':
        return backtestPending({ type: request.type as engine.PendingRequest['type'], symbol: request.symbol ?? '', volume: request.volume ?? 0, price: request.price ?? 0, stopLimit: request.stoplimit, sl: request.sl, tp: request.tp, comment: request.comment, expiration: request.expiration ? request.expiration * 1000 : 0 });
      case 'sltp':
        return modifyBacktestPosition(request.position ?? 0, request.sl ?? 0, request.tp ?? 0);
      case 'modify': {
        const order = before?.orders.find((candidate) => candidate.ticket === request.order);
        return modifyBacktestOrder(request.order ?? 0, { price: request.price ?? order?.price ?? 0, stopLimit: request.stoplimit ?? order?.stopLimit ?? 0, sl: request.sl ?? 0, tp: request.tp ?? 0, expiration: request.expiration ? request.expiration * 1000 : 0 });
      }
      case 'remove':
        return cancelBacktestOrder(request.order ?? 0);
      case 'closeBy':
        return 'Close By is not available in a backtest.';
    }
  };
  const error = await run();
  const after = activeBacktest(backtest.get())?.book;
  return tradeResult(error, before && after ? newTickets(before, after)[0] : undefined);
}

export interface BacktestView {
  readonly account: Account;
  readonly orders: readonly Order[];
  readonly positions: readonly Position[];
  readonly quotes: Readonly<Record<string, { readonly bid: number; readonly ask: number }>>;
}

// The simulated account in the live protocol's shapes, recomputed only when the book or the bids
// change.
let mirrored: { book: Book | null; bids: Readonly<Record<string, number>> | null; view: BacktestView | null } = { book: null, bids: null, view: null };

export function backtestView(state: BacktestState): BacktestView | null {
  const current = activeBacktest(state);
  if (!current) return null;
  if (mirrored.book === current.book && mirrored.bids === state.bids && mirrored.view) return mirrored.view;
  const simulation = simulationOf(current);
  const quotes = Object.fromEntries(Object.entries(state.bids).flatMap(([symbol, bid]) => current.terms[symbol] ? [[symbol, engine.quoteOf(current.terms[symbol], bid)]] : []));
  const view = { account: simAccount(current, simulation, state.bids), orders: simOrders(current.book, state.bids), positions: simPositions(current.book, simulation, state.bids), quotes };
  mirrored = { book: current.book, bids: state.bids, view };
  return view;
}

// Account money per lot for a move of 1.0 in the symbol's price, at its current backtest price;
// null until the session prices the symbol.
export function useBacktestMoneyPerUnit(symbol: string): number | null {
  return useStore(backtest, (state) => {
    const current = activeBacktest(state);
    const terms = current?.terms[symbol];
    const bid = state.bids[symbol];
    return current && terms && bid !== undefined ? engine.moneyPerUnit(simulationOf(current), terms, bid) : null;
  });
}
