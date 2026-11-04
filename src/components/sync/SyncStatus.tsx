import { syncStatuses } from '../../../shared/sync';
import { syncStore } from '../../lib/sync';
import { useStore } from '../../lib/store';
import { openDialog } from '../../lib/workspace';

const tones = { idle: 'is-good', syncing: '', offline: 'is-warn', waiting: 'is-warn', attention: 'is-bad' } as const;

export function SyncStatus() {
  const view = useStore(syncStore, (state) => state.view);
  if (!view || (view.phase !== 'on' && view.phase !== 'savingCode')) return null;
  const isAsked = view.pairingRequests.length > 0;
  const label = isAsked ? 'a computer asks to join' : syncStatuses.find((status) => status.key === view.status)?.label ?? '';
  const title = view.attention?.message ?? (view.lastSyncedAt ? `Last synced ${new Date(view.lastSyncedAt).toLocaleTimeString()}` : 'Sync');
  return (
    <button type="button" className={`status-cell status-sync ${isAsked ? 'is-warn' : tones[view.status]}`} title={title} aria-live="polite" onClick={() => openDialog({ kind: 'sync' })}>
      {view.status === 'syncing' && <span className="spinner" aria-hidden />} Sync: {label}
    </button>
  );
}
