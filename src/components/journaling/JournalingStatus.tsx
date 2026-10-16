import { useEffect, useState } from 'react';
import { journalingStore, showJournaling } from '../../lib/journaling';
import { journalStatus } from '../../lib/journaling-model';
import { useStore } from '../../lib/store';

export function JournalingStatus() {
  const view = useStore(journalingStore, (state) => state.view);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const status = journalStatus(view, now);
  if (!status) return null;
  return (
    <button type="button" className={`status-cell status-journal is-${status.tone}`} title="Open the Journaling page (Ctrl+5)" onClick={() => showJournaling()}>
      {status.text}
    </button>
  );
}
