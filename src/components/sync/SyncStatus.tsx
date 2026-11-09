import { syncStatuses } from '../../../shared/sync';
import { syncStore } from '../../lib/sync';
import { useStore } from '../../lib/store';
import { openDialog } from '../../lib/workspace';
import { Icon } from '../ui/Icon';

// A quiet icon while sync looks after itself, words only when it needs the user.
export function SyncStatus() {
  const view = useStore(syncStore, (state) => state.view);
  const status = useStore(syncStore, (state) => state.settled);
  if (!view || (view.phase !== 'on' && view.phase !== 'savingCode')) return null;
  const isAsked = view.pairingRequests.length > 0;
  const label = syncStatuses.find((item) => item.key === status)?.label ?? '';
  if (isAsked || status === 'attention') {
    const text = isAsked ? 'A computer asks to join' : 'Sync needs you';
    return (
      <button type="button" className="status-cell status-sync is-warn" title={view.attention?.message ?? text} aria-live="polite" onClick={() => openDialog({ kind: 'sync' })}>
        <Icon name="cloudAttention" size={14} /> {text}
      </button>
    );
  }
  const when = view.lastSyncedAt ? ` Last synced ${new Date(view.lastSyncedAt).toLocaleTimeString()}.` : '';
  const detail = status === 'idle' ? '' : `${view.error ? ` ${view.error}` : ''} Your edits are kept and sync tries again by itself.`;
  return (
    <button type="button" className="status-cell status-sync" title={`Sync: ${label}.${when}${detail}`} aria-label={`Sync: ${label}`} onClick={() => openDialog({ kind: 'sync' })}>
      <Icon name={status === 'idle' ? 'cloudSynced' : 'cloudPaused'} size={14} />
    </button>
  );
}
