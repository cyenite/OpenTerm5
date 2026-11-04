import type { SyncApi, SyncMethod, SyncMethods, SyncView } from '../../shared/sync';
import { Store } from './store';

declare global {
  interface Window {
    sync: SyncApi;
  }
}

export const sync = window.sync;

export const syncStore = new Store<{ view: SyncView | null }>({ view: null });

export function startSync(): void {
  sync.on('view', (view) => syncStore.set({ view }));
  void sync.request('sync.view', {}).then((view) => syncStore.set({ view })).catch(() => undefined);
}

// Errors are returned for the dialog to show next to what was tried.
export async function requestSync<M extends SyncMethod>(method: M, params: SyncMethods[M][0]): Promise<string | null> {
  try {
    const result = await sync.request(method, params);
    if (result && typeof result === 'object' && 'phase' in result) syncStore.set({ view: result as SyncView });
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
