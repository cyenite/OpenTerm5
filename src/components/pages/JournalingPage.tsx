import { journaling, journalingStore } from '../../lib/journaling';
import { useStore } from '../../lib/store';
import { AccountSummary } from '../journaling/AccountSummary';
import { ConnectPanel } from '../journaling/ConnectPanel';
import { LinkPrompt } from '../journaling/LinkPrompt';
import { SyncAccounts } from '../journaling/SyncAccounts';
import { TodayJournal } from '../journaling/TodayJournal';
import { TradescribeLinks } from '../journaling/TradescribeLinks';
import { EmptyState } from '../ui/Controls';

interface NoticeBannerProps {
  message: string;
}

function NoticeBanner({ message }: NoticeBannerProps) {
  const dismiss = () => void journaling.request('journaling.dismissLink', {}).then((view) => journalingStore.set({ view })).catch(() => undefined);
  return (
    <p role="alert" className="banner is-bad journal-banner">
      <span>{message}</span>
      <button type="button" className="link-button" onClick={dismiss}>Dismiss</button>
    </p>
  );
}

export function JournalingPage() {
  const view = useStore(journalingStore, (state) => state.view);
  const revision = useStore(journalingStore, (state) => state.view?.accounts.find((account) => account.isActive)?.lastSyncAt ?? null);
  if (!view) return <EmptyState title="Journaling is starting" detail="One moment." />;
  const isLinked = view.isConnected || view.isReconnectNeeded;
  return (
    <div className="page-scroll single journaling-page">
      <div className="section-header-row">
        <h2>Journaling</h2>
        <span className="is-muted">Tradescribe</span>
      </div>
      {view.pendingLink && <LinkPrompt link={view.pendingLink} view={view} />}
      {view.error && !view.isReconnectNeeded && <NoticeBanner message={view.error} />}
      {isLinked ? (
        <>
          <AccountSummary view={view} />
          <SyncAccounts view={view} />
          {view.isConnected && <TodayJournal revision={revision} />}
          <TradescribeLinks view={view} />
        </>
      ) : <ConnectPanel view={view} />}
    </div>
  );
}
