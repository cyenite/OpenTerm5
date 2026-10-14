import { CloseByDialog } from './components/dialogs/CloseByDialog';
import { ManagePositionDialog } from './components/dialogs/ManagePositionDialog';
import { TopTabs } from './components/TopTabs';
import { AutomationPage } from './components/pages/AutomationPage';
import { CopyTradingPage } from './components/pages/CopyTradingPage';
import { SignalsPage } from './components/pages/SignalsPage';
import { PriceAlertNotice } from './components/PriceAlertNotice';
import { DrawingObjectsDialog } from './components/dialogs/DrawingObjectsDialog';
import { SymbolSpecificationDialog } from './components/dialogs/SymbolSpecificationDialog';
import { PriceAlertsDialog } from './components/dialogs/PriceAlertsDialog';
import { AccountsDialog } from './components/dialogs/AccountsDialog';
import { WorkspacePresetDialog } from './components/dialogs/WorkspacePresetDialog';
import { useEffect } from 'react';
import { AnalysisBar } from './components/AnalysisBar';
import { ChartWorkspace } from './components/ChartWorkspace';
import { ContextMenuHost } from './components/ContextMenu';
import { DataWindow } from './components/DataWindow';
import { DepthOfMarket } from './components/DepthOfMarket';
import { AboutDialog, ConnectionDialog, LoginDialog, SymbolsDialog } from './components/dialogs/MiscDialogs';
import { ModifyOrderDialog, ModifyPositionDialog } from './components/dialogs/ModifyDialogs';
import { OrderDialog } from './components/dialogs/OrderDialog';
import { MarketWatch } from './components/MarketWatch';
import { MenuBar } from './components/MenuBar';
import { Navigator } from './components/Navigator';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { Toolbox } from './components/Toolbox';
import { handleShortcut } from './lib/commands';
import { useStore } from './lib/store';
import { workspace, type Dialog } from './lib/workspace';

interface ActiveDialogProps {
  dialog: Dialog;
}

function ActiveDialog({ dialog }: ActiveDialogProps) {
  switch (dialog.kind) {
    case 'order':
      return <OrderDialog initialSymbol={dialog.symbol} initialVolume={dialog.volume} initialPrice={dialog.price} initialType={dialog.type} />;
    case 'closeBy': return <CloseByDialog ticket={dialog.ticket} />;
    case 'manage': return <ManagePositionDialog ticket={dialog.ticket} />;
    case 'modifyPosition':
      return <ModifyPositionDialog ticket={dialog.ticket} />;
    case 'modifyOrder':
      return <ModifyOrderDialog ticket={dialog.ticket} />;
    case 'symbols':
      return <SymbolsDialog />;
    case 'connection':
      return <ConnectionDialog />;
    case 'login':
      return <LoginDialog profileId={dialog.profileId} />;
    case 'specification': return <SymbolSpecificationDialog symbol={dialog.symbol} />;
    case 'objects': return <DrawingObjectsDialog chartId={dialog.chartId} />;
    case 'accounts': return <AccountsDialog />;
    case 'profile': return <WorkspacePresetDialog />;
    case 'template': return <WorkspacePresetDialog chartId={dialog.chartId} />;
    case 'alerts': return <PriceAlertsDialog />;
    case 'about':
      return <AboutDialog />;
  }
}

export function App() {
  const state = useStore(workspace, (current) => current);
  const isAnalysis = state.isAnalysisMode;
  const page = isAnalysis ? 'trading' : state.page;
  const isLeftShown = !isAnalysis && (state.isMarketWatchShown || state.isNavigatorShown || state.isDataWindowShown);
  const isAnalysisDockShown = isAnalysis && (state.isMarketWatchShown || state.isDataWindowShown);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!workspace.get().dialog) {
        handleShortcut(event);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app${isAnalysis ? ' is-analysis' : ''}`}>
      <MenuBar />
      {!isAnalysis && <TopTabs />}
      <PriceAlertNotice />
      {page === 'copier' && <main className="workbench is-page"><CopyTradingPage /></main>}
      {page === 'signals' && <main className="workbench is-page"><SignalsPage /></main>}
      {page === 'automation' && <main className="workbench is-page"><AutomationPage /></main>}
      {page === 'trading' && (isAnalysis ? <AnalysisBar /> : <Toolbar />)}
      {/* Every slot below stays in place across modes, so the charts survive a mode switch. */}
      <main className={`workbench${page !== 'trading' ? ' is-offstage' : ''}`} aria-hidden={page !== 'trading'}>
        {isLeftShown && (
          <aside className="dock-left">
            {state.isMarketWatchShown && <MarketWatch />}
            {state.isDataWindowShown && <DataWindow />}
            {state.isNavigatorShown && <Navigator />}
          </aside>
        )}
        <div className="center">
          <ChartWorkspace />
          {!isAnalysis && state.isToolboxShown && <Toolbox />}
        </div>
        {!isAnalysis && state.depthSymbol && (
          <aside className="dock-right">
            <DepthOfMarket symbol={state.depthSymbol} />
          </aside>
        )}
        {isAnalysisDockShown && (
          <aside className="dock-right analysis-dock">
            {state.isMarketWatchShown && <MarketWatch />}
            {state.isDataWindowShown && <DataWindow />}
          </aside>
        )}
      </main>
      {state.isStatusBarShown && <StatusBar />}
      {state.dialog && <ActiveDialog dialog={state.dialog} />}
      <ContextMenuHost />
    </div>
  );
}
