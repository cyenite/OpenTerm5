import { useEffect, useMemo, useState } from 'react';
import { platforms, type ConnectionSettings, type Platform, type ResolvedServer, type SymbolSpec } from '../../../shared/protocol';
import { refreshSession, session, signingIn, signInName, terminal } from '../../lib/session';
import { searchSymbols } from '../../lib/symbol-search';
import { rowsOf, toggleWatched, useActiveWatchlist, watchedSpecs } from '../../lib/watchlists';
import { useStore } from '../../lib/store';
import { closeDialog } from '../../lib/workspace';
import { Dialog } from './Dialog';
import { BrokerServerField } from './BrokerServerField';
import { BybitLoginForm } from './BybitLoginForm';
import { JournalingPlatformField } from '../journaling/JournalingPlatformField';
import { SigningIn } from '../ui/SigningIn';
import { InfoTip } from '../ui/InfoTip';

export function SymbolsDialog() {
  const symbols = useStore(session, (state) => state.symbols);
  const list = useActiveWatchlist();
  const [query, setQuery] = useState('');
  const watched = useMemo(() => new Set(watchedSpecs(list, symbols).map((spec) => spec.name)), [list, symbols]);
  const missing = rowsOf(list, symbols).filter((row) => row.kind === 'symbol' && !row.symbol).length;
  const groups = useMemo(() => {
    const result = new Map<string, SymbolSpec[]>();
    const matches = query.trim() ? searchSymbols(symbols, query, { limit: 500 }) : Object.values(symbols);
    for (const spec of matches) {
      const group = spec.path.split('\\').slice(0, -1).join(' \\ ') || 'Symbols';
      result.set(group, [...(result.get(group) ?? []), spec]);
    }
    return [...result.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [symbols, query]);

  return (
    <Dialog title="Symbols" width={560}>
      <p className="is-muted">Ticked symbols are in the watchlist "{list.name}".{missing ? ` ${missing} of its symbols are not offered by this account.` : ''}</p>
      <input className="search" placeholder="Find symbol: name, description or market" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
      <div className="symbols-list">
        {groups.map(([group, specs]) => (
          <details key={group} open={query.length > 0 || groups.length < 4}>
            <summary>{group}</summary>
            {specs.map((spec) => (
              <label key={spec.name} className="symbol-option">
                <input type="checkbox" checked={watched.has(spec.name)} onChange={() => toggleWatched(spec.name)} />
                <b>{spec.name}</b>
                <span className="is-muted">{spec.description}</span>
              </label>
            ))}
          </details>
        ))}
      </div>
      <div className="dialog-actions">
        <button className="is-primary" onClick={closeDialog}>OK</button>
      </div>
    </Dialog>
  );
}

export function ConnectionDialog() {
  const [settings, setSettings] = useState<ConnectionSettings | null>(null);
  const link = useStore(session, (state) => state.link);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    void terminal.settings().then(setSettings).catch((reason: Error) => setError(reason.message));
  }, []);

  if (!settings) {
    return <Dialog title="Options: Connection">{error ? <p role="alert" className="is-loss">{error}</p> : 'Loading connection settings…'}</Dialog>;
  }
  const patch = (next: Partial<ConnectionSettings>) => setSettings({ ...settings, ...next });
  const save = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const endpoint = new URL(settings.webEndpoint);
      if (endpoint.protocol !== 'wss:' || endpoint.username || endpoint.password || endpoint.hash) {
        throw new Error('Enter a secure WebSocket endpoint (wss://) without credentials or a fragment.');
      }
      await terminal.saveSettings(settings);
      closeDialog();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Connection settings could not be saved.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog title="Options: Connection" width={560}>
      <div className="order-form">
        <label className="field">
          <span>Server address</span>
          <input value={settings.webEndpoint} disabled={isSaving} onChange={(event) => patch({ webEndpoint: event.target.value })} placeholder="wss://web.metatrader.app/terminal" />
        </label>
        <p className="is-muted">Advanced. The login dialog fills this in from the trade server you pick, so you rarely need to change it.</p>
        {error && <p role="alert" className="is-loss">{error}</p>}
        <p className="order-check">
          Status: {link.state}
          {link.error ? `: ${link.error}` : ''}
        </p>
        <div className="dialog-actions">
          <button onClick={closeDialog}>Cancel</button>
          <button className="is-primary" disabled={isSaving} onClick={save}>
            Apply and reconnect
          </button>
        </div>
        <JournalingPlatformField />
      </div>
    </Dialog>
  );
}

export function LoginDialog({ profileId }: { profileId?: string }) {
  const profile = useStore(session, (state) => state.accounts.find((item) => item.id === profileId));
  const signIn = useStore(session, (state) => state.signIn);
  const [otp, setOtp] = useState('');
  const [login, setLogin] = useState(profile ? String(profile.login) : '');
  const [label, setLabel] = useState(profile?.label ?? '');
  const [server, setServer] = useState<ResolvedServer | null>(null);
  const [canSavePassword, setCanSavePassword] = useState(false);
  const [isPasswordSaved, setIsPasswordSaved] = useState(profile?.isPasswordSaved ?? false);
  const [isClientIdUnique, setIsClientIdUnique] = useState(false);
  const [isUniqueClientIdRequested, setIsUniqueClientIdRequested] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [platform, setPlatform] = useState<Platform>(profile?.platform ?? 'mt5');
  useEffect(() => {
    let isCancelled = false;
    void terminal.request('accounts.storage', {}).then((storage) => { if (!isCancelled) setCanSavePassword(storage.canSavePasswords); });
    void terminal.request('device.identity', {}).then((identity) => { if (!isCancelled) setIsClientIdUnique(identity.isUnique); }).catch(() => undefined);
    return () => { isCancelled = true; };
  }, []);
  const isSigningIn = signIn?.state === 'signing-in';
  const isOwnSignIn = isBusy || isSigningIn && !!profileId && signIn.id === profileId;
  const failure = signIn?.state === 'failed' && !!profileId && signIn.id === profileId && !error ? signIn : null;
  const submit = async () => {
    if (!server) { setError('Choose a server first.'); return; }
    if (isSigningIn) return;
    setIsBusy(true);
    setError(null);
    try {
      const next = await terminal.request('account.login', { login: Number(login), password, label, server: server.server, webEndpoint: server.webEndpoint, isPasswordSaved, isUniqueClientIdRequested, ...(otp ? { otp } : {}) });
      session.set({ account: next });
      await refreshSession();
      closeDialog();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setOtp('');
      setPassword('');
      setIsBusy(false);
    }
  };

  return (
    <Dialog title="Login to Trade Account" width={460}>
      <div className="order-form">
        <label className="field">
          <span>Platform</span>
          <select value={platform} disabled={isBusy || !!profile} onChange={(event) => setPlatform(event.target.value as Platform)}>
            {platforms.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select>
        </label>
      {platform === 'bybit' ? <BybitLoginForm profile={profile} /> : <form
        className="order-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <BrokerServerField initialServer={profile?.server ?? ''} initialEndpoint={profile?.webEndpoint ?? ''} isDisabled={isBusy} onResolved={setServer} />
        <label className="field">
          <span>Login</span>
          <input inputMode="numeric" disabled={isBusy} value={login} onChange={(event) => setLogin(event.target.value.replace(/\D/g, ''))} required />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" disabled={isBusy} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        </label>
        <label className="field">
          <span>One-time code</span>
          <input disabled={isBusy} value={otp} onChange={(event) => setOtp(event.target.value)} autoComplete="one-time-code" placeholder="Only if your account requires it" />
        </label>
        <label className="field"><span>Label</span><input value={label} disabled={isBusy} onChange={(event) => setLabel(event.target.value)} placeholder="Optional, e.g. Personal demo" maxLength={128} /></label>
        <label className="check"><input type="checkbox" checked={isPasswordSaved} disabled={isBusy || !canSavePassword} onChange={(event) => setIsPasswordSaved(event.target.checked)} />Save password securely on this computer</label>
        {!canSavePassword && <p className="is-muted">Secure OS password storage is unavailable. Passwords stay in memory until you quit.</p>}
        <label className="check">
          <input type="checkbox" checked={isClientIdUnique || isUniqueClientIdRequested} disabled={isBusy || isClientIdUnique} onChange={(event) => setIsUniqueClientIdRequested(event.target.checked)} />
          Generate unique CID
          <InfoTip
            title="Recommended for prop firm accounts"
            description={isClientIdUnique
              ? 'This computer already sends a client ID (CID) that nobody else has. All your accounts share it, which is what prop firms expect from one trader.'
              : 'Brokers identify your computer by a client ID (CID) sent at login. The standard web terminal picks it from about a million values, so strangers with the same screen, scaling and language can share one, and prop firms have closed accounts over shared CIDs. Tick this to give this computer a CID nobody else has, once. All your accounts keep sharing it.'}
          />
        </label>
        {isSigningIn && !isBusy && <p className="is-muted"><SigningIn signIn={signIn} /> Log in here once it finishes.</p>}
        {failure && <p role="alert" className="is-loss">The last sign-in to {signInName(failure)} failed: {failure.error ?? 'unknown error'}</p>}
        {error && <p role="alert" className="is-loss">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={closeDialog}>Cancel</button>
          <button className="is-primary" type="submit" disabled={isBusy || isSigningIn || !server}>
            {isOwnSignIn ? 'Signing in…' : 'Login'}
          </button>
        </div>
      </form>}
      </div>
    </Dialog>
  );
}

export function AboutDialog() {
  const signIn = useStore(session, signingIn);
  const status = useStore(session, (state) => state.status);
  return (
    <Dialog title="About OpenTerm5" width={380}>
      <p>
        <b>OpenTerm5</b> is a cross-platform trading terminal modelled on the MetaTrader 5 desktop workflow.
      </p>
      <p className="is-muted">
        {signIn ? `Signing in to ${signInName(signIn)}…` : status?.isConnected ? `Connected to ${status.company ?? 'trade server'}, server build ${status.build}.` : 'Not connected.'}{' '}
        MetaTrader is a trademark of MetaQuotes Ltd. OpenTerm5 is not affiliated with MetaQuotes.
      </p>
      <div className="dialog-actions">
        <button className="is-primary" onClick={closeDialog}>OK</button>
      </div>
    </Dialog>
  );
}
