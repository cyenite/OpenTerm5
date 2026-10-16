import type { MeridianChart } from '@meridian/charts';
import { chartInstance } from './chart-instances';
import { tabActiveChartId, visibleChartIds, type ChartTab } from './chart-tabs';
import { toChartTimeframe, type ChartTimeframe } from './mt5-timeframes';
import { replaySpeeds, updateInterval, updateIntervals, type ReplayMode, type ReplaySpeed } from './replay-model';
import { replay, type ReplaySession } from './replay-session';
import { activeTab, tabOfChart, workspace, type WorkspaceState } from './workspace';

// Bar replay for a layout tab, as TradingView runs it: one clock for every chart taking part, so
// stepping, playing and picking a start move them together. Each chart reveals only what had
// happened by that time; a higher-timeframe bar still forming is built from bars of the update
// interval (see Meridian's `setReplay`).

export { replay, type ReplaySession };

let timer: ReturnType<typeof setInterval> | null = null;

const current = () => replay.get().session;

function update(patch: Partial<ReplaySession>): void {
  replay.set((state) => (state.session ? { session: { ...state.session, ...patch } } : state));
}

function stopTimer(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

function restartTimer(): void {
  stopTimer();
  const speed = replaySpeeds.find((candidate) => candidate.key === workspace.get().replaySpeed) ?? replaySpeeds[4];
  if (current()?.isPlaying) timer = setInterval(stepReplay, speed.delay);
}

// All of the tab's visible charts, or the one chart the replay started on.
function participants(state: WorkspaceState, tab: ChartTab, session: ReplaySession | null, chartId?: string): string[] {
  if (state.replayMode === 'allCharts') return visibleChartIds(tab);
  if (session) return [...session.chartIds];
  return [chartId ?? tabActiveChartId(tab)];
}

function timeframesOf(chartIds: readonly string[]): ChartTimeframe[] {
  const charts = workspace.get().charts;
  return chartIds.map((id) => charts.find((chart) => chart.id === id)?.timeframe).filter((timeframe): timeframe is ChartTimeframe => !!timeframe);
}

export function replayIntervals(session: ReplaySession | null = current()): ChartTimeframe[] {
  return session ? updateIntervals(timeframesOf(session.chartIds)) : [];
}

export function replayInterval(session: ReplaySession | null = current()): ChartTimeframe | null {
  return session ? updateInterval(timeframesOf(session.chartIds), session.chosenInterval) : null;
}

function engines(session: ReplaySession): MeridianChart[] {
  return session.chartIds.map((id) => chartInstance(id)).filter((engine): engine is MeridianChart => !!engine);
}

function apply(): void {
  const session = current();
  if (!session || session.time === null) return;
  const interval = replayInterval(session);
  const step = interval ? toChartTimeframe(interval) : null;
  for (const engine of engines(session)) {
    engine.setReplay({ time: session.time, step });
    if (engine.isReplaySelecting()) engine.cancelReplaySelection();
  }
}

// Picks a start on every chart taking part. A replay already running keeps its clock and charts
// until the new start is picked.
export function startReplay(chartId?: string): void {
  const state = workspace.get();
  const tab = chartId ? tabOfChart(state, chartId) : activeTab(state);
  if (!tab) return;
  const previous = current();
  if (previous && previous.tabId !== tab.id) exitReplay();
  const session = current();
  stopTimer();
  const chartIds = participants(state, tab, null, chartId);
  replay.set({ session: { tabId: tab.id, time: session?.time ?? null, notice: null, chartIds, isPlaying: false, isFinished: false, isSelecting: true, chosenInterval: session?.chosenInterval ?? null } });
  for (const id of session?.chartIds ?? []) if (!chartIds.includes(id)) chartInstance(id)?.setReplay(null);
  chartIds.forEach((id) => chartInstance(id)?.selectReplayStart());
}

// No chart can start before the latest of their first bars.
export function pickReplayStart(time: number): void {
  const session = current();
  if (!session) return;
  const earliest = Math.max(...engines(session).map((engine) => engine.earliestReplayTime() ?? -Infinity));
  update({ time: Math.max(time, earliest), isSelecting: false, isFinished: false, notice: null });
  apply();
}

export function startReplayAt(start: 'first' | 'random' | number): void {
  const session = current();
  if (!session) return;
  const earliest = Math.max(...engines(session).map((engine) => engine.earliestReplayTime() ?? -Infinity));
  if (start === 'first') pickReplayStart(earliest);
  else if (start === 'random') pickReplayStart(earliest + Math.random() * Math.max(0, Date.now() - earliest) * 0.9);
  else pickReplayStart(start);
}

// One step moves the clock to the soonest bar end of any chart, at the update interval, so a
// weekend or a closed market passes in one step.
export function stepReplay(): void {
  const session = current();
  if (!session || session.time === null || session.isSelecting || session.isFinished) return;
  const time = session.time;
  const next = engines(session).map((engine) => engine.nextReplayTime(time)).filter((candidate): candidate is number => candidate !== null);
  if (!next.length) {
    stopTimer();
    update({ isPlaying: false, isFinished: true, notice: 'End of data: the replay has reached the latest bar.' });
    return;
  }
  update({ time: Math.min(...next) });
  apply();
}

export function toggleReplayPlay(): void {
  const session = current();
  if (!session || session.time === null || session.isSelecting || session.isFinished) return;
  update({ isPlaying: !session.isPlaying });
  restartTimer();
}

export function setReplaySpeed(replaySpeed: ReplaySpeed): void {
  workspace.set({ replaySpeed });
  restartTimer();
}

export function setReplayInterval(chosenInterval: ChartTimeframe | null): void {
  update({ chosenInterval });
  apply();
}

// Escape: leave start selection, back to the running replay, or out of replay if none had begun.
export function cancelReplaySelection(): void {
  const session = current();
  if (!session?.isSelecting) return;
  if (session.time === null) {
    exitReplay();
    return;
  }
  update({ isSelecting: false });
  engines(session).forEach((engine) => engine.cancelReplaySelection());
}

export function exitReplay(): void {
  const session = current();
  stopTimer();
  if (!session) return;
  replay.set({ session: null });
  engines(session).forEach((engine) => engine.setReplay(null));
}

// Changing the mode starts over, as the charts taking part change.
export function setReplayMode(replayMode: ReplayMode): void {
  if (workspace.get().replayMode === replayMode) return;
  exitReplay();
  workspace.set({ replayMode });
}

export function isReplaySelecting(tabId: string): boolean {
  const session = current();
  return !!session?.isSelecting && session.tabId === tabId;
}

// A chart that loaded (first mount, or a new symbol or timeframe) joins the replay at its time.
// Without data that far back it goes live, as TradingView drops such charts.
export function followReplay(chartId: string): void {
  const session = current();
  const engine = chartInstance(chartId);
  const state = workspace.get();
  const tab = state.tabs.find((candidate) => candidate.id === session?.tabId);
  if (!session || !engine || !tab || !participants(state, tab, session).includes(chartId)) return;
  if (!session.chartIds.includes(chartId)) update({ chartIds: [...session.chartIds, chartId] });
  if (session.isSelecting) engine.selectReplayStart();
  if (session.time === null) return;
  apply();
  const earliest = engine.earliestReplayTime();
  if (earliest !== null && earliest > session.time) {
    engine.setReplay(null);
    const symbol = state.charts.find((chart) => chart.id === chartId)?.symbol ?? 'A chart';
    update({ chartIds: current()!.chartIds.filter((id) => id !== chartId), notice: `${symbol} has no bars that far back, so it stays live.` });
  }
}

export function attachReplay(chartId: string, engine: MeridianChart): () => void {
  engine.setReplayHosted(true);
  const unsubscribers = [
    engine.onReplayRequest((request) => {
      if (request === 'start') startReplay(chartId);
      else if (request === 'exit') exitReplay();
      else cancelReplaySelection();
    }),
    engine.onReplayPick(pickReplayStart),
  ];
  return () => {
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    const session = current();
    if (session?.chartIds.includes(chartId)) update({ chartIds: session.chartIds.filter((id) => id !== chartId) });
  };
}

// The replay ends with its tab, pauses while another tab is in front, and takes in charts a
// changed layout shows (they join through `followReplay` once loaded).
workspace.subscribe(() => {
  const session = current();
  if (!session) return;
  const state = workspace.get();
  if (!state.tabs.some((tab) => tab.id === session.tabId)) exitReplay();
  else if (session.isPlaying && state.activeTabId !== session.tabId) {
    update({ isPlaying: false });
    stopTimer();
  }
});
