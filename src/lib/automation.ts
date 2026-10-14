import type { AutomationApi, BulkOutcome, BulkRequest, CopierLogEntry, CopierView, ManagerView, RiskOrderOutcome, RiskOrderRequest, SignalRecord, WebhookView } from '../../shared/automation';
import { log, trackTrade } from './session';
import { Store } from './store';
import { loadRiskPreferences } from './risk-preferences';

declare global {
  interface Window {
    automation: AutomationApi;
  }
}

export const automation = window.automation;

export interface AutomationState {
  copier: CopierView;
  manager: ManagerView;
  webhooks: WebhookView | null;
}

export const automationStore = new Store<AutomationState>({
  copier: { configs: [], logs: [], links: [], mappings: [], protections: [] },
  manager: { rules: [], guards: [], guardStates: [] },
  webhooks: null,
});

export function placeRiskOrder(label: string, request: RiskOrderRequest): Promise<RiskOrderOutcome> {
  return trackTrade(label, {}, () => automation.request('manager.risk', request),
    (outcome) => outcome.results.length > 0 && outcome.results.every((result) => result.isSuccess),
    (outcome) => outcome.results.find((result) => !result.isSuccess)?.comment ?? `${outcome.results.length} order${outcome.results.length === 1 ? '' : 's'} done`);
}

export function runBulkTrades(label: string, request: BulkRequest): Promise<BulkOutcome[]> {
  return trackTrade(label, { position: request.ticket }, () => automation.request('manager.bulk', request),
    (outcomes) => outcomes.every((outcome) => outcome.result.isSuccess),
    (outcomes) => outcomes.find((outcome) => !outcome.result.isSuccess)?.result.comment ?? `${outcomes.length} order${outcomes.length === 1 ? '' : 's'} done`);
}

export async function refreshAutomation(): Promise<void> {
  try {
    const [copier, manager, webhooks] = await Promise.all([
      automation.request('copier.view', {}),
      automation.request('manager.state', {}),
      automation.request('webhooks.view', {}),
    ]);
    automationStore.set({ copier, manager, webhooks });
  } catch (error) {
    log(`Automation unavailable: ${(error as Error).message}`, 'Automation');
  }
}

export function startAutomation(): void {
  automation.on('copier', (copier) => automationStore.set({ copier }));
  automation.on('copierLog', (entry: CopierLogEntry) => automationStore.set((state) => ({ copier: { ...state.copier, logs: [entry, ...state.copier.logs].slice(0, 300) } })));
  automation.on('manager', (manager) => automationStore.set({ manager }));
  automation.on('signal', (record: SignalRecord) => automationStore.set((state) => state.webhooks ? {
    webhooks: { ...state.webhooks, records: [record, ...state.webhooks.records.filter((item) => item.id !== record.id)].slice(0, 200) },
  } : {}));
  automation.on('webhookStatus', (status) => automationStore.set((state) => state.webhooks ? { webhooks: { ...state.webhooks, status } } : {}));
  void refreshAutomation();
  loadRiskPreferences();
}

export const accountLabel = (accountId: string) => accountId.split('|').pop() ?? accountId;
