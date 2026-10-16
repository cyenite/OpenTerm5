import { useEffect, useMemo, useState } from 'react';
import type { ConnectionSettings, ResolvedServer, SymbolSpec } from '../../../shared/protocol';
import { refreshSession, session, terminal } from '../../lib/session';
import { searchSymbols } from '../../lib/symbol-search';
import { rowsOf, toggleWatched, useActiveWatchlist, watchedSpecs } from '../../lib/watchlists';
import { useStore } from '../../lib/store';
import { closeDialog } from '../../lib/workspace';
import { Dialog } from './Dialog';
import { BrokerServerField } from './BrokerServerField';
import { JournalingPlatformField } from '../journaling/JournalingPlatformField';

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
        <ClientIdField />
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

function ClientIdField() {
  const [cid, setCid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    void terminal.request('device.clientId', {}).then((result) => setCid(result.cid)).catch((reason: Error) => setError(reason.message));
  }, []);

  const regenerate = async () => {
    if (!window.confirm('Generate a new client ID? Brokers will see this computer as a new device from the next login.')) return;
    setIsGenerating(true);
    setError(null);
    try { setCid((await terminal.request('device.regenerateClientId', {})).cid); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'A new client ID could not be generated.'); }
    finally { setIsGenerating(false); }
  };

  return (
    <>
      <label className="field">
        <span>Client ID (CID)</span>
        <input value={cid ?? ''} readOnly placeholder="Loading…" className="is-mono" />
      </label>
      <p className="is-muted">Sent to the broker at every login so it can recognise this computer. A new ID applies from the next login.</p>
      {error && <p role="alert" className="is-loss">{error}</p>}
      <div className="dialog-actions">
        <button disabled={!cid || isGenerating} onClick={regenerate}>Generate new CID</button>
      </div>
    </>
  );
}

export function LoginDialog({ profileId }: { profileId?: string }) {
  const profile = useStore(session, (state) => state.accounts.find((item) => item.id === profileId));
  const [otp, setOtp] = useState('');
  const [login, setLogin] = useState(profile ? String(profile.login) : '');
  const [label, setLabel] = useState(profile?.label ?? '');
  const [server, setServer] = useState<ResolvedServer | null>(null);
  const [canSavePassword, setCanSavePassword] = useState(false);
  const [isPasswordSaved, setIsPasswordSaved] = useState(profile?.isPasswordSaved ?? false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  useEffect(() => {
    let isCancelled = false;
    void terminal.request('accounts.storage', {}).then((storage) => { if (!isCancelled) setCanSavePassword(storage.canSavePasswords); });
    return () => { isCancelled = true; };
  }, []);
  const submit = async () => {
    if (!server) { setError('Choose a server first.'); return; }
    setIsBusy(true);
    setError(null);
    try {
      const next = await terminal.request('account.login', { login: Number(login), password, label, webEndpoint: server.webEndpoint, isPasswordSaved, ...(otp ? { otp } : {}) });
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
      <form
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
        {error && <p role="alert" className="is-loss">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={closeDialog}>Cancel</button>
          <button className="is-primary" type="submit" disabled={isBusy || !server}>
            {isBusy ? 'Connecting…' : 'Login'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function AboutDialog() {
  const status = useStore(session, (state) => state.status);
  return (
    <Dialog title="About OpenTerm5" width={380}>
      <p>
        <b>OpenTerm5</b> is a cross-platform trading terminal modelled on the MetaTrader 5 desktop workflow.
      </p>
      <p className="is-muted">
        {status?.isConnected ? `Connected to ${status.company ?? 'trade server'}, server build ${status.build}.` : 'Not connected.'}{' '}
        MetaTrader is a trademark of MetaQuotes Ltd. OpenTerm5 is not affiliated with MetaQuotes.
      </p>
      <div className="dialog-actions">
        <button className="is-primary" onClick={closeDialog}>OK</button>
      </div>
    </Dialog>
  );
}
