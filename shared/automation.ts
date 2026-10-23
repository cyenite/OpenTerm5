import type { OrderTypeKey, TradeResult } from './protocol';
import type { DistanceUnit, RiskMode } from './risk';
import type { NewsImpact, NewsView } from './news';
import { isNewsImpact } from './news';
import type { LossBasis, ResetZone } from './trading-day';
import { isLossBasis, isResetZone } from './trading-day';

export interface PartialTarget {
  points: number;
  percent: number;
  isDone?: boolean;
}

export interface PositionRule {
  ticket: number;
  symbol: string;
  accountId: string;
  side: 'buy' | 'sell';
  error?: string;
  partials: PartialTarget[];
  closeAt?: number;
  createdAt: number;
  initialVolume: number;
  virtualStop?: number;
  virtualTarget?: number;
  breakEven?: { triggerPoints: number; lockPoints: number; isDone?: boolean };
  trailing?: { startPoints: number; distancePoints: number; stepPoints: number };
  isPaused?: boolean;
}

export const guardActions = [
  { key: 'blockNew', label: 'Block new trades' },
  { key: 'closeAll', label: 'Close everything and block' },
] as const;

export type GuardAction = (typeof guardActions)[number]['key'];

export interface AccountGuard {
  accountId: string;
  action: GuardAction;
  resetHour: number;
  resetZone: ResetZone;
  lossBasis: LossBasis;
  newsImpact: NewsImpact;
  dailyLossMoney?: number;
  maxOpenPositions?: number;
  maxLotsPerSymbol?: number;
  dailyLossPercent?: number;
  dailyProfitMoney?: number;
  maxDailyRequests?: number;
  newsMinutesAfter?: number;
  newsMinutesBefore?: number;
  maxDrawdownPercent?: number;
  isEnabled: boolean;
}

export const defaultGuard = (accountId: string): AccountGuard => ({
  accountId, action: 'blockNew', resetHour: 0, resetZone: 'server', lossBasis: 'higher', newsImpact: 'high', isEnabled: false,
});

// Guards saved before the reset zone and loss basis existed keep their old behaviour:
// local time and equity at day start.
export function parseGuard(value: AccountGuard): AccountGuard {
  return {
    ...value,
    resetZone: isResetZone(value.resetZone) ? value.resetZone : 'local',
    lossBasis: isLossBasis(value.lossBasis) ? value.lossBasis : 'equity',
    newsImpact: isNewsImpact(value.newsImpact) ? value.newsImpact : 'high',
    resetHour: Number.isInteger(value.resetHour) && value.resetHour >= 0 && value.resetHour <= 23 ? value.resetHour : 0,
  };
}

export interface GuardState {
  dayKey: string;
  accountId: string;
  reason?: string;
  trippedAt?: number;
  peakEquity: number;
  dayStartedAt?: number;
  dayStartEquity: number;
  dayStartBalance: number;
}

export interface RequestCount {
  count: number;
  dayKey: string;
  accountId: string;
}

export const bulkKinds = [
  { key: 'closeAll', label: 'Close all positions' },
  { key: 'closeProfitable', label: 'Close profitable positions' },
  { key: 'closeLosing', label: 'Close losing positions' },
  { key: 'closeBuys', label: 'Close buy positions' },
  { key: 'closeSells', label: 'Close sell positions' },
  { key: 'closeSymbol', label: 'Close positions on symbol' },
  { key: 'deletePending', label: 'Delete pending orders' },
  { key: 'breakEvenAll', label: 'Move all stops to break-even' },
  { key: 'reverse', label: 'Reverse position' },
] as const;

export type BulkKind = (typeof bulkKinds)[number]['key'];

export interface BulkRequest {
  kind: BulkKind;
  symbol?: string;
  ticket?: number;
  accountId?: string;
}

export interface BulkOutcome {
  ticket: number;
  symbol: string;
  result: TradeResult;
}

export interface Distance {
  unit: DistanceUnit;
  value: number;
}

export interface RiskOrderRequest {
  type: OrderTypeKey;
  mode: RiskMode;
  symbol: string;
  comment?: string;
  accountId?: string;
  stopLoss?: Distance;
  takeProfits?: { distance: Distance; share: number }[];
  takeProfitR?: number[];
  price?: number;
  value: number;
  maxLots?: number;
  expiration?: number;
  commissionPerLot?: number;
  management?: {
    trailing?: PositionRule['trailing'];
    breakEvenR?: number;
    isBreakEvenAfterFirstTarget?: boolean;
    isStealth?: boolean;
  };
  isDryRun?: boolean;
}

export interface RiskOrderOutcome {
  lots: number;
  warnings: string[];
  results: TradeResult[];
  riskMoney: number;
  stopLoss: number;
  entry: number;
  takeProfits: number[];
  isDryRun: boolean;
  margin?: number;
  leverage?: number;
  safeLeverage?: number;
  // 0 when no price can liquidate the position.
  liquidationPrice?: number;
}

export type CopierStatus = 'enabled' | 'monitorExisting' | 'disabled';

export const copierRiskTypes = [
  { key: 'fixedLot', label: 'Fixed lot', hint: 'Every copy opens this many lots.' },
  { key: 'lotMultiplier', label: 'Lot multiplier', hint: '100% copies the master volume exactly.' },
  { key: 'balanceMultiplier', label: 'Balance multiplier', hint: '100% risks the same share of balance as the master.' },
  { key: 'equityMultiplier', label: 'Equity multiplier', hint: '100% matches the master volume scaled by equity.' },
  { key: 'fixedBalance', label: 'Fixed master balance', hint: 'Scales by follower balance against a fixed master balance, so the follower compounds.' },
  { key: 'fixedRisk', label: 'Fixed % risk', hint: 'Sizes each copy to risk this % of follower balance. The master trade needs a stop loss.' },
] as const;

export type CopierRiskType = (typeof copierRiskTypes)[number]['key'];

export interface TradingWindow {
  day: number;
  end: string;
  start: string;
}

export interface EquityProtection {
  action: GuardAction;
  lossBasis: LossBasis;
  resetZone: ResetZone;
  minEquity: number;
  resetHour: number;
  maxDailyLossPercent: number;
}

export const defaultEquityProtection: EquityProtection = { action: 'blockNew', minEquity: 0, resetHour: 0, resetZone: 'server', lossBasis: 'higher', maxDailyLossPercent: 0 };

// Followers saved before the reset settings existed keep resetting at local midnight on equity.
export function parseEquityProtection(value: Partial<EquityProtection> | undefined): EquityProtection {
  const raw = value ?? {};
  return {
    action: raw.action === 'closeAll' ? 'closeAll' : 'blockNew',
    minEquity: Number(raw.minEquity) > 0 ? Number(raw.minEquity) : 0,
    resetHour: Number.isInteger(raw.resetHour) && raw.resetHour! >= 0 && raw.resetHour! <= 23 ? raw.resetHour! : 0,
    resetZone: isResetZone(raw.resetZone) ? raw.resetZone : 'local',
    lossBasis: isLossBasis(raw.lossBasis) ? raw.lossBasis : 'equity',
    maxDailyLossPercent: Number(raw.maxDailyLossPercent) > 0 ? Number(raw.maxDailyLossPercent) : 0,
  };
}

export interface FollowerConfig {
  id: string;
  accountId: string;
  status: CopierStatus;
  riskType: CopierRiskType;
  comment: 'copy' | 'none' | 'custom';
  customComment: string;
  side: 'all' | 'buy' | 'sell';
  symbolMap: Record<string, string>;
  magicFilter: { mode: 'off' | 'copy' | 'ignore'; values: number[] };
  commentFilter: { mode: 'off' | 'copy' | 'ignore'; values: string[] };
  symbolFilter: { mode: 'off' | 'copy' | 'ignore'; values: string[] };
  tradingHours: TradingWindow[];
  delay: { minMs: number; maxMs: number };
  lotFilter: { min: number; max: number };
  equityProtection: EquityProtection;
  stopMode: 'price' | 'distance';
  riskValue: number;
  lotRefiner: number;
  fixedStopPips: number;
  fixedTargetPips: number;
  stopRefinePips: number;
  targetRefinePips: number;
  fixedMasterBalance: number;
  maxOpenTrades: number;
  isReversed: boolean;
  isStopCopied: boolean;
  isTargetCopied: boolean;
  isPendingCopied: boolean;
  isExpiryCopied: boolean;
  isStrictClose: boolean;
  isExistingCopied: boolean;
  isMinimumForced: boolean;
  isMaximumForced: boolean;
  isContractAligned: boolean;
  isSuffixAutoMapped: boolean;
}

export interface CopierConfig {
  id: string;
  name: string;
  status: CopierStatus;
  masterId: string;
  followers: FollowerConfig[];
  createdAt: number;
}

export interface CopierLogEntry {
  id: string;
  time: number;
  event: string;
  status: 'ok' | 'skipped' | 'failed' | 'retrying' | 'unknown';
  symbol: string;
  message: string;
  copierId: string;
  accountId?: string;
  followerId: string;
  latencyMs?: number;
  masterTicket?: number;
  followerTicket?: number;
}

export interface CopierLinkState {
  accountId: string;
  state: 'connecting' | 'connected' | 'failed' | 'idle';
  error?: string;
}

export const signalActions = [
  { key: 'buy', isOpening: true, label: 'Buy at market' },
  { key: 'sell', isOpening: true, label: 'Sell at market' },
  { key: 'buy_limit', isOpening: true, label: 'Buy limit' },
  { key: 'sell_limit', isOpening: true, label: 'Sell limit' },
  { key: 'buy_stop', isOpening: true, label: 'Buy stop' },
  { key: 'sell_stop', isOpening: true, label: 'Sell stop' },
  { key: 'reverse', isOpening: true, label: 'Reverse position' },
  { key: 'close', isOpening: false, label: 'Close' },
  { key: 'close_buy', isOpening: false, label: 'Close buys' },
  { key: 'close_sell', isOpening: false, label: 'Close sells' },
  { key: 'close_all', isOpening: false, label: 'Close all' },
  { key: 'cancel', isOpening: false, label: 'Cancel orders' },
  { key: 'cancel_all', isOpening: false, label: 'Cancel all orders' },
  { key: 'modify', isOpening: false, label: 'Modify SL/TP' },
  { key: 'breakeven', isOpening: false, label: 'Break-even' },
] as const;

export interface WebhookSource {
  id: string;
  name: string;
  auth: 'token' | 'hmac';
  secret: string;
  accountId: string;
  sizing: { mode: RiskMode | 'signal'; value: number; maxLots: number };
  symbolMap: Record<string, string>;
  symbolSuffix: string;
  allowedSymbols: string[];
  allowedActions: string[];
  maxPerMinute: number;
  defaultStop?: Distance;
  createdAt: number;
  isEnabled: boolean;
  isDryRun: boolean;
  isStopRequired: boolean;
}

export interface WebhookSettings {
  host: string;
  port: number;
  sources: WebhookSource[];
  isEnabled: boolean;
  isPaused: boolean;
}

export interface SignalRecord {
  id: string;
  time: number;
  action: string;
  status: 'accepted' | 'rejected' | 'executed' | 'failed' | 'duplicate' | 'dryRun';
  symbol: string;
  message: string;
  sourceId: string;
  remote: string;
  results: TradeResult[];
  latencyMs?: number;
  payload: Record<string, unknown>;
}

export interface WebhookStatus {
  url: string;
  error?: string;
  isRunning: boolean;
}

export const notificationEvents = [
  { key: 'signal', label: 'Webhook signals' },
  { key: 'copier', label: 'Copier failures' },
  { key: 'guard', label: 'Equity guard trips' },
  { key: 'manager', label: 'Trade manager actions' },
] as const;

export type NotificationEvent = (typeof notificationEvents)[number]['key'];

export const notificationKinds = [
  { key: 'discord', label: 'Discord webhook' },
  { key: 'slack', label: 'Slack webhook' },
  { key: 'telegram', label: 'Telegram bot' },
  { key: 'json', label: 'JSON POST' },
] as const;

export interface NotificationTarget {
  id: string;
  kind: (typeof notificationKinds)[number]['key'];
  url: string;
  name: string;
  chatId: string;
  events: NotificationEvent[];
  isEnabled: boolean;
}

export interface ManagerView {
  rules: PositionRule[];
  guards: AccountGuard[];
  guardStates: GuardState[];
  requestCounts: RequestCount[];
}

export interface AuditExportResult {
  path: string | null;
  entries: number;
}

export interface CopierMappingView {
  id: string;
  kind: 'position' | 'order';
  status: string;
  symbol: string;
  reason?: string;
  copierId: string;
  followerId: string;
  masterTicket: number;
  followerTicket: number;
  masterVolume: number;
  followerVolume: number;
}

export interface CopierView {
  configs: CopierConfig[];
  logs: CopierLogEntry[];
  links: CopierLinkState[];
  mappings: CopierMappingView[];
  protections: { followerId: string; reason?: string; trippedAt?: number }[];
}

export interface WebhookView {
  status: WebhookStatus;
  records: SignalRecord[];
  settings: WebhookSettings;
  notifications: NotificationTarget[];
  canEncrypt: boolean;
}

export const plannerRiskModes = [
  { key: 'percentEquity', label: '% equity', unit: '%' },
  { key: 'percentBalance', label: '% balance', unit: '%' },
  { key: 'money', label: 'Amount', unit: '' },
] as const;

export type PlannerRiskMode = (typeof plannerRiskModes)[number]['key'];

export interface RiskPreferences {
  mode: PlannerRiskMode;
  value: number;
  commissionPerLot: number;
}

export const defaultRiskPreferences: RiskPreferences = { mode: 'percentEquity', value: 1, commissionPerLot: 0 };

export function parseRiskPreferences(value: unknown): RiskPreferences {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<RiskPreferences>;
  const mode = plannerRiskModes.some((item) => item.key === raw.mode) ? raw.mode! : defaultRiskPreferences.mode;
  const amount = Number(raw.value);
  const commission = Number(raw.commissionPerLot);
  return {
    mode,
    value: Number.isFinite(amount) && amount > 0 && (mode === 'money' || amount <= 20) ? amount : defaultRiskPreferences.value,
    commissionPerLot: Number.isFinite(commission) && commission >= 0 ? commission : 0,
  };
}

export interface AutomationMethods {
  'preferences.risk': [Record<string, never>, RiskPreferences];
  'preferences.setRisk': [RiskPreferences, RiskPreferences];
  'manager.state': [Record<string, never>, ManagerView];
  'manager.setRule': [PositionRule, boolean];
  'manager.removeRule': [{ accountId: string; ticket: number }, boolean];
  'manager.setGuard': [AccountGuard, boolean];
  'manager.resetGuard': [{ accountId: string }, boolean];
  'manager.bulk': [BulkRequest, BulkOutcome[]];
  'manager.risk': [RiskOrderRequest, RiskOrderOutcome];
  'copier.view': [Record<string, never>, CopierView];
  'copier.save': [CopierConfig, CopierConfig];
  'copier.remove': [{ id: string }, boolean];
  'copier.resetProtection': [{ followerId: string }, boolean];
  'copier.symbols': [{ accountId: string }, string[]];
  'copier.exportAudit': [{ copierId?: string }, AuditExportResult];
  'news.view': [Record<string, never>, NewsView];
  'news.refresh': [Record<string, never>, NewsView];
  'accounts.unlock': [{ id: string; password: string }, boolean];
  'webhooks.view': [Record<string, never>, WebhookView];
  'webhooks.save': [WebhookSettings, WebhookStatus];
  'webhooks.secret': [Record<string, never>, string];
  'webhooks.test': [{ sourceId: string; body: string }, SignalRecord];
  'notifications.save': [NotificationTarget[], boolean];
  'notifications.test': [NotificationTarget, boolean];
}

export type AutomationMethod = keyof AutomationMethods;

export interface AutomationEvents {
  news: NewsView;
  manager: ManagerView;
  copier: CopierView;
  copierLog: CopierLogEntry;
  signal: SignalRecord;
  webhookStatus: WebhookStatus;
}

export type AutomationEvent = keyof AutomationEvents;

export interface AutomationApi {
  request<M extends AutomationMethod>(method: M, params: AutomationMethods[M][0]): Promise<AutomationMethods[M][1]>;
  on<E extends AutomationEvent>(event: E, listener: (data: AutomationEvents[E]) => void): () => void;
}
