import type { AutomationApi } from '../../shared/automation';
import { decodePairing, type HubApiKey, type HubChartEvents, type HubChartMethod, type HubChartMethods, type HubReady } from '../../shared/hub';
import { fromBase64Url } from '../../shared/hub-session';
import type { LinkState, TerminalApi } from '../../shared/protocol';
import { Store } from '../lib/store';
import { deviceName, HubClient, newPairing, type HubState, type StoredPairing } from './hub-client';
import { browserHubCrypto } from './hub-crypto';

// The phone's stand-in for the desktop preload: `window.terminal` and `window.automation` forward
// over the hub, so the window's session store and chart data provider run here unchanged. It must
// be imported before anything that reads those globals.

export interface BridgeState {
  state: HubState | 'unpaired';
  detail: string | null;
  ready: HubReady | null;
  pairing: StoredPairing | null;
}

const STORAGE_KEY = 'openterm.mobile.pairing.v1';
const closedLink: LinkState = { url: '', state: 'closed' };

function loadPairing(): StoredPairing | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as StoredPairing | null;
    return value && typeof value.hubKey === 'string' && typeof value.devicePrivateKey === 'string' && Array.isArray(value.addresses) ? value : null;
  } catch {
    return null;
  }
}

function savePairing(pairing: StoredPairing | null): void {
  try {
    if (pairing) localStorage.setItem(STORAGE_KEY, JSON.stringify(pairing));
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* private browsing: the pairing lasts for this visit */ }
}

export const bridge = new Store<BridgeState>({ state: 'unpaired', detail: null, ready: null, pairing: loadPairing() });

const listeners = new Map<string, Set<(data: never) => void>>();
const readyListeners = new Set<(ready: HubReady) => void>();
let client: HubClient | null = null;

function on(api: HubApiKey, event: string, listener: (data: never) => void): () => void {
  const key = `${api}:${event}`;
  const set = listeners.get(key) ?? new Set();
  set.add(listener);
  listeners.set(key, set);
  return () => { set.delete(listener); };
}

function emit(api: HubApiKey, event: string, data: unknown): void {
  for (const listener of listeners.get(`${api}:${event}`) ?? []) listener(data as never);
}

function call(api: HubApiKey, method: string, params: unknown): Promise<never> {
  return (client ? client.request(api, method, params) : Promise.reject(new Error('This phone is not paired with a computer.'))) as Promise<never>;
}

// Each connection, first or after a drop, starts the phone's view afresh from the computer's link.
async function announceLink(): Promise<void> {
  try { emit('terminal', 'link', await call('terminal', 'link.state', {})); }
  catch { emit('terminal', 'link', closedLink); }
}

function connect(pairing: StoredPairing, token?: Uint8Array): void {
  client?.close();
  bridge.set({ pairing, ready: null, state: 'connecting', detail: null });
  client = new HubClient({
    name: deviceName(navigator.userAgent),
    crypto: browserHubCrypto,
    pairing,
    token,
    onState: (state, detail) => {
      bridge.set({ state, detail });
      if (state !== 'ready') emit('terminal', 'link', closedLink);
    },
    onEvent: (message) => emit(message.api, message.event, message.data),
    onReady: (ready) => {
      const next = { ...pairing, deviceId: ready.device.id, scope: ready.device.scope, hubName: ready.hub.name };
      savePairing(next);
      bridge.set({ ready, pairing: next });
      void announceLink();
      for (const listener of readyListeners) listener(ready);
    },
  });
  client.start();
}

export function onReady(listener: (ready: HubReady) => void): () => void {
  readyListeners.add(listener);
  return () => { readyListeners.delete(listener); };
}

// A pairing link opened on the phone, from the address bar or pasted in.
export async function pairWith(link: string): Promise<void> {
  const fragment = link.includes('#pair=') ? link.slice(link.indexOf('#pair=') + 6) : link.trim();
  const payload = decodePairing(fragment);
  const pairing = await newPairing(browserHubCrypto, payload);
  connect(pairing, fromBase64Url(payload.token));
}

export function forgetPairing(): void {
  client?.close();
  client = null;
  savePairing(null);
  bridge.set({ state: 'unpaired', detail: null, ready: null, pairing: null });
  emit('terminal', 'link', closedLink);
}

export function canTrade(state: BridgeState): boolean {
  return state.state === 'ready' && state.ready?.device.scope === 'trade';
}

export function requestChart<M extends HubChartMethod>(method: M, params: HubChartMethods[M][0]): Promise<HubChartMethods[M][1]> {
  return call('charts', method, params);
}

export function onChartsChanged(listener: (change: HubChartEvents['changed']) => void): () => void {
  return on('charts', 'changed', listener as (data: never) => void);
}

window.terminal = {
  request: (method: string, params: unknown) => call('terminal', method, params),
  on: (event: string, listener: (data: never) => void) => on('terminal', event, listener),
  link: () => client?.isReady ? call('terminal', 'link.state', {}) : Promise.resolve(closedLink),
  settings: async () => ({ webEndpoint: '' }),
  saveSettings: async () => { throw new Error('Change the connection on the computer.'); },
  zoom: async () => 1,
  platform: 'mobile',
} as TerminalApi;

window.automation = {
  request: (method: string, params: unknown) => call('automation', method, params),
  on: (event: string, listener: (data: never) => void) => on('automation', event, listener),
} as AutomationApi;

export function startBridge(): void {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') client?.retry(); });
  if (location.hash.startsWith('#pair=')) {
    const link = location.hash;
    // The token must not stay in the address bar or the history.
    history.replaceState(null, '', location.pathname + location.search);
    void pairWith(link).catch((error: Error) => bridge.set({ state: 'unpaired', detail: error.message }));
    return;
  }
  const pairing = bridge.get().pairing;
  if (pairing) connect(pairing);
}
