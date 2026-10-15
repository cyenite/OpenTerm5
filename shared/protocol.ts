import type { TradingViewAccount, TradingViewChartSettingsScan, TradingViewDrawings, TradingViewDrawingTemplate, TradingViewScan, TradingViewSymbol } from './tradingview';
import type { Valuation } from './valuation';

export const timeframes = [
  { label: 'M1', seconds: 60, isOnToolbar: true },
  { label: 'M2', seconds: 120, isOnToolbar: false },
  { label: 'M3', seconds: 180, isOnToolbar: false },
  { label: 'M4', seconds: 240, isOnToolbar: false },
  { label: 'M5', seconds: 300, isOnToolbar: true },
  { label: 'M6', seconds: 360, isOnToolbar: false },
  { label: 'M10', seconds: 600, isOnToolbar: false },
  { label: 'M12', seconds: 720, isOnToolbar: false },
  { label: 'M15', seconds: 900, isOnToolbar: true },
  { label: 'M20', seconds: 1200, isOnToolbar: false },
  { label: 'M30', seconds: 1800, isOnToolbar: true },
  { label: 'H1', seconds: 3600, isOnToolbar: true },
  { label: 'H2', seconds: 7200, isOnToolbar: false },
  { label: 'H3', seconds: 10800, isOnToolbar: false },
  { label: 'H4', seconds: 14400, isOnToolbar: true },
  { label: 'H6', seconds: 21600, isOnToolbar: false },
  { label: 'H8', seconds: 28800, isOnToolbar: false },
  { label: 'H12', seconds: 43200, isOnToolbar: false },
  { label: 'D1', seconds: 86400, isOnToolbar: true },
  { label: 'W1', seconds: 604800, isOnToolbar: false },
  { label: 'MN1', seconds: 2592000, isOnToolbar: false },
] as const;

export type Timeframe = (typeof timeframes)[number]['label'];

export const orderTypes = [
  { key: 'buy', label: 'Buy', isBuy: true, isPending: false },
  { key: 'sell', label: 'Sell', isBuy: false, isPending: false },
  { key: 'buyLimit', label: 'Buy Limit', isBuy: true, isPending: true },
  { key: 'sellLimit', label: 'Sell Limit', isBuy: false, isPending: true },
  { key: 'buyStop', label: 'Buy Stop', isBuy: true, isPending: true },
  { key: 'sellStop', label: 'Sell Stop', isBuy: false, isPending: true },
  { key: 'buyStopLimit', label: 'Buy Stop Limit', isBuy: true, isPending: true },
  { key: 'sellStopLimit', label: 'Sell Stop Limit', isBuy: false, isPending: true },
] as const;

export type OrderTypeKey = (typeof orderTypes)[number]['key'];

export function orderType(key: string) {
  return orderTypes.find((type) => type.key === key);
}

export type TerminalMode = 'mt5-web';

export interface TerminalStatus {
  mode: TerminalMode;
  name?: string;
  path?: string;
  build?: number;
  company?: string;
  language?: string;
  pingLast?: number;
  isConnected: boolean;
  isTradeAllowed?: boolean;
  connectionState?: 'login-required' | 'authenticating' | 'connected' | 'reconnecting' | 'disconnected';
  capabilities?: { history: boolean; trading: boolean; depth: boolean };
}

export interface Account {
  name: string;
  server: string;
  company: string;
  currency: string;
  tradeMode: 'demo' | 'contest' | 'real';
  login: number;
  credit: number;
  margin: number;
  equity: number;
  profit: number;
  balance: number;
  leverage: number;
  marginFree: number;
  marginLevel: number;
  isHedging: boolean;
  isFifo?: boolean;
  isEquityLive?: boolean;
  isTradeAllowed: boolean;
  // The trade server's clock minus UTC right now, as the server reports it.
  utcOffsetSeconds?: number;
}

export interface SymbolSpec {
  tickSize?: number;
  freezeLevel?: number;
  executionMode?: number;
  fillingFlags?: number;
  expirationFlags?: number;
  orderFlags?: number;
  name: string;
  path: string;
  tradeMode: string;
  description: string;
  currencyBase: string;
  currencyProfit: string;
  currencyMargin: string;
  point: number;
  digits: number;
  spread: number;
  swapLong: number;
  swapShort: number;
  volumeMin: number;
  volumeMax: number;
  stopsLevel: number;
  volumeStep: number;
  contractSize: number;
  visible: boolean;
  isSpreadFloat: boolean;
}

export interface Tick {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  time: number;
  volume: number;
}

export interface Bar {
  low: number;
  time: number;
  high: number;
  open: number;
  close: number;
  volume: number;
}

export interface BookLevel {
  side: 'buy' | 'sell';
  price: number;
  volume: number;
}

export interface Book {
  isAvailable?: boolean;
  symbol: string;
  levels: BookLevel[];
}

export interface Position {
  side: 'buy' | 'sell';
  symbol: string;
  comment: string;
  sl: number;
  tp: number;
  swap: number;
  time: number;
  magic: number;
  ticket: number;
  volume: number;
  profit: number;
  priceOpen: number;
  priceCurrent: number;
}

export interface Order {
  type: OrderTypeKey;
  symbol: string;
  comment: string;
  sl: number;
  tp: number;
  time: number;
  state: number;
  ticket: number;
  volume: number;
  timeDone: number;
  priceOpen: number;
  expiration: number;
  positionId: number;
  priceCurrent: number;
  volumeInitial: number;
  stoplimit?: number;
  filling?: number;
  expirationMode?: number;
}

export interface Deal {
  type: string;
  entry: 'in' | 'out' | 'inout' | 'outBy';
  symbol: string;
  comment: string;
  fee: number;
  swap: number;
  time: number;
  order: number;
  price: number;
  ticket: number;
  volume: number;
  profit: number;
  positionId: number;
  commission: number;
}

export interface TradeSnapshot {
  orders: Order[];
  account: Account | null;
  positions: Position[];
}

export interface History {
  deals: Deal[];
  orders: Order[];
}

export type TradeAction = 'deal' | 'pending' | 'sltp' | 'modify' | 'remove' | 'closeBy';

export interface TradeRequest {
  action: TradeAction;
  type?: OrderTypeKey;
  symbol?: string;
  comment?: string;
  sl?: number;
  tp?: number;
  order?: number;
  price?: number;
  volume?: number;
  position?: number;
  positionBy?: number;
  stoplimit?: number;
  deviation?: number;
  expiration?: number;
}

export interface TradeResult {
  comment: string;
  bid?: number;
  ask?: number;
  deal?: number;
  order?: number;
  price?: number;
  volume?: number;
  retcode: number;
  isSuccess: boolean;
}

export interface CheckResult {
  comment: string;
  margin: number;
  equity: number;
  retcode: number;
  balance: number;
  marginFree: number;
  marginLevel: number;
  isSuccess: boolean;
  hasMarginEstimate?: boolean;
}

export interface JournalEntry {
  source: string;
  message: string;
  time: number;
}

export interface TerminalMethods {
  'accounts.storage': [Record<string, never>, { canSavePasswords: boolean }];
  'accounts.list': [Record<string, never>, AccountProfile[]];
  'accounts.connect': [{ id: string; password?: string; otp?: string; isPasswordSaved?: boolean }, Account];
  'accounts.remove': [{ id: string }, boolean];
  'brokers.search': [{ query: string }, BrokerServer[]];
  'brokers.resolve': [{ server: string; webUrl?: string }, ResolvedServer];
  'tradingview.account': [Record<string, never>, TradingViewAccount | null];
  'tradingview.signIn': [Record<string, never>, TradingViewAccount | null];
  'tradingview.signOut': [Record<string, never>, boolean];
  'tradingview.symbols': [Record<string, never>, TradingViewScan];
  'tradingview.drawings': [{ symbols: TradingViewSymbol[] }, TradingViewDrawings];
  'tradingview.drawingTemplates': [{ types: string[] }, TradingViewDrawingTemplate[]];
  'tradingview.themes': [Record<string, never>, string[]];
  'tradingview.theme': [{ name: string }, unknown];
  'tradingview.chartSettings': [Record<string, never>, TradingViewChartSettingsScan];
  'terminal.status': [Record<string, never>, TerminalStatus];
  'account.info': [Record<string, never>, Account | null];
  'account.login': [{ login: number; password: string; otp?: string; webEndpoint?: string; label?: string; isPasswordSaved?: boolean }, Account];
  'symbols.info': [{ symbol: string }, SymbolSpec];
  'symbols.list': [Record<string, never>, SymbolSpec[]];
  'symbols.select': [{ symbol: string; isEnabled: boolean }, boolean];
  'ticks.subscribe': [{ symbols: string[] }, (Tick | null)[]];
  'rates.get': [{ symbol: string; timeframe: Timeframe; count: number }, Bar[]];
  'rates.subscribe': [{ symbol: string; timeframe: Timeframe }, boolean];
  'rates.unsubscribe': [{ symbol: string; timeframe: Timeframe }, boolean];
  'book.subscribe': [{ symbol: string }, Book];
  'book.unsubscribe': [{ symbol: string }, boolean];
  'trade.snapshot': [Record<string, never>, TradeSnapshot];
  'history.get': [{ from: number; to: number }, History];
  'order.check': [TradeRequest, CheckResult];
  'order.send': [TradeRequest, TradeResult];
  'symbols.valuation': [{ symbol: string }, Valuation];
  'symbols.quote': [{ symbol: string }, { symbol: string; bid: number; ask: number; time: number }];
}

export type TerminalMethod = keyof TerminalMethods;

export interface TerminalEvents {
  accounts: AccountProfile[];
  accountChanged: { id: string | null };
  status: TerminalStatus;
  symbols: SymbolSpec[];
  bar: { symbol: string; timeframe: Timeframe; bar: Bar };
  book: Book;
  tick: Tick;
  trade: TradeSnapshot;
  journal: JournalEntry;
  link: LinkState;
  fullScreen: boolean;
}

export type TerminalEvent = keyof TerminalEvents;

export interface LinkState {
  url: string;
  error?: string;
  latency?: number;
  state: 'idle' | 'connecting' | 'open' | 'closed';
}

export interface ConnectionSettings {
  readonly webEndpoint: string;
}

export interface AccountProfile {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly server: string;
  readonly company: string;
  readonly webEndpoint: string;
  readonly tradeMode: Account['tradeMode'];
  readonly login: number;
  readonly lastUsed: number;
  readonly hasPassword: boolean;
  readonly isPasswordSaved: boolean;
  readonly isActive?: boolean;
}

export interface ServerLookupResult {
  readonly type: string;
  readonly broker: string;
  readonly server: string;
  readonly webUrl: string;
  readonly webEndpoint: string;
  readonly isWebAvailable: boolean;
}

export interface BrokerServer {
  readonly type: string;
  readonly broker: string;
  readonly server: string;
}

export const serverSources = [
  { key: 'known', label: 'Verified broker terminal', isTrusted: true },
  { key: 'saved', label: 'Used for a previous successful login', isTrusted: true },
  { key: 'discovered', label: 'Found by searching broker hosts', isTrusted: false },
  { key: 'manual', label: 'Entered by you', isTrusted: false },
] as const;

export type ServerSource = (typeof serverSources)[number]['key'];

export interface ResolvedServer {
  readonly broker: string;
  readonly server: string;
  readonly webUrl: string;
  readonly webEndpoint: string;
  readonly isListed: boolean;
  readonly source: ServerSource;
}

export interface TerminalApi {
  request<M extends TerminalMethod>(method: M, params: TerminalMethods[M][0]): Promise<TerminalMethods[M][1]>;
  on<E extends TerminalEvent>(event: E, listener: (data: TerminalEvents[E]) => void): () => void;
  link(): Promise<LinkState>;
  settings(): Promise<ConnectionSettings>;
  saveSettings(settings: ConnectionSettings): Promise<LinkState>;
  platform: string;
}
