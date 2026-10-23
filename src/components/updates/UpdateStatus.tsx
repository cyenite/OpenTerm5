import { requestUpdate, updateStore } from '../../lib/updates';
import { useStore } from '../../lib/store';

export function UpdateStatus() {
  const state = useStore(updateStore, (current) => current.state);
  if (!state?.version) return null;
  if (state.phase === 'downloading') {
    return <span className="status-cell status-update" role="status">Downloading OpenTerm5 {state.version}: {Math.floor(state.percent)}%</span>;
  }
  if (state.phase === 'downloaded') {
    return (
      <button type="button" className="status-cell status-update is-ready" title={`Install OpenTerm5 ${state.version}. If you do not restart now, it installs when you quit.`} onClick={() => requestUpdate('updates.install', {})}>
        Restart to update
      </button>
    );
  }
  if (state.phase !== 'available') return null;
  return state.canInstall
    ? <button type="button" className="status-cell status-update is-ready" title={state.error ?? `Download OpenTerm5 ${state.version}`} onClick={() => requestUpdate('updates.download', {})}>Download OpenTerm5 {state.version}</button>
    : <button type="button" className="status-cell status-update is-ready" title="Open the release page" onClick={() => requestUpdate('updates.openRelease', {})}>OpenTerm5 {state.version} is available</button>;
}
