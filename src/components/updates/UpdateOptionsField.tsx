import { useState } from 'react';
import { updatePhases } from '../../../shared/updates';
import { updates, updateStore } from '../../lib/updates';
import { useStore } from '../../lib/store';

// Saved on its own like the journaling platform: applying connection settings reconnects MT5.
export function UpdateOptionsField() {
  const state = useStore(updateStore, (current) => current.state);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const phase = updatePhases.find((item) => item.key === state?.phase);

  const toggle = async (isAutomatic: boolean) => {
    setIsSaving(true);
    setError(null);
    try { updateStore.set({ state: await updates.request('updates.setAutomatic', { isAutomatic }) }); }
    catch (reason) { setError((reason as Error).message); }
    finally { setIsSaving(false); }
  };

  return (
    <section className="journal-options" aria-label="Updates">
      <label className="check">
        <input type="checkbox" checked={state?.isAutomatic ?? true} disabled={!state || isSaving} onChange={(event) => void toggle(event.target.checked)} />
        Check for and download updates automatically
      </label>
      <p className="is-muted">
        {state?.canInstall === false
          ? 'On macOS OpenTerm5 tells you when a new version is out and links to its release page.'
          : 'Updates download in the background and install when you choose Restart to update or quit. OpenTerm5 never restarts by itself.'}
        {phase ? ` Status: ${phase.label}${state?.version ? ` (${state.version})` : ''}.` : ''}
      </p>
      {error && <p role="alert" className="is-loss">{error}</p>}
    </section>
  );
}
