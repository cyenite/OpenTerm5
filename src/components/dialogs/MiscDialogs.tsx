import { useEffect, useMemo, useState } from 'react';
import type { ConnectionSettings, SymbolSpec } from '../../../shared/protocol';
import { indicatorKind, type IndicatorKey } from '../../lib/indicators';
import { log, refreshSession, session, setSymbolVisible, terminal } from '../../lib/session';
import { useStore } from '../../lib/store';
import { addIndicator, closeDialog, defaultParams, openDialog } from '../../lib/workspace';
import { Dialog } from './Dialog';

export function SymbolsDialog() {
  const symbols = useStore(session, (state) => state.symbols);
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const result = new Map<string, SymbolSpec[]>();
    for (const spec of Object.values(symbols)) {
      if (query && !`${spec.name} ${spec.description}`.toLowerCase().includes(query.toLowerCase())) {
        continue;
      }
      const group = spec.path.split('\\').slice(0, -1).join(' \\ ') || 'Symbols';
      result.set(group, [...(result.get(group) ?? []), spec]);
    }
    return [...result.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [symbols, query]);

  const toggle = (spec: SymbolSpec) => setSymbolVisible(spec.name, !spec.visible).catch((error: Error) => log(`cannot change ${spec.name}: ${error.message}`));

  return (
    <Dialog title="Symbols" width={560}>
      <input className="search" placeholder="Find symbol" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus />
      <div className="symbols-list">
        {groups.map(([group, specs]) => (
          <details key={group} open={query.length > 0 || groups.length < 4}>
            <summary>{group}</summary>
            {specs.map((spec) => (
              <label key={spec.name} className="symbol-option">
                <input type="checkbox" checked={spec.visible} onChange={() => toggle(spec)} />
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
          <span>Web endpoint</span>
          <input value={settings.webEndpoint} disabled={isSaving} onChange={(event) => patch({ webEndpoint: event.target.value })} placeholder="wss://web.metatrader.app/terminal" />
        </label>
        <p className="is-muted">Terminal5 connects directly to the MT5 web service. The endpoint selects the broker; the public MetaQuotes endpoint supports demo accounts. Apply, then use File → Login to Trade Account.</p>
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
      </div>
    </Dialog>
  );
}

export function LoginDialog({ profileId }: { profileId?: string }) {
  const profile = useStore(session, (state) => state.accounts.find((item) => item.id === profileId));
  const [otp, setOtp] = useState('');
  const [login, setLogin] = useState(profile ? String(profile.login) : '');
  const [label, setLabel] = useState(profile?.label ?? '');
  const [endpoint, setEndpoint] = useState(profile?.webEndpoint ?? '');
  const [canSavePassword, setCanSavePassword] = useState(false);
  const [isPasswordSaved, setIsPasswordSaved] = useState(profile?.isPasswordSaved ?? false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  useEffect(() => {
    let isCancelled = false;
    void terminal.settings().then((settings) => { if (!isCancelled) setEndpoint(profile?.webEndpoint ?? settings.webEndpoint); });
    void terminal.request('accounts.storage', {}).then((storage) => { if (!isCancelled) setCanSavePassword(storage.canSavePasswords); });
    return () => { isCancelled = true; };
  }, [profile?.webEndpoint]);
  const submit = async () => {
    setIsBusy(true);
    setError(null);
    try {
      const next = await terminal.request('account.login', { login: Number(login), password, label, webEndpoint: endpoint, isPasswordSaved, ...(otp ? { otp } : {}) });
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
    <Dialog title="Login to Trade Account" width={400}>
      <form
        className="order-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="field"><span>Account label</span><input value={label} disabled={isBusy} onChange={(event) => setLabel(event.target.value)} placeholder="For example, Personal demo" maxLength={128} /></label>
        <label className="field"><span>Web endpoint</span><input value={endpoint} disabled={isBusy} onChange={(event) => setEndpoint(event.target.value)} required /></label>
        <button type="button" disabled={isBusy} onClick={() => openDialog({ kind: 'servers' })}>Find broker / server</button>
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
        <p className="is-muted">The web endpoint in Tools → Options selects your broker. Your password is kept in memory for automatic reconnection and is never saved to disk. Accounts requiring a new one-time code must log in again after a disconnect.</p>
        <label className="check"><input type="checkbox" checked={isPasswordSaved} disabled={isBusy || !canSavePassword} onChange={(event) => setIsPasswordSaved(event.target.checked)} />Save password securely on this computer</label>
        {!canSavePassword && <p className="is-muted">Secure OS password storage is unavailable. Passwords stay in memory until you quit.</p>}
        {error && <p role="alert" className="is-loss">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={closeDialog}>Cancel</button>
          <button className="is-primary" type="submit" disabled={isBusy}>
            Login
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface IndicatorDialogProps {
  chartId: string;
  indicator: IndicatorKey;
}

const paramLabels: Record<string, string> = {
  period: 'Period',
  slowing: 'Slowing periods',
  tenkan: 'Tenkan-sen periods',
  kijun: 'Kijun-sen periods',
  senkou: 'Senkou Span B periods',
  acceleration: 'Acceleration step',
  maxAcceleration: 'Maximum acceleration',
  deviations: 'Deviations',
  fast: 'Fast EMA',
  slow: 'Slow EMA',
  signal: 'MACD SMA',
  isExponential: 'Exponential',
};

export function IndicatorDialog({ chartId, indicator }: IndicatorDialogProps) {
  const [params, setParams] = useState(defaultParams(indicator));
  const [error, setError] = useState<string | null>(null);
  const kind = indicatorKind(indicator);
  return (
    <Dialog title={kind.label} width={340}>
      <form
        className="order-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (Object.values(params).some((value) => typeof value === 'number' && (!Number.isFinite(value) || value <= 0))) { setError('Indicator parameters must be positive numbers.'); return; }
          if ('acceleration' in params && Number(params.acceleration) > Number(params.maxAcceleration)) { setError('Maximum acceleration must be at least the acceleration step.'); return; }
          addIndicator(chartId, indicator, params);
          closeDialog();
        }}
      >
        {Object.entries(params).map(([key, value]) =>
          typeof value === 'boolean' ? (
            <label key={key} className="check">
              <input type="checkbox" checked={value} onChange={(event) => setParams({ ...params, [key]: event.target.checked })} />
              {paramLabels[key] ?? key}
            </label>
          ) : (
            <label key={key} className="field">
              <span>{paramLabels[key] ?? key}</span>
              <input type="number" min={key === 'acceleration' || key === 'maxAcceleration' ? 0.001 : 1} step={key === 'acceleration' || key === 'maxAcceleration' ? 0.001 : key === 'deviations' ? 0.1 : 1} value={value} onChange={(event) => setParams({ ...params, [key]: Number(event.target.value) || 1 })} />
            </label>
          ),
        )}
        {error && <p role="alert" className="is-loss">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={closeDialog}>Cancel</button>
          <button className="is-primary" type="submit">OK</button>
        </div>
      </form>
    </Dialog>
  );
}

export function AboutDialog() {
  const status = useStore(session, (state) => state.status);
  return (
    <Dialog title="About Terminal5" width={380}>
      <p>
        <b>Terminal5</b> is a cross-platform trading terminal modelled on the MetaTrader 5 desktop workflow.
      </p>
      <p className="is-muted">
        Connected to: {status ? 'independent MT5 web client' : 'nothing'}.
        MetaTrader is a trademark of MetaQuotes Ltd. Terminal5 is not affiliated with MetaQuotes.
      </p>
      <p className="is-muted">Charts by TradingView Lightweight Charts™ (Apache-2.0), https://www.tradingview.com/</p>
      <div className="dialog-actions">
        <button className="is-primary" onClick={closeDialog}>OK</button>
      </div>
    </Dialog>
  );
}
