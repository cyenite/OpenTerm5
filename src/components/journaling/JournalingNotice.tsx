import { dismissNotices, journalingStore, reviewClosedTrade } from '../../lib/journaling';
import { formatPnl } from '../../lib/journaling-model';
import { useStore } from '../../lib/store';

// Shown when a sync reports trades that just closed, like the price alert notice: it never takes
// focus or blocks the terminal.
export function JournalingNotice() {
  const notices = useStore(journalingStore, (state) => state.notices);
  const [latest] = notices;
  if (!latest) return null;
  const more = notices.length - 1;
  return (
    <aside className="price-alert-notice journal-notice" role="status" aria-live="polite">
      <strong>Trade closed</strong>
      <button type="button" className="is-primary" onClick={() => reviewClosedTrade(latest)}>
        Review {latest.symbol} {formatPnl(latest.netPnl)}
      </button>
      {more > 0 && <span className="is-muted">{more} more to review on the Journaling page</span>}
      <button type="button" aria-label="Dismiss closed trade notice" onClick={dismissNotices}>×</button>
    </aside>
  );
}
