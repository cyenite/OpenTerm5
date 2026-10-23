import type { AutomationEvent, AutomationMethod } from './automation';
import type { TerminalEvent, TerminalMethod } from './protocol';

// The mobile hub: paired phones use this computer's broker sessions over an encrypted channel, so
// a phone never opens a second web session for an account and every order meets the same guards.

export const hubScopes = [
  { key: 'view', label: 'Charts only', description: 'Charts, drawings, quotes, positions and history. This device cannot trade.' },
  { key: 'trade', label: 'Charts and trading', description: 'Everything in Charts only, plus placing, changing and closing orders. Your guards still apply.' },
] as const;

export type HubScope = (typeof hubScopes)[number]['key'];

export const isHubScope = (value: unknown): value is HubScope => hubScopes.some((scope) => scope.key === value);

export const canUseScope = (granted: HubScope, required: HubScope) => granted === 'trade' || required === 'view';

// `link.state` is the broker link's state, which the window reads outside the request API.
// Account logins, saved passwords, connection settings, TradingView, the copier, signal sources and
// guard settings stay on this computer: a lost phone must not be able to change them.
export const hubTerminalMethods = {
  'accounts.list': 'view',
  'accounts.signIn': 'view',
  'terminal.status': 'view',
  'account.info': 'view',
  'symbols.info': 'view',
  'symbols.list': 'view',
  'symbols.quote': 'view',
  'symbols.leverage': 'view',
  'symbols.valuation': 'view',
  'ticks.subscribe': 'view',
  'rates.get': 'view',
  'rates.subscribe': 'view',
  'rates.unsubscribe': 'view',
  'trade.snapshot': 'view',
  'history.get': 'view',
  'link.state': 'view',
  'order.check': 'trade',
  'order.send': 'trade',
  'symbols.setLeverage': 'trade',
} as const satisfies Partial<Record<TerminalMethod | 'link.state', HubScope>>;

export const hubAutomationMethods = {
  'manager.state': 'view',
  'preferences.risk': 'view',
  'manager.risk': 'trade',
  'manager.bulk': 'trade',
} as const satisfies Partial<Record<AutomationMethod, HubScope>>;

export const hubChartMethods = {
  'charts.list': 'view',
  'charts.get': 'view',
  'charts.setMarket': 'view',
  'charts.editDrawings': 'view',
} as const;

export type HubChartMethod = keyof typeof hubChartMethods;

export const hubApis = [
  { key: 'terminal', methods: hubTerminalMethods },
  { key: 'automation', methods: hubAutomationMethods },
  { key: 'charts', methods: hubChartMethods },
] as const;

export type HubApiKey = (typeof hubApis)[number]['key'];

export function hubMethodScope(api: string, method: string): HubScope | null {
  const methods: Readonly<Record<string, HubScope>> | undefined = hubApis.find((item) => item.key === api)?.methods;
  return methods && Object.hasOwn(methods, method) ? methods[method] : null;
}

export const hubTerminalEvents = ['accounts', 'accountChanged', 'signIn', 'status', 'symbols', 'bar', 'tick', 'trade', 'journal', 'link'] as const satisfies readonly TerminalEvent[];

export const hubAutomationEvents = ['manager'] as const satisfies readonly AutomationEvent[];

// A drawing as Meridian saves it. The hub only routes drawings; each end validates them.
export interface HubDrawing {
  readonly id: string;
  readonly type: string;
}

export interface HubIndicator {
  readonly id: string;
  readonly kind: string;
  readonly params: Readonly<Record<string, string | number | boolean>>;
}

export interface HubChart {
  readonly id: string;
  readonly tabId: string;
  readonly symbol: string;
  readonly timeframe: string;
  readonly tabLabel: string;
  readonly isActive: boolean;
}

export interface HubChartDocument extends HubChart {
  readonly type: string;
  readonly drawings: readonly HubDrawing[];
  readonly indicators: readonly HubIndicator[];
  readonly isVolumeShown: boolean;
}

// Edits as operations on drawing ids, so a phone and the desktop editing different drawings of the
// same chart never overwrite each other's work.
export interface HubDrawingEdit {
  readonly chartId: string;
  readonly removals: readonly string[];
  readonly upserts: readonly HubDrawing[];
}

export interface HubChartMethods {
  'charts.list': [Record<string, never>, HubChart[]];
  'charts.get': [{ chartId: string }, HubChartDocument];
  'charts.setMarket': [{ chartId: string; symbol?: string; timeframe?: string }, HubChartDocument];
  'charts.editDrawings': [HubDrawingEdit, HubChartDocument];
}

// `isListChanged` when charts or tabs were added, removed or rearranged, not only edited.
export interface HubChartEvents {
  changed: { chartIds: string[]; isListChanged: boolean };
}

export interface HubRequest {
  readonly id: number;
  readonly kind: 'request';
  readonly api: HubApiKey;
  readonly method: string;
  readonly params: unknown;
}

export type HubReply =
  | { readonly id: number; readonly kind: 'reply'; readonly result: unknown }
  | { readonly id: number; readonly kind: 'reply'; readonly error: string };

export interface HubEventMessage {
  readonly kind: 'event';
  readonly api: HubApiKey;
  readonly data: unknown;
  readonly event: string;
}

export interface HubDeviceInfo {
  readonly id: string;
  readonly name: string;
  readonly scope: HubScope;
}

export interface HubReady {
  readonly kind: 'ready';
  readonly hub: { readonly name: string; readonly version: string };
  readonly device: HubDeviceInfo;
}

export interface HubAuth {
  readonly kind: 'auth';
  readonly name: string;
}

export type HubClientMessage = HubAuth | HubRequest;

export type HubServerMessage = HubReady | HubReply | HubEventMessage;

// What a pairing link carries. The token is mixed into the first session's keys and never sent.
export interface HubPairingPayload {
  readonly v: 1;
  readonly key: string;
  readonly name: string;
  readonly token: string;
  readonly scope: HubScope;
  readonly addresses: readonly string[];
}

export interface HubPairingOffer {
  readonly url: string;
  readonly scope: HubScope;
  readonly expiresAt: number;
}

export interface HubSettings {
  readonly port: number;
  readonly isEnabled: boolean;
}

export const defaultHubSettings: HubSettings = { port: 8788, isEnabled: false };

export interface HubDeviceView extends HubDeviceInfo {
  readonly address?: string;
  readonly pairedAt: number;
  readonly lastSeenAt: number | null;
  readonly isConnected: boolean;
}

export interface HubView {
  readonly error?: string;
  readonly offer: HubPairingOffer | null;
  readonly devices: readonly HubDeviceView[];
  readonly settings: HubSettings;
  readonly addresses: readonly string[];
  readonly isRunning: boolean;
  readonly isPersistent: boolean;
}

// The window's side of the hub: its settings, and serving chart requests the window owns.
export interface HubMethods {
  'hub.view': [Record<string, never>, HubView];
  'hub.save': [HubSettings, HubView];
  'hub.pair': [{ scope: HubScope }, HubPairingOffer];
  'hub.cancelPairing': [Record<string, never>, HubView];
  'hub.revoke': [{ id: string }, HubView];
  'hub.setScope': [{ id: string; scope: HubScope }, HubView];
  'hub.chartReply': [{ requestId: number; result?: unknown; error?: string }, boolean];
  'hub.chartsChanged': [HubChartEvents['changed'], boolean];
}

export type HubMethod = keyof HubMethods;

export interface HubEvents {
  view: HubView;
  chartRequest: { requestId: number; method: HubChartMethod; params: unknown };
}

export type HubEvent = keyof HubEvents;

export interface HubApi {
  request<M extends HubMethod>(method: M, params: HubMethods[M][0]): Promise<HubMethods[M][1]>;
  on<E extends HubEvent>(event: E, listener: (data: HubEvents[E]) => void): () => void;
}

const base64Url = (text: string) => text.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function encodePairing(payload: HubPairingPayload): string {
  return base64Url(btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(payload)))));
}

export function decodePairing(text: string): HubPairingPayload {
  let value: unknown;
  try {
    const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
    value = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
  } catch { throw new Error('This pairing link is damaged. Show a new code on the computer.'); }
  const payload = value as Partial<HubPairingPayload> | null;
  const isText = (field: unknown): field is string => typeof field === 'string' && field.length > 0 && field.length < 200;
  if (payload?.v !== 1 || !isText(payload.key) || !isText(payload.token) || !isText(payload.name) || !isHubScope(payload.scope)) throw new Error('This pairing link is not from a supported OpenTerm5 version.');
  if (!Array.isArray(payload.addresses) || !payload.addresses.length || !payload.addresses.every(isText)) throw new Error('This pairing link has no address for the computer.');
  return { v: 1, key: payload.key, name: payload.name, token: payload.token, scope: payload.scope, addresses: payload.addresses.slice(0, 8) };
}
