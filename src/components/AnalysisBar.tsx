import { useMemo } from 'react';
import { automationStore } from '../lib/automation';
import { chartInstance, chartUi } from '../lib/chart-instances';
import { setChartType, setTimeframe, showSymbol, togglePanel, zoom } from '../lib/commands';
import { openMenuAt } from '../lib/context-menu';
import { indicatorMenuItems } from '../lib/indicator-menu';
import { session } from '../lib/session';
import { useStore } from '../lib/store';
import { useWatchedSpecs } from '../lib/watchlists';
import { activeChart, chartTypes, openDialog, toggleAnalysisMode, toggleAnalysisPositions, workspace } from '../lib/workspace';
import { chartTypeIcons, ToolButton, ToolGroup } from './Toolbar';
import { SymbolSearch } from './SymbolSearch';
import { HintBubble } from './ui/Hint';
import { chartTimeframes } from '../lib/mt5-timeframes';

function BackgroundActivity() {
  const activeCopiers = useStore(automationStore, (state) => state.copier.configs.filter((config) => config.status === 'enabled').length);
  const isSignalsRunning = useStore(automationStore, (state) => !!state.webhooks?.status.isRunning && !state.webhooks.settings.isPaused);
  const positionCount = useStore(session, (state) => state.positions.length);
  const parts = [
    activeCopiers > 0 && `${activeCopiers} copier${activeCopiers === 1 ? '' : 's'}`,
    isSignalsRunning && 'signals on',
    positionCount > 0 && `${positionCount} open position${positionCount === 1 ? '' : 's'}`,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <span className="status-dot is-good analysis-activity" title="Trading keeps running while you analyse">{parts.join(' · ')}</span>;
}

export function AnalysisBar() {
  const state = useStore(workspace, (current) => current);
  const symbols = useStore(session, (current) => current.symbols);
  const watchedSpecs = useWatchedSpecs();
  const watched = useMemo(() => new Set(watchedSpecs.map((spec) => spec.name)), [watchedSpecs]);
  const chart = activeChart(state);
  const hasChart = chart !== undefined;
  const description = chart ? symbols[chart.symbol]?.description : undefined;
  const ui = useStore(chartUi, (current) => (chart ? current.byId[chart.id] : undefined));
  const engine = () => chartInstance(chart?.id);

  const showIndicators = (event: React.MouseEvent<HTMLElement>) => {
    if (!chart) return;
    const box = event.currentTarget.getBoundingClientRect();
    openMenuAt(box.left, box.bottom + 2, indicatorMenuItems(chart.id));
  };

  return (
    <div className="toolbar analysis-bar" role="toolbar" aria-label="Analysis">
      <div className="analysis-symbol" title={description}>
        <strong>{chart?.symbol ?? 'No chart'}</strong>
        <SymbolSearch symbols={symbols} watched={watched} onPick={showSymbol} label="Change symbol" placeholder="Symbol search" />
      </div>
      <ToolGroup label="Timeframe">
        {chartTimeframes
          .filter((timeframe) => timeframe.isOnToolbar)
          .map((timeframe) => (
            <ToolButton key={timeframe.label} text={timeframe.label} isActive={chart?.timeframe === timeframe.label} isDisabled={!hasChart} hint={{ title: `Timeframe ${timeframe.label}` }} onClick={() => setTimeframe(timeframe.label)} />
          ))}
      </ToolGroup>
      <ToolGroup label="Chart type">
        {chartTypes.map((type) => (
          <ToolButton key={type.key} icon={chartTypeIcons[type.key]} isActive={chart?.type === type.key} isDisabled={!hasChart} hint={{ title: type.label, shortcut: type.shortcut, description: type.description }} onClick={() => setChartType(type.key)} />
        ))}
      </ToolGroup>
      <ToolGroup label="Studies">
        <ToolButton icon="indicators" text="Indicators" isDisabled={!hasChart} hint={{ title: 'Indicators', description: 'Add a study to the active chart.' }} onClick={showIndicators} />
        <ToolButton icon="alert" text="Alert" hint={{ title: 'Price Alerts', description: 'Get notified when price reaches a level.' }} onClick={() => openDialog({ kind: 'alerts' })} />
      </ToolGroup>
      <ToolGroup label="Edit">
        <ToolButton icon="undo" isDisabled={!ui?.canUndo} hint={{ title: 'Undo', shortcut: 'Ctrl+Z', description: 'Undo the last change to drawings or indicators.' }} onClick={() => engine()?.undo()} />
        <ToolButton icon="redo" isDisabled={!ui?.canRedo} hint={{ title: 'Redo', shortcut: 'Ctrl+Y' }} onClick={() => engine()?.redo()} />
      </ToolGroup>
      <ToolGroup label="Replay">
        <ToolButton icon="replay" text="Replay" isActive={!!ui?.isReplaying} isDisabled={!ui} hint={{ title: 'Bar Replay', description: 'Hide the later bars and play the chart forward from a bar you pick.' }} onClick={() => (ui?.isReplaying ? engine()?.exitReplay() : engine()?.startReplay())} />
      </ToolGroup>
      <ToolGroup label="View">
        <ToolButton icon="objectTree" isActive={!!ui?.isObjectTreeShown} isDisabled={!ui} hint={{ title: 'Object Tree', description: 'List the indicators and drawings on the chart.' }} onClick={() => engine()?.toggleObjectTree()} />
        <ToolButton icon="chartSettings" isDisabled={!ui} hint={{ title: 'Chart Settings', description: 'Colours, status line, scales and appearance of the active chart.' }} onClick={() => engine()?.openChartSettings()} />
        <ToolButton icon="zoomIn" isDisabled={!hasChart} hint={{ title: 'Zoom In', shortcut: '+' }} onClick={() => zoom(1.25)} />
        <ToolButton icon="zoomOut" isDisabled={!hasChart} hint={{ title: 'Zoom Out', shortcut: '-' }} onClick={() => zoom(0.8)} />
        <ToolButton icon="camera" isDisabled={!hasChart} hint={{ title: 'Save Chart Image' }} onClick={() => window.dispatchEvent(new Event('openterm:chart-image'))} />
      </ToolGroup>
      <div className="analysis-spacer" />
      <BackgroundActivity />
      <ToolGroup label="Panels">
        <ToolButton icon="positions" isActive={state.isAnalysisPositionsShown} hint={{ title: 'Show Positions', description: 'Draw open positions and pending orders on the charts, read-only.' }} onClick={toggleAnalysisPositions} />
        <ToolButton icon="marketWatch" isActive={state.isMarketWatchShown} hint={{ title: 'Watchlist', shortcut: 'Ctrl+M' }} onClick={() => togglePanel('isMarketWatchShown')} />
        <ToolButton icon="dataWindow" isActive={state.isDataWindowShown} hint={{ title: 'Data Window', shortcut: 'Ctrl+D' }} onClick={() => togglePanel('isDataWindowShown')} />
      </ToolGroup>
      <ToolGroup label="Mode">
        <ToolButton icon="exit" text="Trading" hint={{ title: 'Back to Trading', shortcut: 'Ctrl+Shift+A', description: 'Return to the full terminal with order tickets and the toolbox.' }} onClick={toggleAnalysisMode} />
      </ToolGroup>
      <HintBubble />
    </div>
  );
}
