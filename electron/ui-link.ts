import { EventEmitter } from 'node:events';
import type { Account, LinkState, TerminalMethod, TerminalMethods } from '../shared/protocol';
import type { SessionCredentials, TradeGate, TradingLink } from './session-pool';

// The window's session. It forwards to whichever platform's link serves the active account,
// so the session pool and every IPC handler keep one stable object across platform changes.
export class UiLink extends EventEmitter implements TradingLink {
  private pollInterval = 2_000;
  private gate?: TradeGate;
  private current: TradingLink;
  private readonly forward = (event: string, data: unknown) => this.emit('event', event, data);

  constructor(initial: TradingLink) {
    super();
    this.current = initial;
    initial.on('event', this.forward);
  }

  get link(): TradingLink { return this.current; }
  get loggedIn(): boolean { return this.current.loggedIn; }
  get state(): LinkState { return this.current.state; }

  // The previous link is disconnected; its late events no longer reach the window.
  use(link: TradingLink): void {
    if (link === this.current) return;
    this.current.off('event', this.forward);
    this.current.disconnect();
    this.current = link;
    link.on('event', this.forward);
    link.setTradeGate(this.gate);
    link.setPollInterval(this.pollInterval);
  }

  signIn(credentials: SessionCredentials): Promise<Account> { return this.current.signIn(credentials); }

  disconnect(): void { this.current.disconnect(); }

  setPollInterval(milliseconds: number): void {
    this.pollInterval = milliseconds;
    this.current.setPollInterval(milliseconds);
  }

  setTradeGate(gate: TradeGate | undefined): void {
    this.gate = gate;
    this.current.setTradeGate(gate);
  }

  request<M extends TerminalMethod>(method: M, params: TerminalMethods[M][0]): Promise<TerminalMethods[M][1]> {
    return this.current.request(method, params);
  }
}
