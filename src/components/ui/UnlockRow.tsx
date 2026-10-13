import { useState } from 'react';
import { accountLabel, automation } from '../../lib/automation';
import { session } from '../../lib/session';
import { useStore } from '../../lib/store';
import { StatusPill } from './Controls';

interface UnlockRowProps {
  accountId: string;
  error?: string;
  state: string;
}

export function UnlockRow({ accountId, error, state }: UnlockRowProps) {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const label = useStore(session, (current) => current.accounts.find((profile) => profile.id === accountId)?.label ?? accountLabel(accountId));
  const needsPassword = !!error?.includes('Password');
  return (
    <li className="session-row">
      <div>
        <strong>{label}</strong>
        <small>{error ?? accountId.split('|')[0].replace('wss://', '')}</small>
      </div>
      <StatusPill status={state} />
      {needsPassword && (
        <form className="inline-form" onSubmit={(event) => {
          event.preventDefault();
          automation.request('accounts.unlock', { id: accountId, password }).then(() => { setPassword(''); setMessage('Connecting…'); }).catch((reason: Error) => setMessage(reason.message));
        }}>
          <input type="password" aria-label={`Password for ${label}`} placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
          <button type="submit" disabled={!password}>Connect</button>
          {message && <small>{message}</small>}
        </form>
      )}
    </li>
  );
}

