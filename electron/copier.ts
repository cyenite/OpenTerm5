import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { CopierConfig, CopierLogEntry, FollowerConfig } from '../shared/automation';
import type { Order, Position, SymbolSpec, TradeRequest, TradeResult, TradeSnapshot } from '../shared/protocol';
import { orderType } from '../shared/protocol';
import { floorToStep } from '../shared/risk';
import { copyStops, copyVolume, isWithinHours, mapFollowerSymbol, passesFilters } from './copier-math';
import { isSameInstrument } from '../shared/symbol-match';
import type { SessionPool, TradingLink } from './session-pool';
import { dayKey } from './trade-manager';

export interface CopyMapping {
  id: string;
  kind: 'position' | 'order';
  status: 'opening' | 'open' | 'unknown' | 'closed' | 'failed' | 'skipped';
  symbol: string;
  reason?: string;
  copierId: string;
  followerId: string;
  masterTicket: number;
  followerTicket: number;
  masterVolume: number;
  followerVolume: number;
  masterStop: number;
  masterTarget: number;
  masterPrice: number;
  createdAt: number;
}

export interface Protection {
  dayKey: string;
  followerId: string;
  reason?: string;
  trippedAt?: number;
  dayStartEquity: number;
}

export interface CopierState {
  configs: CopierConfig[];
  mappings: CopyMapping[];
  baselines: { copierId: string; followerId: string; tickets: number[] }[];
  protections: Protection[];
}

export interface CopierDeps {
  load(): Promise<CopierState>;
  save(state: CopierState): Promise<void>;
  append(entry: CopierLogEntry): void;
  canOpen(accountId: string, symbol: string, lots: number): string | null;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

const MASTER_POLL_MS = 500;
const UNKNOWN_ADOPT_MS = 60_000;
const TRANSIENT_RETCODES = new Set([10004, 10018, 10020, 10021, 10024]);
const RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 120_000, 240_000, 420_000];
const user = (copierId: string) => `copier:${copierId}`;

export class CopierError extends Error {}

export class Copier extends EventEmitter {
  private state: CopierState = { configs: [], mappings: [], baselines: [], protections: [] };
  private readonly snapshots = new Map<string, TradeSnapshot>();
  private readonly specs = new Map<string, SymbolSpec>();
  private readonly symbolLists = new Map<string, string[]>();
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly running = new Set<string>();
  private readonly dirty = new Set<string>();
  private readonly held = new Map<string, Set<string>>();
  private readonly logs: CopierLogEntry[] = [];

  constructor(private readonly pool: SessionPool, private readonly deps: CopierDeps) {
    super();
  }

  private now(): number { return (this.deps.now ?? Date.now)(); }
  private sleep(milliseconds: number): Promise<void> { return milliseconds > 0 ? (this.deps.sleep ?? ((value) => new Promise((resolve) => setTimeout(resolve, value))))(milliseconds) : Promise.resolve(); }

  async init(): Promise<void> {
    this.state = await this.deps.load();
    this.pool.on('trade', (accountId: string, snapshot: TradeSnapshot) => {
      this.snapshots.set(accountId, snapshot);
      for (const config of this.state.configs) {
        if (config.masterId === accountId || config.followers.some((follower) => follower.accountId === accountId)) this.schedule(config.id);
      }
    });
    await this.sync();
  }

  configs(): CopierConfig[] { return this.state.configs; }
  mappings(): CopyMapping[] { return this.state.mappings; }
  recentLogs(): CopierLogEntry[] { return [...this.logs].reverse(); }
  protections(): Protection[] { return this.state.protections; }

  private persist(): void {
    void this.deps.save(this.state).catch((error: Error) => this.log({ copierId: '', followerId: '', event: 'state', status: 'failed', symbol: '', message: `Copier state was not saved: ${error.message}` }));
    this.emit('changed');
  }

  private log(entry: Omit<CopierLogEntry, 'id' | 'time'>): void {
    const full: CopierLogEntry = { id: randomUUID(), time: this.now(), ...entry };
    this.logs.push(full);
    if (this.logs.length > 1000) this.logs.shift();
    this.deps.append(full);
    this.emit('log', full);
  }

  validate(config: CopierConfig): void {
    if (!config.name.trim()) throw new CopierError('Give the copier a name');
    if (!config.masterId) throw new CopierError('Choose a master account');
    const ids = config.followers.map((follower) => follower.accountId);
    if (ids.includes(config.masterId)) throw new CopierError('An account cannot copy from itself');
    if (new Set(ids).size !== ids.length) throw new CopierError('Each follower account can be added only once');
    for (const follower of config.followers) {
      if (!(follower.riskValue > 0)) throw new CopierError('Risk setting must be positive');
      if (follower.riskType === 'fixedBalance' && !(follower.fixedMasterBalance > 0)) throw new CopierError('Set the fixed master balance');
      if (follower.delay.minMs < 0 || follower.delay.maxMs < follower.delay.minMs || follower.delay.maxMs > 60_000) throw new CopierError('Delay must be between 0 and 60000 ms, and the maximum must not be below the minimum');
      if (follower.isStrictClose && !(follower.isStopCopied || follower.fixedStopPips) ) throw new CopierError('Strict close needs copied or fixed stop losses, otherwise copies never close');
    }
    const edges = new Map<string, Set<string>>();
    for (const item of [...this.state.configs.filter((existing) => existing.id !== config.id), config]) {
      if (item.status === 'disabled') continue;
      const targets = edges.get(item.masterId) ?? new Set();
      for (const follower of item.followers) if (follower.status !== 'disabled') targets.add(follower.accountId);
      edges.set(item.masterId, targets);
    }
    const visit = (account: string, path: Set<string>): boolean => {
      if (path.has(account)) return true;
      const next = new Set(path).add(account);
      return [...(edges.get(account) ?? [])].some((target) => visit(target, next));
    };
    if (visit(config.masterId, new Set())) throw new CopierError('These copiers would copy trades in a loop between accounts');
  }

  async save(config: CopierConfig): Promise<CopierConfig> {
    this.validate(config);
    const isNew = !this.state.configs.some((item) => item.id === config.id);
    this.state = { ...this.state, configs: isNew ? [...this.state.configs, config] : this.state.configs.map((item) => item.id === config.id ? config : item) };
    const followerIds = new Set(config.followers.map((follower) => follower.id));
    this.state.baselines = this.state.baselines.filter((baseline) => baseline.copierId !== config.id || followerIds.has(baseline.followerId));
    this.persist();
    await this.sync();
    this.schedule(config.id);
    return config;
  }

  async remove(id: string): Promise<void> {
    this.state = {
      ...this.state,
      configs: this.state.configs.filter((config) => config.id !== id),
      mappings: this.state.mappings.filter((mapping) => mapping.copierId !== id),
      baselines: this.state.baselines.filter((baseline) => baseline.copierId !== id),
    };
    this.persist();
    await this.sync();
  }

  resetProtection(followerId: string): void {
    this.state.protections = this.state.protections.filter((item) => item.followerId !== followerId);
    this.persist();
  }

  private async sync(): Promise<void> {
    for (const config of this.state.configs) {
      const wanted = new Set<string>();
      if (config.status !== 'disabled') {
        wanted.add(config.masterId);
        for (const follower of config.followers) if (follower.status !== 'disabled') wanted.add(follower.accountId);
      }
      const held = this.held.get(config.id) ?? new Set();
      for (const accountId of held) if (!wanted.has(accountId)) this.pool.release(accountId, user(config.id));
      this.held.set(config.id, wanted);
      for (const accountId of wanted) {
        if (held.has(accountId)) continue;
        void this.pool.acquire(accountId, user(config.id)).then(() => {
          if (accountId === config.masterId) this.pool.setPoll(accountId, MASTER_POLL_MS);
          this.schedule(config.id);
        }).catch((error: Error) => {
          this.log({ copierId: config.id, followerId: '', event: 'connect', status: 'failed', symbol: '', message: `${accountId.split('|').pop()}: ${error.message}` });
        });
      }
    }
    for (const [id, held] of this.held) {
      if (this.state.configs.some((config) => config.id === id)) continue;
      for (const accountId of held) this.pool.release(accountId, user(id));
      this.held.delete(id);
    }
  }

  async resync(): Promise<void> {
    await this.sync();
    for (const config of this.state.configs) this.schedule(config.id);
  }

  shutdown(): void {
    for (const [id, held] of this.held) for (const accountId of held) this.pool.release(accountId, user(id));
    this.held.clear();
  }

  private schedule(copierId: string): void {
    if (this.running.has(copierId)) { this.dirty.add(copierId); return; }
    this.running.add(copierId);
    void this.reconcile(copierId).catch((error: Error) => this.log({ copierId, followerId: '', event: 'reconcile', status: 'failed', symbol: '', message: error.message }))
      .finally(() => {
        this.running.delete(copierId);
        if (this.dirty.delete(copierId)) this.schedule(copierId);
      });
  }

  async settle(): Promise<void> {
    for (let index = 0; index < 50 && (this.running.size || this.dirty.size); index++) await new Promise((resolve) => setTimeout(resolve, 5));
    await Promise.all([...this.queues.values()]);
    for (let index = 0; index < 50 && (this.running.size || this.dirty.size); index++) await new Promise((resolve) => setTimeout(resolve, 5));
  }

  private async spec(link: TradingLink, accountId: string, symbol: string): Promise<SymbolSpec> {
    const key = `${accountId}|${symbol}`;
    const cached = this.specs.get(key);
    if (cached) return cached;
    const spec = await link.request('symbols.info', { symbol });
    this.specs.set(key, spec);
    return spec;
  }

  private async symbolNames(link: TradingLink, accountId: string): Promise<string[]> {
    const cached = this.symbolLists.get(accountId);
    if (cached) return cached;
    const names = (await link.request('symbols.list', {})).map((spec) => spec.name);
    this.symbolLists.set(accountId, names);
    return names;
  }

  private mapping(copierId: string, followerId: string, masterTicket: number, kind?: CopyMapping['kind']): CopyMapping | undefined {
    return this.state.mappings.find((mapping) => mapping.copierId === copierId && mapping.followerId === followerId && mapping.masterTicket === masterTicket && (!kind || mapping.kind === kind));
  }

  private update(mapping: CopyMapping, patch: Partial<CopyMapping>): CopyMapping {
    const next = { ...mapping, ...patch };
    this.state.mappings = this.state.mappings.map((item) => item.id === mapping.id ? next : item);
    this.persist();
    return next;
  }

  private drop(mapping: CopyMapping): void {
    this.state.mappings = this.state.mappings.filter((item) => item.id !== mapping.id);
    this.persist();
  }

  private enqueue(followerId: string, work: () => Promise<void>): Promise<void> {
    const next = (this.queues.get(followerId) ?? Promise.resolve()).then(work).catch(() => undefined);
    this.queues.set(followerId, next);
    return next;
  }

  private async reconcile(copierId: string): Promise<void> {
    const config = this.state.configs.find((item) => item.id === copierId);
    if (!config || config.status === 'disabled') return;
    const master = this.snapshots.get(config.masterId);
    if (!master || !this.pool.link(config.masterId)) return;
    for (const follower of config.followers) {
      if (follower.status === 'disabled') continue;
      const snapshot = this.snapshots.get(follower.accountId);
      const link = this.pool.link(follower.accountId);
      if (!snapshot || !link) continue;
      await this.reconcileFollower(config, follower, master, snapshot, link);
    }
  }

  private baseline(config: CopierConfig, follower: FollowerConfig, master: TradeSnapshot): Set<number> {
    let entry = this.state.baselines.find((item) => item.copierId === config.id && item.followerId === follower.id);
    if (!entry) {
      const tickets = follower.isExistingCopied ? master.orders.map((order) => order.ticket) : [...master.positions, ...master.orders].map((item) => item.ticket);
      entry = { copierId: config.id, followerId: follower.id, tickets: tickets.filter((ticket) => !this.mapping(config.id, follower.id, ticket)) };
      this.state.baselines = [...this.state.baselines, entry];
      this.persist();
    }
    const live = new Set([...master.positions, ...master.orders].map((item) => item.ticket));
    if (entry.tickets.some((ticket) => !live.has(ticket))) {
      entry.tickets = entry.tickets.filter((ticket) => live.has(ticket));
      this.persist();
    }
    return new Set(entry.tickets);
  }

  private protection(follower: FollowerConfig, snapshot: TradeSnapshot): string | null {
    const settings = follower.equityProtection;
    const equity = snapshot.account?.equity;
    if (!(settings.minEquity > 0 || settings.maxDailyLossPercent > 0) || equity === undefined || !Number.isFinite(equity)) return null;
    const today = dayKey(this.now(), 0);
    let state = this.state.protections.find((item) => item.followerId === follower.id);
    if (!state || state.dayKey !== today && !state.reason?.startsWith('equity')) {
      state = { followerId: follower.id, dayKey: today, dayStartEquity: equity, ...(state?.trippedAt && state.reason?.startsWith('equity') ? { trippedAt: state.trippedAt, reason: state.reason } : {}) };
      this.state.protections = [...this.state.protections.filter((item) => item.followerId !== follower.id), state];
      this.persist();
    }
    if (state.trippedAt) return state.reason ?? 'equity protection tripped';
    const reason = settings.minEquity > 0 && equity < settings.minEquity ? `equity ${equity.toFixed(2)} fell below ${settings.minEquity}`
      : settings.maxDailyLossPercent > 0 && state.dayStartEquity - equity >= state.dayStartEquity * settings.maxDailyLossPercent / 100 ? `daily loss reached ${settings.maxDailyLossPercent}%` : null;
    if (!reason) return null;
    this.state.protections = this.state.protections.map((item) => item.followerId === follower.id ? { ...item, trippedAt: this.now(), reason } : item);
    this.persist();
    return reason;
  }

  private async reconcileFollower(config: CopierConfig, follower: FollowerConfig, master: TradeSnapshot, snapshot: TradeSnapshot, link: TradingLink): Promise<void> {
    const ignored = this.baseline(config, follower, master);
    const detected = this.now();
    const tripped = this.protection(follower, snapshot);
    const protectionState = this.state.protections.find((item) => item.followerId === follower.id);
    if (tripped && protectionState?.trippedAt && protectionState.trippedAt >= detected - 1 && follower.equityProtection.action === 'closeAll') {
      this.log({ copierId: config.id, followerId: follower.id, event: 'protection', status: 'failed', symbol: '', message: `Equity protection: ${tripped}. Closing copied trades.` });
      for (const mapping of this.state.mappings.filter((item) => item.copierId === config.id && item.followerId === follower.id && item.kind === 'position' && item.status === 'open')) {
        const position = snapshot.positions.find((item) => item.ticket === mapping.followerTicket);
        if (position) void this.enqueue(follower.id, () => this.close(config, follower, link, mapping, position, position.volume, 'protection'));
      }
    }
    const masterTickets = new Set(master.positions.map((position) => position.ticket));
    const masterOrders = new Set(master.orders.map((order) => order.ticket));
    const isOpeningAllowed = config.status === 'enabled' && follower.status === 'enabled' && !tripped;
    const openCount = () => this.state.mappings.filter((mapping) => mapping.followerId === follower.id && mapping.kind === 'position' && ['open', 'opening', 'unknown'].includes(mapping.status)).length;

    for (const position of master.positions) {
      let mapping = this.mapping(config.id, follower.id, position.ticket);
      if (mapping?.kind === 'order') {
        const filled = snapshot.positions.find((item) => item.ticket === mapping!.followerTicket);
        const stillPending = snapshot.orders.find((item) => item.ticket === mapping!.followerTicket);
        if (filled) mapping = this.update(mapping, { kind: 'position', status: 'open', followerVolume: filled.volume, masterVolume: position.volume, masterStop: position.sl, masterTarget: position.tp });
        else if (stillPending) {
          const pending = mapping;
          await this.enqueue(follower.id, async () => {
            const result = await this.send(link, { action: 'remove', order: pending.followerTicket });
            this.log({ copierId: config.id, followerId: follower.id, event: 'sync pending fill', status: result.isSuccess ? 'ok' : 'failed', symbol: pending.symbol, message: `Master order #${position.ticket} filled; follower order #${pending.followerTicket} ${result.isSuccess ? 'removed and replaced at market' : `could not be removed: ${result.comment}`}`, masterTicket: position.ticket });
            if (result.isSuccess) this.drop(pending);
          });
          continue;
        } else { this.drop(mapping); mapping = undefined; }
      }
      if (!mapping) {
        if (ignored.has(position.ticket) || !isOpeningAllowed) continue;
        const reason = passesFilters(follower, position)
          ?? (isWithinHours(follower.tradingHours, new Date(this.now())) ? null : 'outside the trading hours')
          ?? (follower.maxOpenTrades && openCount() >= follower.maxOpenTrades ? `max ${follower.maxOpenTrades} open copies reached` : null);
        const created = this.create(config, follower, position, 'position', reason ? 'skipped' : 'opening', reason ?? undefined);
        if (reason) { this.log({ copierId: config.id, followerId: follower.id, event: 'open', status: 'skipped', symbol: position.symbol, message: `#${position.ticket} not copied: ${reason}`, masterTicket: position.ticket }); continue; }
        void this.enqueue(follower.id, () => this.open(config, follower, link, master, created, position, detected));
        continue;
      }
      if (mapping.status === 'unknown') { this.adopt(config, follower, snapshot, mapping); continue; }
      if (mapping.status !== 'open') continue;
      const copy = snapshot.positions.find((item) => item.ticket === mapping!.followerTicket);
      if (!copy) {
        this.update(mapping, { status: 'closed', reason: 'closed on the follower' });
        this.log({ copierId: config.id, followerId: follower.id, event: 'close', status: 'ok', symbol: mapping.symbol, message: `Follower #${mapping.followerTicket} closed on its own (stop or manual); master #${position.ticket} is still open`, masterTicket: position.ticket, followerTicket: mapping.followerTicket });
        continue;
      }
      if (position.volume < mapping.masterVolume - 1e-9) {
        const current = mapping;
        const spec = await this.spec(link, follower.accountId, copy.symbol);
        let volume = floorToStep(copy.volume * (1 - position.volume / current.masterVolume), spec.volumeStep);
        if (copy.volume - volume < spec.volumeMin - 1e-9) volume = copy.volume;
        this.update(current, { masterVolume: position.volume });
        if (volume >= spec.volumeMin - 1e-9) void this.enqueue(follower.id, () => this.close(config, follower, link, { ...current, masterVolume: position.volume }, copy, volume, 'partial close'));
        continue;
      }
      if ((follower.isStopCopied && position.sl !== mapping.masterStop || follower.isTargetCopied && position.tp !== mapping.masterTarget) && !follower.isReversed) {
        const current = this.update(mapping, { masterStop: position.sl, masterTarget: position.tp });
        void this.enqueue(follower.id, () => this.modifyStops(config, follower, link, current, position, copy));
      }
    }

    for (const mapping of this.state.mappings.filter((item) => item.copierId === config.id && item.followerId === follower.id && item.kind === 'position')) {
      if (masterTickets.has(mapping.masterTicket) || masterOrders.has(mapping.masterTicket)) continue;
      if (mapping.status === 'open' && !follower.isStrictClose) {
        const copy = snapshot.positions.find((item) => item.ticket === mapping.followerTicket);
        if (copy) {
          this.update(mapping, { status: 'closed', reason: 'master closed' });
          void this.enqueue(follower.id, () => this.close(config, follower, link, mapping, copy, copy.volume, 'close'));
          continue;
        }
      }
      if (mapping.status !== 'opening') this.drop(mapping);
    }

    if (follower.isPendingCopied) await this.reconcileOrders(config, follower, master, snapshot, link, ignored, isOpeningAllowed);
  }

  private async reconcileOrders(config: CopierConfig, follower: FollowerConfig, master: TradeSnapshot, snapshot: TradeSnapshot, link: TradingLink, ignored: Set<number>, isOpeningAllowed: boolean): Promise<void> {
    for (const order of master.orders) {
      if (!orderType(order.type)?.isPending) continue;
      const mapping = this.mapping(config.id, follower.id, order.ticket, 'order');
      if (!mapping) {
        if (ignored.has(order.ticket) || !isOpeningAllowed || passesFilters(follower, { ...order, side: orderType(order.type)!.isBuy ? 'buy' : 'sell', magic: 0 })) continue;
        const created = this.create(config, follower, order, 'order', 'opening');
        void this.enqueue(follower.id, () => this.placePending(config, follower, link, created, order));
        continue;
      }
      if (mapping.status !== 'open') continue;
      if (order.priceOpen !== mapping.masterPrice || order.sl !== mapping.masterStop || order.tp !== mapping.masterTarget) {
        const copy = snapshot.orders.find((item) => item.ticket === mapping.followerTicket);
        const current = this.update(mapping, { masterPrice: order.priceOpen, masterStop: order.sl, masterTarget: order.tp });
        if (copy) void this.enqueue(follower.id, () => this.modifyPending(config, follower, link, current, order, copy));
      }
    }
    const live = new Set([...master.orders, ...master.positions].map((item) => item.ticket));
    for (const mapping of this.state.mappings.filter((item) => item.copierId === config.id && item.followerId === follower.id && item.kind === 'order')) {
      if (live.has(mapping.masterTicket)) continue;
      const copy = snapshot.orders.find((item) => item.ticket === mapping.followerTicket);
      this.drop(mapping);
      if (copy) void this.enqueue(follower.id, async () => {
        const result = await this.send(link, { action: 'remove', order: copy.ticket });
        this.log({ copierId: config.id, followerId: follower.id, event: 'cancel', status: result.isSuccess ? 'ok' : 'failed', symbol: copy.symbol, message: `Master order #${mapping.masterTicket} was removed; follower order #${copy.ticket} ${result.isSuccess ? 'deleted' : `not deleted: ${result.comment}`}`, masterTicket: mapping.masterTicket, followerTicket: copy.ticket });
      });
    }
  }

  private create(config: CopierConfig, follower: FollowerConfig, trade: Position | Order, kind: CopyMapping['kind'], status: CopyMapping['status'], reason?: string): CopyMapping {
    const mapping: CopyMapping = {
      id: randomUUID(), kind, status, symbol: trade.symbol, copierId: config.id, followerId: follower.id, masterTicket: trade.ticket,
      followerTicket: 0, masterVolume: trade.volume, followerVolume: 0, masterStop: trade.sl, masterTarget: trade.tp,
      masterPrice: trade.priceOpen, createdAt: this.now(), ...(reason ? { reason } : {}),
    };
    this.state.mappings = [...this.state.mappings, mapping];
    this.persist();
    return mapping;
  }

  private async send(link: TradingLink, request: TradeRequest): Promise<TradeResult> {
    return link.request('order.send', request);
  }

  private delay(follower: FollowerConfig): Promise<void> {
    const { minMs, maxMs } = follower.delay;
    return this.sleep(minMs + Math.round((this.deps.random ?? Math.random)() * (maxMs - minMs)));
  }

  private comment(follower: FollowerConfig, masterComment: string): string {
    return (follower.comment === 'copy' ? masterComment : follower.comment === 'custom' ? follower.customComment : '').slice(0, 31);
  }

  private async open(config: CopierConfig, follower: FollowerConfig, link: TradingLink, master: TradeSnapshot, mapping: CopyMapping, position: Position, detected: number): Promise<void> {
    const fail = (status: CopierLogEntry['status'], message: string) => {
      this.update(mapping, { status: status === 'unknown' ? 'unknown' : status === 'skipped' ? 'skipped' : 'failed', reason: message });
      this.log({ copierId: config.id, followerId: follower.id, event: 'open', status, symbol: position.symbol, message: `#${position.ticket}: ${message}`, masterTicket: position.ticket });
    };
    try {
      const masterLink = this.pool.require(config.masterId);
      const symbol = mapFollowerSymbol(position.symbol, follower, await this.symbolNames(link, follower.accountId));
      if (!symbol) return fail('skipped', `no matching symbol for ${position.symbol} on the follower; add a symbol mapping`);
      const [masterSpec, spec, account, quote] = await Promise.all([
        this.spec(masterLink, config.masterId, position.symbol), this.spec(link, follower.accountId, symbol),
        link.request('account.info', {}), link.request('symbols.quote', { symbol }),
      ]);
      if (!account) return fail('failed', 'follower account information is unavailable');
      const valuation = follower.riskType === 'fixedRisk' ? await link.request('symbols.valuation', { symbol }) : undefined;
      const sizing = copyVolume(follower, {
        masterLots: position.volume, masterBalance: master.account?.balance ?? 0, masterEquity: master.account?.equity ?? 0,
        followerBalance: account.balance, followerEquity: account.equity, masterContract: masterSpec.contractSize, followerContract: spec.contractSize,
        stopDistance: position.sl ? Math.abs(position.priceOpen - position.sl) : undefined, followerMoneyPerUnit: valuation?.moneyPerUnit, limits: spec,
      });
      if ('skip' in sizing) return fail('skipped', sizing.skip);
      const side = follower.isReversed ? (position.side === 'buy' ? 'sell' : 'buy') : position.side;
      const blocked = this.deps.canOpen(follower.accountId, symbol, sizing.lots);
      if (blocked) return fail('skipped', blocked);
      await this.delay(follower);
      const entry = side === 'buy' ? quote.ask : quote.bid;
      const stops = copyStops(follower, { side, masterSide: position.side, masterOpen: position.priceOpen, masterStop: position.sl, masterTarget: position.tp, followerEntry: entry, digits: spec.digits, point: spec.point });
      const request: TradeRequest = { action: 'deal', type: side, symbol, volume: sizing.lots, ...(stops.sl ? { sl: stops.sl } : {}), ...(stops.tp ? { tp: stops.tp } : {}), comment: this.comment(follower, position.comment) };
      for (let attempt = 0; ; attempt++) {
        if (!this.snapshots.get(config.masterId)?.positions.some((item) => item.ticket === position.ticket)) return fail('skipped', 'master closed before the copy was sent');
        let result: TradeResult;
        try { result = await this.send(link, request); }
        catch (error) { return fail('unknown', `outcome unknown (${(error as Error).message}); checking follower positions before doing anything else`); }
        if (result.isSuccess) {
          this.update(mapping, { status: 'open', symbol, followerTicket: result.order ?? 0, followerVolume: result.volume || sizing.lots, reason: sizing.note });
          this.log({ copierId: config.id, followerId: follower.id, event: 'open', status: 'ok', symbol, message: `${side} ${sizing.lots} ${symbol} copied from #${position.ticket}${sizing.note ? ` (${sizing.note})` : ''}`, masterTicket: position.ticket, followerTicket: result.order, latencyMs: this.now() - detected });
          return;
        }
        const delay = RETRY_DELAYS_MS[attempt];
        if (!TRANSIENT_RETCODES.has(result.retcode) || delay === undefined) return fail('failed', `${result.comment} (${result.retcode})`);
        this.log({ copierId: config.id, followerId: follower.id, event: 'open', status: 'retrying', symbol, message: `#${position.ticket}: ${result.comment} (${result.retcode}); retrying in ${delay / 1000}s`, masterTicket: position.ticket });
        await this.sleep(delay);
      }
    } catch (error) {
      fail('failed', (error as Error).message);
    }
  }

  // After an unknown outcome the follower is checked for a matching new position;
  // the copy is adopted if found, and never re-sent automatically.
  private adopt(config: CopierConfig, follower: FollowerConfig, snapshot: TradeSnapshot, mapping: CopyMapping): void {
    const claimed = new Set(this.state.mappings.filter((item) => item.followerId === follower.id).map((item) => item.followerTicket));
    const master = this.snapshots.get(config.masterId)?.positions.find((item) => item.ticket === mapping.masterTicket);
    const side = master && (follower.isReversed ? (master.side === 'buy' ? 'sell' : 'buy') : master.side);
    const match = snapshot.positions.find((position) => !claimed.has(position.ticket) && position.side === side && isSameInstrument(position.symbol, mapping.symbol) && position.time >= mapping.createdAt - 60_000);
    if (match) {
      this.update(mapping, { status: 'open', symbol: match.symbol, followerTicket: match.ticket, followerVolume: match.volume, reason: 'adopted after unknown outcome' });
      this.log({ copierId: config.id, followerId: follower.id, event: 'reconcile', status: 'ok', symbol: match.symbol, message: `Found follower #${match.ticket} for master #${mapping.masterTicket} after an unknown outcome`, masterTicket: mapping.masterTicket, followerTicket: match.ticket });
    } else if (this.now() - mapping.createdAt > UNKNOWN_ADOPT_MS) {
      this.update(mapping, { status: 'failed', reason: 'no follower position appeared after an unknown outcome' });
      this.log({ copierId: config.id, followerId: follower.id, event: 'reconcile', status: 'failed', symbol: mapping.symbol, message: `No follower position appeared for master #${mapping.masterTicket}. It was not re-sent; check the follower account.`, masterTicket: mapping.masterTicket });
    }
  }

  private async close(config: CopierConfig, follower: FollowerConfig, link: TradingLink, mapping: CopyMapping, copy: Position, volume: number, event: string): Promise<void> {
    await this.delay(follower);
    for (let attempt = 0; ; attempt++) {
      let result: TradeResult;
      try { result = await this.send(link, { action: 'deal', symbol: copy.symbol, position: copy.ticket, volume, type: copy.side === 'buy' ? 'sell' : 'buy' }); }
      catch (error) {
        this.log({ copierId: config.id, followerId: follower.id, event, status: 'unknown', symbol: copy.symbol, message: `Closing #${copy.ticket}: outcome unknown (${(error as Error).message}). Check the follower before closing again.`, masterTicket: mapping.masterTicket, followerTicket: copy.ticket });
        return;
      }
      if (result.isSuccess) {
        if (volume < copy.volume) this.update(mapping, { followerVolume: Number((copy.volume - volume).toFixed(8)) });
        this.log({ copierId: config.id, followerId: follower.id, event, status: 'ok', symbol: copy.symbol, message: `${event}: ${volume} of #${copy.ticket}`, masterTicket: mapping.masterTicket, followerTicket: copy.ticket });
        return;
      }
      const delay = RETRY_DELAYS_MS[attempt];
      if (!TRANSIENT_RETCODES.has(result.retcode) || delay === undefined) {
        this.log({ copierId: config.id, followerId: follower.id, event, status: 'failed', symbol: copy.symbol, message: `${event} #${copy.ticket} failed: ${result.comment} (${result.retcode})`, masterTicket: mapping.masterTicket, followerTicket: copy.ticket });
        return;
      }
      this.log({ copierId: config.id, followerId: follower.id, event, status: 'retrying', symbol: copy.symbol, message: `${event} #${copy.ticket}: ${result.comment}; retrying in ${delay / 1000}s`, masterTicket: mapping.masterTicket });
      await this.sleep(delay);
    }
  }

  private async modifyStops(config: CopierConfig, follower: FollowerConfig, link: TradingLink, mapping: CopyMapping, master: Position, copy: Position): Promise<void> {
    const spec = await this.spec(link, follower.accountId, copy.symbol);
    const stops = copyStops(follower, { side: copy.side, masterSide: master.side, masterOpen: master.priceOpen, masterStop: master.sl, masterTarget: master.tp, followerEntry: copy.priceOpen, digits: spec.digits, point: spec.point });
    const sl = follower.isStopCopied || follower.fixedStopPips ? stops.sl : copy.sl;
    const tp = follower.isTargetCopied || follower.fixedTargetPips ? stops.tp : copy.tp;
    if (sl === copy.sl && tp === copy.tp) return;
    await this.delay(follower);
    let result: TradeResult;
    try { result = await this.send(link, { action: 'sltp', symbol: copy.symbol, position: copy.ticket, sl, tp }); }
    catch (error) { result = { retcode: 0, isSuccess: false, comment: (error as Error).message }; }
    this.log({ copierId: config.id, followerId: follower.id, event: 'modify', status: result.isSuccess ? 'ok' : 'failed', symbol: copy.symbol, message: `#${copy.ticket} sl ${sl || '-'} tp ${tp || '-'}${result.isSuccess ? '' : `: ${result.comment}`}`, masterTicket: mapping.masterTicket, followerTicket: copy.ticket });
  }

  private async placePending(config: CopierConfig, follower: FollowerConfig, link: TradingLink, mapping: CopyMapping, order: Order): Promise<void> {
    const fail = (message: string) => {
      this.update(mapping, { status: 'failed', reason: message });
      this.log({ copierId: config.id, followerId: follower.id, event: 'pending', status: 'failed', symbol: order.symbol, message: `Order #${order.ticket}: ${message}`, masterTicket: order.ticket });
    };
    try {
      const symbol = mapFollowerSymbol(order.symbol, follower, await this.symbolNames(link, follower.accountId));
      if (!symbol) return fail(`no matching symbol for ${order.symbol}`);
      const masterLink = this.pool.require(config.masterId);
      const master = this.snapshots.get(config.masterId)!;
      const [masterSpec, spec, account] = await Promise.all([this.spec(masterLink, config.masterId, order.symbol), this.spec(link, follower.accountId, symbol), link.request('account.info', {})]);
      const sizing = copyVolume(follower, {
        masterLots: order.volume, masterBalance: master.account?.balance ?? 0, masterEquity: master.account?.equity ?? 0,
        followerBalance: account?.balance ?? 0, followerEquity: account?.equity ?? 0, masterContract: masterSpec.contractSize, followerContract: spec.contractSize,
        stopDistance: order.sl ? Math.abs(order.priceOpen - order.sl) : undefined, limits: spec,
      });
      if ('skip' in sizing) return fail(sizing.skip);
      const blocked = this.deps.canOpen(follower.accountId, symbol, sizing.lots);
      if (blocked) return fail(blocked);
      const isBuy = orderType(order.type)!.isBuy;
      const side = isBuy ? 'buy' : 'sell';
      const stops = copyStops(follower, { side, masterSide: side, masterOpen: order.priceOpen, masterStop: order.sl, masterTarget: order.tp, followerEntry: order.priceOpen, digits: spec.digits, point: spec.point });
      await this.delay(follower);
      let result: TradeResult;
      try {
        result = await this.send(link, {
          action: 'pending', type: order.type, symbol, volume: sizing.lots, price: order.priceOpen,
          ...(order.stoplimit ? { stoplimit: order.stoplimit } : {}), ...(stops.sl ? { sl: stops.sl } : {}), ...(stops.tp ? { tp: stops.tp } : {}),
          ...(follower.isExpiryCopied && order.expiration ? { expiration: order.expiration } : {}), comment: this.comment(follower, order.comment),
        });
      } catch (error) { return fail(`outcome unknown: ${(error as Error).message}`); }
      if (!result.isSuccess) return fail(`${result.comment} (${result.retcode})`);
      this.update(mapping, { status: 'open', symbol, followerTicket: result.order ?? 0, followerVolume: sizing.lots });
      this.log({ copierId: config.id, followerId: follower.id, event: 'pending', status: 'ok', symbol, message: `${orderType(order.type)!.label} ${sizing.lots} ${symbol} at ${order.priceOpen} copied from #${order.ticket}`, masterTicket: order.ticket, followerTicket: result.order });
    } catch (error) { fail((error as Error).message); }
  }

  private async modifyPending(config: CopierConfig, follower: FollowerConfig, link: TradingLink, mapping: CopyMapping, order: Order, copy: Order): Promise<void> {
    const spec = await this.spec(link, follower.accountId, copy.symbol);
    const side = orderType(order.type)!.isBuy ? 'buy' : 'sell';
    const stops = copyStops(follower, { side, masterSide: side, masterOpen: order.priceOpen, masterStop: order.sl, masterTarget: order.tp, followerEntry: order.priceOpen, digits: spec.digits, point: spec.point });
    await this.delay(follower);
    let result: TradeResult;
    try { result = await this.send(link, { action: 'modify', order: copy.ticket, symbol: copy.symbol, price: order.priceOpen, sl: stops.sl, tp: stops.tp, expiration: copy.expiration }); }
    catch (error) { result = { retcode: 0, isSuccess: false, comment: (error as Error).message }; }
    this.log({ copierId: config.id, followerId: follower.id, event: 'modify pending', status: result.isSuccess ? 'ok' : 'failed', symbol: copy.symbol, message: `Order #${copy.ticket} at ${order.priceOpen}${result.isSuccess ? '' : `: ${result.comment}`}`, masterTicket: mapping.masterTicket, followerTicket: copy.ticket });
  }
}
