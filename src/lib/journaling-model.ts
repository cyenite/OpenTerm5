import { syncState, type AccountSync, type JournalingView } from '../../shared/journaling';

export function relativeTime(time: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export interface JournalStatus {
  readonly text: string;
  readonly tone: 'good' | 'warn' | 'bad' | 'neutral';
}

// The status bar's one-line summary, for the account the UI is logged in to.
export function journalStatus(view: JournalingView | null, now: number): JournalStatus | null {
  if (!view) return null;
  if (view.isReconnectNeeded) return { text: 'Journal: reconnect', tone: 'bad' };
  if (!view.isConnected) return null;
  const account = view.accounts.find((item) => item.isActive);
  if (!account) return { text: 'Journal connected', tone: 'neutral' };
  if (account.state === 'synced' && account.lastSyncAt) return { text: `Journal synced ${relativeTime(account.lastSyncAt, now)}`, tone: 'good' };
  const state = syncState(account.state);
  return { text: `Journal ${state.status}`, tone: state.tone };
}

export const accountSyncKey = (login: number, server: string) => `${login}@${server}`;

export interface AccountRow {
  readonly key: string;
  readonly label: string;
  readonly sync: AccountSync;
}

// Saved MT5 accounts with their sync state; an account the service has not seen yet syncs by
// default once it becomes active.
export function accountRows(profiles: readonly { label: string; login: number; server: string }[], accounts: readonly AccountSync[]): AccountRow[] {
  const known = new Map(accounts.map((account) => [account.key, account]));
  const rows = profiles.map((profile) => {
    const key = accountSyncKey(profile.login, profile.server);
    const sync = known.get(key) ?? { key, login: profile.login, server: profile.server, state: 'idle' as const, cursor: null, retryAt: null, lastSyncAt: null, message: null, isActive: false, isEnabled: true };
    known.delete(key);
    return { key, label: profile.label || String(profile.login), sync };
  });
  return [...rows, ...[...known.values()].map((sync) => ({ key: sync.key, label: String(sync.login), sync }))];
}

export function splitList(value: string): string[] {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
}

export function formatPnl(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  const fixed = Math.abs(value).toFixed(2);
  return value > 0 ? `+${fixed}` : value < 0 ? `-${fixed}` : fixed;
}
