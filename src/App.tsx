import { CloseByDialog } from './components/dialogs/CloseByDialog';
import { ManagePositionDialog } from './components/dialogs/ManagePositionDialog';
import { AutomationPage } from './components/pages/AutomationPage';
import { TradeCopierPage } from './components/pages/TradeCopierPage';
import { SignalsPage } from './components/pages/SignalsPage';
import { JournalingPage } from './components/pages/JournalingPage';
import { JournalingNotice } from './components/journaling/JournalingNotice';
import { PriceAlertNotice } from './components/PriceAlertNotice';
import { DrawingObjectsDialog } from './components/dialogs/DrawingObjectsDialog';
import { SymbolSpecificationDialog } from './components/dialogs/SymbolSpecificationDialog';
import { PriceAlertsDialog } from './components/dialogs/PriceAlertsDialog';
import { AccountsDialog } from './components/dialogs/AccountsDialog';
import { WorkspacePresetDialog } from './components/dialogs/WorkspacePresetDialog';
import { TradingViewDialog } from './components/dialogs/TradingViewDialog';
import { IndicatorsDialog } from './components/dialogs/IndicatorsDialog';
import { BacktestDialog } from './components/backtest/BacktestDialog';
import { BacktestOrderEditDialog, BacktestPositionDialog } from './components/backtest/BacktestTickets';
import { useEffect, useState } from 'react';
import { AppBar } from './components/AppBar';
import { ChartWorkspace } from './components/ChartWorkspace';
import { ContextMenuHost } from './components/ContextMenu';
import { ChartPopouts } from './components/chart/ChartPopout';
import { TimeframePromptHost } from './components/chart/TimeframePrompt';
import { SymbolPromptHost } from './components/chart/SymbolPrompt';
import { SurfacePortal } from './components/ui/Surface';
import { focusedPopoutWindow } from './lib/popouts';
import { Dock } from './components/Dock';
import { AboutDialog, ConnectionDialog, LoginDialog, SymbolsDialog } from './components/dialogs/MiscDialogs';
import { ModifyOrderDialog, ModifyPositionDialog } from './components/dialogs/ModifyDialogs';
import { OrderDialog } from './components/dialogs/OrderDialog';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { Toolbox } from './components/Toolbox';
import { HintBubble } from './components/ui/Hint';
import { handleShortcut } from './lib/commands';
import { dockItems } from './lib/dock';
import { useStore } from './lib/store';
import { closeDialog, workspace, type Dialog } from './lib/workspace';

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
    case 'tradingview': return <TradingViewDialog />;
    case 'indicators': return <IndicatorsDialog initialSection={dialog.section} />;
    case 'backtests': return <BacktestDialog />;
    case 'backtestPosition': return <BacktestPositionDialog ticket={dialog.ticket} />;
    case 'backtestOrderEdit': return <BacktestOrderEditDialog ticket={dialog.ticket} />;
    case 'about':
      return <AboutDialog />;
  }
}

interface DialogHostProps {
  dialog: Dialog;
}

// A dialog opens in the window it was asked for from: a chart's pop-out window or the main one.
// Closing that window closes the dialog with it.
function DialogHost({ dialog }: DialogHostProps) {
  const [view] = useState(focusedPopoutWindow);
  useEffect(() => {
    if (!view) return;
    const close = () => closeDialog();
    view.addEventListener('pagehide', close);
    return () => view.removeEventListener('pagehide', close);
  }, [view]);
  return <SurfacePortal view={view}><ActiveDialog dialog={dialog} /></SurfacePortal>;
}

export function App() {
  const state = useStore(workspace, (current) => current);
  const isAnalysis = state.isAnalysisMode;
  const page = isAnalysis ? 'trading' : state.page;

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
    <div className={`app${isAnalysis ? ' is-analysis' : ''}${state.isBacktestMode ? ' is-backtest' : ''}`}>
      <AppBar />
      <PriceAlertNotice />
      <JournalingNotice />
      {page === 'copier' && <main className="workbench is-page"><TradeCopierPage /></main>}
      {page === 'signals' && <main className="workbench is-page"><SignalsPage /></main>}
      {page === 'automation' && <main className="workbench is-page"><AutomationPage /></main>}
      {page === 'journaling' && <main className="workbench is-page"><JournalingPage /></main>}
      {page === 'trading' && <Toolbar />}
      {/* Every slot below stays in place across modes, so the charts survive a mode switch. */}
      <main className={`workbench${page !== 'trading' ? ' is-offstage' : ''}`} aria-hidden={page !== 'trading'}>
        <Dock side="left" items={dockItems(state, 'left')} depthSymbol={state.depthSymbol} />
        <div className="center">
          <ChartWorkspace />
          {!isAnalysis && state.isToolboxShown && <Toolbox />}
        </div>
        <Dock side="right" items={dockItems(state, 'right')} depthSymbol={state.depthSymbol} />
      </main>
      {state.isStatusBarShown && <StatusBar />}
      {state.dialog && <DialogHost dialog={state.dialog} />}
      <ChartPopouts />
      <ContextMenuHost />
      <TimeframePromptHost />
      <SymbolPromptHost />
      <HintBubble />
    </div>
  );
}
