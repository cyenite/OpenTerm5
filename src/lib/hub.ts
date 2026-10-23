import type { HubApi, HubChartMethod, HubChartMethods, HubMethod, HubMethods, HubView } from '../../shared/hub';
import { chartFingerprint, editHubDrawings, hubChartDocument, hubCharts, setHubChartMarket } from './hub-charts';
import { log } from './session';
import { Store } from './store';
import { symbolDrawings } from './symbol-drawings';
import { workspace } from './workspace';

declare global {
  interface Window {
    hub: HubApi;
  }
}

export const hub = window.hub;

export const hubStore = new Store<{ view: HubView | null }>({ view: null });

const CHANGE_MS = 250;

function answer(method: HubChartMethod, params: unknown): unknown {
  const values = (params ?? {}) as Partial<HubChartMethods['charts.setMarket'][0]>;
  switch (method) {
    case 'charts.list': return hubCharts(workspace.get());
    case 'charts.get': return hubChartDocument(String(values.chartId));
    case 'charts.setMarket': return setHubChartMarket(String(values.chartId), values.symbol, values.timeframe);
    case 'charts.editDrawings': return editHubDrawings(params as HubChartMethods['charts.editDrawings'][0]);
    default: throw new Error(`Unknown chart request ${String(method)}`);
  }
}

// Tells connected phones which charts changed, so they reload only those.
function watchCharts(): void {
  let shown = new Map<string, readonly unknown[]>();
  let listed = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    timer = undefined;
    const state = workspace.get();
    const list = JSON.stringify(hubCharts(state).map((chart) => [chart.id, chart.tabId, chart.isActive]));
    const next = new Map(state.charts.map((chart) => [chart.id, chartFingerprint(state, chart)]));
    const chartIds = [...next].filter(([id, fingerprint]) => {
      const previous = shown.get(id);
      return !previous || fingerprint.some((part, index) => part !== previous[index]);
    }).map(([id]) => id);
    const isListChanged = list !== listed;
    shown = next;
    listed = list;
    if (!chartIds.length && !isListChanged) return;
    if (!hubStore.get().view?.devices.some((device) => device.isConnected)) return;
    void hub.request('hub.chartsChanged', { chartIds, isListChanged }).catch(() => undefined);
  };
  const schedule = () => { timer ??= setTimeout(check, CHANGE_MS); };
  check();
  workspace.subscribe(schedule);
  symbolDrawings.subscribe(schedule);
}

export function startHub(): void {
  hub.on('view', (view) => hubStore.set({ view }));
  hub.on('chartRequest', ({ requestId, method, params }) => {
    let reply: HubMethods['hub.chartReply'][0];
    try { reply = { requestId, result: answer(method, params) }; }
    catch (error) { reply = { requestId, error: (error as Error).message }; }
    void hub.request('hub.chartReply', reply).catch(() => undefined);
  });
  void hub.request('hub.view', {}).then((view) => hubStore.set({ view })).catch(() => undefined);
  watchCharts();
}

export async function requestHub<M extends HubMethod>(method: M, params: HubMethods[M][0]): Promise<HubMethods[M][1] | null> {
  try { return await hub.request(method, params); }
  catch (error) {
    log((error as Error).message, 'Phones');
    return null;
  }
}
