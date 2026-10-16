import { EventEmitter } from 'node:events';
import type { JournalEntry, LinkState, TerminalEvent, TerminalMethod, TerminalMethods, Tick, TradeRequest, TradeSnapshot } from '../shared/protocol';
import type { CopierLinkState } from '../shared/automation';

// Returns why a trade request must not be sent, or null to send it.
export type TradeGate = (request: TradeRequest) => string | null;

export interface TradingLink extends EventEmitter {
  readonly loggedIn: boolean;
  state: LinkState;
  connect(endpoint: string): Promise<void>;
  disconnect(): void;
  setPollInterval(milliseconds: number): void;
  setTradeGate(gate: TradeGate | undefined): void;
  request<M extends TerminalMethod>(method: M, params: TerminalMethods[M][0]): Promise<TerminalMethods[M][1]>;
}

export interface SessionCredentials {
  login: number;
  password: string;
  endpoint: string;
}

const DEFAULT_POLL = 2_000;

// One broker session per account: the UI's link serves its active account, and
// every other account an engine needs gets its own background link. A second
// session on the same login would invalidate the first.
export class SessionPool extends EventEmitter {
  private uiAccount: string | null = null;
  private admit?: (accountId: string, request: TradeRequest) => string | null;
  private readonly background = new Map<string, TradingLink>();
  private readonly starting = new Map<string, Promise<TradingLink>>();
  private readonly users = new Map<string, Set<string>>();
  private readonly polls = new Map<string, number>();
  private readonly states = new Map<string, CopierLinkState>();

  constructor(
    private readonly ui: TradingLink,
    private readonly credentials: (accountId: string) => SessionCredentials | undefined,
    private readonly create: () => TradingLink,
  ) {
    super();
    ui.setTradeGate((request) => this.uiAccount ? this.admit?.(this.uiAccount, request) ?? null : null);
  }

  // One gate sees every trade request on every session, whichever engine or window sent it.
  setAdmission(admit: ((accountId: string, request: TradeRequest) => string | null) | undefined): void {
    this.admit = admit;
  }

  get activeAccount(): string | null { return this.uiAccount; }

  link(accountId: string): TradingLink | undefined {
    if (accountId === this.uiAccount) return this.ui.loggedIn ? this.ui : undefined;
    const link = this.background.get(accountId);
    return link?.loggedIn ? link : undefined;
  }

  require(accountId: string): TradingLink {
    const link = this.link(accountId);
    if (!link) throw new Error(`Account ${accountId.split('|').pop()} is not connected`);
    return link;
  }

  status(): CopierLinkState[] {
    const ids = new Set([...this.users.keys(), ...(this.uiAccount ? [this.uiAccount] : [])]);
    return [...ids].map((accountId) => accountId === this.uiAccount
      ? { accountId, state: this.ui.loggedIn ? 'connected' : 'connecting' }
      : this.states.get(accountId) ?? { accountId, state: 'idle' });
  }

  async acquire(accountId: string, user: string): Promise<TradingLink> {
    const users = this.users.get(accountId) ?? new Set();
    users.add(user);
    this.users.set(accountId, users);
    if (accountId === this.uiAccount) return this.ui;
    return this.ensure(accountId);
  }

  // Called after a password becomes available; failed sessions stay registered so
  // the UI can show them and offer to unlock.
  retry(accountId: string): Promise<TradingLink | undefined> {
    if (!this.users.get(accountId)?.size || accountId === this.uiAccount) return Promise.resolve(undefined);
    return this.ensure(accountId);
  }

  release(accountId: string, user: string): void {
    const users = this.users.get(accountId);
    users?.delete(user);
    if (users?.size) return;
    this.users.delete(accountId);
    this.polls.delete(accountId);
    this.close(accountId);
  }

  setPoll(accountId: string, milliseconds: number): void {
    this.polls.set(accountId, milliseconds);
    if (accountId === this.uiAccount) this.ui.setPollInterval(milliseconds);
    else this.background.get(accountId)?.setPollInterval(milliseconds);
  }

  async beforeUiLogin(accountId: string): Promise<void> {
    await this.starting.get(accountId)?.catch(() => undefined);
    this.close(accountId);
  }

  afterUiChange(accountId: string | null, previous: string | null): void {
    this.uiAccount = accountId;
    this.ui.setPollInterval(accountId ? this.polls.get(accountId) ?? DEFAULT_POLL : DEFAULT_POLL);
    if (accountId) this.setState({ accountId, state: 'connected' });
    if (previous && previous !== accountId && this.users.get(previous)?.size) {
      void this.ensure(previous).catch(() => undefined);
    }
  }

  forwardUi(event: TerminalEvent, data: unknown): void {
    if (this.uiAccount) this.dispatch(this.uiAccount, event, data);
  }

  shutdown(): void {
    for (const accountId of [...this.background.keys()]) this.close(accountId);
    this.users.clear();
  }

  private dispatch(accountId: string, event: TerminalEvent, data: unknown): void {
    if (event === 'trade') this.emit('trade', accountId, data as TradeSnapshot);
    else if (event === 'tick') this.emit('tick', accountId, data as Tick);
    else if (event === 'journal') this.emit('journal', accountId, data as JournalEntry);
  }

  private setState(state: CopierLinkState): void {
    this.states.set(state.accountId, state);
    this.emit('state', state);
  }

  private close(accountId: string): void {
    const link = this.background.get(accountId);
    if (!link) return;
    this.background.delete(accountId);
    link.removeAllListeners();
    link.disconnect();
    this.setState({ accountId, state: 'idle' });
  }

  private ensure(accountId: string): Promise<TradingLink> {
    const existing = this.background.get(accountId);
    if (existing?.loggedIn) return Promise.resolve(existing);
    const pending = this.starting.get(accountId);
    if (pending) return pending;
    const work = this.start(accountId).finally(() => this.starting.delete(accountId));
    this.starting.set(accountId, work);
    return work;
  }

  private async start(accountId: string): Promise<TradingLink> {
    const credentials = this.credentials(accountId);
    if (!credentials) {
      const error = 'Password unavailable: connect this account once or save its password securely';
      this.setState({ accountId, state: 'failed', error });
      throw new Error(error);
    }
    this.close(accountId);
    const link = this.create();
    link.setTradeGate((request) => this.admit?.(accountId, request) ?? null);
    this.background.set(accountId, link);
    link.on('event', (event: TerminalEvent, data: unknown) => {
      if (this.background.get(accountId) !== link) return;
      if (event === 'link') {
        const state = data as LinkState;
        if (state.state === 'open' && link.loggedIn) this.setState({ accountId, state: 'connected' });
        else if (state.state !== 'open') this.setState({ accountId, state: 'connecting', error: state.error });
      }
      this.dispatch(accountId, event, data);
    });
    this.setState({ accountId, state: 'connecting' });
    try {
      await link.connect(credentials.endpoint);
      await link.request('account.login', { login: credentials.login, password: credentials.password });
      link.setPollInterval(this.polls.get(accountId) ?? DEFAULT_POLL);
      this.setState({ accountId, state: 'connected' });
      this.emit('trade', accountId, await link.request('trade.snapshot', {}));
      return link;
    } catch (error) {
      if (this.background.get(accountId) === link) {
        this.background.delete(accountId);
        link.removeAllListeners();
        link.disconnect();
      }
      this.setState({ accountId, state: 'failed', error: (error as Error).message });
      throw error;
    }
  }
}
