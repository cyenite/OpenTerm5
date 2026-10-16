import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type {
  AutomationEvent, AutomationEvents, AutomationMethod, AutomationMethods, CopierLogEntry, CopierView, NotificationTarget,
  SignalRecord, WebhookSettings, WebhookSource, WebhookView,
} from '../shared/automation';
import type { AccountGuard } from '../shared/automation';
import { copierRiskTypes, notificationEvents, notificationKinds, parseRiskPreferences, type RiskPreferences } from '../shared/automation';
import { riskModes } from '../shared/risk';
import type { AccountRegistry } from './account-registry';
import type { PasswordCipher } from './account-registry';
import { Copier, type CopierState } from './copier';
import { buildCopierAudit } from './copier-audit';
import { JsonLog, JsonStore } from './json-store';
import { NewsCalendar, parseCalendarCache } from './news-calendar';
import { parseOwnedTickets, SignalOwnership } from './signal-ownership';
import { Notifier, validateTarget } from './notifier';
import type { SessionPool } from './session-pool';
import { SignalExecutor } from './signal-executor';
import { TradeManager, type ManagerState } from './trade-manager';
import { WebhookServer } from './webhook-server';

export interface HostDeps {
  pool: SessionPool;
  userData: string;
  appVersion: string;
  cipher: PasswordCipher;
  clientId: () => string;
  accounts: () => AccountRegistry | undefined;
  send<E extends AutomationEvent>(event: E, data: AutomationEvents[E]): void;
  journal(message: string, source: string): void;
  saveFile(name: string, contents: string): Promise<string | null>;
}

const MAX_NEWS_MINUTES = 240;
const MAX_DAILY_REQUESTS = 100_000;

const usesNews = (guard: AccountGuard) => guard.isEnabled && !!(guard.newsMinutesBefore || guard.newsMinutesAfter);

export function validateGuard(guard: AccountGuard): AccountGuard {
  for (const [label, value] of [['News minutes before', guard.newsMinutesBefore], ['News minutes after', guard.newsMinutesAfter]] as const) {
    if (value !== undefined && !(Number.isInteger(value) && value >= 0 && value <= MAX_NEWS_MINUTES)) throw new Error(`${label} must be a whole number from 0 to ${MAX_NEWS_MINUTES}`);
  }
  const requests = guard.maxDailyRequests;
  if (requests !== undefined && !(Number.isInteger(requests) && requests >= 0 && requests <= MAX_DAILY_REQUESTS)) throw new Error(`Daily trade requests must be a whole number up to ${MAX_DAILY_REQUESTS}`);
  return guard;
}

interface StoredSecrets {
  isEncrypted: boolean;
  settings: WebhookSettings | string;
  notifications: NotificationTarget[] | string;
}

const ALLOWED_HOSTS = /^(127\.0\.0\.1|::1|0\.0\.0\.0|localhost|\d{1,3}(\.\d{1,3}){3})$/;

export function validateWebhookSettings(value: WebhookSettings): WebhookSettings {
  if (!value || typeof value !== 'object') throw new Error('Invalid webhook settings');
  if (!ALLOWED_HOSTS.test(value.host)) throw new Error('Listen address must be 127.0.0.1, 0.0.0.0 or an IPv4 address');
  if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) throw new Error('Port must be between 1024 and 65535');
  if (!Array.isArray(value.sources) || value.sources.length > 50) throw new Error('At most 50 signal sources');
  const ids = new Set<string>();
  const sources = value.sources.map((source): WebhookSource => {
    if (!/^[\w-]{6,64}$/.test(source.id) || ids.has(source.id)) throw new Error('Source ids must be unique, 6-64 letters, digits, _ or -');
    ids.add(source.id);
    if (!source.name?.trim()) throw new Error('Every source needs a name');
    if (typeof source.secret !== 'string' || source.secret.length < 24) throw new Error(`${source.name}: the secret must be at least 24 characters`);
    if (source.auth !== 'token' && source.auth !== 'hmac') throw new Error(`${source.name}: unknown authentication mode`);
    if (!source.accountId) throw new Error(`${source.name}: choose the account that executes its signals`);
    if (source.sizing.mode !== 'signal' && !riskModes.some((mode) => mode.key === source.sizing.mode)) throw new Error(`${source.name}: unknown sizing mode`);
    if (source.sizing.mode !== 'signal' && !(source.sizing.value > 0)) throw new Error(`${source.name}: the sizing value must be positive`);
    if (source.sizing.mode.startsWith('percent') && source.sizing.value > 20) throw new Error(`${source.name}: risk per signal above 20% is refused`);
    if (!(source.sizing.maxLots >= 0)) throw new Error(`${source.name}: max lots cannot be negative`);
    if (!Number.isInteger(source.maxPerMinute) || source.maxPerMinute < 1 || source.maxPerMinute > 600) throw new Error(`${source.name}: rate limit must be 1-600 per minute`);
    return { ...source, name: source.name.trim(), symbolSuffix: source.symbolSuffix.trim(), allowedSymbols: source.allowedSymbols.map((item) => item.trim()).filter(Boolean) };
  });
  return { host: value.host, port: value.port, sources, isEnabled: !!value.isEnabled, isPaused: !!value.isPaused };
}

export class AutomationHost {
  readonly manager: TradeManager;
  readonly copier: Copier;
  readonly webhooks: WebhookServer;
  readonly notifier: Notifier;
  readonly news: NewsCalendar;
  private settings: WebhookSettings = { host: '127.0.0.1', port: 8787, sources: [], isEnabled: false, isPaused: false };
  private notifications: NotificationTarget[] = [];
  private copierPush?: NodeJS.Timeout;
  private readonly heldSources = new Map<string, string>();
  private readonly secrets: JsonStore<StoredSecrets>;
  private readonly signalLog: JsonLog<SignalRecord>;
  private readonly copierLog: JsonLog<CopierLogEntry>;
  private readonly riskStore: JsonStore<RiskPreferences>;

  constructor(private readonly deps: HostDeps) {
    const file = (name: string) => path.join(deps.userData, name);
    this.notifier = new Notifier((message) => deps.journal(message, 'Notifications'));
    this.news = new NewsCalendar(new JsonStore(file('news-calendar.json'), parseCalendarCache, () => ({ fetchedAt: 0, events: [] })), (url, init) => fetch(url, init), (message) => deps.journal(message, 'News'));
    const managerStore = new JsonStore<ManagerState>(file('automation.json'), (value) => value as ManagerState, () => ({ rules: [], guards: [], guardStates: [], requestCounts: [] }));
    this.manager = new TradeManager(deps.pool, managerStore, (message) => {
      deps.journal(message, 'Automation');
      this.notifier.notify('manager', 'Trade manager', message);
    }, undefined, this.news);
    this.copierLog = new JsonLog<CopierLogEntry>(file('copier-log.jsonl'));
    const copierStore = new JsonStore<CopierState>(file('copier.json'), (value) => value as CopierState, () => ({ configs: [], mappings: [], baselines: [], protections: [] }));
    this.copier = new Copier(deps.pool, {
      load: () => copierStore.load(), save: (state) => copierStore.save(state), append: (entry) => this.copierLog.append(entry),
      canOpen: (accountId, symbol, lots) => this.manager.canOpen(accountId, symbol, lots),
    });
    this.signalLog = new JsonLog<SignalRecord>(file('signals.jsonl'));
    const executor = new SignalExecutor(deps.pool, this.manager, new SignalOwnership(new JsonStore(file('signal-tickets.json'), parseOwnedTickets, () => ({}))));
    this.webhooks = new WebhookServer({ execute: (source, signal) => executor.execute(source, signal), append: (record) => this.signalLog.append(record) });
    this.riskStore = new JsonStore<RiskPreferences>(file('risk-preferences.json'), parseRiskPreferences, () => parseRiskPreferences(undefined));
    this.secrets = new JsonStore<StoredSecrets>(file('webhooks.json'), (value) => value as StoredSecrets, () => ({ isEncrypted: false, settings: this.settings, notifications: [] }));
  }

  async init(): Promise<void> {
    const { deps } = this;
    await this.news.init();
    this.news.on('changed', (view) => deps.send('news', view));
    await this.manager.init().catch((error: Error) => deps.journal(`Trade manager disabled: ${error.message}`, 'Automation'));
    deps.pool.setAdmission((accountId, request) => this.manager.admit(accountId, request));
    this.news.setActive(this.manager.state().guards.some(usesNews));
    this.manager.on('changed', (state: ManagerState) => {
      deps.send('manager', state);
      this.news.setActive(state.guards.some(usesNews));
    });
    this.manager.on('tripped', (accountId: string, reason: string) => this.notifier.notify('guard', 'Equity guard tripped', `${accountId.split('|').pop()}: ${reason}`));
    await this.copier.init().catch((error: Error) => deps.journal(`Copier disabled: ${error.message}`, 'Copier'));
    this.copier.on('changed', () => this.pushCopier());
    this.copier.on('log', (entry: CopierLogEntry) => {
      deps.send('copierLog', entry);
      if (entry.status === 'failed' || entry.status === 'unknown') this.notifier.notify('copier', `Copier ${entry.status}`, entry.message);
    });
    deps.pool.on('state', () => this.pushCopier());
    this.webhooks.on('record', (record: SignalRecord) => {
      deps.send('signal', record);
      if (record.status !== 'accepted') this.notifier.notify('signal', `Signal ${record.status}: ${record.action} ${record.symbol}`, record.message);
    });
    this.webhooks.on('status', (status) => deps.send('webhookStatus', status));
    this.webhooks.seed(await this.signalLog.tail(500));
    try {
      const stored = await this.secrets.load();
      const decode = <T>(value: T | string): T => typeof value === 'string' ? JSON.parse(stored.isEncrypted ? deps.cipher.decrypt(value) : value) : value;
      this.settings = validateWebhookSettings(decode(stored.settings));
      this.notifications = decode(stored.notifications);
      this.notifier.setTargets(this.notifications);
      await this.webhooks.apply(this.settings);
      this.syncSourceSessions();
    } catch (error) {
      deps.journal(`Webhook settings could not be loaded: ${(error as Error).message}`, 'Webhooks');
    }
  }

  // Every enabled source keeps a broker session for its account, like copiers do,
  // so signals can execute on accounts other than the one open in the UI.
  private syncSourceSessions(): void {
    const wanted = new Map(this.settings.isEnabled ? this.settings.sources.filter((source) => source.isEnabled && source.accountId).map((source) => [source.id, source.accountId]) : []);
    for (const [sourceId, accountId] of this.heldSources) {
      if (wanted.get(sourceId) === accountId) continue;
      this.deps.pool.release(accountId, `webhook:${sourceId}`);
      this.heldSources.delete(sourceId);
    }
    for (const [sourceId, accountId] of wanted) {
      if (this.heldSources.has(sourceId)) continue;
      this.heldSources.set(sourceId, accountId);
      void this.deps.pool.acquire(accountId, `webhook:${sourceId}`).catch((error: Error) => {
        this.deps.journal(`Signal source account ${accountId.split('|').pop()} is not connected: ${error.message}`, 'Webhooks');
      });
    }
  }

  private pushCopier(): void {
    if (this.copierPush) return;
    this.copierPush = setTimeout(() => {
      this.copierPush = undefined;
      this.deps.send('copier', this.copierView());
    }, 200);
  }

  private copierView(): CopierView {
    return {
      configs: this.copier.configs(),
      logs: this.copier.recentLogs().slice(0, 300),
      links: this.deps.pool.status(),
      mappings: this.copier.mappings().map(({ masterStop, masterTarget, masterPrice, createdAt, ...mapping }) => mapping),
      protections: this.copier.protections(),
    };
  }

  private async persistSecrets(): Promise<void> {
    const isEncrypted = this.deps.cipher.canEncrypt();
    const encode = (value: unknown) => isEncrypted ? this.deps.cipher.encrypt(JSON.stringify(value)) : JSON.stringify(value);
    await this.secrets.save({ isEncrypted, settings: encode(this.settings), notifications: encode(this.notifications) });
  }

  canOpen(accountId: string | null, symbol?: string, lots?: number): Promise<string | null> {
    return accountId ? this.manager.canOpen(accountId, symbol, lots) : Promise.resolve(null);
  }

  private async exportAudit(copierId?: string): Promise<AutomationMethods['copier.exportAudit'][1]> {
    const profiles = this.deps.accounts()?.list() ?? [];
    const exportedAt = Date.now();
    const audit = buildCopierAudit({
      copierId, exportedAt, clientId: this.deps.clientId(), appVersion: this.deps.appVersion, log: await this.copierLog.all(),
      configs: this.copier.configs(), mappings: this.copier.mappings(),
      account: (id) => {
        const profile = profiles.find((item) => item.id === id);
        const holder = this.manager.account(id)?.name;
        return { id, ...(profile ? { label: profile.label, server: profile.server, company: profile.company, login: profile.login } : {}), ...(holder ? { holder } : {}) };
      },
    });
    const name = copierId ? this.copier.configs().find((config) => config.id === copierId)?.name ?? 'copier' : 'all-copiers';
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'copier';
    const path = await this.deps.saveFile(`openterm5-audit-${slug}-${new Date(exportedAt).toISOString().slice(0, 10)}.json`, JSON.stringify(audit, null, 2));
    return { path, entries: audit.log.length };
  }

  async handle(method: AutomationMethod, values: unknown): Promise<unknown> {
    const params = values as AutomationMethods[typeof method][0];
    switch (method) {
      case 'preferences.risk': return this.riskStore.load().catch(() => parseRiskPreferences(undefined));
      case 'preferences.setRisk': {
        const preferences = parseRiskPreferences(params);
        await this.riskStore.save(preferences);
        return preferences;
      }
      case 'manager.state': return this.manager.state();
      case 'manager.setRule': this.manager.setRule(params as AutomationMethods['manager.setRule'][0]); return true;
      case 'manager.removeRule': { const { accountId, ticket } = params as AutomationMethods['manager.removeRule'][0]; this.manager.removeRule(accountId, ticket); return true; }
      case 'manager.setGuard': this.manager.setGuard(validateGuard(params as AutomationMethods['manager.setGuard'][0])); return true;
      case 'manager.resetGuard': this.manager.resetGuard((params as AutomationMethods['manager.resetGuard'][0]).accountId); return true;
      case 'manager.bulk': return this.manager.bulk(params as AutomationMethods['manager.bulk'][0]);
      case 'manager.risk': return this.manager.placeRisk(params as AutomationMethods['manager.risk'][0]);
      case 'copier.view': return this.copierView();
      case 'copier.save': {
        const config = params as AutomationMethods['copier.save'][0];
        for (const follower of config.followers) {
          if (!copierRiskTypes.some((type) => type.key === follower.riskType)) throw new Error('Unknown risk type');
        }
        return this.copier.save(config);
      }
      case 'copier.remove': await this.copier.remove((params as AutomationMethods['copier.remove'][0]).id); return true;
      case 'copier.resetProtection': this.copier.resetProtection((params as AutomationMethods['copier.resetProtection'][0]).followerId); return true;
      case 'copier.exportAudit': return this.exportAudit((params as AutomationMethods['copier.exportAudit'][0]).copierId);
      case 'news.view': return this.news.view();
      case 'news.refresh': await this.news.refresh(); return this.news.view();
      case 'copier.symbols': {
        const { accountId } = params as AutomationMethods['copier.symbols'][0];
        const link = await this.deps.pool.acquire(accountId, 'symbols');
        try { return (await link.request('symbols.list', {})).map((spec) => spec.name); }
        finally { this.deps.pool.release(accountId, 'symbols'); }
      }
      case 'accounts.unlock': {
        const { id, password } = params as AutomationMethods['accounts.unlock'][0];
        const accounts = this.deps.accounts();
        if (!accounts) throw new Error('Account storage is unavailable');
        accounts.unlock(id, password);
        await this.deps.pool.retry(id);
        await this.copier.resync();
        return true;
      }
      case 'webhooks.view': {
        const view: WebhookView = { status: this.webhooks.status(), records: this.webhooks.recent(), settings: this.settings, notifications: this.notifications, canEncrypt: this.deps.cipher.canEncrypt() };
        return view;
      }
      case 'webhooks.save': {
        this.settings = validateWebhookSettings(params as WebhookSettings);
        await this.persistSecrets();
        const status = await this.webhooks.apply(this.settings);
        this.syncSourceSessions();
        return status;
      }
      case 'webhooks.secret': return randomBytes(32).toString('base64url');
      case 'webhooks.test': {
        const { sourceId, body } = params as AutomationMethods['webhooks.test'][0];
        const source = this.settings.sources.find((item) => item.id === sourceId);
        if (!source) throw new Error('Save the source before testing it');
        return this.webhooks.test(source, body);
      }
      case 'notifications.save': {
        const targets = params as NotificationTarget[];
        if (!Array.isArray(targets) || targets.length > 20) throw new Error('At most 20 notification targets');
        for (const target of targets) {
          if (!notificationKinds.some((kind) => kind.key === target.kind)) throw new Error('Unknown notification kind');
          const problem = validateTarget(target);
          if (problem) throw new Error(`${target.name || 'Target'}: ${problem}`);
          target.events = target.events.filter((event) => notificationEvents.some((item) => item.key === event));
        }
        this.notifications = targets;
        this.notifier.setTargets(targets);
        await this.persistSecrets();
        return true;
      }
      case 'notifications.test': {
        const target = params as NotificationTarget;
        const problem = validateTarget(target);
        if (problem) throw new Error(problem);
        return this.notifier.send(target, 'signal', 'OpenTerm5 test', 'Notifications from OpenTerm5 will arrive here.');
      }
    }
  }

  async shutdown(): Promise<void> {
    for (const [sourceId, accountId] of this.heldSources) this.deps.pool.release(accountId, `webhook:${sourceId}`);
    this.news.stop();
    this.copier.shutdown();
    await this.webhooks.stop();
  }
}
