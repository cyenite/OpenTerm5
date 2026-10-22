import { useEffect, useState } from 'react';
import { bybitEnvironments, type AccountProfile, type BybitEnvironment } from '../../../shared/protocol';
import { refreshSession, session, signInName, terminal } from '../../lib/session';
import { useStore } from '../../lib/store';
import { closeDialog } from '../../lib/workspace';
import { SigningIn } from '../ui/SigningIn';

interface BybitLoginFormProps {
  profile?: AccountProfile;
}

export function BybitLoginForm({ profile }: BybitLoginFormProps) {
  const signIn = useStore(session, (state) => state.signIn);
  const initial = bybitEnvironments.find((item) => item.restUrl === profile?.webEndpoint)?.key ?? bybitEnvironments[0].key;
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState(profile?.label ?? '');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [environment, setEnvironment] = useState<BybitEnvironment>(initial);
  const [isBusy, setIsBusy] = useState(false);
  const [canSaveSecret, setCanSaveSecret] = useState(false);
  const [isPasswordSaved, setIsPasswordSaved] = useState(profile?.isPasswordSaved ?? false);
  useEffect(() => {
    let isCancelled = false;
    void terminal.request('accounts.storage', {}).then((storage) => { if (!isCancelled) setCanSaveSecret(storage.canSavePasswords); });
    return () => { isCancelled = true; };
  }, []);
  const isSigningIn = signIn?.state === 'signing-in';
  const selected = bybitEnvironments.find((item) => item.key === environment)!;
  const submit = async () => {
    if (isSigningIn) return;
    setIsBusy(true);
    setError(null);
    try {
      const next = await terminal.request('exchange.login', { platform: 'bybit', environment, apiKey, apiSecret, label, isPasswordSaved });
      session.set({ account: next });
      await refreshSession();
      closeDialog();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setApiSecret('');
      setIsBusy(false);
    }
  };

  return (
    <form
      className="order-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="field">
        <span>Environment</span>
        <select value={environment} disabled={isBusy} onChange={(event) => setEnvironment(event.target.value as BybitEnvironment)}>
          {bybitEnvironments.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>API key</span>
        <input disabled={isBusy} value={apiKey} onChange={(event) => setApiKey(event.target.value.trim())} autoComplete="off" spellCheck={false} required />
      </label>
      <label className="field">
        <span>API secret</span>
        <input type="password" disabled={isBusy} value={apiSecret} onChange={(event) => setApiSecret(event.target.value.trim())} autoComplete="off" required />
      </label>
      <label className="field"><span>Label</span><input value={label} disabled={isBusy} onChange={(event) => setLabel(event.target.value)} placeholder="Optional, e.g. Bybit demo" maxLength={128} /></label>
      <label className="check"><input type="checkbox" checked={isPasswordSaved} disabled={isBusy || !canSaveSecret} onChange={(event) => setIsPasswordSaved(event.target.checked)} />Save API secret securely on this computer</label>
      {!canSaveSecret && <p className="is-muted">Secure OS storage is unavailable. The secret stays in memory until you quit.</p>}
      <p className="is-muted">
        Create a system-generated key on {selected.key === 'demo' ? 'Bybit, after switching to Demo Trading' : selected.key === 'testnet' ? 'testnet.bybit.com' : 'Bybit'} with
        Contract Orders and Positions allowed and Withdraw off. OpenTerm5 refuses keys that can withdraw. Keys without an IP restriction stop working after 90 days.
      </p>
      {isSigningIn && !isBusy && signIn && <p className="is-muted"><SigningIn signIn={signIn} /> Log in here once it finishes.</p>}
      {signIn?.state === 'failed' && profile && signIn.id === profile.id && !error && <p role="alert" className="is-loss">The last sign-in to {signInName(signIn)} failed: {signIn.error ?? 'unknown error'}</p>}
      {error && <p role="alert" className="is-loss">{error}</p>}
      <div className="dialog-actions">
        <button type="button" onClick={closeDialog}>Cancel</button>
        <button className="is-primary" type="submit" disabled={isBusy || isSigningIn || !apiKey || !apiSecret}>
          {isBusy ? 'Signing in…' : 'Login'}
        </button>
      </div>
    </form>
  );
}
