import type { UpdateApi, UpdateMethod, UpdateMethods, UpdateState } from '../../shared/updates';
import { log } from './session';
import { Store } from './store';

declare global {
  interface Window {
    updates: UpdateApi;
  }
}

export const updates = window.updates;

export const updateStore = new Store<{ state: UpdateState | null }>({ state: null });

export function startUpdates(): void {
  updates.on('state', (state) => updateStore.set({ state }));
  void updates.request('updates.state', {}).then((state) => updateStore.set({ state })).catch(() => undefined);
}

export function requestUpdate<M extends UpdateMethod>(method: M, params: UpdateMethods[M][0]): void {
  updates.request(method, params).catch((error: Error) => log(error.message, 'Updates'));
}
