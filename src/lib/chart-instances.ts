import type { MeridianChart } from '@meridian/charts';
import { Store } from './store';

// The live chart engines by chart id, so toolbars and menus outside a chart window can reach
// the active chart.
const instances = new Map<string, MeridianChart>();

export interface ChartUiState {
  canUndo: boolean;
  canRedo: boolean;
  isReplaying: boolean;
  isObjectTreeShown: boolean;
}

// What the toolbars show for each chart: undo, redo, replay and the object tree.
export const chartUi = new Store<{ byId: Readonly<Record<string, ChartUiState>> }>({ byId: {} });

// The time under the pointer in whichever chart has it; the other charts show a crosshair there.
export const crosshairSync = new Store<{ chartId: string | null; time: number | null }>({ chartId: null, time: null });

function readUi(chart: MeridianChart): ChartUiState {
  return { canUndo: chart.canUndo(), canRedo: chart.canRedo(), isReplaying: chart.isReplaying(), isObjectTreeShown: chart.isObjectTreeShown() };
}

export function registerChart(id: string, chart: MeridianChart): () => void {
  instances.set(id, chart);
  const publish = () => chartUi.set((state) => ({ byId: { ...state.byId, [id]: readUi(chart) } }));
  const unsubscribers = [chart.onHistoryChange(publish), chart.onReplayChange(publish), chart.onObjectTreeChange(publish)];
  publish();
  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    if (instances.get(id) === chart) instances.delete(id);
    chartUi.set((state) => {
      const byId = { ...state.byId };
      delete byId[id];
      return { byId };
    });
    if (crosshairSync.get().chartId === id) crosshairSync.set({ chartId: null, time: null });
  };
}

export function chartInstance(id: string | null | undefined): MeridianChart | undefined {
  return id ? instances.get(id) : undefined;
}
