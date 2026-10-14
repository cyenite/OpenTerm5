import { useEffect, useState } from 'react';
import type { NotificationTarget, SignalRecord, WebhookSettings, WebhookSource } from '../../../shared/automation';
import { notificationEvents, notificationKinds, signalActions } from '../../../shared/automation';
import { distanceUnits, riskModes } from '../../../shared/risk';
import { automation, automationStore, refreshAutomation } from '../../lib/automation';
import { formatTime } from '../../lib/format';
import { session } from '../../lib/session';
import { useStore } from '../../lib/store';
import { EmptyState, NumberField, Section, Segmented, SelectField, StatusPill, Switch, TextField } from '../ui/Controls';
import { UnlockRow } from '../ui/UnlockRow';

const sizingModes = [{ key: 'signal', label: 'From the signal (volume or risk)' }, ...riskModes] as const;

function copy(text: string): void {
  void navigator.clipboard.writeText(text);
}

interface CopyBlockProps {
  label: string;
  text: string;
}

function CopyBlock({ label, text }: CopyBlockProps) {
  const [isCopied, setIsCopied] = useState(false);
  return (
    <div className="copy-block">
      <div className="copy-block-header">
        <span>{label}</span>
        <button type="button" className="link-button" onClick={() => { copy(text); setIsCopied(true); setTimeout(() => setIsCopied(false), 1500); }}>{isCopied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}

interface SourceEditorProps {
  source: WebhookSource;
  baseUrl: string;
  onChange: (source: WebhookSource) => void;
  onRemove: () => void;
}

function SourceEditor({ source, baseUrl, onChange, onRemove }: SourceEditorProps) {
  const accounts = useStore(session, (state) => state.accounts);
  const [isRevealed, setIsRevealed] = useState(false);
  const [tab, setTab] = useState<'settings' | 'connect' | 'test'>('settings');
  const set = (patch: Partial<WebhookSource>) => onChange({ ...source, ...patch });
  const hookUrl = `${baseUrl}/v1/hooks/${source.id}`;
  const tradingView = JSON.stringify({ secret: isRevealed ? source.secret : '<your secret>', id: '{{timenow}}-{{ticker}}', action: '{{strategy.order.action}}', symbol: '{{ticker}}', risk: 1, sl_pips: 20, tp_r: [1, 2], comment: '{{strategy.order.id}}' }, null, 2);
  const curl = source.auth === 'token'
    ? `curl -X POST '${baseUrl}/v1/signals?wait=1' \\\n  -H 'Authorization: Bearer ${isRevealed ? source.secret : '<secret>'}' \\\n  -H 'Content-Type: application/json' \\\n  -d '{"id":"order-1","action":"buy","symbol":"EURUSD","risk":1,"sl_pips":20,"tp_r":2}'`
    : `BODY='{"id":"order-1","action":"buy","symbol":"EURUSD","risk":1,"sl_pips":20,"tp_r":2}'\nTS=$(date +%s)\nSIG=sha256=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac '${isRevealed ? source.secret : '<secret>'}' -hex | sed 's/^.* //')\ncurl -X POST '${baseUrl}/v1/signals?wait=1' -H "X-OpenTerm-Source: ${source.id}" -H "X-OpenTerm-Timestamp: $TS" -H "X-OpenTerm-Signature: $SIG" -H 'Content-Type: application/json' -d "$BODY"`;
  const [testBody, setTestBody] = useState('{"action":"buy","symbol":"EURUSD","risk":1,"sl_pips":20,"tp_r":[1,2]}');
  const [testResult, setTestResult] = useState<SignalRecord | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  return (
    <Section
      title={source.name || 'Signal source'}
      detail={`Signals execute on ${accounts.find((profile) => profile.id === source.accountId)?.label ?? 'no account yet'}${source.isDryRun ? ' as dry runs' : ''}.`}
      actions={<><Segmented label="Source view" value={tab} options={[{ key: 'settings', label: 'Settings' }, { key: 'connect', label: 'Connect' }, { key: 'test', label: 'Test' }]} onChange={setTab} /><button type="button" className="is-danger" onClick={onRemove}>Remove</button></>}
    >
      {tab === 'settings' && (
        <div className="form-grid">
          <TextField label="Name" value={source.name} placeholder="TradingView strategy" onChange={(name) => set({ name })} />
          <SelectField label="Executes on account" value={source.accountId} options={[{ key: '', label: 'Choose an account' }, ...accounts.map((profile) => ({ key: profile.id, label: `${profile.label} (${profile.tradeMode})` }))]} onChange={(accountId) => set({ accountId })} />
          <div className="form-field">
            <span>Authentication</span>
            <Segmented label="Authentication" value={source.auth} options={[{ key: 'token', label: 'Secret token' }, { key: 'hmac', label: 'HMAC signature' }]} onChange={(auth) => set({ auth })} />
            <small>{source.auth === 'token' ? 'Bearer header, or "secret" in the JSON body for TradingView.' : 'Each request is signed and must be under 5 minutes old; replays are refused.'}</small>
          </div>
          <div className="form-field is-span-2">
            <span>Secret</span>
            <span className="input-with-suffix">
              <input className="is-mono" readOnly value={isRevealed ? source.secret : '•'.repeat(24)} aria-label="Secret" />
              <button type="button" onClick={() => setIsRevealed(!isRevealed)}>{isRevealed ? 'Hide' : 'Show'}</button>
              <button type="button" onClick={() => copy(source.secret)}>Copy</button>
              <button type="button" onClick={() => { if (window.confirm('Generate a new secret? Senders using the old one will be rejected after you save.')) void automation.request('webhooks.secret', {}).then((secret) => set({ secret })); }}>New</button>
            </span>
          </div>
          <SelectField label="Position sizing" value={source.sizing.mode} options={sizingModes} hint={source.sizing.mode === 'signal' ? 'Uses volume, risk (%) or risk_money from each signal. Max lots still applies.' : 'Signal sizing fields are ignored; this source always sizes the same way.'} onChange={(mode) => set({ sizing: { ...source.sizing, mode } })} />
          {source.sizing.mode !== 'signal' && <NumberField label="Size" value={source.sizing.value} step={source.sizing.mode === 'lots' ? 0.01 : 0.1} suffix={riskModes.find((mode) => mode.key === source.sizing.mode)?.unit} onChange={(value) => set({ sizing: { ...source.sizing, value } })} />}
          <NumberField label="Max lots per signal" value={source.sizing.maxLots} step={0.1} hint="0 means only the symbol maximum." onChange={(maxLots) => set({ sizing: { ...source.sizing, maxLots } })} />
          <NumberField label="Rate limit" value={source.maxPerMinute} suffix="/ min" onChange={(maxPerMinute) => set({ maxPerMinute: Math.round(maxPerMinute) })} />
          <SelectField label="Default stop unit" value={source.defaultStop?.unit ?? 'pips'} options={distanceUnits.filter((unit) => unit.key !== 'price')} onChange={(unit) => set({ defaultStop: { unit, value: source.defaultStop?.value ?? 0 } })} />
          <NumberField label="Default stop" value={source.defaultStop?.value ?? 0} hint="Used when a signal has no stop. 0 is none." onChange={(value) => set({ defaultStop: value > 0 ? { unit: source.defaultStop?.unit ?? 'pips', value } : undefined })} />
          <TextField label="Symbol suffix" value={source.symbolSuffix} placeholder=".m" hint="Optional. Prefixed and suffixed broker names are found automatically; set this only to force one, e.g. EURUSD becomes EURUSD.m." onChange={(symbolSuffix) => set({ symbolSuffix })} />
          <TextField label="Allowed symbols" value={source.allowedSymbols.join(', ')} placeholder="All symbols" onChange={(value) => set({ allowedSymbols: value.split(',').map((item) => item.trim()).filter(Boolean) })} />
          <label className="form-field is-wide">
            <span>Symbol map</span>
            <textarea className="is-mono" rows={3} placeholder={'XAUUSD=GOLD\nUS30=DJ30'} value={Object.entries(source.symbolMap).map(([from, to]) => `${from}=${to}`).join('\n')} onChange={(event) => set({ symbolMap: Object.fromEntries(event.target.value.split('\n').map((line) => line.split('=').map((part) => part.trim())).filter((parts) => parts.length === 2 && parts[0] && parts[1])) })} />
          </label>
          <div className="form-field is-wide">
            <span>Allowed actions</span>
            <div className="chip-group">
              {signalActions.map((action) => {
                const isAllowed = !source.allowedActions.length || source.allowedActions.includes(action.key);
                return (
                  <button key={action.key} type="button" className={`chip${isAllowed ? ' is-on' : ''}`} aria-pressed={isAllowed} onClick={() => {
                    const current = source.allowedActions.length ? source.allowedActions : signalActions.map((item) => item.key);
                    const next = isAllowed ? current.filter((key) => key !== action.key) : [...current, action.key];
                    set({ allowedActions: next.length === signalActions.length ? [] : next });
                  }}>{action.label}</button>
                );
              })}
            </div>
          </div>
          <Switch label="Enabled" isOn={source.isEnabled} onChange={(isEnabled) => set({ isEnabled })} />
          <Switch label="Dry run" hint="Validate, size and log every signal without sending orders." isOn={source.isDryRun} onChange={(isDryRun) => set({ isDryRun })} />
          <Switch label="Require a stop loss" hint="Reject entries without sl, sl_points or sl_pips (unless a default stop is set)." isOn={source.isStopRequired} onChange={(isStopRequired) => set({ isStopRequired })} />
        </div>
      )}
      {tab === 'connect' && (
        <div className="stack">
          <p className="is-muted">Entries carry only the comment the signal sends, like trades placed by hand. OpenTerm5 remembers which tickets this source opened; close, modify and cancel only touch those, unless a signal sends "scope": "symbol".</p>
          <CopyBlock label="TradingView webhook URL" text={hookUrl} />
          <CopyBlock label="TradingView alert message" text={tradingView} />
          <CopyBlock label={source.auth === 'token' ? 'curl with a bearer token' : 'Signed request (bash)'} text={curl} />
          <CopyBlock label="Text form (for tools that cannot send JSON)" text={`buy EURUSD risk=1 sl_pips=20 tp_r=1,2${source.auth === 'token' ? ` secret=${isRevealed ? source.secret : '<secret>'}` : ''}`} />
          <details className="reference">
            <summary>Signal fields</summary>
            <table className="grid compact">
              <tbody>
                <tr><th>action</th><td>{signalActions.map((action) => action.key).join(', ')} (also long, short, exit, flat)</td></tr>
                <tr><th>symbol / ticker</th><td>Exchange prefixes like OANDA: are removed; then the symbol map and suffix apply.</td></tr>
                <tr><th>volume | risk | risk_money</th><td>Lots, percent of balance, or account-currency amount (only when sizing is "from the signal").</td></tr>
                <tr><th>sl | sl_points | sl_pips</th><td>Stop as a price or a distance from entry.</td></tr>
                <tr><th>tp | tp_points | tp_pips | tp_r</th><td>Up to 5 targets; each gets an equal share. tp_r is a multiple of the stop distance.</td></tr>
                <tr><th>price, expiration_minutes</th><td>For limit and stop orders.</td></tr>
                <tr><th>trailing_points, trailing_start_points, breakeven_r</th><td>Managed by OpenTerm5 while it is running.</td></tr>
                <tr><th>close_percent, ticket, scope</th><td>Partial closes, one ticket, or "symbol" to include trades not opened by this source.</td></tr>
                <tr><th>id</th><td>Idempotency key: a repeated id within 24 hours is answered without trading again.</td></tr>
              </tbody>
            </table>
          </details>
        </div>
      )}
      {tab === 'test' && (
        <div className="stack">
          <p className="is-muted">Runs the full pipeline (parsing, mapping, sizing, guards) as a dry run. Nothing is sent to the broker. Save the source first.</p>
          <textarea className="is-mono" rows={5} aria-label="Test signal" value={testBody} onChange={(event) => setTestBody(event.target.value)} />
          <div className="button-row">
            <button type="button" className="is-primary" onClick={() => { setTestError(null); automation.request('webhooks.test', { sourceId: source.id, body: testBody }).then(setTestResult).catch((error: Error) => setTestError(error.message)); }}>Run dry-run test</button>
          </div>
          {testError && <p className="banner is-bad">{testError}</p>}
          {testResult && <p className={`banner ${testResult.status === 'rejected' ? 'is-bad' : 'is-good'}`}><StatusPill status={testResult.status} /> {testResult.message}</p>}
        </div>
      )}
    </Section>
  );
}

interface NotificationsEditorProps {
  targets: NotificationTarget[];
}

function NotificationsEditor({ targets: initial }: NotificationsEditorProps) {
  const [targets, setTargets] = useState(initial);
  const [message, setMessage] = useState<{ text: string; isBad: boolean } | null>(null);
  useEffect(() => setTargets(initial), [initial]);
  const update = (id: string, patch: Partial<NotificationTarget>) => setTargets(targets.map((target) => target.id === id ? { ...target, ...patch } : target));
  return (
    <Section
      title="Notifications"
      detail="Send signal results, copier failures, guard trips and trade-manager actions to Discord, Slack, Telegram or any HTTPS endpoint."
      actions={(
        <>
          <button type="button" onClick={() => setTargets([...targets, { id: crypto.randomUUID(), kind: 'discord', url: '', name: 'Discord', chatId: '', events: ['signal', 'copier', 'guard'], isEnabled: true }])}>Add target</button>
          <button type="button" className="is-primary" onClick={() => automation.request('notifications.save', targets).then(() => setMessage({ text: 'Saved', isBad: false })).catch((error: Error) => setMessage({ text: error.message, isBad: true }))}>Save</button>
        </>
      )}
    >
      {message && <p className={`banner ${message.isBad ? 'is-bad' : 'is-good'}`}>{message.text}</p>}
      {!targets.length && <p className="is-muted">No notification targets.</p>}
      {targets.map((target) => (
        <div className="notification-row" key={target.id}>
          <div className="form-grid">
            <TextField label="Name" value={target.name} onChange={(name) => update(target.id, { name })} />
            <SelectField label="Kind" value={target.kind} options={notificationKinds} onChange={(kind) => update(target.id, { kind })} />
            <TextField label={target.kind === 'telegram' ? 'Bot token' : 'Webhook URL'} value={target.url} isSecret={target.kind === 'telegram'} isMonospace placeholder={target.kind === 'telegram' ? '123456:ABC…' : 'https://'} onChange={(url) => update(target.id, { url: url.trim() })} />
            {target.kind === 'telegram' && <TextField label="Chat id" value={target.chatId} placeholder="-1001234567890" onChange={(chatId) => update(target.id, { chatId: chatId.trim() })} />}
            <div className="form-field is-wide">
              <span>Events</span>
              <div className="chip-group">
                {notificationEvents.map((event) => (
                  <button key={event.key} type="button" className={`chip${target.events.includes(event.key) ? ' is-on' : ''}`} aria-pressed={target.events.includes(event.key)} onClick={() => update(target.id, { events: target.events.includes(event.key) ? target.events.filter((item) => item !== event.key) : [...target.events, event.key] })}>{event.label}</button>
                ))}
              </div>
            </div>
            <Switch label="Enabled" isOn={target.isEnabled} onChange={(isEnabled) => update(target.id, { isEnabled })} />
          </div>
          <div className="button-row">
            <button type="button" onClick={() => automation.request('notifications.test', target).then((isSent) => setMessage({ text: isSent ? `Test sent to ${target.name}` : `${target.name} did not accept the test`, isBad: !isSent })).catch((error: Error) => setMessage({ text: error.message, isBad: true }))}>Send test</button>
            <button type="button" className="link-button" onClick={() => setTargets(targets.filter((item) => item.id !== target.id))}>Remove</button>
          </div>
        </div>
      ))}
    </Section>
  );
}

export function SignalsPage() {
  const view = useStore(automationStore, (state) => state.webhooks);
  const accounts = useStore(session, (state) => state.accounts);
  const links = useStore(automationStore, (state) => state.copier.links);
  const [draft, setDraft] = useState<WebhookSettings | null>(view?.settings ?? null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'problems'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => { if (!draft && view) setDraft(structuredClone(view.settings)); }, [view, draft]);
  useEffect(() => { if (!view) void refreshAutomation(); }, [view]);

  if (!view || !draft) return <EmptyState title="Loading signal settings" detail="" />;
  const isDirty = JSON.stringify(view.settings) !== JSON.stringify(draft);
  const save = async (next = draft) => {
    setError(null);
    try {
      await automation.request('webhooks.save', next);
      await refreshAutomation();
      setDraft(structuredClone(next));
    } catch (reason) { setError((reason as Error).message); }
  };
  const addSource = async () => {
    const secret = await automation.request('webhooks.secret', {});
    setDraft({ ...draft, sources: [...draft.sources, {
      id: `src-${crypto.randomUUID().slice(0, 8)}`, name: 'New source', auth: 'token', secret, accountId: accounts.find((profile) => profile.isActive)?.id ?? accounts[0]?.id ?? '',
      sizing: { mode: 'percentBalance', value: 0.5, maxLots: 1 }, symbolMap: {}, symbolSuffix: '', allowedSymbols: [], allowedActions: [],
      maxPerMinute: 30, createdAt: Date.now(), isEnabled: true, isDryRun: true, isStopRequired: true,
    }] });
  };
  const sourceLinks = links.filter((link) => draft.sources.some((source) => source.isEnabled && source.accountId === link.accountId));
  const records = view.records.filter((record) => filter === 'all' || ['rejected', 'failed'].includes(record.status));
  const isExposed = draft.host !== '127.0.0.1' && draft.host !== '::1' && draft.host !== 'localhost';

  return (
    <div className="page-scroll single">
      <Section
        title="Signal API"
        detail="Receive trade signals over HTTP from TradingView alerts, bots, scripts or other platforms. Signals execute while OpenTerm5 is running."
        actions={(
          <>
            <button type="button" className={draft.isPaused ? 'is-primary' : 'is-danger'} onClick={() => void save({ ...draft, isPaused: !draft.isPaused })}>{draft.isPaused ? 'Resume intake' : 'Pause all signals'}</button>
            <button type="button" className="is-primary" disabled={!isDirty} onClick={() => void save()}>{isDirty ? 'Save changes' : 'Saved'}</button>
          </>
        )}
      >
        {error && <p className="banner is-bad">{error}</p>}
        <div className="status-strip">
          <StatusPill status={view.status.isRunning ? (draft.isPaused ? 'paused' : 'running') : view.status.error ? 'failed' : 'disabled'} label={view.status.isRunning ? (draft.isPaused ? 'Paused' : 'Listening') : view.status.error ?? 'Off'} />
          {view.status.isRunning && <><code>{view.status.url}</code><button type="button" className="link-button" onClick={() => copy(view.status.url)}>Copy</button></>}
        </div>
        <div className="form-grid">
          <Switch label="Run the signal server" isOn={draft.isEnabled} onChange={(isEnabled) => setDraft({ ...draft, isEnabled })} />
          <SelectField label="Listen on" value={draft.host} options={[{ key: '127.0.0.1', label: 'This computer only (127.0.0.1)' }, { key: '0.0.0.0', label: 'All network interfaces (0.0.0.0)' }]} onChange={(host) => setDraft({ ...draft, host })} />
          <NumberField label="Port" value={draft.port} min={1024} max={65535} onChange={(port) => setDraft({ ...draft, port: Math.round(port) })} />
        </div>
        {sourceLinks.length > 0 && <ul className="session-list">{sourceLinks.map((link) => <UnlockRow key={link.accountId} accountId={link.accountId} state={link.state} error={link.error} />)}</ul>}
        {isExposed && <p className="banner is-warn">The server is reachable from your network over plain HTTP. For TradingView or other internet senders, keep 127.0.0.1 and publish it through an HTTPS tunnel (Cloudflare Tunnel, ngrok, Tailscale Funnel) or a TLS reverse proxy.</p>}
        {!view.canEncrypt && <p className="banner is-warn">This system has no secure keychain, so secrets are stored in a private file (mode 600) rather than encrypted.</p>}
      </Section>
      <div className="section-header-row">
        <h2>Sources</h2>
        <button type="button" onClick={() => void addSource()}>Add source</button>
      </div>
      {!draft.sources.length && <EmptyState title="No signal sources" detail="A source is one sender (a TradingView strategy, a bot) with its own secret, account, sizing rules and limits. New sources start in dry-run mode." />}
      {draft.sources.map((source) => (
        <SourceEditor key={source.id} source={source} baseUrl={view.status.url} onChange={(next) => setDraft({ ...draft, sources: draft.sources.map((item) => item.id === next.id ? next : item) })} onRemove={() => setDraft({ ...draft, sources: draft.sources.filter((item) => item.id !== source.id) })} />
      ))}
      <Section title="Signal log" actions={<Segmented label="Log filter" value={filter} options={[{ key: 'all', label: 'All' }, { key: 'problems', label: 'Problems' }]} onChange={setFilter} />}>
        {records.length ? (
          <table className="grid compact selectable">
            <thead><tr><th>Time</th><th>Source</th><th>Action</th><th>Symbol</th><th>Status</th><th>Result</th><th className="num">Latency</th></tr></thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} onClick={() => setExpanded(expanded === record.id ? null : record.id)} className={expanded === record.id ? 'is-selected' : ''}>
                  <td>{formatTime(record.time)}</td>
                  <td>{draft.sources.find((item) => item.id === record.sourceId)?.name ?? record.sourceId}</td>
                  <td>{record.action}</td>
                  <td>{record.symbol}</td>
                  <td><StatusPill status={record.status} /></td>
                  <td>{record.message}{expanded === record.id && <pre className="payload">{JSON.stringify({ payload: record.payload, results: record.results, from: record.remote }, null, 2)}</pre>}</td>
                  <td className="num">{record.latencyMs !== undefined ? `${record.latencyMs} ms` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="is-muted">No signals received yet.</p>}
      </Section>
      <NotificationsEditor targets={view.notifications} />
    </div>
  );
}
