import { useState, type FormEvent } from 'react';
import { passphraseProblem, syncKindInfo, syncStatuses, type SyncAttention, type SyncDeviceView, type SyncMethod, type SyncMethods, type SyncPairingRequest, type SyncView } from '../../../shared/sync';
import { requestSync, syncStore } from '../../lib/sync';
import { useStore } from '../../lib/store';
import { Dialog } from '../dialogs/Dialog';
import { Section, Switch } from '../ui/Controls';

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const run = async <M extends SyncMethod>(method: M, params: SyncMethods[M][0]) => {
    if (isBusy) return;
    setIsBusy(true);
    setError(null);
    setError(await requestSync(method, params));
    setIsBusy(false);
  };
  return { error, isBusy, run };
}

interface ErrorBannerProps {
  error: string | null;
}

interface SyncStepProps {
  view: SyncView;
}

function ErrorBanner({ error }: ErrorBannerProps) {
  return error ? <p role="alert" className="banner is-bad">{error}</p> : null;
}

function SignInStep({ view }: SyncStepProps) {
  const { error, isBusy, run } = useAction();
  return (
    <Section title="Sync with GitHub" detail="Keep your layouts, drawings and settings the same on every computer. Everything is encrypted on this computer before it leaves, so GitHub only ever stores data it cannot read.">
      <ol className="sync-steps">
        <li>Create an empty <b>private</b> repository for sync. <button type="button" className="link-button" onClick={() => void requestSync('sync.open', { page: 'newRepository' })}>Create one on GitHub</button></li>
        <li>Install the <b>OpenTerm5 Sync</b> app on that repository only. <button type="button" className="link-button" onClick={() => void requestSync('sync.open', { page: 'install' })}>Install the app</button></li>
        <li>Connect GitHub below.</li>
      </ol>
      {view.userCode ? <DeviceCode view={view} /> : (
        <div className="button-row">
          <button type="button" className="is-primary" aria-disabled={isBusy} onClick={() => void run('sync.connect', {})}>Connect GitHub</button>
        </div>
      )}
      <ErrorBanner error={error ?? view.error} />
      {!view.userCode && (
        <div className="sync-alternative">
          <p className="is-muted">No GitHub account? Keep the encrypted sync data in one file instead, on a USB drive, a network share or a folder your cloud storage syncs. Open the same file on each computer.</p>
          <div className="button-row">
            <button type="button" aria-disabled={isBusy} onClick={() => void run('sync.useFile', { mode: 'new' })}>Create a sync file</button>
            <button type="button" aria-disabled={isBusy} onClick={() => void run('sync.useFile', { mode: 'open' })}>Open a sync file</button>
          </div>
        </div>
      )}
    </Section>
  );
}

function DeviceCode({ view }: SyncStepProps) {
  return (
    <div className="stack">
      <p>Enter this code on the GitHub page that opened in your browser, and check the page names <b>OpenTerm5 Sync</b>:</p>
      <p className="sync-code is-mono" aria-label="GitHub code">{view.userCode}</p>
      <div className="button-row">
        <button type="button" onClick={() => void requestSync('sync.open', { page: 'verification' })}>Open the page again</button>
        <button type="button" onClick={() => void requestSync('sync.cancel', {})}>Cancel</button>
        <span className="is-muted" role="status"><span className="spinner" aria-hidden /> Waiting for GitHub</span>
      </div>
    </div>
  );
}

function RepositoryStep({ view }: SyncStepProps) {
  const { error, isBusy, run } = useAction();
  return (
    <Section title="Choose the sync repository" detail={`Signed in to GitHub as ${view.login ?? 'you'}. OpenTerm5 Sync can only see the repositories you installed it on.`}>
      {view.repositories.length ? (
        <ul className="sync-repositories">
          {view.repositories.map((repository) => (
            <li key={repository.id}>
              <button type="button" aria-disabled={isBusy || !repository.isPrivate} title={repository.isPrivate ? undefined : 'Public repositories are not used for sync'} onClick={() => repository.isPrivate && void run('sync.chooseRepository', { id: repository.id })}>
                {repository.fullName}
              </button>
              {!repository.isPrivate && <span className="is-muted"> public, not usable</span>}
            </li>
          ))}
        </ul>
      ) : <p className="is-muted">The app is not installed on any repository yet.</p>}
      <div className="button-row">
        <button type="button" onClick={() => void requestSync('sync.open', { page: 'install' })}>Install on a repository</button>
        <button type="button" aria-disabled={isBusy} onClick={() => void run('sync.refreshRepositories', {})}>Refresh</button>
        <button type="button" onClick={() => void requestSync('sync.cancel', {})}>Cancel</button>
      </div>
      <ErrorBanner error={error} />
    </Section>
  );
}

function CreateStep({ view }: SyncStepProps) {
  const { error, isBusy, run } = useAction();
  const [passphrase, setPassphrase] = useState('');
  const problem = passphrase ? passphraseProblem(passphrase) : null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!problem) void run('sync.create', { passphrase: passphrase || null });
  };
  return (
    <Section title="Set up sync" detail={`${view.backend === 'file' ? 'This sync file is new' : `${view.repository} is empty`}, so this computer creates the sync key. You get a recovery code next: it unlocks sync on your other computers.`}>
      {!view.canKeepSecrets && <p className="banner is-warn">This computer has no system keychain, so the sync key is kept only until OpenTerm5 closes. You will need the recovery code again after a restart.</p>}
      <form className="stack" onSubmit={submit}>
        <label className="form-field is-wide">
          <span>Passphrase (optional)</span>
          <input type="password" value={passphrase} autoComplete="new-password" aria-describedby="sync-passphrase-hint" onChange={(event) => setPassphrase(event.target.value)} />
          <small id="sync-passphrase-hint">{problem ?? 'A second way to unlock sync, easier to remember than the recovery code. Leave it empty to use the code only.'}</small>
        </label>
        <div className="button-row">
          <button type="submit" className="is-primary" aria-disabled={isBusy || !!problem}>Create sync key</button>
          <button type="button" onClick={() => void requestSync('sync.cancel', {})}>Cancel</button>
        </div>
      </form>
      <ErrorBanner error={error} />
    </Section>
  );
}

function JoinStep({ view }: SyncStepProps) {
  const { error, isBusy, run } = useAction();
  const [isPassphrase, setIsPassphrase] = useState(false);
  const [secret, setSecret] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (secret.trim()) void run('sync.join', isPassphrase ? { passphrase: secret } : { recoveryCode: secret });
  };
  return (
    <Section title="Unlock sync" detail={`${view.backend === 'file' ? 'This sync file' : view.repository} is already set up by another computer. Approve this computer from one that already syncs, or unlock it with the recovery code or your passphrase.`}>
      <div className="button-row sync-copy">
        <button type="button" className="is-primary" aria-disabled={isBusy} onClick={() => void run('sync.requestPairing', {})}>Approve from another computer</button>
      </div>
      <form className="stack" onSubmit={submit}>
        <label className="form-field is-wide">
          <span>{isPassphrase ? 'Passphrase' : 'Recovery code'}</span>
          <input type={isPassphrase ? 'password' : 'text'} className={isPassphrase ? undefined : 'is-mono'} value={secret} placeholder={isPassphrase ? undefined : 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'} autoComplete="off" spellCheck={false} onChange={(event) => setSecret(event.target.value)} />
        </label>
        <div className="button-row">
          <button type="submit" aria-disabled={isBusy || !secret.trim()}>{isBusy ? 'Unlocking…' : 'Unlock'}</button>
          <button type="button" className="link-button" onClick={() => { setIsPassphrase(!isPassphrase); setSecret(''); }}>{isPassphrase ? 'Use the recovery code' : 'Use the passphrase'}</button>
          <button type="button" onClick={() => void requestSync('sync.cancel', {})}>Cancel</button>
        </div>
      </form>
      <ErrorBanner error={error} />
    </Section>
  );
}

interface PairingWordsProps {
  words: readonly string[];
}

function PairingWords({ words }: PairingWordsProps) {
  return <p className="sync-code sync-words" aria-label="Pairing words">{words.join(' ')}</p>;
}

function PairingStep({ view }: SyncStepProps) {
  const { error, isBusy, run } = useAction();
  const [words, setWords] = useState('');
  if (view.isPairingApproved) {
    const submit = (event: FormEvent) => {
      event.preventDefault();
      if (words.trim()) void run('sync.confirmPairing', { words });
    };
    return (
      <Section title="Confirm the approval" detail="The other computer approved this one and now shows three words. Type them here: they prove the sync key really came from your computer.">
        <form className="stack" onSubmit={submit}>
          <label className="form-field is-wide">
            <span>Three words from the other computer</span>
            <input value={words} autoComplete="off" spellCheck={false} onChange={(event) => setWords(event.target.value)} />
          </label>
          <div className="button-row">
            <button type="submit" className="is-primary" aria-disabled={isBusy || !words.trim()}>Confirm</button>
            <button type="button" aria-disabled={isBusy} onClick={() => void run('sync.cancelPairing', {})}>Cancel</button>
          </div>
        </form>
        <ErrorBanner error={error} />
      </Section>
    );
  }
  return (
    <Section title="Waiting for approval" detail="On a computer that already syncs, open File > Sync Across Computers. Approve the request there only if it shows exactly these six words.">
      <PairingWords words={view.pairingWords} />
      <div className="button-row">
        <span className="is-muted" role="status"><span className="spinner" aria-hidden /> Waiting for the other computer</span>
        <button type="button" aria-disabled={isBusy} onClick={() => void run('sync.cancelPairing', {})}>Use the recovery code instead</button>
      </div>
      <ErrorBanner error={error ?? view.error} />
    </Section>
  );
}

interface PairingRequestsProps {
  requests: readonly SyncPairingRequest[];
}

interface PairingConfirmationProps {
  words: readonly string[];
}

function PairingConfirmation({ words }: PairingConfirmationProps) {
  if (!words.length) return null;
  return (
    <div className="banner is-good" role="status">
      <p>Approved. Type these three words on the new computer to finish:</p>
      <PairingWords words={words} />
      <div className="button-row">
        <button type="button" onClick={() => void requestSync('sync.dismissConfirmation', {})}>Done</button>
      </div>
    </div>
  );
}

// Approving wraps the sync key to that computer, so the words must match what it shows.
function PairingRequests({ requests }: PairingRequestsProps) {
  const { error, isBusy, run } = useAction();
  if (!requests.length) return null;
  return (
    <div className="banner is-warn" role="alert">
      <p>{requests.length === 1 ? 'A computer asks to join sync.' : `${requests.length} computers ask to join sync.`} Approve only if the new computer shows exactly the same six words. If you did not ask, decline.</p>
      {requests.map((request) => (
        <div key={request.deviceId} className="stack">
          <PairingWords words={request.words} />
          <div className="button-row">
            <button type="button" className="is-primary" aria-disabled={isBusy} onClick={() => void run('sync.answerPairing', { deviceId: request.deviceId, isApproved: true })}>The words match: approve</button>
            <button type="button" aria-disabled={isBusy} onClick={() => void run('sync.answerPairing', { deviceId: request.deviceId, isApproved: false })}>Decline</button>
          </div>
        </div>
      ))}
      <ErrorBanner error={error} />
    </div>
  );
}

function RecoveryStep({ view }: SyncStepProps) {
  const { error, isBusy, run } = useAction();
  const [answers, setAnswers] = useState<string[]>(view.recoveryCheck.map(() => ''));
  const [isCopied, setIsCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(view.recoveryCode ?? '');
    setIsCopied(true);
    // The code should not linger on the clipboard.
    setTimeout(() => { void navigator.clipboard.writeText('').catch(() => undefined); setIsCopied(false); }, 60_000);
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run('sync.confirmRecovery', { answers });
  };
  return (
    <Section title="Save your recovery code" detail="Keep it in your password manager or on paper. With it you can unlock sync on any computer, even if you lose this one. Nobody, including OpenTerm5, can recover your synced data without it.">
      <p className="sync-code is-mono" aria-label="Recovery code">{view.recoveryCode}</p>
      <div className="button-row sync-copy">
        <button type="button" onClick={() => void copy()}>{isCopied ? 'Copied for 60 seconds' : 'Copy'}</button>
      </div>
      <form className="stack" onSubmit={submit}>
        <p>To show it is saved, type these groups of the code:</p>
        <div className="field-pair">
          {view.recoveryCheck.map((group, index) => (
            <label key={group} className="form-field">
              <span>Group {group}</span>
              <input className="is-mono" maxLength={4} value={answers[index] ?? ''} autoComplete="off" spellCheck={false} onChange={(event) => setAnswers(answers.map((answer, position) => position === index ? event.target.value : answer))} />
            </label>
          ))}
        </div>
        <div className="button-row">
          <button type="submit" className="is-primary" aria-disabled={isBusy || answers.some((answer) => answer.trim().length !== 4)}>I saved it</button>
        </div>
      </form>
      <ErrorBanner error={error} />
    </Section>
  );
}

const resolutionLabels: Partial<Record<SyncAttention['reason'], { choice: SyncMethods['sync.resolve'][0]['choice']; label: string }[]>> = {
  held: [{ choice: 'useSynced', label: 'Restore from sync' }, { choice: 'allowDeletions', label: 'Delete everywhere' }],
  join: [{ choice: 'merge', label: 'Merge' }, { choice: 'useSynced', label: 'Use synced data' }],
  stale: [{ choice: 'useSynced', label: 'Use the synced data' }],
  rollback: [{ choice: 'acceptHistory', label: 'I restored it on purpose' }],
};

interface AttentionBannerProps {
  attention: SyncAttention;
}

function AttentionBanner({ attention }: AttentionBannerProps) {
  const { error, isBusy, run } = useAction();
  const choices = resolutionLabels[attention.reason] ?? [];
  return (
    <div className="banner is-warn" role="alert">
      <p>{attention.message}</p>
      {attention.changes.length > 0 && (
        <ul>
          {attention.changes.map((change) => (
            <li key={`${change.kind}-${change.side}`}>{syncKindInfo(change.kind).label}: {change.removed} of {change.total} removed {change.side === 'local' ? 'on this computer' : 'on another computer'}</li>
          ))}
        </ul>
      )}
      <div className="button-row">
        {attention.reason === 'reconnect' && <button type="button" className="is-primary" aria-disabled={isBusy} onClick={() => void run('sync.connect', {})}>Reconnect GitHub</button>}
        {choices.map(({ choice, label }) => <button key={choice} type="button" aria-disabled={isBusy} onClick={() => void run('sync.resolve', { choice })}>{label}</button>)}
        {attention.reason !== 'reconnect' && attention.reason !== 'join' && <button type="button" aria-disabled={isBusy} onClick={() => void run('sync.syncNow', {})}>Try again</button>}
      </div>
      <ErrorBanner error={error} />
    </div>
  );
}

const formatWhen = (time: number | null) => time ? new Date(time).toLocaleString() : 'never';

interface DeviceListProps {
  devices: readonly SyncDeviceView[];
}

function DeviceList({ devices }: DeviceListProps) {
  if (!devices.length) return null;
  return (
    <table className="sync-devices">
      <thead><tr><th>Computer</th><th>System</th><th>Last synced</th></tr></thead>
      <tbody>
        {devices.map((device) => (
          <tr key={device.id}>
            <td>{device.name}{device.isThisComputer ? ' (this computer)' : ''}{device.isRevoked ? ' (removed)' : ''}</td>
            <td>{device.platform}</td>
            <td>{formatWhen(device.lastSeen)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Secrets and the CID sync only on request, and only where the system keychain can hold them.
function SharingPanel({ view }: SyncStepProps) {
  const { error, isBusy, run } = useAction();
  const share = (change: Partial<SyncMethods['sync.setSharing'][0]>) => void run('sync.setSharing', { isSecretsSynced: view.isSecretsSynced, isIdentitySynced: view.isIdentitySynced, ...change });
  return (
    <Section title="Passwords and identity" detail="Saved accounts always sync. Their passwords and the CID sync only if you turn them on here, on each computer.">
      <Switch
        label="Sync saved passwords, API keys and webhook secrets"
        hint={view.canKeepSecrets ? 'Encrypted with your sync key, and stored here in the system keychain. The newest saved password wins.' : 'This computer has no system keychain, so passwords cannot be kept here.'}
        isOn={view.isSecretsSynced}
        isDisabled={isBusy || !view.canKeepSecrets}
        onChange={(isSecretsSynced) => share({ isSecretsSynced })}
      />
      <Switch
        label="Use one CID on all my computers"
        hint="Brokers and prop firms then see your computers as one device. Off, each computer is its own device. Logging in to one account from two computers at once can look like one device on two networks."
        isOn={view.isIdentitySynced}
        isDisabled={isBusy || view.isIdentityChoiceNeeded}
        onChange={(isIdentitySynced) => share({ isIdentitySynced })}
      />
      {view.isIdentityChoiceNeeded && (
        <div className="banner is-warn" role="alert">
          <p>Your other computers already share a different CID. Which one should all your computers use? A change applies from each computer's next login.</p>
          <div className="button-row">
            <button type="button" className="is-primary" aria-disabled={isBusy} onClick={() => share({ isIdentitySynced: true, identityChoice: 'synced' })}>Use the synced CID</button>
            <button type="button" aria-disabled={isBusy} onClick={() => share({ isIdentitySynced: true, identityChoice: 'this' })}>Use this computer's CID</button>
          </div>
        </div>
      )}
      <ErrorBanner error={error} />
    </Section>
  );
}

function OnPanel({ view }: SyncStepProps) {
  const { error, isBusy, run } = useAction();
  const [isConfirmingDisconnect, setIsConfirmingDisconnect] = useState(false);
  const status = syncStatuses.find((item) => item.key === view.status)?.label;
  return (
    <Section title={view.backend === 'file' ? 'Syncing through a sync file' : `Syncing with ${view.repository}`} detail={`${status}. Last synced ${formatWhen(view.lastSyncedAt)}. ${view.backend === 'file' ? `File: ${view.repository}.` : `GitHub account: ${view.login ?? 'not connected'}.`}`}>
      {view.userCode && <DeviceCode view={view} />}
      <PairingConfirmation words={view.pairingConfirmation} />
      <PairingRequests requests={view.pairingRequests} />
      {view.attention && <AttentionBanner attention={view.attention} />}
      {!view.isRecoveryConfirmed && <p className="banner is-warn">The recovery code for this sync was never confirmed. Make a new one and save it.</p>}
      {view.status === 'offline' && view.error && <p className="banner is-warn">{view.error} OpenTerm5 keeps your edits and tries again.</p>}
      <p className="is-muted">Layouts, charts, drawings, watchlists, templates, alerts, Pine scripts, saved accounts and settings stay the same on your computers. Panels, and which layout is in front, stay with each one.</p>
      <DeviceList devices={view.devices} />
      <div className="button-row">
        <button type="button" aria-disabled={isBusy || !!view.attention} onClick={() => void run('sync.syncNow', {})}>Sync now</button>
        <button type="button" aria-disabled={isBusy} onClick={() => void run('sync.newRecoveryCode', {})}>New recovery code</button>
        <button type="button" onClick={() => void requestSync('sync.open', { page: 'repository' })}>{view.backend === 'file' ? 'Show file' : 'Open repository'}</button>
        {isConfirmingDisconnect
          ? <><button type="button" className="is-danger" onClick={() => void run('sync.disconnect', {})}>Stop syncing this computer</button><button type="button" onClick={() => setIsConfirmingDisconnect(false)}>Keep syncing</button></>
          : <button type="button" onClick={() => setIsConfirmingDisconnect(true)}>Disconnect…</button>}
      </div>
      {isConfirmingDisconnect && (
        <p className="is-muted">
          This computer forgets the sync key and stops syncing. Your data here and in the {view.backend === 'file' ? 'sync file' : 'repository'} stays.
          {view.backend === 'github' && <>{' '}To also end OpenTerm5's access to GitHub,{' '}<button type="button" className="link-button" onClick={() => void requestSync('sync.open', { page: 'authorizations' })}>revoke it on GitHub</button>.</>}
        </p>
      )}
      <ErrorBanner error={error} />
    </Section>
  );
}

function SyncStep({ view }: SyncStepProps) {
  switch (view.phase) {
    case 'off':
    case 'signingIn': return <SignInStep view={view} />;
    case 'choosingRepository': return <RepositoryStep view={view} />;
    case 'creating': return <CreateStep view={view} />;
    case 'joining': return <JoinStep view={view} />;
    case 'pairing': return <PairingStep view={view} />;
    case 'savingCode': return <RecoveryStep key={view.recoveryCode} view={view} />;
    case 'on': return <><OnPanel view={view} /><SharingPanel view={view} /></>;
  }
}

export function SyncDialog() {
  const view = useStore(syncStore, (state) => state.view);
  return (
    <Dialog title="Sync Across Computers" width={560}>
      {view ? <SyncStep view={view} /> : <p className="is-muted"><span className="spinner" aria-hidden /> Loading</p>}
    </Dialog>
  );
}
