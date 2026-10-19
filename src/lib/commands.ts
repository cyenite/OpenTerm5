import type { ChartTimeframe } from './mt5-timeframes';
import { defaultSymbol } from './broker-symbols';
import { cancelReplaySelection, replay, stepReplay, toggleReplayPlay } from './replay';
import { activeChart, closeChart, openChart, openDialog, pages, setChartSymbol, setChartTimeframe, stepChart, toggleAnalysisMode, toggleMaximized, updateActiveChart, workspace, type ChartType, type ToolboxTab, type WorkspaceState } from './workspace';

type PanelFlag = 'isMarketWatchShown' | 'isNavigatorShown' | 'isToolboxShown' | 'isDataWindowShown' | 'isStatusBarShown' | 'isChartBarShown' | 'isTradeAssistantShown' | 'isTradeDrawingToolbarShown';

export function togglePanel(flag: PanelFlag): void {
  workspace.set((state) => ({ [flag]: !state[flag] }) as Partial<WorkspaceState>);
}

export function showToolbox(tab: ToolboxTab): void {
  workspace.set({ isToolboxShown: true, toolboxTab: tab });
}

// Without a symbol the ticket is for the active chart, so it counts as opened from that chart.
export function newOrder(symbol?: string): void {
  const chartId = symbol ? undefined : activeChart(workspace.get())?.id;
  openDialog({ kind: 'order', symbol: symbol ?? defaultSymbol(), ...(chartId ? { chartId } : {}) });
}

export function setChartType(type: ChartType): void {
  updateActiveChart({ type });
}

export function setTimeframe(timeframe: ChartTimeframe): void {
  const chart = activeChart(workspace.get());
  if (chart) setChartTimeframe(chart.id, timeframe);
}

export function zoom(factor: number): void {
  window.dispatchEvent(new CustomEvent('openterm:zoom', { detail: factor }));
}

export function toggleDepth(symbol?: string): void {
  if (workspace.get().isAnalysisMode) return;
  workspace.set((state) => ({
    depthSymbol: state.depthSymbol && !symbol ? null : symbol ?? activeChart(state)?.symbol ?? null,
  }));
}

export function toggleOneClick(): void {
  const state = workspace.get();
  if (state.isAnalysisMode) return;
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

// Shows a symbol on the active chart, the way a watchlist click works in charting apps.
export function showSymbol(symbol: string): void {
  const chart = activeChart(workspace.get());
  if (chart) setChartSymbol(chart.id, symbol);
  else openChart(symbol);
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

// Ctrl+1 to Ctrl+9 follow the order of the workspace tabs.
function pageForKey(key: string) {
  return /^[1-9]$/.test(key) ? pages[Number(key) - 1] : undefined;
}

function isReplayInFront(): boolean {
  return replay.get().session?.tabId === workspace.get().activeTabId;
}

function isChartFocus(target: EventTarget | null): boolean {
  return target === document.body || target instanceof Element && !!target.closest('.chart-area');
}

export function handleShortcut(event: KeyboardEvent): boolean {
  // A focused panel that used the key (typing into Market Watch starts a search) has claimed it.
  if (event.defaultPrevented || event.target instanceof Element && event.target.closest('input, textarea, select')) {
    return false;
  }
  const key = event.key.toLowerCase();
  const isCtrl = event.ctrlKey || event.metaKey;
  const isAnalysis = workspace.get().isAnalysisMode;
  const action: (() => void) | undefined = (() => {
    if (isCtrl && event.shiftKey && key === 'a') return toggleAnalysisMode;
    // Analysis mode has no order ticket, depth, pages or terminal panels; their keys stay free.
    if (isAnalysis && (event.key === 'F9' || event.altKey && key === 'b' || isCtrl && (key === 't' || key === 'n' || !!pageForKey(key)))) return undefined;
    // TradingView's key for the Indicators dialog.
    if (event.key === '/' && !isCtrl && !event.altKey) return () => openDialog({ kind: 'indicators' });
    if (event.key === 'F9') return () => newOrder();
    if (event.key === 'F11') return toggleFullScreen;
    if (event.key === 'F4' && isCtrl) return closeActiveChart;
    if (event.altKey && key === '1') return () => setChartType('bars');
    if (event.altKey && key === '2') return () => setChartType('candles');
    if (event.altKey && key === '3') return () => setChartType('line');
    if (event.altKey && key === 'b') return () => toggleDepth();
    if (event.altKey && key === 'enter') return toggleMaximized;
    if (isReplayInFront()) {
      if (event.shiftKey && key === 'arrowright') return stepReplay;
      if (event.shiftKey && key === 'arrowdown') return toggleReplayPlay;
      if (key === 'escape' && replay.get().session?.isSelecting) return cancelReplaySelection;
    }
    // Tab moves between the layout's charts, unless focus is on a control that tabs to the next one.
    if (key === 'tab' && !isCtrl && !event.altKey && isChartFocus(event.target)) return () => stepChart(event.shiftKey ? -1 : 1);
    const page = isCtrl ? pageForKey(key) : undefined;
    if (page) return () => workspace.set({ page: page.key });
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
