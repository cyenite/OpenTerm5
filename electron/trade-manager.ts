import { EventEmitter } from 'node:events';
import { orderType } from '../shared/protocol';
import type { Account, Position, SymbolSpec, TradeRequest, TradeResult, TradeSnapshot } from '../shared/protocol';
import type { AccountGuard, BulkOutcome, BulkRequest, GuardState, PositionRule, RequestCount, RiskOrderOutcome, RiskOrderRequest } from '../shared/automation';
import { parseGuard } from '../shared/automation';
import type { NewsEvent, NewsImpact } from '../shared/news';
import { symbolCurrencies } from '../shared/news';
import { distanceToPrice, floorToStep, planRisk } from '../shared/risk';
import { dayReference, lossBases, tradingDayKey } from '../shared/trading-day';
import type { SessionPool, TradingLink } from './session-pool';

export interface ManagerState {
  rules: PositionRule[];
  guards: AccountGuard[];
  guardStates: GuardState[];
  requestCounts: RequestCount[];
}

export interface NewsSource {
  isCovering(time: number): boolean;
  blackout(currencies: readonly string[], time: number, beforeMs: number, afterMs: number, minimum: NewsImpact): NewsEvent | undefined;
}

export interface ManagerStore {
  load(): Promise<ManagerState>;
  save(state: ManagerState): Promise<void>;
}

const MAX_FAILURES = 3;
const PENDING_RULE_DAYS = 30;
const REQUEST_WARNING_SHARE = 0.8;

const unknownOutcome = (error: unknown): TradeResult => ({ retcode: 0, isSuccess: false, comment: (error as Error).message });
const loginOf = (accountId: string) => accountId.split('|').pop();
const clockTime = (time: number) => new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const isExitRequest = (request: TradeRequest) => request.action === 'remove' || request.action === 'closeBy' || request.action === 'deal' && !!request.position;

export class TradeManager extends EventEmitter {
  private rules: PositionRule[] = [];
  private guards: AccountGuard[] = [];
  private guardStates = new Map<string, GuardState>();
  private requestCounts = new Map<string, RequestCount>();
  private readonly busy = new Set<string>();
  private readonly failures = new Map<string, number>();
  private readonly specs = new Map<string, SymbolSpec>();
  private readonly snapshots = new Map<string, TradeSnapshot>();
  private readonly closingAll = new Set<string>();

  constructor(
    private readonly pool: SessionPool,
    private readonly store: ManagerStore,
    private readonly journal: (message: string) => void,
    private readonly now = () => Date.now(),
    private readonly news?: NewsSource,
  ) {
    super();
  }

  async init(): Promise<void> {
    const state = await this.store.load();
    this.rules = state.rules;
    this.guards = state.guards.map(parseGuard);
    this.guardStates = new Map(state.guardStates.map((entry) => [entry.accountId, { ...entry, dayStartBalance: entry.dayStartBalance ?? entry.dayStartEquity }]));
    this.requestCounts = new Map((state.requestCounts ?? []).map((entry) => [entry.accountId, entry]));
    this.pool.on('trade', (accountId: string, snapshot: TradeSnapshot) => void this.onTrade(accountId, snapshot));
  }

  state(): ManagerState {
    return { rules: this.rules, guards: this.guards, guardStates: [...this.guardStates.values()], requestCounts: [...this.requestCounts.values()] };
  }

  account(accountId: string): Account | null {
    return this.snapshots.get(accountId)?.account ?? null;
  }

  private enabledGuard(accountId: string): AccountGuard | undefined {
    return this.guards.find((item) => item.accountId === accountId && item.isEnabled);
  }

  // Without a guard, requests are counted per broker server day.
  private tradingDay(accountId: string, guard = this.enabledGuard(accountId)): string {
    const offset = this.snapshots.get(accountId)?.account?.utcOffsetSeconds;
    return guard ? tradingDayKey(this.now(), guard.resetZone, guard.resetHour, offset) : tradingDayKey(this.now(), 'server', 0, offset);
  }

  private requestsToday(accountId: string, guard?: AccountGuard): number {
    const entry = this.requestCounts.get(accountId);
    return entry?.dayKey === this.tradingDay(accountId, guard) ? entry.count : 0;
  }

  // Every order.send from any source passes through here before it is sent. Exits stay
  // allowed past the limit so a position can always be closed.
  admit(accountId: string, request: TradeRequest): string | null {
    const guard = this.enabledGuard(accountId);
    const limit = guard?.maxDailyRequests;
    const count = this.requestsToday(accountId, guard);
    const isExit = isExitRequest(request);
    if (limit && count >= limit && !isExit) return `Daily limit of ${limit} trade requests reached on ${loginOf(accountId)}. Closing positions and deleting orders still work; everything else waits for the next trading day.`;
    const next = count + 1;
    this.requestCounts.set(accountId, { accountId, dayKey: this.tradingDay(accountId, guard), count: next });
    if (limit && next > limit) this.journal(`Trade request ${next} sent on ${loginOf(accountId)} over the daily limit of ${limit}, because it closes a position or deletes an order.`);
    else if (limit && next === Math.ceil(limit * REQUEST_WARNING_SHARE)) this.journal(`${next} of ${limit} daily trade requests used on ${loginOf(accountId)}.`);
    this.persist();
    return null;
  }

  private persist(): void {
    void this.store.save(this.state()).catch((error: Error) => this.journal(`Trade manager state was not saved: ${error.message}`));
    this.emit('changed', this.state());
  }

  setRule(rule: PositionRule): void {
    this.rules = [...this.rules.filter((item) => !(item.accountId === rule.accountId && item.ticket === rule.ticket)), { ...rule, isPaused: false, error: undefined }];
    this.failures.delete(`${rule.accountId}:${rule.ticket}`);
    this.persist();
  }

  removeRule(accountId: string, ticket: number): void {
    this.rules = this.rules.filter((rule) => !(rule.accountId === accountId && rule.ticket === ticket));
    this.persist();
  }

  setGuard(guard: AccountGuard): void {
    const parsed = parseGuard(guard);
    this.guards = [...this.guards.filter((item) => item.accountId !== guard.accountId), parsed];
    this.persist();
  }

  resetGuard(accountId: string): void {
    const state = this.guardStates.get(accountId);
    if (state) this.guardStates.set(accountId, { ...state, trippedAt: undefined, reason: undefined, peakEquity: this.snapshots.get(accountId)?.account?.equity ?? state.peakEquity });
    this.persist();
  }

  // Opening trades from any source (manual, risk ticket, webhook, copier) pass
  // through here, so a tripped guard blocks them all.
  async canOpen(accountId: string, symbol?: string, lots = 0): Promise<string | null> {
    const guard = this.enabledGuard(accountId);
    if (!guard) return null;
    const state = this.guardStates.get(accountId);
    if (state?.trippedAt) return `Equity guard tripped: ${state.reason}. Reset it in Automation to trade again.`;
    const positions = this.snapshots.get(accountId)?.positions ?? [];
    if (guard.maxOpenPositions && positions.length >= guard.maxOpenPositions) return `Equity guard allows at most ${guard.maxOpenPositions} open positions.`;
    if (guard.maxLotsPerSymbol && symbol) {
      const open = positions.filter((position) => position.symbol === symbol).reduce((sum, position) => sum + position.volume, 0);
      if (open + lots > guard.maxLotsPerSymbol + 1e-9) return `Equity guard allows at most ${guard.maxLotsPerSymbol} lots on ${symbol}.`;
    }
    if (guard.maxDailyRequests && this.requestsToday(accountId, guard) >= guard.maxDailyRequests) return `Daily limit of ${guard.maxDailyRequests} trade requests reached.`;
    const beforeMs = (guard.newsMinutesBefore ?? 0) * 60_000;
    const afterMs = (guard.newsMinutesAfter ?? 0) * 60_000;
    if (symbol && this.news && (beforeMs || afterMs)) {
      const link = this.pool.link(accountId);
      const spec = link ? await this.spec(link, accountId, symbol).catch(() => undefined) : undefined;
      const event = this.news.blackout(symbolCurrencies(symbol, spec), this.now(), beforeMs, afterMs, guard.newsImpact);
      if (event) return `News blackout for ${symbol}: ${event.currency} ${event.title} at ${clockTime(event.time)}. New trades open again at ${clockTime(event.time + afterMs)}.`;
    }
    return null;
  }

  private async spec(link: TradingLink, accountId: string, symbol: string): Promise<SymbolSpec> {
    const key = `${accountId}|${symbol}`;
    const cached = this.specs.get(key);
    if (cached) return cached;
    const spec = await link.request('symbols.info', { symbol });
    this.specs.set(key, spec);
    return spec;
  }

  private async onTrade(accountId: string, snapshot: TradeSnapshot): Promise<void> {
    this.snapshots.set(accountId, snapshot);
    this.checkGuard(accountId, snapshot);
    const open = new Set(snapshot.positions.map((position) => position.ticket));
    const pendingTickets = new Set(snapshot.orders.map((order) => order.ticket));
    const expiry = this.now() - PENDING_RULE_DAYS * 86_400_000;
    const before = this.rules.length;
    this.rules = this.rules.filter((rule) => rule.accountId !== accountId || open.has(rule.ticket) || pendingTickets.has(rule.ticket) && rule.createdAt > expiry);
    if (this.rules.length !== before) this.persist();
    for (const position of snapshot.positions) {
      const rule = this.rules.find((item) => item.accountId === accountId && item.ticket === position.ticket);
      if (rule && !rule.isPaused) void this.evaluate(accountId, rule, position);
    }
  }

  private async evaluate(accountId: string, rule: PositionRule, position: Position): Promise<void> {
    const key = `${accountId}:${rule.ticket}`;
    if (this.busy.has(key) || !(position.priceCurrent > 0)) return;
    this.busy.add(key);
    try {
      const link = this.pool.require(accountId);
      const spec = await this.spec(link, accountId, position.symbol);
      const direction = position.side === 'buy' ? 1 : -1;
      const price = position.priceCurrent;
      const profitPoints = direction * (price - position.priceOpen) / spec.point;
      const close = (volume: number, why: string) => this.act(key, rule, `${why}: close ${volume} ${position.symbol} #${position.ticket}`, () => link.request('order.send', { action: 'deal', symbol: position.symbol, position: position.ticket, volume, type: position.side === 'buy' ? 'sell' : 'buy' }));
      if (rule.virtualStop && direction * (price - rule.virtualStop) <= 0) return void await close(position.volume, 'Hidden stop loss');
      if (rule.virtualTarget && direction * (price - rule.virtualTarget) >= 0) return void await close(position.volume, 'Hidden take profit');
      if (rule.closeAt && this.now() >= rule.closeAt) return void await close(position.volume, 'Time exit');
      const partial = rule.partials.filter((item) => !item.isDone).sort((left, right) => left.points - right.points)[0];
      if (partial && profitPoints >= partial.points) {
        let volume = Math.min(position.volume, floorToStep(rule.initialVolume * partial.percent / 100, spec.volumeStep));
        if (position.volume - volume < spec.volumeMin - 1e-9) volume = position.volume;
        if (volume >= spec.volumeMin - 1e-9 && await close(volume, `Partial take profit at ${partial.points} points`)) {
          this.rules = this.rules.map((item) => item === rule ? { ...rule, partials: rule.partials.map((entry) => entry === partial ? { ...entry, isDone: true } : entry) } : item);
          this.persist();
        }
        return;
      }
      const minimumGap = Math.max(spec.stopsLevel, 0) * spec.point;
      const modify = (sl: number, why: string) => this.act(key, rule, `${why}: #${position.ticket} stop to ${sl.toFixed(spec.digits)}`, () => link.request('order.send', { action: 'sltp', symbol: position.symbol, position: position.ticket, sl, tp: position.tp }));
      if (rule.breakEven && !rule.breakEven.isDone && profitPoints >= rule.breakEven.triggerPoints) {
        const target = Number((position.priceOpen + direction * rule.breakEven.lockPoints * spec.point).toFixed(spec.digits));
        const isBetter = !position.sl || direction * (target - position.sl) > spec.point / 2;
        if (isBetter && direction * (price - target) >= minimumGap && await modify(target, 'Break-even')) {
          this.rules = this.rules.map((item) => item === rule ? { ...rule, breakEven: { ...rule.breakEven!, isDone: true } } : item);
          this.persist();
        } else if (!isBetter) {
          this.rules = this.rules.map((item) => item === rule ? { ...rule, breakEven: { ...rule.breakEven!, isDone: true } } : item);
        }
        return;
      }
      if (rule.trailing && profitPoints >= rule.trailing.startPoints) {
        const target = Number((price - direction * rule.trailing.distancePoints * spec.point).toFixed(spec.digits));
        const step = Math.max(1, rule.trailing.stepPoints) * spec.point;
        if ((!position.sl || direction * (target - position.sl) >= step - spec.point / 2) && direction * (price - target) >= minimumGap) await modify(target, 'Trailing stop');
      }
    } catch (error) {
      this.fail(rule, key, (error as Error).message, false);
    } finally {
      this.busy.delete(key);
    }
  }

  private async act(key: string, rule: PositionRule, description: string, work: () => Promise<TradeResult>): Promise<boolean> {
    let result: TradeResult;
    try { result = await work(); }
    catch (error) {
      // An unknown outcome must not be retried automatically: pause the rule and
      // let the trader reconcile against the broker.
      this.fail(rule, key, `${description} outcome unknown: ${(error as Error).message}`, true);
      return false;
    }
    if (result.isSuccess) {
      this.failures.delete(key);
      this.journal(`${description} done`);
      return true;
    }
    this.fail(rule, key, `${description} rejected: ${result.comment} (${result.retcode})`, false);
    return false;
  }

  private fail(rule: PositionRule, key: string, message: string, isFatal: boolean): void {
    const count = (this.failures.get(key) ?? 0) + 1;
    this.failures.set(key, count);
    const isPaused = isFatal || count >= MAX_FAILURES;
    this.rules = this.rules.map((item) => item.accountId === rule.accountId && item.ticket === rule.ticket ? { ...item, error: message, isPaused } : item);
    this.journal(isPaused ? `${message}. Management of #${rule.ticket} is paused.` : message);
    this.persist();
  }

  private checkGuard(accountId: string, snapshot: TradeSnapshot): void {
    const guard = this.enabledGuard(accountId);
    const equity = snapshot.account?.equity;
    const balance = snapshot.account?.balance;
    if (!guard || equity === undefined || !Number.isFinite(equity)) return;
    const today = this.tradingDay(accountId, guard);
    let state = this.guardStates.get(accountId);
    if (!state || state.dayKey !== today) {
      const isDrawdownTrip = state?.reason?.startsWith('drawdown');
      state = {
        accountId, dayKey: today, dayStartedAt: this.now(), dayStartEquity: equity, dayStartBalance: balance !== undefined && Number.isFinite(balance) ? balance : equity,
        peakEquity: Math.max(equity, state?.peakEquity ?? equity), ...(isDrawdownTrip ? { trippedAt: state!.trippedAt, reason: state!.reason } : {}),
      };
      this.guardStates.set(accountId, state);
      this.persist();
    }
    if (equity > state.peakEquity) state.peakEquity = equity;
    if (state.trippedAt) return;
    const reference = dayReference(guard.lossBasis, state.dayStartBalance, state.dayStartEquity);
    const loss = reference - equity;
    const basis = lossBases.find((item) => item.key === guard.lossBasis)!.label.toLowerCase();
    const reason =
      guard.dailyLossMoney && loss >= guard.dailyLossMoney ? `daily loss ${loss.toFixed(2)} reached the ${guard.dailyLossMoney} limit` :
      guard.dailyLossPercent && loss >= reference * guard.dailyLossPercent / 100 ? `daily loss reached ${guard.dailyLossPercent}% of the ${basis}` :
      guard.maxDrawdownPercent && state.peakEquity - equity >= state.peakEquity * guard.maxDrawdownPercent / 100 ? `drawdown reached ${guard.maxDrawdownPercent}% from the equity peak` :
      guard.dailyProfitMoney && -loss >= guard.dailyProfitMoney ? `daily profit target ${guard.dailyProfitMoney} reached` : undefined;
    if (!reason) return;
    this.guardStates.set(accountId, { ...state, trippedAt: this.now(), reason });
    this.journal(`Equity guard tripped on ${loginOf(accountId)}: ${reason}. New trades are blocked.`);
    this.emit('tripped', accountId, reason);
    this.persist();
    if (guard.action === 'closeAll' && !this.closingAll.has(accountId)) {
      this.closingAll.add(accountId);
      void Promise.all([this.bulk({ accountId, kind: 'closeAll' }), this.bulk({ accountId, kind: 'deletePending' })])
        .catch((error: Error) => this.journal(`Guard close-all failed: ${error.message}`))
        .finally(() => this.closingAll.delete(accountId));
    }
  }

  private resolveAccount(accountId?: string): string {
    const id = accountId ?? this.pool.activeAccount;
    if (!id) throw new Error('No account is connected');
    return id;
  }

  async bulk(request: BulkRequest): Promise<BulkOutcome[]> {
    const accountId = this.resolveAccount(request.accountId);
    const link = this.pool.require(accountId);
    const snapshot = await link.request('trade.snapshot', {});
    const outcomes: BulkOutcome[] = [];
    const send = async (ticket: number, symbol: string, trade: TradeRequest) => {
      let result: TradeResult;
      try { result = await link.request('order.send', trade); }
      catch (error) { result = unknownOutcome(error); }
      outcomes.push({ ticket, symbol, result });
      return result;
    };
    const closing = (position: Position) => send(position.ticket, position.symbol, { action: 'deal', symbol: position.symbol, position: position.ticket, volume: position.volume, type: position.side === 'buy' ? 'sell' : 'buy' });
    const filters: Partial<Record<BulkRequest['kind'], (position: Position) => boolean>> = {
      closeAll: () => true,
      closeProfitable: (position) => position.profit + position.swap > 0,
      closeLosing: (position) => position.profit + position.swap < 0,
      closeBuys: (position) => position.side === 'buy',
      closeSells: (position) => position.side === 'sell',
      closeSymbol: (position) => position.symbol === request.symbol,
    };
    // A symbol narrows every kind to that symbol's positions and orders.
    const isListed = (item: { symbol: string }) => !request.symbol || item.symbol === request.symbol;
    const positions = snapshot.positions.filter(isListed);
    const filter = filters[request.kind];
    if (filter) {
      await Promise.all(positions.filter(filter).map(closing));
    } else if (request.kind === 'deletePending') {
      await Promise.all(snapshot.orders.filter(isListed).map((order) => send(order.ticket, order.symbol, { action: 'remove', order: order.ticket })));
    } else if (request.kind === 'breakEvenAll') {
      for (const position of positions) {
        const spec = await this.spec(link, accountId, position.symbol);
        const direction = position.side === 'buy' ? 1 : -1;
        const isAhead = direction * (position.priceCurrent - position.priceOpen) >= Math.max(spec.stopsLevel, 1) * spec.point;
        const isImproved = !position.sl || direction * (position.priceOpen - position.sl) > 0;
        if (isAhead && isImproved) await send(position.ticket, position.symbol, { action: 'sltp', symbol: position.symbol, position: position.ticket, sl: position.priceOpen, tp: position.tp });
      }
    } else if (request.kind === 'reverse') {
      const position = snapshot.positions.find((item) => item.ticket === request.ticket);
      if (!position) throw new Error('Position is no longer open');
      const blocked = await this.canOpen(accountId, position.symbol, 0);
      if (blocked) throw new Error(blocked);
      const closed = await closing(position);
      if (closed.isSuccess) await send(position.ticket, position.symbol, { action: 'deal', symbol: position.symbol, volume: position.volume, type: position.side === 'buy' ? 'sell' : 'buy', comment: position.comment });
    }
    const failed = outcomes.filter((outcome) => !outcome.result.isSuccess).length;
    this.journal(`${request.kind}: ${outcomes.length - failed} done, ${failed} failed`);
    return outcomes;
  }

  async placeRisk(request: RiskOrderRequest): Promise<RiskOrderOutcome> {
    const accountId = this.resolveAccount(request.accountId);
    const link = this.pool.require(accountId);
    const definition = orderType(request.type);
    if (!definition) throw new Error('Unknown order type');
    const side = definition.isBuy ? 'buy' : 'sell';
    const [spec, valuation, quote, account] = await Promise.all([
      this.spec(link, accountId, request.symbol),
      link.request('symbols.valuation', { symbol: request.symbol }),
      link.request('symbols.quote', { symbol: request.symbol }),
      link.request('account.info', {}),
    ]);
    if (!account) throw new Error('Account information is unavailable');
    const entry = definition.isPending ? request.price ?? 0 : side === 'buy' ? quote.ask : quote.bid;
    if (definition.isPending && !(entry > 0)) throw new Error('Pending orders need a price');
    const stopLoss = request.stopLoss && request.stopLoss.value > 0 ? distanceToPrice(side, entry, request.stopLoss.value, request.stopLoss.unit, spec, true) : 0;
    const riskDistance = stopLoss ? Math.abs(entry - stopLoss) : 0;
    const targets = request.takeProfitR?.length
      ? request.takeProfitR.map((multiple, index, all) => ({ price: Number((entry + (side === 'buy' ? 1 : -1) * multiple * riskDistance).toFixed(spec.digits)), share: 100 / all.length }))
      : (request.takeProfits ?? []).filter((target) => target.distance.value > 0).map((target) => ({ price: distanceToPrice(side, entry, target.distance.value, target.distance.unit, spec, false), share: target.share }));
    if (request.takeProfitR?.length && !riskDistance) throw new Error('R-multiple targets need a stop loss');
    const plan = planRisk({
      side, entry, stopLoss, mode: request.mode, value: request.value, limits: spec, takeProfits: targets,
      balance: account.balance, equity: Number.isFinite(account.equity) ? account.equity : account.balance,
      moneyPerUnit: valuation.moneyPerUnit, maxLots: request.maxLots, commissionPerLot: request.commissionPerLot,
    });
    if (!plan.isValid) throw new Error(plan.warnings.join(' '));
    const outcome: RiskOrderOutcome = { lots: plan.lots, warnings: plan.warnings, results: [], riskMoney: plan.riskMoney, stopLoss, entry, takeProfits: plan.legs.map((leg) => leg.takeProfit), isDryRun: !!request.isDryRun };
    if (request.isDryRun) return outcome;
    const blocked = await this.canOpen(accountId, request.symbol, plan.lots);
    if (blocked) throw new Error(blocked);
    const management = request.management ?? {};
    const isStealth = !!management.isStealth;
    const firstTargetPoints = plan.legs[0]?.takeProfit ? Math.round(Math.abs(plan.legs[0].takeProfit - entry) / spec.point) : 0;
    const riskPoints = Math.round(riskDistance / spec.point);
    for (const [index, leg] of plan.legs.entries()) {
      const trade: TradeRequest = {
        action: definition.isPending ? 'pending' : 'deal', type: request.type, symbol: request.symbol, volume: leg.lots,
        ...(definition.isPending ? { price: entry, ...(request.expiration ? { expiration: request.expiration } : {}) } : {}),
        ...(isStealth ? {} : { sl: stopLoss || undefined, tp: leg.takeProfit || undefined }),
        comment: (request.comment ?? '').slice(0, 31),
      };
      let result: TradeResult;
      try { result = await link.request('order.send', trade); }
      catch (error) { result = unknownOutcome(error); }
      outcome.results.push(result);
      if (!result.isSuccess) {
        this.journal(`Risk order leg ${index + 1} failed: ${result.comment}. Remaining legs were not sent.`);
        break;
      }
      const breakEvenPoints = management.isBreakEvenAfterFirstTarget && index > 0 && firstTargetPoints ? firstTargetPoints : management.breakEvenR && riskPoints ? Math.round(management.breakEvenR * riskPoints) : 0;
      if ((breakEvenPoints || management.trailing || isStealth) && result.order) {
        this.setRule({
          accountId, ticket: result.order, symbol: request.symbol, side, partials: [], createdAt: this.now(), initialVolume: leg.lots,
          ...(breakEvenPoints ? { breakEven: { triggerPoints: breakEvenPoints, lockPoints: 1 } } : {}),
          ...(management.trailing ? { trailing: management.trailing } : {}),
          ...(isStealth && stopLoss ? { virtualStop: stopLoss } : {}),
          ...(isStealth && leg.takeProfit ? { virtualTarget: leg.takeProfit } : {}),
        });
      }
    }
    return outcome;
  }
}
