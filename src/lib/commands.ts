import type { Timeframe } from '../../shared/protocol';
import { defaultSymbol } from './broker-symbols';
import { activeChart, arrangeWindows, closeChart, openDialog, pages, updateActiveChart, workspace, type ChartType, type ToolboxTab, type WorkspaceState } from './workspace';

type PanelFlag = 'isMarketWatchShown' | 'isNavigatorShown' | 'isToolboxShown' | 'isDataWindowShown' | 'isStatusBarShown' | 'isChartBarShown';

export function togglePanel(flag: PanelFlag): void {
  workspace.set((state) => ({ [flag]: !state[flag] }) as Partial<WorkspaceState>);
}

export function showToolbox(tab: ToolboxTab): void {
  workspace.set({ isToolboxShown: true, toolboxTab: tab });
}

export function newOrder(symbol?: string): void {
  openDialog({ kind: 'order', symbol: symbol ?? defaultSymbol() });
}

export function setChartType(type: ChartType): void {
  updateActiveChart({ type });
}

export function setTimeframe(timeframe: Timeframe): void {
  updateActiveChart({ timeframe });
}

export function zoom(factor: number): void {
  window.dispatchEvent(new CustomEvent('openterm:zoom', { detail: factor }));
}

export function toggleDepth(symbol?: string): void {
  workspace.set((state) => ({
    depthSymbol: state.depthSymbol && !symbol ? null : symbol ?? activeChart(state)?.symbol ?? null,
  }));
}

export function toggleOneClick(): void {
  const state = workspace.get();
  if (state.isOneClickEnabled) {
    workspace.set({ isOneClickEnabled: false });
    return;
  }
  if (!state.hasAcceptedOneClick) {
    const isAccepted = window.confirm(
      'One Click Trading sends market orders immediately, without a confirmation dialog. ' +
        'You accept responsibility for trades placed this way. Enable One Click Trading?',
    );
    if (!isAccepted) {
      return;
    }
  }
  workspace.set({ isOneClickEnabled: true, hasAcceptedOneClick: true });
}

export function toggleFullScreen(): void {
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void document.documentElement.requestFullscreen();
  }
}

export function closeActiveChart(): void {
  const chart = activeChart(workspace.get());
  if (chart) {
    closeChart(chart.id);
  }
}

export function handleShortcut(event: KeyboardEvent): boolean {
  // A focused panel that used the key (typing into Market Watch starts a search) has claimed it.
  if (event.defaultPrevented || event.target instanceof Element && event.target.closest('input, textarea, select')) {
    return false;
  }
  const key = event.key.toLowerCase();
  const isCtrl = event.ctrlKey || event.metaKey;
  const action: (() => void) | undefined = (() => {
    if (event.key === 'F9') return () => newOrder();
    if (event.key === 'F11') return toggleFullScreen;
    if (event.key === 'F4' && isCtrl) return closeActiveChart;
    if (event.altKey && key === '1') return () => setChartType('bars');
    if (event.altKey && key === '2') return () => setChartType('candles');
    if (event.altKey && key === '3') return () => setChartType('line');
    if (event.altKey && key === 'b') return () => toggleDepth();
    if (event.altKey && key === 'r') return () => arrangeWindows('tile');
    if (isCtrl && /^[1-4]$/.test(key)) return () => workspace.set({ page: pages[Number(key) - 1].key });
    if (isCtrl && key === 'm') return () => togglePanel('isMarketWatchShown');
    if (isCtrl && key === 'n') return () => togglePanel('isNavigatorShown');
    if (isCtrl && key === 't') return () => togglePanel('isToolboxShown');
    if (isCtrl && key === 'd') return () => togglePanel('isDataWindowShown');
    if (isCtrl && key === 'g') return () => updateActiveChart((chart) => ({ isGridShown: !chart.isGridShown }));
    if (isCtrl && key === 'l') return () => updateActiveChart((chart) => ({ isVolumeShown: !chart.isVolumeShown }));
    if (isCtrl && key === 'b') return () => { const chart = activeChart(workspace.get()); if (chart) openDialog({ kind: 'objects', chartId: chart.id }); };
    if (isCtrl && key === 'o') return () => openDialog({ kind: 'connection' });
    if (isCtrl && key === 'u') return () => openDialog({ kind: 'symbols' });
    if (!isCtrl && !event.altKey && (key === '+' || key === '=')) return () => zoom(1.25);
    if (!isCtrl && !event.altKey && key === '-') return () => zoom(0.8);
    if (!isCtrl && !event.altKey && key === 'end') return () => zoom(0);
    if (key === 'escape') return () => workspace.set({ tool: 'cursor' });
    return undefined;
  })();
  if (!action) {
    return false;
  }
  event.preventDefault();
  action();
  return true;
}
