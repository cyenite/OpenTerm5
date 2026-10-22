import { Component } from 'react';
import type { AccountProfile, AccountSignIn } from '../../../shared/protocol';
import { refreshSession, session, terminal } from '../../lib/session';
import { closeDialog, openDialog } from '../../lib/workspace';
import { Dialog } from './Dialog';

interface AccountsState {
  error: string;
  removeId: string;
  activeId: string | null;
  signIn: AccountSignIn | null;
  profiles: AccountProfile[];
  isBusy: boolean;
}

const credentialState = (profile: AccountProfile) => {
  const name = profile.platform === 'bybit' ? 'API secret' : 'Password';
  return profile.isPasswordSaved ? `${name} saved securely` : profile.hasPassword ? `${name} in memory` : `${name} required`;
};

export class AccountsDialog extends Component<Record<string, never>, AccountsState> {
  state: AccountsState = { error: '', removeId: '', activeId: session.get().profileId, signIn: session.get().signIn, profiles: session.get().accounts, isBusy: false };
  private unsubscribe?: () => void;

  componentDidMount(): void {
    this.unsubscribe = session.subscribe(() => this.setState({ activeId: session.get().profileId, signIn: session.get().signIn, profiles: session.get().accounts }));
    void terminal.request('accounts.list', {}).then((profiles) => session.set({ accounts: profiles })).catch((error: Error) => this.setState({ error: error.message }));
  }

  componentWillUnmount(): void { this.unsubscribe?.(); }

  private connect = async (profile: AccountProfile): Promise<void> => {
    if (!profile.hasPassword) { openDialog({ kind: 'login', profileId: profile.id }); return; }
    this.setState({ isBusy: true, error: '' });
    try {
      await terminal.request('accounts.connect', { id: profile.id });
      await refreshSession();
      closeDialog();
    } catch (error) { this.setState({ error: (error as Error).message }); }
    finally { this.setState({ isBusy: false }); }
  };

  private remove = async (id: string): Promise<void> => {
    this.setState({ isBusy: true, error: '' });
    try { await terminal.request('accounts.remove', { id }); this.setState({ removeId: '' }); }
    catch (error) { this.setState({ error: (error as Error).message }); }
    finally { this.setState({ isBusy: false }); }
  };

  render() {
    const { error, signIn, profiles, activeId, removeId, isBusy } = this.state;
    const isSigningIn = signIn?.state === 'signing-in';
    return (
      <Dialog title="Trading Accounts" width={760}>
        <p className="is-muted">One account is active at a time. Switching clears its market and trade state. Saved passwords use your OS credential storage only when you choose to save them.</p>
        <div className="scroll" style={{ maxHeight: 360 }}>
          <table className="grid">
            <thead><tr><th>Account</th><th>Server</th><th>Access</th><th>Actions</th></tr></thead>
            <tbody>{profiles.map((profile) => (
              <tr key={profile.id}>
                <td title={profile.webEndpoint}><b>{profile.label}</b><br />{profile.login} · {profile.name}{profile.id === activeId ? ' · Active' : ''}</td>
                <td>{profile.server}<br /><span className="is-muted">{profile.company}</span></td>
                <td>{profile.tradeMode}<br />{credentialState(profile)}{signIn?.id === profile.id && signIn.state === 'failed' && <><br /><span className="is-loss" title={signIn.error}>Last sign-in failed</span></>}</td>
                <td>
                  <button disabled={isBusy || isSigningIn} title={isSigningIn && signIn.id !== profile.id ? 'Available once the current sign-in finishes' : undefined} onClick={() => void this.connect(profile)}>{isSigningIn && signIn.id === profile.id ? <><span className="spinner" aria-hidden /> Signing in…</> : 'Connect'}</button>{' '}
                  <button disabled={isBusy} onClick={() => openDialog({ kind: 'login', profileId: profile.id })}>Edit login</button>{' '}
                  {removeId === profile.id ? <><button disabled={isBusy} onClick={() => void this.remove(profile.id)}>Confirm forget</button><button disabled={isBusy} onClick={() => this.setState({ removeId: '' })}>Keep account</button></> : <button disabled={isBusy} onClick={() => this.setState({ removeId: profile.id })}>Forget</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!profiles.length && <p>No saved accounts. Log in to add your first account.</p>}
        </div>
        {error && <p className="is-loss" role="alert">{error}</p>}
        <div className="dialog-actions"><button disabled={isBusy} onClick={() => openDialog({ kind: 'login' })}>Add account</button><button onClick={closeDialog}>Close</button></div>
      </Dialog>
    );
  }
}
