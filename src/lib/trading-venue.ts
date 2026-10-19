import { useMemo } from 'react';
import type { BulkOutcome, BulkRequest, RiskOrderOutcome, RiskOrderRequest } from '../../shared/automation';
import type { Account, Order, Position, TradeRequest, TradeResult } from '../../shared/protocol';
import { automation, placeRiskOrder, runBulkTrades } from './automation';
import { backtest, backtestBulk, backtestRiskOrder, backtestTrade, backtestView, useActiveBacktest } from './backtest/runtime';
import { closePosition, sendOrder, session } from './session';
import { useStore } from './store';

// Where trades go: the logged-in broker account, or the running backtest's simulated account.
// The chart overlay, the Trade Assistant and the one-click panel read positions, orders, quotes
// and the account from a venue and trade through it, so a backtest has every tool the live
// account has and behaves the same way.

export interface VenueQuote {
  readonly bid: number;
  readonly ask: number;
}

export interface Venue {
  readonly kind: 'live' | 'backtest';
  // The account the venue trades, for panels to say where an order goes.
  readonly label: string;
  readonly canTrade: boolean;
  readonly account: Account | null;
  readonly orders: readonly Order[];
  readonly positions: readonly Position[];
  readonly quotes: Readonly<Record<string, VenueQuote>>;
  sendOrder(request: TradeRequest): Promise<TradeResult>;
  closePosition(position: Position, volume?: number): Promise<TradeResult>;
  placeRiskOrder(label: string, request: RiskOrderRequest): Promise<RiskOrderOutcome>;
  previewRisk(request: RiskOrderRequest): Promise<RiskOrderOutcome>;
  runBulk(label: string, request: BulkRequest): Promise<BulkOutcome[]>;
}

const noOrders: readonly Order[] = [];
const noPositions: readonly Position[] = [];
const noQuotes: Readonly<Record<string, VenueQuote>> = {};

const liveActions = {
  sendOrder: (request: TradeRequest) => sendOrder(request),
  closePosition: (position: Position, volume?: number) => closePosition(position, volume),
  placeRiskOrder,
  previewRisk: (request: RiskOrderRequest) => automation.request('manager.risk', { ...request, isDryRun: true }),
  runBulk: runBulkTrades,
};

const backtestActions = {
  sendOrder: backtestTrade,
  closePosition: (position: Position, volume?: number) => backtestTrade({ action: 'deal', position: position.ticket, symbol: position.symbol, volume: volume ?? position.volume, type: position.side === 'buy' ? 'sell' : 'buy' }),
  placeRiskOrder: (_label: string, request: RiskOrderRequest) => backtestRiskOrder(request),
  previewRisk: (request: RiskOrderRequest) => backtestRiskOrder({ ...request, isDryRun: true }),
  runBulk: (_label: string, request: BulkRequest) => backtestBulk(request),
};

// The backtest when `isBacktesting` (the chart, or the active chart, takes part in it), else the
// live account. Both are read every render so the hooks stay in order.
export function useVenue(isBacktesting: boolean): Venue {
  const account = useStore(session, (state) => state.account);
  const orders = useStore(session, (state) => state.orders);
  const positions = useStore(session, (state) => state.positions);
  const ticks = useStore(session, (state) => state.ticks);
  const isLiveTradable = useStore(session, (state) => !!state.account && state.status?.isTradeAllowed === true && state.status?.capabilities?.trading === true && state.link.state === 'open');
  const view = useStore(backtest, backtestView);
  const isStarting = useStore(backtest, (state) => state.isStarting);
  const name = useActiveBacktest()?.name;
  const live = useMemo<Venue>(() => ({ kind: 'live', label: account ? `${account.login} on ${account.server}` : 'No account', canTrade: isLiveTradable, account, orders, positions, quotes: ticks, ...liveActions }), [account, orders, positions, ticks, isLiveTradable]);
  const simulated = useMemo<Venue>(() => ({
    kind: 'backtest',
    label: name ? `Backtest: ${name}` : 'Backtest',
    canTrade: !!view && !isStarting,
    account: view?.account ?? null,
    orders: view?.orders ?? noOrders,
    positions: view?.positions ?? noPositions,
    quotes: view?.quotes ?? noQuotes,
    ...backtestActions,
  }), [view, isStarting, name]);
  return isBacktesting ? simulated : live;
}
