import { useEffect, useState } from 'react';
import type { JournalDay, JournalToday, JournalTrade, Playbook } from '../../../shared/journaling';
import { journaling, journalingStore, openInJournal } from '../../lib/journaling';
import { formatPnl } from '../../lib/journaling-model';
import { useStore } from '../../lib/store';
import { Section } from '../ui/Controls';
import { TradeReviewForm } from './TradeReviewForm';
import { VerifiedBadge } from './VerifiedBadge';

const clock = (iso: string | null) => iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '';

interface TradeRowProps {
  trade: JournalTrade;
  isSelected: boolean;
  onSelect: () => void;
}

function TradeRow({ trade, isSelected, onSelect }: TradeRowProps) {
  return (
    <tr className={isSelected ? 'is-selected' : ''} onClick={onSelect}>
      <td>{clock(trade.openedAt)}{trade.closedAt ? `-${clock(trade.closedAt)}` : ''}</td>
      <td><b>{trade.symbol}</b> <VerifiedBadge source={trade.verifiedBy} /></td>
      <td className={`side-${trade.direction === 'long' ? 'buy' : 'sell'}`}>{trade.direction}</td>
      <td className="num">{trade.quantity}</td>
      <td className={`num ${trade.netPnl !== null && trade.netPnl < 0 ? 'is-loss' : 'is-profit'}`}>{trade.status === 'open' ? 'open' : formatPnl(trade.netPnl)}</td>
      <td>{trade.reviewed ? `Reviewed${trade.rating ? `, ${trade.rating}/5` : ''}` : <span className="is-muted">Not reviewed</span>}</td>
      <td className="num"><button type="button" className="link-button" aria-pressed={isSelected} onClick={(event) => { event.stopPropagation(); onSelect(); }}>Review</button></td>
    </tr>
  );
}

interface DayNoteProps {
  day: JournalDay;
  onSaved: (day: JournalDay) => void;
}

function DayNote({ day, onSaved }: DayNoteProps) {
  const [note, setNote] = useState(day.note);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => setNote(day.note), [day.note, day.date]);
  const isDirty = note !== day.note;
  const save = async () => {
    if (!isDirty || isSaving) return;
    setIsSaving(true);
    setError(null);
    try { onSaved(await journaling.request('journaling.saveNote', { date: day.date, note, etag: day.etag })); }
    catch (reason) { setError((reason as Error).message); }
    finally { setIsSaving(false); }
  };
  return (
    <Section
      title="Day note"
      detail={day.updatedAt ? `Saved ${new Date(day.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}` : 'Plans, rules and how the session went.'}
      actions={<>
        <button type="button" className="link-button" onClick={() => openInJournal({ kind: 'day', date: day.date })}>Open day in Tradescribe</button>
        <button type="button" className="is-primary" aria-disabled={!isDirty || isSaving} onClick={save}>{isSaving ? 'Saving…' : 'Save note'}</button>
      </>}
    >
      <textarea className="journal-note" aria-label={`Note for ${day.date}`} rows={6} value={note} placeholder="Markdown works. For example: ## Plan" onChange={(event) => setNote(event.target.value)} />
      {error && <p role="alert" className="banner is-bad">{error}</p>}
    </Section>
  );
}

interface TodayJournalProps {
  // Changes whenever a sync finishes, so the list follows new trades.
  revision: number | null;
}

export function TodayJournal({ revision }: TodayJournalProps) {
  const focusKey = useStore(journalingStore, (state) => state.focusKey);
  const [today, setToday] = useState<JournalToday | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [playbooks, setPlaybooks] = useState<readonly Playbook[]>([]);

  useEffect(() => {
    let isCurrent = true;
    journaling.request('journaling.today', {})
      .then((result) => { if (isCurrent) { setToday(result); setError(null); } })
      .catch((reason: Error) => { if (isCurrent) setError(reason.message); });
    return () => { isCurrent = false; };
  }, [revision]);

  useEffect(() => {
    journaling.request('journaling.playbooks', {}).then(setPlaybooks).catch(() => setPlaybooks([]));
  }, []);

  useEffect(() => {
    if (!focusKey) return;
    setSelected(focusKey);
    journalingStore.set({ focusKey: null });
  }, [focusKey]);

  const replaceTrade = (trade: JournalTrade) => setToday((current) => current && { ...current, trades: current.trades.map((item) => item.key === trade.key ? trade : item) });
  const trades = today?.trades ?? [];

  return (
    <>
      <Section title={today ? `Today, ${today.date}` : 'Today'} detail={today ? `Trades opened today in your journal's time zone (${today.timeZone}).` : undefined}>
        {error && <p role="alert" className="banner is-bad">{error}</p>}
        {!today && !error && <p className="is-muted">Loading today's trades…</p>}
        {today && (trades.length ? (
          <table className="grid compact selectable journal-trades">
            <thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th className="num">Lots</th><th className="num">Net P/L</th><th>Review</th><th /></tr></thead>
            <tbody>
              {trades.map((trade) => <TradeRow key={trade.key} trade={trade} isSelected={selected === trade.key} onSelect={() => setSelected(trade.key)} />)}
            </tbody>
          </table>
        ) : <p className="is-muted">No trades today yet. Closed MT5 trades appear here a few seconds after they close.</p>)}
        {selected && <TradeReviewForm key={selected} tradeKey={selected} playbooks={playbooks} onSaved={replaceTrade} onClose={() => setSelected(null)} />}
      </Section>
      {today && <DayNote day={today.day} onSaved={(day) => setToday((current) => current && { ...current, day })} />}
    </>
  );
}
