import { automationStore } from '../lib/automation';
import { connectProfile } from '../lib/accounts';
import { openContextMenu } from '../lib/context-menu';
import { session } from '../lib/session';
import { useStore } from '../lib/store';
import { openDialog, pages, toggleAnalysisMode, workspace, type Page } from '../lib/workspace';
import { MenuBar } from './MenuBar';
import { hintProps } from './ui/Hint';
import { Icon } from './ui/Icon';

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

function WorkspaceTabs() {
  const page = useStore(workspace, (state) => state.page);
  const badges = useBadges();
  return (
    <div className="app-bar-tabs" role="tablist" aria-label="Workspaces">
      {pages.map((item) => (
        <button key={item.key} type="button" role="tab" aria-selected={page === item.key} className={page === item.key ? 'is-active' : ''} title={`${item.label} (${item.shortcut})`} onClick={() => workspace.set({ page: item.key })}>
          {item.label}
          {!!badges[item.key] && <span className="tab-badge" aria-label={`${badges[item.key]} problems`}>{badges[item.key]}</span>}
        </button>
      ))}
    </div>
  );
}

interface BackgroundActivityProps {
  isAnalysis: boolean;
}

// What keeps running out of sight: always the copiers and signals, and in analysis mode, where the
// toolbox is hidden, the open positions too.
function BackgroundActivity({ isAnalysis }: BackgroundActivityProps) {
  const activeCopiers = useStore(automationStore, (state) => state.copier.configs.filter((config) => config.status === 'enabled').length);
  const isSignalsRunning = useStore(automationStore, (state) => !!state.webhooks?.status.isRunning && !state.webhooks.settings.isPaused);
  const positionCount = useStore(session, (state) => state.positions.length);
  const parts = [
    activeCopiers > 0 && `${activeCopiers} copier${activeCopiers === 1 ? '' : 's'}`,
    isSignalsRunning && 'Signals on',
    isAnalysis && positionCount > 0 && `${positionCount} open position${positionCount === 1 ? '' : 's'}`,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <span className="status-dot is-good app-bar-activity" title="Running in the background">{parts.join(' · ')}</span>;
}

interface ModeSwitchProps {
  isAnalysis: boolean;
}

function ModeSwitch({ isAnalysis }: ModeSwitchProps) {
  const choose = (isWanted: boolean) => { if (isWanted !== isAnalysis) toggleAnalysisMode(); };
  return (
    <div className="mode-switch" role="radiogroup" aria-label="Mode">
      <button type="button" role="radio" aria-checked={!isAnalysis} aria-label="Trade" className={isAnalysis ? '' : 'is-active'} onClick={() => choose(false)} {...hintProps({ title: 'Trade', shortcut: 'Ctrl+Shift+A', description: 'The full terminal: order tickets, one-click trading, the toolbox and every workspace.' })}>
        <Icon name="trade" size={14} />
        <span className="mode-switch-label">Trade</span>
      </button>
      <button type="button" role="radio" aria-checked={isAnalysis} aria-label="Analysis" className={isAnalysis ? 'is-active' : ''} onClick={() => choose(true)} {...hintProps({ title: 'Analysis', shortcut: 'Ctrl+Shift+A', description: 'A chart-first layout without trading controls. Accounts, copiers and signals keep running.' })}>
        <Icon name="analysis" size={14} />
        <span className="mode-switch-label">Analysis</span>
      </button>
    </div>
  );
}

function AccountChip() {
  const account = useStore(session, (state) => state.account);
  const profiles = useStore(session, (state) => state.accounts);
  const profileId = useStore(session, (state) => state.profileId);
  const profile = profiles.find((item) => item.id === profileId);
  if (!account) return <button type="button" className="account-chip" onClick={() => openDialog({ kind: 'login' })}>Log in</button>;
  const switcher = (event: React.MouseEvent) => openContextMenu(event, [
    ...profiles.map((item) => ({ label: `${item.label || item.login} · ${item.server}`, isChecked: item.id === profileId, action: () => { if (item.id !== profileId) void connectProfile(item); } })),
    { label: '', isSeparator: true },
    { label: 'Login to Trade Account...', action: () => openDialog({ kind: 'login' }) },
    { label: 'Manage Accounts...', action: () => openDialog({ kind: 'accounts' }) },
  ]);
  return (
    <button type="button" className="account-chip" title={`${account.login} · ${account.server} · ${account.company}`} onClick={switcher} onContextMenu={switcher}>
      <span className="account-chip-name">{profile?.label || account.login}</span>
      <b className={`account-chip-mode is-${account.tradeMode}`}>{account.tradeMode}</b>
      <Icon name="chevron" size={12} />
    </button>
  );
}

// One row for the whole application: menus, the workspace being shown, the mode and the account.
// Analysis mode only ever shows the chart workspace, so its tabs give way there.
export function AppBar() {
  const isAnalysis = useStore(workspace, (state) => state.isAnalysisMode);
  return (
    <header className="app-bar">
      <MenuBar />
      {!isAnalysis && <WorkspaceTabs />}
      <div className="app-bar-end">
        <BackgroundActivity isAnalysis={isAnalysis} />
        <ModeSwitch isAnalysis={isAnalysis} />
        <AccountChip />
      </div>
    </header>
  );
}
