import type {
  Account,
  AccountProfile,
  JournalEntry,
  LinkState,
  Order,
  Position,
  SymbolSpec,
  TerminalApi,
  TerminalStatus,
  Tick,
  TradeRequest,
  TradeResult,
} from '../../shared/protocol';
import { orderType } from '../../shared/protocol';
import { Store } from './store';
import { checkPriceAlerts, priceAlerts } from './price-alerts';

declare global {
  interface Window {
    terminal: TerminalApi;
  }
}

export const terminal = window.terminal;

const JOURNAL_LIMIT = 1000;
const SUBSCRIPTION_LIMIT = 256;
let contextVersion = 0;
let refreshWork: Promise<void> | undefined;

let tradeId = 0;

export type Direction = 'up' | 'down' | 'flat';

export interface TradeTarget {
  readonly order?: number;
  readonly position?: number;
}

export interface PendingTrade extends TradeTarget {
  readonly id: number;
  readonly label: string;
  readonly startedAt: number;
}

export interface FinishedTrade {
  readonly id: number;
  readonly label: string;
  readonly comment: string;
  readonly finishedAt: number;
  readonly elapsedMs: number;
  readonly isSuccess: boolean;
}

export interface SessionState {
  profileId: string | null;
  accounts: AccountProfile[];
  link: LinkState;
  status: TerminalStatus | null;
  account: Account | null;
  orders: Order[];
  journal: JournalEntry[];
  positions: Position[];
  pendingTrades: PendingTrade[];
  lastTrade: FinishedTrade | null;
  ticks: Record<string, Tick>;
  symbols: Record<string, SymbolSpec>;
  directions: Record<string, Direction>;
  extraSymbols: string[];
  watchedSymbols: string[];
}

export const session = new Store<SessionState>({
  profileId: null,
  accounts: [],
  link: { url: '', state: 'idle' },
  status: null,
  account: null,
  orders: [],
  journal: [],
  positions: [],
  pendingTrades: [],
  lastTrade: null,
  ticks: {},
  symbols: {},
  directions: {},
  extraSymbols: [],
  watchedSymbols: [],
});

export function log(message: string, source = 'Terminal'): void {
  const entry = { time: Date.now(), source, message };
  session.set((state) => ({ journal: [...state.journal.slice(-JOURNAL_LIMIT + 1), entry] }));
}

// A name this account does not list (a chart saved on another broker) fails the whole request,
// so only listed names are sent. Charts and alerts come first when the limit cuts the list.
function subscribedSymbols(): string[] {
  const { symbols, extraSymbols, watchedSymbols } = session.get();
  return [...new Set([...extraSymbols, ...watchedSymbols])].filter((name) => symbols[name]).slice(0, SUBSCRIPTION_LIMIT);
}

async function resubscribeTicks(): Promise<void> {
  const ticks = await terminal.request('ticks.subscribe', { symbols: subscribedSymbols() });
  session.set((state) => {
    const next = { ...state.ticks };
    for (const tick of ticks) {
      if (tick) {
        next[tick.symbol] = tick;
      }
    }
    return { ticks: next };
  });
}

export async function requireSymbols(names: string[]): Promise<void> {
  const missing = names.filter((name) => !session.get().extraSymbols.includes(name));
  if (missing.length === 0) {
    return;
  }
  session.set((state) => ({ extraSymbols: [...state.extraSymbols, ...missing] }));
  if (session.get().link.state === 'open') {
    await resubscribeTicks();
  }
}

export function setWatchedSymbols(names: string[]): void {
  const current = session.get().watchedSymbols;
  if (names.length === current.length && names.every((name, index) => name === current[index])) return;
  session.set({ watchedSymbols: names });
  if (session.get().link.state === 'open' && Object.keys(session.get().symbols).length) {
    void resubscribeTicks().catch((error: Error) => log(`quote subscription failed: ${error.message}`, 'Network'));
  }
}

export function refreshSession(): Promise<void> {
  return refreshWork ??= loadSession().finally(() => { refreshWork = undefined; });
}

async function loadSession(): Promise<void> {
  const version = contextVersion;
  try {
    const [status, symbols, trade] = await Promise.all([
      terminal.request('terminal.status', {}),
      terminal.request('symbols.list', {}),
      terminal.request('trade.snapshot', {}),
    ]);
    if (version !== contextVersion) return;
    session.set({
      status,
      orders: trade.orders,
      account: trade.account,
      positions: trade.positions,
      symbols: Object.fromEntries(symbols.map((symbol) => [symbol.name, symbol])),
    });
    const alertSymbols = priceAlerts.get().alerts.filter((alert) => alert.isEnabled && alert.triggeredAt === null && alert.profileId === session.get().profileId).map((alert) => alert.symbol).filter((symbol) => !!session.get().symbols[symbol]);
    if (alertSymbols.length) session.set((state) => ({ extraSymbols: [...new Set([...state.extraSymbols, ...alertSymbols])] }));
    await resubscribeTicks();
    log(`connected to ${trade.account?.server ?? status.company ?? 'trade server'} (server build ${status.build})`, 'Network');
    if (trade.account) {
      log(`'${trade.account.login}': ${trade.account.server}, ${trade.account.tradeMode} account, 1:${trade.account.leverage}`, 'Network');
    }
  } catch (error) {
    log(`initial synchronisation failed: ${(error as Error).message}`, 'Network');
  }
}

export function isTradePending(state: SessionState, target: TradeTarget): boolean {
  return state.pendingTrades.some((trade) => (target.position !== undefined && trade.position === target.position) || (target.order !== undefined && trade.order === target.order));
}

export async function trackTrade<T>(label: string, target: TradeTarget, run: () => Promise<T>, isSuccess: (value: T) => boolean, comment: (value: T) => string): Promise<T> {
  const trade: PendingTrade = { ...target, label, id: ++tradeId, startedAt: performance.now() };
  session.set((state) => ({ pendingTrades: [...state.pendingTrades, trade] }));
  const finish = (isDone: boolean, text: string) => session.set((state) => ({
    pendingTrades: state.pendingTrades.filter((candidate) => candidate.id !== trade.id),
    lastTrade: { label, id: trade.id, comment: text, isSuccess: isDone, finishedAt: Date.now(), elapsedMs: performance.now() - trade.startedAt },
  }));
  try {
    const value = await run();
    finish(isSuccess(value), comment(value));
    return value;
  } catch (error) {
    finish(false, (error as Error).message);
    throw error;
  }
}

export function describeTrade(request: TradeRequest): string {
  const subject = [request.volume, request.symbol].filter((part) => part !== undefined && part !== '').join(' ');
  if (request.action === 'remove') return `Delete order #${request.order}`;
  if (request.action === 'modify') return `Modify order #${request.order}`;
  if (request.action === 'sltp') return `Modify #${request.position} SL/TP`;
  if (request.action === 'closeBy') return `Close #${request.position} by #${request.positionBy}`;
  if (request.position) return `Close #${request.position} ${subject}`.trim();
  return `${orderType(request.type ?? '')?.label ?? request.type ?? request.action} ${subject}`.trim();
}

export function sendOrder(request: TradeRequest, label = describeTrade(request)): Promise<TradeResult> {
  return trackTrade(label, { position: request.position, order: request.order }, async () => {
    try {
      return await terminal.request('order.send', request);
    } catch (error) {
      return { retcode: 0, comment: (error as Error).message, isSuccess: false };
    }
  }, (result) => result.isSuccess, (result) => result.comment);
}

export function closePosition(position: Position, volume = position.volume): Promise<TradeResult> {
  return sendOrder({
    action: 'deal',
    symbol: position.symbol,
    position: position.ticket,
    volume,
    type: position.side === 'buy' ? 'sell' : 'buy',
  });
}

export function startSession(): void {
  terminal.on('accounts', (accounts) => session.set({ accounts, profileId: accounts.find((profile) => profile.isActive)?.id ?? null }));
  terminal.on('accountChanged', ({ id }) => {
    if (id === null) {
      contextVersion++;
      refreshWork = undefined;
      session.set({ extraSymbols: [], profileId: null, account: null, status: null, orders: [], positions: [], symbols: {}, ticks: {}, directions: {} });
    } else session.set({ profileId: id });
  });
  void terminal.request('accounts.list', {}).then((accounts) => session.set({ accounts, profileId: accounts.find((profile) => profile.isActive)?.id ?? null })).catch((error: Error) => log(error.message, 'Accounts'));
  terminal.on('status', (status) => session.set({ status }));
  terminal.on('symbols', (symbols) => session.set((state) => ({ symbols: { ...state.symbols, ...Object.fromEntries(symbols.map((symbol) => [symbol.name, symbol])) } })));
  terminal.on('link', (link) => {
    const wasOpen = session.get().link.state === 'open';
    session.set({ link });
    if (link.state === 'open' && !wasOpen) {
      void refreshSession();
    }
    if (link.state !== 'open' && wasOpen) {
      log(`connection to trade server lost${link.error ? `: ${link.error}` : ''}`, 'Network');
    }
  });
  terminal.on('tick', (tick) => {
    checkPriceAlerts(tick, session.get().profileId);
    session.set((state) => {
      const previous = state.ticks[tick.symbol];
      const direction: Direction = !previous || previous.bid === tick.bid ? state.directions[tick.symbol] ?? 'flat' : tick.bid > previous.bid ? 'up' : 'down';
      return {
        ticks: { ...state.ticks, [tick.symbol]: tick },
        directions: { ...state.directions, [tick.symbol]: direction },
      };
    });
  });
  terminal.on('trade', (trade) => session.set({ account: trade.account, orders: trade.orders, positions: trade.positions }));
  terminal.on('journal', (entry) => session.set((state) => ({ journal: [...state.journal.slice(-JOURNAL_LIMIT + 1), entry] })));
  void terminal.link().then((link) => {
    session.set({ link });
    if (link.state === 'open') {
      void refreshSession();
    }
  });
}
