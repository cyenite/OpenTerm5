import { automationStore } from '../lib/automation';
import { connectProfile } from '../lib/accounts';
import { openContextMenu } from '../lib/context-menu';
import { session } from '../lib/session';
import { useStore } from '../lib/store';
import { openDialog, pages, workspace, type Page } from '../lib/workspace';

function useBadges(): Partial<Record<Page, number>> {
  const copier = useStore(automationStore, (state) => {
    const accounts = new Set(state.copier.configs.filter((config) => config.status !== 'disabled').flatMap((config) => [config.masterId, ...config.followers.map((follower) => follower.accountId)]));
    return state.copier.links.filter((link) => link.state === 'failed' && accounts.has(link.accountId)).length + state.copier.protections.filter((item) => item.trippedAt).length;
  });
  const signals = useStore(automationStore, (state) => {
    const webhooks = state.webhooks;
    if (!webhooks?.settings.isEnabled) return 0;
    const accounts = new Set(webhooks.settings.sources.filter((source) => source.isEnabled).map((source) => source.accountId));
    return (webhooks.status.error ? 1 : 0) + state.copier.links.filter((link) => link.state === 'failed' && accounts.has(link.accountId)).length;
  });
  const automation = useStore(automationStore, (state) => state.manager.guardStates.filter((item) => item.trippedAt).length);
  return { copier, signals, automation };
}

export function TopTabs() {
  const page = useStore(workspace, (state) => state.page);
  const account = useStore(session, (state) => state.account);
  const profiles = useStore(session, (state) => state.accounts);
  const profileId = useStore(session, (state) => state.profileId);
  const profile = profiles.find((item) => item.id === profileId);
  const switcher = (event: React.MouseEvent) => openContextMenu(event, [
    ...profiles.map((item) => ({ label: `${item.label || item.login} · ${item.server}`, isChecked: item.id === profileId, action: () => { if (item.id !== profileId) void connectProfile(item); } })),
    { label: '', isSeparator: true },
    { label: 'Login to Trade Account...', action: () => openDialog({ kind: 'login' }) },
    { label: 'Manage Accounts...', action: () => openDialog({ kind: 'accounts' }) },
  ]);
  const signalsRunning = useStore(automationStore, (state) => !!state.webhooks?.status.isRunning && !state.webhooks.settings.isPaused);
  const activeCopiers = useStore(automationStore, (state) => state.copier.configs.filter((config) => config.status === 'enabled').length);
  const badges = useBadges();
  return (
    <nav className="top-tabs" aria-label="Workspaces">
      <div className="segmented is-large" role="tablist">
        {pages.map((item) => (
          <button key={item.key} role="tab" aria-selected={page === item.key} className={page === item.key ? 'is-active' : ''} title={`${item.label} (${item.shortcut})`} onClick={() => workspace.set({ page: item.key })}>
            {item.label}
            {!!badges[item.key] && <span className="tab-badge" aria-label={`${badges[item.key]} problems`}>{badges[item.key]}</span>}
          </button>
        ))}
      </div>
      <div className="top-status">
        {activeCopiers > 0 && <span className="status-dot is-good" title="Copiers running">{activeCopiers} copier{activeCopiers === 1 ? '' : 's'}</span>}
        {signalsRunning && <span className="status-dot is-good" title="Signal API listening">Signals on</span>}
        {account
          ? (
            <button type="button" className="account-chip" title={`${account.login} · ${account.server} · ${account.company}`} onClick={switcher} onContextMenu={switcher}>
              <span className="account-chip-name">{profile?.label || account.login}</span>
              <b className={`account-chip-mode is-${account.tradeMode}`}>{account.tradeMode}</b>
              <span aria-hidden="true">▾</span>
            </button>
          )
          : <button type="button" className="account-chip" onClick={() => openDialog({ kind: 'login' })}>Log in</button>}
      </div>
    </nav>
  );
}
