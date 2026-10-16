import { useEffect, useState } from 'react';
import { syncState, type JournalingView } from '../../../shared/journaling';
import { journaling, journalingStore } from '../../lib/journaling';
import { accountRows, relativeTime } from '../../lib/journaling-model';
import { session, signingIn, signInName } from '../../lib/session';
import { useStore } from '../../lib/store';
import { Section, StatusPill } from '../ui/Controls';

const pillStatus = { good: 'ok', warn: 'paused', bad: 'failed', neutral: 'idle' } as const;

interface SyncSwitchProps {
  label: string;
  isOn: boolean;
  isDisabled: boolean;
  onChange: (isOn: boolean) => void;
}

function SyncSwitch({ label, isOn, isDisabled, onChange }: SyncSwitchProps) {
  return (
    <button type="button" role="switch" aria-checked={isOn} aria-label={label} aria-disabled={isDisabled} className={`switch${isOn ? ' is-on' : ''}`} onClick={() => { if (!isDisabled) onChange(!isOn); }}>
      <span className="switch-knob" />
    </button>
  );
}

interface SyncAccountsProps {
  view: JournalingView;
}

export function SyncAccounts({ view }: SyncAccountsProps) {
  const signIn = useStore(session, signingIn);
  const profiles = useStore(session, (state) => state.accounts);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const rows = accountRows(profiles, view.accounts);
  const active = view.accounts.find((account) => account.isActive);
  const canSync = view.isConnected && !!active?.isEnabled && active.state !== 'syncing';

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const run = async (work: () => Promise<JournalingView>) => {
    setError(null);
    try { journalingStore.set({ view: await work() }); }
    catch (reason) { setError((reason as Error).message); }
  };
  const syncNow = () => { if (canSync) void run(() => journaling.request('journaling.syncNow', {})); };
  const syncHint = !active && signIn ? `Available once ${signInName(signIn)} has signed in.` : !active ? 'Log in to an MT5 account to sync it.' : !active.isEnabled ? 'Sync is off for the active account.' : 'Fetch the active account\'s deals now.';

  return (
    <Section
      title="MT5 accounts"
      detail="The account you are logged in to syncs automatically. Others sync when you switch to them."
      actions={<button type="button" aria-disabled={!canSync} title={syncHint} onClick={syncNow}>Sync now</button>}
    >
      {error && <p role="alert" className="banner is-bad">{error}</p>}
      {rows.length ? (
        <table className="grid compact journal-accounts">
          <thead><tr><th>Account</th><th>Status</th><th>Last sync</th><th className="num">Sync</th></tr></thead>
          <tbody>
            {rows.map(({ key, label, sync }) => {
              const state = syncState(sync.isEnabled ? sync.state : 'off');
              const detail = [sync.message, sync.retryAt ? `Retrying at ${new Date(sync.retryAt).toLocaleTimeString()}` : null].filter(Boolean).join(' ');
              return (
                <tr key={key} className={sync.isActive ? 'is-selected' : ''}>
                  <td>
                    <b>{label}</b> <span className="is-muted">{sync.login} · {sync.server}{sync.isActive ? ' · active' : ''}</span>
                  </td>
                  <td>
                    <StatusPill status={pillStatus[state.tone]} label={state.label} />
                    {detail && <small className="journal-detail">{detail}</small>}
                  </td>
                  <td title={sync.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString() : undefined}>{sync.lastSyncAt ? relativeTime(sync.lastSyncAt, now) : 'Never'}</td>
                  <td className="num">
                    <SyncSwitch label={`Sync ${label}`} isOn={sync.isEnabled} isDisabled={!view.isConnected} onChange={(isEnabled) => void run(() => journaling.request('journaling.setEnabled', { key, isEnabled }))} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p className="is-muted">No MT5 accounts yet. Log in to one (File &gt; Login to Trade Account) and its trades sync here.</p>}
    </Section>
  );
}
