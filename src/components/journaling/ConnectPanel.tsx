import { useState } from 'react';
import { connectFlows, normalizeCode, type JournalingView } from '../../../shared/journaling';
import { journaling, journalingStore } from '../../lib/journaling';
import { openDialog } from '../../lib/workspace';
import { Section } from '../ui/Controls';

interface CodeFieldProps {
  isBusy: boolean;
}

// A code from Tradescribe's connect page, typed by the user, so it is exchanged without a prompt.
export function CodeField({ isBusy }: CodeFieldProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isValid = !!normalizeCode(code);
  const redeem = async () => {
    if (!isValid || isBusy) return;
    setError(null);
    try {
      journalingStore.set({ view: await journaling.request('journaling.redeem', { code }) });
      setCode('');
    } catch (reason) { setError((reason as Error).message); }
  };
  return (
    <form className="journal-code" onSubmit={(event) => { event.preventDefault(); void redeem(); }}>
      <label className="form-field">
        <span>Have a code?</span>
        <span className="inline-form">
          <input className="is-mono" value={code} placeholder="ABCD-EFGH" maxLength={12} autoComplete="off" spellCheck={false} aria-describedby="journal-code-hint" onChange={(event) => setCode(event.target.value)} />
          <button type="submit" aria-disabled={!isValid || isBusy}>Connect with code</button>
        </span>
        <small id="journal-code-hint">Tradescribe shows one when you connect OpenTerm5 from its Accounts or Import page.</small>
      </label>
      {error && <p role="alert" className="banner is-bad">{error}</p>}
    </form>
  );
}

interface BrowserConnectProps {
  view: JournalingView;
  label: string;
}

export function BrowserConnect({ view, label }: BrowserConnectProps) {
  const [error, setError] = useState<string | null>(null);
  const isWaiting = view.flow !== 'idle';
  const connect = async () => {
    if (isWaiting) return;
    setError(null);
    try { journalingStore.set({ view: await journaling.request('journaling.connect', {}) }); }
    catch (reason) { setError((reason as Error).message); }
  };
  const cancel = () => void journaling.request('journaling.cancelConnect', {}).catch(() => undefined);
  return (
    <div className="stack">
      <div className="button-row">
        <button type="button" className="is-primary" aria-disabled={isWaiting} onClick={connect}>{label}</button>
        {view.flow === 'browser' && <button type="button" onClick={cancel}>Cancel</button>}
        {isWaiting && <span className="is-muted" role="status"><span className="spinner" aria-hidden /> {connectFlows.find((flow) => flow.key === view.flow)?.label}</span>}
      </div>
      {error && <p role="alert" className="banner is-bad">{error}</p>}
    </div>
  );
}

interface ConnectPanelProps {
  view: JournalingView;
}

export function ConnectPanel({ view }: ConnectPanelProps) {
  return (
    <Section title="Journal every MT5 trade automatically" detail="Connect Tradescribe and OpenTerm5 sends the deals of the account you are logged in to straight to your trading journal.">
      <ul className="journal-points">
        <li><b>Automatic.</b> Trades arrive as they close, and earlier ones from the last 90 days on first sync.</li>
        <li><b>Verified.</b> They come from MT5's own deal records, so Tradescribe marks them as verified.</li>
        <li><b>Reviewed here.</b> Rate, tag and note today's trades without leaving the terminal.</li>
        <li><b>Free</b> for up to 20 trades a month.</li>
      </ul>
      <BrowserConnect view={view} label="Connect Tradescribe" />
      <CodeField isBusy={view.flow !== 'idle'} />
      <p className="is-muted">
        Journals to {view.platformUrl}.{' '}
        <button type="button" className="link-button" onClick={() => openDialog({ kind: 'connection' })}>Change in Options</button>
      </p>
    </Section>
  );
}
