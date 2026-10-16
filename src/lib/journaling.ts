import type { ClosedTrade, JournalingApi, JournalingView, OpenTarget } from '../../shared/journaling';
import { log } from './session';
import { Store } from './store';
import { workspace } from './workspace';

declare global {
  interface Window {
    journaling: JournalingApi;
  }
}

export const journaling = window.journaling;

export interface JournalingState {
  view: JournalingView | null;
  // Trades a sync reported as newly closed, newest first, until the user reviews or dismisses them.
  notices: ClosedTrade[];
  // The trade the page should open for review, set by a close notice.
  focusKey: string | null;
}

export const journalingStore = new Store<JournalingState>({ view: null, notices: [], focusKey: null });

// Analysis mode only shows the charts, so opening the page leaves it.
export function showJournaling(focusKey: string | null = null): void {
  workspace.set({ page: 'journaling', isAnalysisMode: false });
  if (focusKey) journalingStore.set({ focusKey });
}

export function reviewClosedTrade(trade: ClosedTrade): void {
  journalingStore.set((state) => ({ notices: state.notices.filter((item) => item.key !== trade.key) }));
  showJournaling(trade.key);
}

export function dismissNotices(): void {
  journalingStore.set({ notices: [] });
}

export function openInJournal(target: OpenTarget): void {
  journaling.request('journaling.open', target).catch((error: Error) => log(error.message, 'Journaling'));
}

export async function refreshJournaling(): Promise<void> {
  try { journalingStore.set({ view: await journaling.request('journaling.view', {}) }); }
  catch (error) { log(`Journaling unavailable: ${(error as Error).message}`, 'Journaling'); }
}

export function startJournaling(): void {
  journaling.on('view', (view) => journalingStore.set({ view }));
  journaling.on('closed', (trades) => journalingStore.set((state) => ({
    notices: [...trades, ...state.notices.filter((item) => !trades.some((trade) => trade.key === item.key))].slice(0, 20),
  })));
  journaling.on('link', () => showJournaling());
  void refreshJournaling();
}
