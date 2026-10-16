import { useState } from 'react';
import type { JournalingView, PendingLink } from '../../../shared/journaling';
import { journaling, journalingStore } from '../../lib/journaling';

interface LinkPromptProps {
  link: PendingLink;
  view: JournalingView;
}

// A link can come from anyone, and connecting with someone else's code would send this account's
// trades to their journal, so the account it connects to is shown and confirmed first.
export function LinkPrompt({ link, view }: LinkPromptProps) {
  const [error, setError] = useState<string | null>(null);
  const isBusy = view.flow !== 'idle';
  const confirm = async () => {
    if (isBusy) return;
    setError(null);
    try { journalingStore.set({ view: await journaling.request('journaling.confirmLink', {}) }); }
    catch (reason) { setError((reason as Error).message); }
  };
  const dismiss = () => void journaling.request('journaling.dismissLink', {}).then((next) => journalingStore.set({ view: next })).catch(() => undefined);
  return (
    <section className="card journal-prompt" role="alertdialog" aria-labelledby="journal-prompt-title" aria-describedby="journal-prompt-detail">
      <div className="card-body">
        <h3 id="journal-prompt-title">Connect Journaling to Tradescribe as {link.email || 'this account'}?</h3>
        <p id="journal-prompt-detail" className="is-muted">
          {link.name ? `${link.name}'s journal` : 'The journal'} on {link.platform}. Continue only if you just chose to connect OpenTerm5 in Tradescribe. With someone else's code, your trades would go to their journal.
          {view.isConnected && view.user ? ` This replaces the connection to ${view.user.email}.` : ''}
        </p>
        {error && <p role="alert" className="banner is-bad">{error}</p>}
        <div className="button-row">
          <button type="button" className="is-primary" aria-disabled={isBusy} onClick={confirm} autoFocus>Connect</button>
          <button type="button" onClick={dismiss}>Cancel</button>
        </div>
      </div>
    </section>
  );
}
