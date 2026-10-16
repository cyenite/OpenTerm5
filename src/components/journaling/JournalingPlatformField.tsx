import { useEffect, useState } from 'react';
import { defaultPlatformUrl, parsePlatformUrl } from '../../../shared/journaling';
import { journaling, journalingStore } from '../../lib/journaling';
import { useStore } from '../../lib/store';

// Saved through the journaling service, not with the connection settings: saving those reconnects
// MT5, and a platform change only concerns Journaling.
export function JournalingPlatformField() {
  const view = useStore(journalingStore, (state) => state.view);
  const saved = view?.platformUrl ?? defaultPlatformUrl;
  const [url, setUrl] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  useEffect(() => setUrl(saved), [saved]);

  const isChanged = url.trim() !== saved;
  const save = async () => {
    if (!isChanged || isSaving) return;
    setError(null);
    setMessage(null);
    let next: string;
    try { next = parsePlatformUrl(url); }
    catch (reason) { setError((reason as Error).message); return; }
    if (next === saved) { setUrl(saved); return; }
    const isLinked = view?.isConnected || view?.isReconnectNeeded;
    if (isLinked && !window.confirm(`Change the journaling platform to ${next}? Journaling disconnects from ${saved} and you connect again on the new platform.`)) return;
    setIsSaving(true);
    try {
      journalingStore.set({ view: await journaling.request('journaling.setPlatform', { url: next }) });
      setMessage(isLinked ? 'Saved. Journaling is disconnected; connect it on the Journaling page.' : 'Saved.');
    } catch (reason) { setError((reason as Error).message); }
    finally { setIsSaving(false); }
  };

  return (
    <section className="journal-options" aria-label="Journaling">
      <label className="field">
        <span>Journaling platform</span>
        <input value={url} spellCheck={false} placeholder={defaultPlatformUrl} onChange={(event) => setUrl(event.target.value)} />
      </label>
      <p className="is-muted">Where Journaling sends your trades. Change it only if you host Tradescribe yourself; plain http works for localhost.</p>
      {error && <p role="alert" className="is-loss">{error}</p>}
      {message && <p role="status" className="is-muted">{message}</p>}
      <div className="dialog-actions">
        {url !== defaultPlatformUrl && <button type="button" onClick={() => setUrl(defaultPlatformUrl)}>Use {defaultPlatformUrl}</button>}
        <button type="button" aria-disabled={!isChanged || isSaving} onClick={save}>Save platform</button>
      </div>
    </section>
  );
}
