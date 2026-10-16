import type { ClosedTrade } from '../shared/journaling';
import type { Account, History } from '../shared/protocol';
import { closingPositions, dealBatches, ingestPayload, withoutOrphanExits, type IngestPayload, type IngestResult } from './journaling-deals';

const DAY = 86_400_000;

export const BACKFILL_MS = 90 * DAY;
export const OVERLAP_MS = DAY;

export interface SyncInput {
  readonly account: Account;
  // Server-clock epoch ms up to which every deal was delivered; null before the first sync.
  readonly cursor: number | null;
  // Now on the server's clock (UTC plus the server's offset), in epoch ms.
  readonly serverNow: number;
  readonly offsetMinutes: number;
}

export interface SyncDeps {
  // `history.get` takes whole seconds on the server's clock.
  history(fromSeconds: number, toSeconds: number): Promise<History>;
  post(payload: IngestPayload): Promise<IngestResult>;
  // Called after every accepted batch, so a later failure keeps the progress made.
  progress(cursor: number | null, result: IngestResult): void;
}

export interface SyncOutcome {
  readonly cursor: number | null;
  readonly held: IngestResult['held'];
  readonly closed: readonly ClosedTrade[];
  readonly batches: number;
}

// The first sync reaches back 90 days; later ones start a day before the cursor, since deal ids
// make the overlap harmless and a day covers clock rounding and late broker records.
export function syncWindow(cursor: number | null, serverNow: number): { from: number; to: number } {
  return { from: Math.max(0, cursor === null ? serverNow - BACKFILL_MS : cursor - OVERLAP_MS), to: serverNow + DAY };
}

export async function syncDeals(input: SyncInput, deps: SyncDeps): Promise<SyncOutcome> {
  const window = syncWindow(input.cursor, input.serverNow);
  const history = await deps.history(Math.floor(window.from / 1000), Math.ceil(window.to / 1000));
  const batches = dealBatches(input.cursor === null ? withoutOrphanExits(history.deals) : history.deals);
  const closed: ClosedTrade[] = [];
  let cursor = input.cursor;
  for (const deals of batches) {
    const result = await deps.post(ingestPayload(input.account, input.offsetMinutes, deals));
    if (input.cursor !== null) {
      const positions = closingPositions(deals, input.cursor);
      for (const trade of result.trades) {
        const symbol = positions.get(trade.positionId);
        if (symbol && !trade.isOpen && Number.isFinite(trade.netPnl)) closed.push({ key: trade.key, url: trade.url ?? null, symbol, netPnl: trade.netPnl });
      }
    }
    if (result.held) {
      // Nothing from the first held deal on was saved: the next attempt has to start there.
      cursor = result.held.fromTime;
      deps.progress(cursor, result);
      return { cursor, held: result.held, closed, batches: batches.indexOf(deals) + 1 };
    }
    cursor = Math.max(cursor ?? 0, deals[deals.length - 1].time);
    deps.progress(cursor, result);
  }
  cursor = Math.max(cursor ?? 0, input.serverNow);
  return { cursor, held: null, closed, batches: batches.length };
}
