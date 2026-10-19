import type { ChartTimeframe } from './mt5-timeframes';
import { Store, useStore } from './store';

// The replay store lives apart from `replay.ts`, which imports the workspace: the workspace's
// trade gate reads it, and importing `replay.ts` there would be a cycle.

export interface ReplaySession {
  readonly tabId: string;
  // Data up to this instant is shown; null until a start is picked.
  readonly time: number | null;
  readonly notice: string | null;
  readonly chartIds: readonly string[];
  readonly isPlaying: boolean;
  readonly isFinished: boolean;
  readonly isSelecting: boolean;
  // The update interval chosen in the replay toolbar; null steps automatically.
  readonly chosenInterval: ChartTimeframe | null;
  // Stepping stops here, as at the end of the data; a backtest's end date. Null runs to the end.
  readonly limit?: number | null;
}

export const replay = new Store<{ session: ReplaySession | null }>({ session: null });

export const replayTradingHint = 'Trading is off while this chart replays';

// A replaying chart shows past bars while orders still fill at live prices, so nothing on it
// trades. Charts outside the replay, in its tab or another, are not affected.
export function isReplayingChart(session: ReplaySession | null, chartId: string | undefined): boolean {
  return !!session && !!chartId && session.chartIds.includes(chartId);
}

export function useIsReplayingChart(chartId: string | undefined): boolean {
  return useStore(replay, (state) => isReplayingChart(state.session, chartId));
}
