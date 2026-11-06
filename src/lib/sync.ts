import type { SyncApi, SyncMethod, SyncMethods, SyncSnapshot, SyncSourceRequest, SyncView } from '../../shared/sync';
import { Store } from './store';
import { syncedStores, syncSources } from './sync-sources';
import { toJson } from './sync-model';

const CHANGE_NOTICE_MS = 250;

declare global {
  interface Window {
    sync: SyncApi;
  }
}

export const sync = window.sync;

export const syncStore = new Store<{ view: SyncView | null }>({ view: null });

// Store changes made by applying synced records are not news to the main process.
let isApplying = false;

async function serve(request: SyncSourceRequest): Promise<unknown> {
  const source = syncSources[request.kind];
  if (request.method === 'validate') return source.validate(request.value, request.id) ?? null;
  if (request.method === 'snapshot') {
    const values = toJson(await source.snapshot()) as SyncSnapshot['values'];
    const invalid = Object.entries(values).flatMap(([id, value]) => {
      try { source.validate(value, id); return []; } catch { return [id]; }
    });
    return { values, invalid } satisfies SyncSnapshot;
  }
  isApplying = true;
  try { await source.apply(request.change); }
  finally { isApplying = false; }
  return null;
}

export function startSync(): void {
  sync.on('view', (view) => syncStore.set({ view }));
  void sync.request('sync.view', {}).then((view) => syncStore.set({ view })).catch(() => undefined);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const notice = () => {
    if (isApplying || noticeTimer || syncStore.get().view?.phase !== 'on') return;
    noticeTimer = setTimeout(() => {
      noticeTimer = undefined;
      sync.changed();
    }, CHANGE_NOTICE_MS);
  };
  syncedStores.forEach((store) => store.subscribe(notice));
  sync.serve(serve);
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
