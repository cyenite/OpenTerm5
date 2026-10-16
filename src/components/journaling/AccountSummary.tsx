import { journalPlans, type JournalingView, type MonthlyTradeUsage } from '../../../shared/journaling';
import { journaling, journalingStore, openInJournal } from '../../lib/journaling';
import { log } from '../../lib/session';
import { Section } from '../ui/Controls';
import { BrowserConnect, CodeField } from './ConnectPanel';

interface UsageMeterProps {
  usage: MonthlyTradeUsage;
}

function UsageMeter({ usage }: UsageMeterProps) {
  const resets = usage.resetsAt ? new Date(usage.resetsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  if (usage.limit === null) return <span className="is-muted">{usage.used} trades this month, no limit</span>;
  const share = usage.limit > 0 ? Math.min(1, usage.used / usage.limit) : 1;
  const tone = share >= 1 ? 'is-bad' : share >= 0.8 ? 'is-warn' : '';
  return (
    <div className="usage-meter">
      <div className={`usage-track ${tone}`} role="meter" aria-label="Trades journaled this month" aria-valuemin={0} aria-valuemax={usage.limit} aria-valuenow={Math.min(usage.used, usage.limit)}>
        <span style={{ width: `${share * 100}%` }} />
      </div>
      <span>{usage.used} of {usage.limit} trades this month{resets ? `, resets ${resets}` : ''}</span>
    </div>
  );
}

interface AccountSummaryProps {
  view: JournalingView;
}

export function AccountSummary({ view }: AccountSummaryProps) {
  const user = view.user;
  const plan = journalPlans.find((item) => item.key === user?.plan)?.label ?? 'Free';
  const disconnect = async () => {
    if (!window.confirm('Disconnect Journaling? OpenTerm5 stops syncing and Tradescribe revokes its key. Trades already journaled stay in Tradescribe.')) return;
    try { journalingStore.set({ view: await journaling.request('journaling.disconnect', {}) }); }
    catch (error) { log((error as Error).message, 'Journaling'); }
  };
  return (
    <Section
      title={user?.email || 'Tradescribe'}
      detail={`${plan} plan on ${view.platformUrl}`}
      actions={<>
        {user?.plan !== 'pro' && <button type="button" className="link-button" onClick={() => openInJournal({ kind: 'upgrade' })}>Upgrade</button>}
        <button type="button" onClick={disconnect}>Disconnect</button>
      </>}
    >
      {view.isReconnectNeeded && (
        <div className="banner is-warn stack">
          <span>{view.error ?? 'Tradescribe no longer accepts this connection. Reconnect to keep syncing.'}</span>
          <BrowserConnect view={view} label="Reconnect" />
          <CodeField isBusy={view.flow !== 'idle'} />
        </div>
      )}
      {view.isConnected && !view.isStored && <p className="banner is-warn">This system has no keychain OpenTerm5 can use, so the connection is kept in memory and ends when OpenTerm5 closes.</p>}
      {view.usage ? <UsageMeter usage={view.usage.monthlyTrades} /> : <span className="is-muted">Usage appears after the first sync.</span>}
    </Section>
  );
}
