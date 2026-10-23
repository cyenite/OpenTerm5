import os from 'node:os';
import path from 'node:path';
import { encodePairing, hubAutomationEvents, hubTerminalEvents, isHubScope, type HubApiKey, type HubChartMethod, type HubEvent, type HubEvents, type HubMethod, type HubMethods, type HubPairingOffer, type HubView } from '../shared/hub';
import type { AutomationMethod } from '../shared/automation';
import type { LinkState, TerminalMethod, Tick } from '../shared/protocol';
import type { PasswordCipher } from './account-registry';
import { nodeHubCrypto } from './hub-crypto';
import { HubDevices, emptyHubFile, parseHubFile } from './hub-devices';
import { BarInterest, TickInterest } from './hub-interest';
import { HubServer, lanAddresses, type HubCaller } from './hub-server';
import { JsonStore } from './json-store';

export interface HubHostDeps {
  readonly userData: string;
  readonly version: string;
  readonly webRoot: string | null;
  readonly cipher: PasswordCipher;
  subscribeTicks(symbols: string[]): Promise<(Tick | null)[]>;
  linkState(): LinkState;
  terminal(method: TerminalMethod, params: unknown): Promise<unknown>;
  automation(method: AutomationMethod, params: unknown): Promise<unknown>;
  sendWindow<E extends HubEvent>(event: E, data: HubEvents[E]): boolean;
  journal(message: string): void;
}

const CHART_TIMEOUT_MS = 10_000;
const terminalEvents: ReadonlySet<string> = new Set(hubTerminalEvents);
const automationEvents: ReadonlySet<string> = new Set(hubAutomationEvents);

const barKey = (symbol: unknown, timeframe: unknown) => `${symbol}:${timeframe}`;

function barParams(key: string): { symbol: string; timeframe: string } {
  const split = key.lastIndexOf(':');
  return { symbol: key.slice(0, split), timeframe: key.slice(split + 1) };
}

// Phone access: the paired devices, the server they connect to, and the window's part in it (its
// chart state answers phones' chart requests).
export class HubHost {
  readonly ticks: TickInterest;
  private requestId = 0;
  private offer: HubPairingOffer | null = null;
  private offerTimer?: NodeJS.Timeout;
  private readonly bars = new BarInterest();
  private readonly server: HubServer;
  private readonly devices: HubDevices;
  private readonly charts = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>();

  constructor(private readonly deps: HubHostDeps) {
    this.ticks = new TickInterest(deps.subscribeTicks);
    const store = new JsonStore(path.join(deps.userData, 'hub.json'), parseHubFile, emptyHubFile);
    this.devices = new HubDevices(store, deps.cipher, nodeHubCrypto);
    this.server = new HubServer({
      devices: this.devices,
      crypto: nodeHubCrypto,
      version: deps.version,
      webRoot: deps.webRoot,
      hubName: () => os.hostname(),
      call: (caller, api, method, params) => this.call(caller, api, method, params),
      wants: (connectionId, api, event, data) => this.wants(connectionId, api, event, data),
      closed: (connectionId) => void this.release(connectionId),
      journal: deps.journal,
    });
    this.server.on('change', () => this.publish());
  }

  async init(): Promise<void> {
    await this.devices.init();
    await this.server.apply(this.devices.settings);
    if (this.server.lastError) this.deps.journal(`Phone access could not start: ${this.server.lastError}`);
  }

  async shutdown(): Promise<void> {
    clearTimeout(this.offerTimer);
    for (const pending of this.charts.values()) clearTimeout(pending.timer);
    await this.server.stop();
  }

  forward(api: 'terminal' | 'automation', event: string, data: unknown): void {
    if ((api === 'terminal' ? terminalEvents : automationEvents).has(event)) this.server.broadcast(api, event, data);
  }

  view(): HubView {
    const connected = this.server.connectedDevices();
    return {
      ...(this.server.lastError ? { error: this.server.lastError } : {}),
      offer: this.offer && this.devices.activeOffer() ? this.offer : null,
      devices: this.devices.devices.map((device) => ({
        id: device.id, name: device.name, scope: device.scope, pairedAt: device.pairedAt, lastSeenAt: device.lastSeenAt,
        isConnected: connected.has(device.id), ...(connected.has(device.id) ? { address: connected.get(device.id) } : {}),
      })),
      settings: this.devices.settings,
      addresses: this.server.isRunning ? lanAddresses(this.server.boundPort) : [],
      isRunning: this.server.isRunning,
      isPersistent: this.devices.isPersistent,
    };
  }

  async handle<M extends HubMethod>(method: M, params: HubMethods[M][0]): Promise<HubMethods[M][1]>;
  async handle(method: HubMethod, params: unknown): Promise<unknown> {
    switch (method) {
      case 'hub.view': return this.view();
      case 'hub.save': {
        const { port, isEnabled } = params as HubMethods['hub.save'][0];
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port from 1024 to 65535.');
        await this.devices.saveSettings({ port, isEnabled: isEnabled === true });
        await this.server.apply(this.devices.settings);
        if (!isEnabled) this.cancelOffer();
        return this.publish();
      }
      case 'hub.pair': {
        const { scope } = params as HubMethods['hub.pair'][0];
        if (!isHubScope(scope)) throw new Error('Choose what the phone may do.');
        if (!this.server.isRunning) throw new Error('Turn on phone access first.');
        const addresses = lanAddresses(this.server.boundPort);
        if (!addresses.length) throw new Error('This computer has no network address a phone can reach. Connect it to your Wi-Fi or local network.');
        const { expiresAt, ...payload } = this.devices.createOffer(scope, os.hostname(), addresses);
        this.offer = { url: `http://${addresses[0]}/#pair=${encodePairing(payload)}`, scope, expiresAt };
        clearTimeout(this.offerTimer);
        this.offerTimer = setTimeout(() => this.publish(), Math.max(0, expiresAt - Date.now()) + 50);
        this.publish();
        return this.offer;
      }
      case 'hub.cancelPairing':
        this.cancelOffer();
        return this.publish();
      case 'hub.revoke': {
        const { id } = params as HubMethods['hub.revoke'][0];
        const device = this.devices.get(id);
        await this.devices.revoke(id);
        this.server.drop(id);
        if (device) this.deps.journal(`Unpaired ${device.name}.`);
        return this.publish();
      }
      case 'hub.setScope': {
        const { id, scope } = params as HubMethods['hub.setScope'][0];
        if (!isHubScope(scope)) throw new Error('Choose what the phone may do.');
        await this.devices.setScope(id, scope);
        const device = this.devices.get(id);
        if (device) this.server.refresh(device);
        return this.publish();
      }
      case 'hub.chartReply': {
        const { requestId, result, error } = params as HubMethods['hub.chartReply'][0];
        const pending = this.charts.get(requestId);
        if (!pending) return false;
        this.charts.delete(requestId);
        clearTimeout(pending.timer);
        if (typeof error === 'string') pending.reject(new Error(error));
        else pending.resolve(result);
        return true;
      }
      case 'hub.chartsChanged': {
        const { chartIds, isListChanged } = params as HubMethods['hub.chartsChanged'][0];
        if (Array.isArray(chartIds)) this.server.broadcast('charts', 'changed', { chartIds: chartIds.filter((id) => typeof id === 'string'), isListChanged: isListChanged === true });
        return true;
      }
      default: throw new Error(`Unknown hub method ${method}`);
    }
  }

  private cancelOffer(): void {
    this.devices.cancelOffer();
    this.offer = null;
    clearTimeout(this.offerTimer);
  }

  private publish(): HubView {
    const view = this.view();
    if (!view.offer) this.offer = null;
    this.deps.sendWindow('view', view);
    return view;
  }

  private async call(caller: HubCaller, api: HubApiKey, method: string, params: unknown): Promise<unknown> {
    const owner = caller.connectionId;
    if (api === 'charts') return this.chartRequest(method as HubChartMethod, params);
    if (api === 'automation') return this.deps.automation(method as AutomationMethod, params);
    const values = (params ?? {}) as { symbols?: unknown; symbol?: unknown; timeframe?: unknown };
    if (method === 'link.state') return this.deps.linkState();
    if (method === 'ticks.subscribe') return this.ticks.set(owner, values.symbols);
    if (method === 'rates.subscribe') {
      const key = barKey(values.symbol, values.timeframe);
      this.bars.add(owner, key);
      try { return await this.deps.terminal('rates.subscribe', params); }
      catch (error) {
        this.bars.remove(owner, key);
        throw error;
      }
    }
    if (method === 'rates.unsubscribe') return this.bars.remove(owner, barKey(values.symbol, values.timeframe)) ? this.deps.terminal('rates.unsubscribe', params) : true;
    return this.deps.terminal(method as TerminalMethod, params);
  }

  private wants(connectionId: string, api: HubApiKey, event: string, data: unknown): boolean {
    const value = data as { symbol?: string; timeframe?: string } | null;
    if (api === 'terminal' && event === 'tick') return this.ticks.has(connectionId, value?.symbol ?? '');
    if (api === 'terminal' && event === 'bar') return this.bars.has(connectionId, barKey(value?.symbol, value?.timeframe));
    return true;
  }

  private async release(connectionId: string): Promise<void> {
    for (const key of this.bars.release(connectionId)) await this.deps.terminal('rates.unsubscribe', barParams(key)).catch(() => undefined);
    await this.ticks.release(connectionId).catch(() => undefined);
  }

  // The window owns chart state, so it answers; with no window there is nothing to answer from.
  private chartRequest(method: HubChartMethod, params: unknown): Promise<unknown> {
    const requestId = ++this.requestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.charts.delete(requestId);
        reject(new Error('The computer did not answer. Check that the OpenTerm5 window is open.'));
      }, CHART_TIMEOUT_MS);
      this.charts.set(requestId, { resolve, reject, timer });
      if (!this.deps.sendWindow('chartRequest', { requestId, method, params })) {
        clearTimeout(timer);
        this.charts.delete(requestId);
        reject(new Error('Open the OpenTerm5 window on the computer to use its charts.'));
      }
    });
  }
}
