import type { Account, Deal } from '../shared/protocol';

export const DEALS_PER_REQUEST = 200;

export interface IngestAccount {
  readonly name: string;
  readonly server: string;
  readonly company: string;
  readonly currency: string;
  readonly tradeMode: Account['tradeMode'];
  readonly login: number;
  readonly isHedging: boolean;
}

export interface IngestDeal {
  readonly type: string;
  readonly entry: Deal['entry'];
  readonly symbol: string;
  readonly comment: string;
  readonly fee: number;
  readonly swap: number;
  readonly time: number;
  readonly order: number;
  readonly price: number;
  readonly ticket: number;
  readonly volume: number;
  readonly profit: number;
  readonly positionId: number;
  readonly commission: number;
}

export interface IngestPayload {
  readonly account: IngestAccount;
  readonly serverTimeOffsetMinutes: number;
  readonly deals: readonly IngestDeal[];
}

export interface IngestTrade {
  readonly key: string;
  readonly url: string | null;
  readonly status: string;
  readonly verifiedBy: string | null;
  readonly netPnl: number;
  readonly positionId: number;
  readonly isOpen: boolean;
}

export interface IngestResult {
  readonly accountId: string;
  readonly held: { fromTime: number; message: string } | null;
  readonly trades: readonly IngestTrade[];
  readonly usage?: { monthlyTrades: { used: number; limit: number | null; resetsAt: string } };
  readonly inserted: number;
  readonly skipped: number;
  readonly duplicates: number;
}

export function ingestAccount(account: Account): IngestAccount {
  const { login, name, server, company, currency, tradeMode, isHedging } = account;
  return { name, server, company, currency, tradeMode, login, isHedging };
}

// Every deal goes up as MT5 reports it; the server decides which ones become fills (balance,
// credit and commission deals are counted as skipped there).
export function ingestDeal(deal: Deal): IngestDeal {
  return {
    type: deal.type, entry: deal.entry, symbol: deal.symbol, comment: deal.comment,
    fee: deal.fee, swap: deal.swap, time: deal.time, order: deal.order, price: deal.price,
    ticket: deal.ticket, volume: deal.volume, profit: deal.profit, positionId: deal.positionId, commission: deal.commission,
  };
}

// Oldest first, so a monthly cap holds back the newest deals and the cursor can rest on the first
// one the server did not save.
export function dealBatches(deals: readonly Deal[], size = DEALS_PER_REQUEST): IngestDeal[][] {
  const ordered = [...deals].sort((left, right) => left.time - right.time || left.ticket - right.ticket).map(ingestDeal);
  const batches: IngestDeal[][] = [];
  for (let start = 0; start < ordered.length; start += size) batches.push(ordered.slice(start, start + size));
  return batches;
}

export function ingestPayload(account: Account, serverTimeOffsetMinutes: number, deals: readonly IngestDeal[]): IngestPayload {
  return { account: ingestAccount(account), serverTimeOffsetMinutes, deals };
}

const isTradeDeal = (deal: { readonly type: string }) => deal.type === 'buy' || deal.type === 'sell';

// A backfill window can start after a position opened. Its exit alone would reach the journal as
// a new trade in the opposite direction, so trade deals of positions with no entry here stay home.
export function withoutOrphanExits(deals: readonly Deal[]): Deal[] {
  const opened = new Set(deals.filter((deal) => isTradeDeal(deal) && deal.entry === 'in').map((deal) => deal.positionId));
  return deals.filter((deal) => !isTradeDeal(deal) || opened.has(deal.positionId));
}

const closingEntries = new Set<Deal['entry']>(['out', 'inout', 'outBy']);

// Positions with an exit deal after `since`: the ones this sync closed or reduced, as opposed to
// overlap the cursor's one-day margin sends again.
export function closingPositions(deals: readonly IngestDeal[], since: number): Map<number, string> {
  const positions = new Map<number, string>();
  for (const deal of deals) if (deal.time > since && closingEntries.has(deal.entry) && isTradeDeal(deal)) positions.set(deal.positionId, deal.symbol);
  return positions;
}
