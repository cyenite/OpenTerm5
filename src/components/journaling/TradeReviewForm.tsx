import { useEffect, useRef, useState } from 'react';
import type { JournalTradeDetail, Playbook } from '../../../shared/journaling';
import { journaling, openInJournal } from '../../lib/journaling';
import { formatPnl, splitList } from '../../lib/journaling-model';
import { VerifiedBadge } from './VerifiedBadge';

const ratings = [1, 2, 3, 4, 5] as const;

interface RatingFieldProps {
  value: number | null;
  onChange: (value: number | null) => void;
}

function RatingField({ value, onChange }: RatingFieldProps) {
  return (
    <div className="form-field">
      <span id="journal-rating-label">Rating</span>
      <div className="segmented journal-rating" role="radiogroup" aria-labelledby="journal-rating-label">
        {ratings.map((rating) => (
          <button key={rating} type="button" role="radio" aria-checked={value === rating} aria-label={`${rating} of 5`} className={value === rating ? 'is-active' : ''} onClick={() => onChange(value === rating ? null : rating)}>{rating}</button>
        ))}
      </div>
      <small>Choose the selected rating again to clear it.</small>
    </div>
  );
}

interface Draft {
  tags: string;
  notes: string;
  mistakes: string;
  playbookId: string;
  rating: number | null;
  isReviewed: boolean;
}

const draftOf = (trade: JournalTradeDetail): Draft => ({
  tags: trade.tags.join(', '),
  notes: trade.notes,
  mistakes: trade.mistakes.join(', '),
  playbookId: trade.playbookId ?? '',
  rating: trade.rating,
  isReviewed: true,
});

interface TradeReviewFormProps {
  tradeKey: string;
  playbooks: readonly Playbook[];
  onSaved: (trade: JournalTradeDetail) => void;
  onClose: () => void;
}

export function TradeReviewForm({ tradeKey, playbooks, onSaved, onClose }: TradeReviewFormProps) {
  const [trade, setTrade] = useState<JournalTradeDetail | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const isLoaded = !!trade;

  useEffect(() => {
    if (isLoaded) formRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isLoaded]);

  useEffect(() => {
    let isCurrent = true;
    setTrade(null);
    setDraft(null);
    setError(null);
    setMessage(null);
    journaling.request('journaling.trade', { key: tradeKey })
      .then((detail) => { if (isCurrent) { setTrade(detail); setDraft(draftOf(detail)); } })
      .catch((reason: Error) => { if (isCurrent) setError(reason.message); });
    return () => { isCurrent = false; };
  }, [tradeKey]);

  if (!trade || !draft) return <div className="journal-review" aria-busy={!error}>{error ? <p role="alert" className="banner is-bad">{error}</p> : <p className="is-muted">Loading the trade…</p>}</div>;
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const save = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await journaling.request('journaling.review', {
        key: trade.key,
        etag: trade.etag,
        review: { rating: draft.rating, tags: splitList(draft.tags), mistakes: splitList(draft.mistakes), playbookId: draft.playbookId || null, notes: draft.notes, reviewed: draft.isReviewed },
      });
      setTrade(saved);
      setMessage('Review saved');
      onSaved(saved);
    } catch (reason) { setError((reason as Error).message); }
    finally { setIsSaving(false); }
  };

  return (
    <form ref={formRef} className="journal-review" aria-label={`Review ${trade.symbol}`} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header className="journal-review-header">
        <div>
          <h4>{trade.symbol} <span className={`side-${trade.direction === 'long' ? 'buy' : 'sell'}`}>{trade.direction}</span> <b className={trade.netPnl !== null && trade.netPnl < 0 ? 'is-loss' : 'is-profit'}>{formatPnl(trade.netPnl)}</b></h4>
          <VerifiedBadge source={trade.verifiedBy} />
        </div>
        <div className="button-row">
          {trade.url && <button type="button" className="link-button" onClick={() => openInJournal({ kind: 'trade', url: trade.url! })}>Open in Tradescribe</button>}
          <button type="button" className="link-button" aria-label="Close review" onClick={onClose}>Close</button>
        </div>
      </header>
      <div className="form-grid">
        <RatingField value={draft.rating} onChange={(rating) => set({ rating })} />
        <label className="form-field">
          <span>Playbook</span>
          <select value={draft.playbookId} onChange={(event) => set({ playbookId: event.target.value })}>
            <option value="">None</option>
            {playbooks.map((playbook) => <option key={playbook.id} value={playbook.id}>{playbook.name}</option>)}
            {draft.playbookId && !playbooks.some((playbook) => playbook.id === draft.playbookId) && <option value={draft.playbookId}>{draft.playbookId}</option>}
          </select>
        </label>
        <label className="form-field">
          <span>Tags</span>
          <input value={draft.tags} placeholder="breakout, a-plus" onChange={(event) => set({ tags: event.target.value })} />
          <small>Separate with commas.</small>
        </label>
        <label className="form-field">
          <span>Mistakes</span>
          <input value={draft.mistakes} placeholder="exited early" onChange={(event) => set({ mistakes: event.target.value })} />
          <small>Separate with commas.</small>
        </label>
        <label className="form-field is-wide">
          <span>Notes</span>
          <textarea rows={4} value={draft.notes} placeholder="What you saw, why you took it, what you would repeat." onChange={(event) => set({ notes: event.target.value })} />
        </label>
      </div>
      {error && <p role="alert" className="banner is-bad">{error}</p>}
      <div className="button-row">
        <label className="inline-form"><input type="checkbox" checked={draft.isReviewed} onChange={(event) => set({ isReviewed: event.target.checked })} /> Mark as reviewed</label>
        <span className="journal-spacer" />
        {message && <span className="is-muted" role="status">{message}</span>}
        <button type="submit" className="is-primary" aria-disabled={isSaving}>{isSaving ? 'Saving…' : 'Save review'}</button>
      </div>
    </form>
  );
}
