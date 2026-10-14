export type OwnedTickets = Record<string, number[]>;

export interface TicketStore {
  load(): Promise<OwnedTickets>;
  save(value: OwnedTickets): Promise<void>;
}

export function parseOwnedTickets(value: unknown): OwnedTickets {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
    .map(([source, tickets]) => [source, tickets.filter((ticket): ticket is number => Number.isSafeInteger(ticket) && (ticket as number) > 0)]));
}

// Which orders each webhook source opened. An MT5 position keeps the ticket of the order that
// opened it, so one record covers a pending order and the position it becomes. Kept locally so
// trades carry no tag of their own, exactly like orders placed by hand in MT5.
export class SignalOwnership {
  private owned: OwnedTickets = {};
  private isLoaded = false;

  constructor(private readonly store: TicketStore) {}

  async owns(sourceId: string, ticket: number): Promise<boolean> {
    await this.load();
    return this.owned[sourceId]?.includes(ticket) ?? false;
  }

  async add(sourceId: string, tickets: readonly number[]): Promise<void> {
    const fresh = tickets.filter((ticket) => Number.isSafeInteger(ticket) && ticket > 0);
    if (!fresh.length) return;
    await this.load();
    this.owned = { ...this.owned, [sourceId]: [...new Set([...(this.owned[sourceId] ?? []), ...fresh])] };
    await this.store.save(this.owned);
  }

  async prune(sourceId: string, live: ReadonlySet<number>): Promise<void> {
    await this.load();
    const current = this.owned[sourceId] ?? [];
    const kept = current.filter((ticket) => live.has(ticket));
    if (kept.length === current.length) return;
    this.owned = { ...this.owned, [sourceId]: kept };
    await this.store.save(this.owned);
  }

  private async load(): Promise<void> {
    if (this.isLoaded) return;
    this.owned = await this.store.load();
    this.isLoaded = true;
  }
}
