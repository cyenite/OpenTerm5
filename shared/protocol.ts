import type { TradingViewAccount, TradingViewChanges, TradingViewChartSettingsScan, TradingViewDrawings, TradingViewDrawingTemplate, TradingViewPush, TradingViewScan, TradingViewScript, TradingViewScriptPage, TradingViewStreamStatus, TradingViewSymbol, TradingViewWatchedLayout } from './tradingview';
import type { Valuation } from './valuation';
import type { ZoomStep } from './zoom';

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

export type TerminalMode = 'mt5-web' | Exclude<Platform, 'mt5'>;

// What an account trades. Charts, watchlists and risk ticket settings belong to a market, so a
// crypto chart never opens on a forex account and the other way round.
export const markets = [
  { key: 'fx', label: 'Forex and CFDs' },
  { key: 'crypto', label: 'Crypto' },
] as const;

export type Market = (typeof markets)[number]['key'];

export const platforms = [
  { key: 'mt5', label: 'MetaTrader 5', market: 'fx' },
  { key: 'bybit', label: 'Bybit', market: 'crypto' },
  { key: 'binance', label: 'Binance', market: 'crypto' },
] as const satisfies readonly { key: string; label: string; market: Market }[];

export type Platform = (typeof platforms)[number]['key'];

export const marketOf = (platform: Platform): Market => platforms.find((item) => item.key === platform)?.market ?? 'fx';

export const platformOfMode = (mode: TerminalMode): Platform => mode === 'mt5-web' ? 'mt5' : mode;

// Before the status arrives the window treats the account as forex, as MT5 was the only kind.
export const marketOfMode = (mode: TerminalMode | undefined): Market => mode ? marketOf(platformOfMode(mode)) : 'fx';

// Demo trading takes public market data from mainnet; only its REST API and private stream differ.
export const bybitEnvironments = [
  { key: 'demo', label: 'Demo trading', tradeMode: 'demo', restUrl: 'https://api-demo.bybit.com', publicUrl: 'wss://stream.bybit.com/v5/public', privateUrl: 'wss://stream-demo.bybit.com/v5/private' },
  { key: 'mainnet', label: 'Live', tradeMode: 'real', restUrl: 'https://api.bybit.com', publicUrl: 'wss://stream.bybit.com/v5/public', privateUrl: 'wss://stream.bybit.com/v5/private' },
  { key: 'testnet', label: 'Testnet', tradeMode: 'demo', restUrl: 'https://api-testnet.bybit.com', publicUrl: 'wss://stream-testnet.bybit.com/v5/public', privateUrl: 'wss://stream-testnet.bybit.com/v5/private' },
] as const;

export type BybitEnvironment = (typeof bybitEnvironments)[number]['key'];

export const bybitEnvironment = (key: string) => bybitEnvironments.find((item) => item.key === key);

// USDⓈ-M futures. Since 2026-04-23 the streams are split: book tickers on /public, mark prices
// and klines on /market, user data on /private. The spot API holds the key's permissions and UID.
export const binanceEnvironments = [
  {
    key: 'demo', label: 'Demo trading', tradeMode: 'demo', restUrl: 'https://demo-fapi.binance.com', spotUrl: 'https://demo-api.binance.com',
    publicUrl: 'wss://demo-fstream.binance.com/public', marketUrl: 'wss://demo-fstream.binance.com/market', privateUrl: 'wss://demo-fstream.binance.com/private',
  },
  {
    key: 'mainnet', label: 'Live', tradeMode: 'real', restUrl: 'https://fapi.binance.com', spotUrl: 'https://api.binance.com',
    publicUrl: 'wss://fstream.binance.com/public', marketUrl: 'wss://fstream.binance.com/market', privateUrl: 'wss://fstream.binance.com/private',
  },
] as const;

export type BinanceEnvironment = (typeof binanceEnvironments)[number]['key'];

export const binanceEnvironment = (key: string) => binanceEnvironments.find((item) => item.key === key);

export type ExchangePlatform = Exclude<Platform, 'mt5'>;

export const exchangeEnvironments = { bybit: bybitEnvironments, binance: binanceEnvironments } as const;

export interface ExchangeEnvironmentInfo {
  key: string;
  label: string;
  restUrl: string;
  tradeMode: Account['tradeMode'];
}

export const isExchangePlatform = (platform: Platform): platform is ExchangePlatform => platform !== 'mt5';

export const exchangeEnvironment = (platform: ExchangePlatform, key: string): ExchangeEnvironmentInfo | undefined =>
  (exchangeEnvironments[platform] as readonly ExchangeEnvironmentInfo[]).find((item) => item.key === key);

// An API key pair for one exchange environment; the environment keys differ per exchange.
export type ExchangeCredentials = {
  [P in ExchangePlatform]: { platform: P; environment: (typeof exchangeEnvironments)[P][number]['key']; apiKey: string; apiSecret: string };
}[ExchangePlatform];

export const marginModes = [
  { key: 'cross', label: 'Cross', apiValue: 'REGULAR_MARGIN' },
  { key: 'isolated', label: 'Isolated', apiValue: 'ISOLATED_MARGIN' },
  { key: 'portfolio', label: 'Portfolio', apiValue: 'PORTFOLIO_MARGIN' },
] as const;

export type MarginMode = (typeof marginModes)[number]['key'];

export interface LeverageState {
  symbol: string;
  leverage: number;
  leverageMin: number;
  leverageMax: number;
  leverageStep: number;
  maintenanceRate?: number;
  marginMode?: MarginMode;
}

export type ExchangeLogin = ExchangeCredentials & {
  label?: string;
  isPasswordSaved?: boolean;
};

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
  leverage?: number;
  liquidationPrice?: number;
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
  // Set when the deal went into a position whose ticket differs from the order's, as on netting accounts.
  position?: number;
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
  leverage?: number;
  maintenanceRate?: number;
  // 0 when no price can liquidate the position.
  liquidationPrice?: number;
}

export interface JournalEntry {
  source: string;
  message: string;
  time: number;
}

export interface ClientIdState {
  isUnique: boolean;
}

export interface TerminalMethods {
  'accounts.storage': [Record<string, never>, { canSavePasswords: boolean }];
  'accounts.list': [Record<string, never>, AccountProfile[]];
  'accounts.signIn': [Record<string, never>, AccountSignIn | null];
  'accounts.connect': [{ id: string; password?: string; otp?: string; isPasswordSaved?: boolean }, Account];
  'accounts.remove': [{ id: string }, boolean];
  'brokers.search': [{ query: string }, BrokerServer[]];
  'device.identity': [Record<string, never>, ClientIdState];
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
  // Follows exactly these layouts' change streams; an empty list stops following.
  'tradingview.watch': [{ layouts: TradingViewWatchedLayout[] }, boolean];
  'tradingview.push': [TradingViewPush, { serverUpdateTime: number }];
  // Needs no sign-in: open-source scripts are public.
  'tradingview.script': [{ url: string }, TradingViewScript];
  'tradingview.scriptList': [{ page: number }, TradingViewScriptPage];
  'tradingview.scriptSource': [{ scriptId: string; version: number }, string];
  'terminal.status': [Record<string, never>, TerminalStatus];
  'account.info': [Record<string, never>, Account | null];
  'account.login': [{ login: number; password: string; otp?: string; server?: string; webEndpoint?: string; label?: string; isPasswordSaved?: boolean; isUniqueClientIdRequested?: boolean }, Account];
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
  'exchange.login': [ExchangeLogin, Account];
  'symbols.leverage': [{ symbol: string }, LeverageState];
  'symbols.setLeverage': [{ symbol: string; leverage: number }, LeverageState];
}

export type TerminalMethod = keyof TerminalMethods;

export interface TerminalEvents {
  accounts: AccountProfile[];
  accountChanged: { id: string | null };
  signIn: AccountSignIn | null;
  status: TerminalStatus;
  symbols: SymbolSpec[];
  bar: { symbol: string; timeframe: Timeframe; bar: Bar };
  book: Book;
  tick: Tick;
  trade: TradeSnapshot;
  journal: JournalEntry;
  link: LinkState;
  fullScreen: boolean;
  // The interface zoom factor, sent on every page load and change.
  zoom: number;
  tradingViewChanges: TradingViewChanges;
  tradingViewStream: TradingViewStreamStatus;
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
  readonly platform: Platform;
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

// The account the terminal is logging in to (automatically at startup, or on request), so the
// window can say so instead of looking logged out. It stays after a failure until the next attempt.
export interface AccountSignIn {
  readonly id: string | null;
  readonly error?: string;
  readonly label: string;
  readonly server: string;
  readonly state: 'signing-in' | 'failed';
  readonly login: number;
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
  // Steps the interface zoom and resolves with the new factor.
  zoom(step: ZoomStep): Promise<number>;
  platform: string;
}
