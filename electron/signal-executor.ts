import type { WebhookSource } from '../shared/automation';
import type { Order, Position, TradeRequest, TradeResult } from '../shared/protocol';
import type { RiskMode } from '../shared/risk';
import { distanceToPrice, floorToStep } from '../shared/risk';
import type { SessionPool, TradingLink } from './session-pool';
import type { SignalOwnership } from './signal-ownership';
import type { TradeManager } from './trade-manager';
import { mapSymbol, pendingTypes, signalActions, type Signal } from './webhook-signal';
import { isListedSymbol, matchSymbol } from '../shared/symbol-match';

export interface Execution {
  status: 'executed' | 'failed' | 'dryRun';
  symbol: string;
  message: string;
  results: TradeResult[];
}

export class SignalRejected extends Error {}

export class SignalExecutor {
  constructor(private readonly pool: SessionPool, private readonly manager: TradeManager, private readonly ownership: SignalOwnership, private readonly now = () => Date.now()) {}

  private async inScope(source: WebhookSource, positions: readonly Position[], orders: readonly Order[]): Promise<(item: Position | Order) => boolean> {
    await this.ownership.prune(source.id, new Set([...positions, ...orders].map((item) => item.ticket)));
    const owned = new Set<number>();
    for (const item of [...positions, ...orders]) if (await this.ownership.owns(source.id, item.ticket)) owned.add(item.ticket);
    return (item) => owned.has(item.ticket);
  }

  // Signals name plain instruments (EURUSD); prefixed and suffixed brokers list them decorated.
  private async brokerSymbol(link: TradingLink, symbol: string): Promise<string> {
    try {
      await link.request('symbols.info', { symbol });
      return symbol;
    } catch {
      const match = matchSymbol(symbol, (await link.request('symbols.list', {})).map((spec) => spec.name));
      if (!match) throw new SignalRejected(`The broker has no symbol ${symbol}; add a symbol mapping`);
      await link.request('symbols.info', { symbol: match });
      return match;
    }
  }

  async execute(source: WebhookSource, signal: Signal): Promise<Execution> {
    if (source.allowedActions.length && !source.allowedActions.includes(signal.action)) throw new SignalRejected(`Action "${signal.action}" is not allowed for this source`);
    const mapped = mapSymbol(signal.symbol, source.symbolMap, source.symbolSuffix);
    const link = this.pool.require(source.accountId);
    const symbol = mapped && await this.brokerSymbol(link, mapped);
    if (symbol && source.allowedSymbols.length && !source.allowedSymbols.some((allowed) => isListedSymbol(allowed, symbol))) throw new SignalRejected(`${symbol} is not in this source's allowed symbols`);
    const isOpening = signalActions.find((item) => item.key === signal.action)!.isOpening;
    if (isOpening) return this.open(source, signal, symbol);
    const snapshot = await link.request('trade.snapshot', {});
    const isOwned = await this.inScope(source, snapshot.positions, snapshot.orders);
    const inScope = (item: Position | Order) => (signal.scope === 'symbol' || isOwned(item)) && (!symbol || item.symbol === symbol) && (!signal.ticket || item.ticket === signal.ticket);
    const positions = snapshot.positions.filter(inScope).filter((position) =>
      signal.action === 'close_buy' ? position.side === 'buy' : signal.action === 'close_sell' ? position.side === 'sell' : true);
    const orders = snapshot.orders.filter(inScope);
    const requests: TradeRequest[] = [];
    switch (signal.action) {
      case 'close': case 'close_buy': case 'close_sell': case 'close_all':
        for (const position of positions) {
          const spec = await link.request('symbols.info', { symbol: position.symbol });
          let volume = signal.closePercent ? floorToStep(position.volume * signal.closePercent / 100, spec.volumeStep) : position.volume;
          if (position.volume - volume < spec.volumeMin - 1e-9) volume = position.volume;
          if (volume >= spec.volumeMin - 1e-9) requests.push({ action: 'deal', symbol: position.symbol, position: position.ticket, volume, type: position.side === 'buy' ? 'sell' : 'buy' });
        }
        break;
      case 'cancel': case 'cancel_all':
        for (const order of orders) requests.push({ action: 'remove', order: order.ticket });
        break;
      case 'breakeven':
        for (const position of positions) {
          const direction = position.side === 'buy' ? 1 : -1;
          if (direction * (position.priceCurrent - position.priceOpen) > 0 && (!position.sl || direction * (position.priceOpen - position.sl) > 0)) requests.push({ action: 'sltp', symbol: position.symbol, position: position.ticket, sl: position.priceOpen, tp: position.tp });
        }
        break;
      case 'modify':
        if (!signal.stop && !signal.targets.length) throw new SignalRejected('modify needs sl and/or tp');
        for (const position of positions) {
          const spec = await link.request('symbols.info', { symbol: position.symbol });
          const sl = signal.stop ? distanceToPrice(position.side, position.priceOpen, signal.stop.value, signal.stop.unit, spec, true) : position.sl;
          const tp = signal.targets[0] ? distanceToPrice(position.side, position.priceOpen, signal.targets[0].value, signal.targets[0].unit, spec, false) : position.tp;
          requests.push({ action: 'sltp', symbol: position.symbol, position: position.ticket, sl, tp });
        }
        break;
    }
    if (!requests.length) return { status: 'executed', symbol, message: `Nothing to ${signal.action}: no matching ${signal.action.startsWith('cancel') ? 'orders' : 'positions'} in scope`, results: [] };
    if (source.isDryRun) return { status: 'dryRun', symbol, message: `Dry run: would send ${requests.length} request(s)`, results: [] };
    const results: TradeResult[] = [];
    for (const request of requests) {
      try { results.push(await link.request('order.send', request)); }
      catch (error) { results.push({ retcode: 0, isSuccess: false, comment: (error as Error).message }); }
    }
    const failed = results.filter((result) => !result.isSuccess).length;
    return { status: failed ? 'failed' : 'executed', symbol, message: `${signal.action}: ${results.length - failed} of ${results.length} succeeded`, results };
  }

  private async open(source: WebhookSource, signal: Signal, symbol: string): Promise<Execution> {
    let action = signal.action;
    const results: TradeResult[] = [];
    if (action === 'reverse') {
      const link = this.pool.require(source.accountId);
      const snapshot = await link.request('trade.snapshot', {});
      const isOwned = await this.inScope(source, snapshot.positions, snapshot.orders);
      const current = snapshot.positions.filter((position) => position.symbol === symbol && (signal.scope === 'symbol' || isOwned(position)));
      if (!current.length) throw new SignalRejected(`No ${symbol} position in scope to reverse`);
      action = current[0].side === 'buy' ? 'sell' : 'buy';
      if (!source.isDryRun) {
        for (const position of current) {
          try { results.push(await link.request('order.send', { action: 'deal', symbol, position: position.ticket, volume: position.volume, type: position.side === 'buy' ? 'sell' : 'buy' })); }
          catch (error) { results.push({ retcode: 0, isSuccess: false, comment: (error as Error).message }); }
        }
        if (results.some((result) => !result.isSuccess)) return { status: 'failed', symbol, message: 'Reverse stopped: closing the current position failed', results };
      }
    }
    const type = pendingTypes[action];
    if (!type) throw new SignalRejected(`Cannot open from action ${action}`);
    const stop = signal.stop ?? source.defaultStop;
    if (source.isStopRequired && !stop) throw new SignalRejected('This source requires a stop loss on every entry');
    let mode: RiskMode;
    let value: number;
    if (source.sizing.mode === 'signal') {
      if (signal.lots) { mode = 'lots'; value = signal.lots; }
      else if (signal.riskPercent) { mode = 'percentBalance'; value = signal.riskPercent; }
      else if (signal.riskMoney) { mode = 'money'; value = signal.riskMoney; }
      else throw new SignalRejected('The signal must include volume, risk or risk_money');
    } else {
      mode = source.sizing.mode;
      value = source.sizing.value;
    }
    const outcome = await this.manager.placeRisk({
      accountId: source.accountId, type, mode, value, symbol, price: signal.price,
      stopLoss: stop, takeProfitR: signal.targetR.length ? signal.targetR : undefined,
      takeProfits: signal.targets.length ? signal.targets.map((distance) => ({ distance, share: 100 / signal.targets.length })) : undefined,
      comment: (signal.comment ?? '').slice(0, 31),
      maxLots: source.sizing.maxLots || undefined,
      expiration: signal.expirationMinutes ? Math.floor(this.now() / 1000) + Math.round(signal.expirationMinutes * 60) : undefined,
      management: { trailing: signal.trailing, breakEvenR: signal.breakEvenR },
      isDryRun: source.isDryRun,
    });
    results.push(...outcome.results);
    if (!outcome.isDryRun) await this.ownership.add(source.id, outcome.results.filter((result) => result.isSuccess && result.order).map((result) => result.order!));
    const failed = outcome.results.filter((result) => !result.isSuccess).length;
    const summary = `${action} ${outcome.lots} ${symbol} at ${outcome.entry}${outcome.stopLoss ? ` sl ${outcome.stopLoss}` : ''}${outcome.takeProfits.some(Boolean) ? ` tp ${outcome.takeProfits.filter(Boolean).join('/')}` : ''}, risk ${Number.isFinite(outcome.riskMoney) ? outcome.riskMoney.toFixed(2) : 'unlimited'}`;
    if (outcome.isDryRun) return { status: 'dryRun', symbol, message: `Dry run: ${summary}`, results };
    return { status: failed ? 'failed' : 'executed', symbol, message: failed ? `${summary}; ${failed} leg(s) failed` : summary, results };
  }
}
