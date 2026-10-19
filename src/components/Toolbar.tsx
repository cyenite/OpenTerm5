import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { newOrder, setChartType, setTimeframe, showSymbol, toggleDepth, toggleFullScreen, toggleOneClick, togglePanel } from '../lib/commands';
import { chartInstance, chartUi } from '../lib/chart-instances';
import { defaultSymbol } from '../lib/broker-symbols';
import { openMenuAt } from '../lib/context-menu';
import { indicatorFavorites } from '../lib/indicator-favorites';
import { favoriteIndicatorItems, toggleIndicatorsDialog } from '../lib/indicator-menu';
import { chartTimeframes } from '../lib/mt5-timeframes';
import { session, signingIn } from '../lib/session';
import { useStore } from '../lib/store';
import { useWatchedSpecs } from '../lib/watchlists';
import { drawingSyncs } from '../lib/chart-layouts';
import { visibleChartIds } from '../lib/chart-tabs';
import { exitReplay, replay, setReplayMode, startReplay } from '../lib/replay';
import { replayModes } from '../lib/replay-model';
import { replayTradingHint, useIsReplayingChart } from '../lib/replay-session';
import { drawingSyncMenuItems } from '../lib/layout-menu';
import { activeChart, activeTab, chartTypes, openChart, openDialog, openTab, toggleAnalysisPositions, workspace, type ChartType } from '../lib/workspace';
import { LayoutPicker } from './chart/LayoutPicker';
import type { MenuItem } from './MenuBar';
import { SymbolSearch } from './SymbolSearch';
import { hintProps, type HintContent } from './ui/Hint';
import { Icon, type IconName } from './ui/Icon';

interface ToolButtonProps {
  hint: HintContent;
  icon?: IconName;
  text?: string;
  isActive?: boolean;
  isPrimary?: boolean;
  isDisabled?: boolean;
  hasMenu?: boolean;
  textLevel?: number;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

export function ToolButton({ hint, icon, text, isActive, isPrimary, isDisabled, hasMenu, textLevel, onClick }: ToolButtonProps) {
  const className = ['tool-button', isActive && 'is-active', isPrimary && 'is-primary', textLevel && 'has-text', hasMenu && 'has-menu'].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={className}
      aria-label={hint.title}
      aria-keyshortcuts={hint.shortcut}
      aria-pressed={hasMenu ? undefined : isActive}
      aria-haspopup={hasMenu ? 'menu' : undefined}
      aria-disabled={isDisabled || undefined}
      data-text-level={textLevel}
      onClick={(event) => { if (!isDisabled) onClick(event); }}
      {...hintProps(hint)}
    >
      {icon && <Icon name={icon} />}
      {text && <span className="tool-text">{text}</span>}
      {hasMenu && <Icon name="chevron" size={12} />}
    </button>
  );
}

interface IndicatorsButtonProps {
  chartId: string | undefined;
}

// TradingView's pair: the button toggles the Indicators dialog, and the arrow beside it, shown
// once something is starred, lists the favourites.
function IndicatorsButton({ chartId }: IndicatorsButtonProps) {
  const hasFavorites = useStore(indicatorFavorites, (state) => state.types.length > 0);
  const isOpen = useStore(workspace, (state) => state.dialog?.kind === 'indicators');
  return (
    <span className="tool-split">
      <ToolButton icon="indicators" text="Indicators" textLevel={2} isActive={isOpen} hint={{ title: 'Indicators', shortcut: '/', description: 'Every indicator in one place: built-in studies, MetaTrader formulas and Pine scripts.' }} onClick={toggleIndicatorsDialog} />
      {hasFavorites && <ToolButton hasMenu hint={{ title: 'Favorite Indicators', description: 'The indicators you starred in the Indicators dialog.' }} onClick={(event) => menuBelow(event, favoriteIndicatorItems(chartId))} />}
    </span>
  );
}

interface ToolGroupProps {
  label: string;
  children: React.ReactNode;
}

export function ToolGroup({ label, children }: ToolGroupProps) {
  return <div className="toolbar-group" role="group" aria-label={label}>{children}</div>;
}

export const chartTypeIcons: Record<ChartType, IconName> = { bars: 'bars', candles: 'candles', hollow: 'hollow', line: 'line', area: 'area', baseline: 'baseline', heikinashi: 'heikinashi' };

const menuBelow = (event: React.MouseEvent<HTMLElement>, items: readonly MenuItem[]) => {
  const box = event.currentTarget.getBoundingClientRect();
  openMenuAt(box.left, box.bottom + 4, items);
};

// Labels stay while the toolbar fits on one row. When it would not, the least needed labels go
// first (level 1), then the rest (level 2); each comes back once the window regains the width
// that level needed.
const compactLevels = 2;

function useCompactToolbar() {
  const toolbar = useRef<HTMLDivElement>(null);
  const neededWidths = useRef<number[]>([]);
  const [level, setLevel] = useState(0);

  useLayoutEffect(() => {
    const element = toolbar.current;
    if (!element) return;
    const measure = () => {
      if (level < compactLevels && element.scrollWidth > element.clientWidth + 1) {
        neededWidths.current[level] = element.scrollWidth;
        setLevel(level + 1);
      } else if (level > 0 && element.clientWidth >= neededWidths.current[level - 1]) setLevel(level - 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [level]);

  return { toolbar, level };
}

function SymbolPicker() {
  const symbol = useStore(workspace, (state) => activeChart(state)?.symbol);
  const signIn = useStore(session, signingIn);
  const symbols = useStore(session, (state) => state.symbols);
  const watchedSpecs = useWatchedSpecs();
  const watched = useMemo(() => new Set(watchedSpecs.map((spec) => spec.name)), [watchedSpecs]);
  return (
    <div className="chart-symbol" title={symbol ? symbols[symbol]?.description : undefined}>
      <strong>{symbol ?? 'No chart'}</strong>
      <SymbolSearch symbols={symbols} watched={watched} signIn={signIn} onPick={showSymbol} label="Change symbol" placeholder="Symbol search" />
    </div>
  );
}

// The toolbar's timeframes are the common ones; any other the chart is on joins them so the
// current choice always shows, and the menu lists them all.
function TimeframePicker() {
  const timeframe = useStore(workspace, (state) => activeChart(state)?.timeframe);
  const shown = chartTimeframes.filter((candidate) => candidate.isOnToolbar || candidate.label === timeframe);
  const all: MenuItem[] = chartTimeframes.map((candidate) => ({ label: candidate.label, isChecked: candidate.label === timeframe, action: () => setTimeframe(candidate.label) }));
  return (
    <ToolGroup label="Timeframe">
      {shown.map((candidate) => (
        <ToolButton key={candidate.label} text={candidate.label} isActive={timeframe === candidate.label} isDisabled={!timeframe} hint={{ title: `Timeframe ${candidate.label}`, description: 'The period each bar on the active chart covers.' }} onClick={() => setTimeframe(candidate.label)} />
      ))}
      <ToolButton hasMenu isDisabled={!timeframe} hint={{ title: 'All Timeframes', description: 'Seconds, minutes, hours, days, weeks and months.' }} onClick={(event) => menuBelow(event, all)} />
    </ToolGroup>
  );
}

function ChartTypePicker() {
  const type = useStore(workspace, (state) => activeChart(state)?.type);
  const current = chartTypes.find((candidate) => candidate.key === type) ?? chartTypes[1];
  const items: MenuItem[] = chartTypes.map((candidate) => ({ label: candidate.label, shortcut: candidate.shortcut, isChecked: candidate.key === type, action: () => setChartType(candidate.key) }));
  return <ToolButton icon={chartTypeIcons[current.key]} hasMenu isDisabled={!type} hint={{ title: `Chart Type: ${current.label}`, description: 'Candles, bars, line, area, baseline or Heikin Ashi.' }} onClick={(event) => menuBelow(event, items)} />;
}

interface PanelsMenuProps {
  isAnalysis: boolean;
}

function PanelsMenu({ isAnalysis }: PanelsMenuProps) {
  const state = useStore(workspace, (current) => current);
  const hasChart = activeChart(state) !== undefined;
  const items: MenuItem[] = [
    { label: isAnalysis ? 'Watchlist' : 'Market Watch', shortcut: 'Ctrl+M', isChecked: state.isMarketWatchShown, action: () => togglePanel('isMarketWatchShown') },
    { label: 'Data Window', shortcut: 'Ctrl+D', isChecked: state.isDataWindowShown, action: () => togglePanel('isDataWindowShown') },
    ...(isAnalysis
      ? [{ label: 'Positions on Charts', isChecked: state.isAnalysisPositionsShown, action: toggleAnalysisPositions }]
      : [
        { label: 'Navigator', shortcut: 'Ctrl+N', isChecked: state.isNavigatorShown, action: () => togglePanel('isNavigatorShown') },
        { label: 'Toolbox', shortcut: 'Ctrl+T', isChecked: state.isToolboxShown, action: () => togglePanel('isToolboxShown') },
        { label: 'Trade Assistant', isChecked: state.isTradeAssistantShown, action: () => togglePanel('isTradeAssistantShown') },
        { label: 'Depth of Market', shortcut: 'Alt+B', isChecked: state.depthSymbol !== null, isDisabled: !hasChart, action: () => toggleDepth() },
      ]),
    { label: '', isSeparator: true },
    ...(isAnalysis ? [] : [{ label: 'Drawing Toolbar', isChecked: state.isTradeDrawingToolbarShown, action: () => togglePanel('isTradeDrawingToolbarShown') }]),
    { label: 'Chart Tabs', isChecked: state.isChartBarShown, action: () => togglePanel('isChartBarShown') },
    { label: 'Status Bar', isChecked: state.isStatusBarShown, action: () => togglePanel('isStatusBarShown') },
    { label: '', isSeparator: true },
    { label: 'Full Screen', shortcut: 'F11', action: toggleFullScreen },
  ];
  return <ToolButton icon="panels" hasMenu hint={{ title: 'Panels', description: 'Show or hide the watchlist, data window, toolbox and other panels.' }} onClick={(event) => menuBelow(event, items)} />;
}

interface ReplayButtonProps {
  isDisabled: boolean;
}

// In a multi-chart tab the mode menu beside it chooses between replaying every chart on one clock
// and replaying the active chart alone.
function ReplayButton({ isDisabled }: ReplayButtonProps) {
  const tab = useStore(workspace, activeTab);
  const mode = useStore(workspace, (state) => state.replayMode);
  const isReplaying = useStore(replay, (state) => !!state.session && state.session.tabId === tab?.id);
  const isMultiChart = !!tab && visibleChartIds(tab).length > 1;
  const modes: MenuItem[] = replayModes.map((candidate) => ({ label: candidate.label, isChecked: candidate.key === mode, action: () => setReplayMode(candidate.key) }));
  const current = replayModes.find((candidate) => candidate.key === mode) ?? replayModes[0];
  return (
    <>
      <ToolButton icon="replay" text="Replay" textLevel={1} isActive={isReplaying} isDisabled={isDisabled} hint={{ title: 'Bar Replay', description: isMultiChart ? `Hide the later bars and play forward from a bar you pick. ${current.description}` : 'Hide the later bars and play the chart forward from a bar you pick.' }} onClick={() => (isReplaying ? exitReplay() : startReplay())} />
      {isMultiChart && <ToolButton hasMenu hint={{ title: `Replay: ${current.label}`, description: 'Replay every chart of the layout together, or only the active chart.' }} onClick={(event) => menuBelow(event, modes)} />}
    </>
  );
}

// TradingView shows drawing sync only where there is another chart to sync with.
function DrawingSyncMenu() {
  const isMultiChart = useStore(workspace, (state) => { const tab = activeTab(state); return !!tab && visibleChartIds(tab).length > 1; });
  const drawingSync = useStore(workspace, (state) => state.drawingSync);
  const current = drawingSyncs.find((candidate) => candidate.key === drawingSync) ?? drawingSyncs[0];
  if (!isMultiChart) return null;
  return <ToolButton icon="link" hasMenu isActive={drawingSync !== 'off'} hint={{ title: `Sync Drawings: ${current.label}`, description: current.description }} onClick={(event) => menuBelow(event, drawingSyncMenuItems())} />;
}

function TradingActions() {
  const tool = useStore(workspace, (state) => state.tool);
  const chartId = useStore(workspace, (state) => activeChart(state)?.id);
  const isOneClickEnabled = useStore(workspace, (state) => state.isOneClickEnabled);
  const isReplaying = useIsReplayingChart(chartId);
  return (
    <ToolGroup label="Trading">
      <ToolButton icon="riskOrder" isActive={tool === 'riskOrder'} hint={{ title: 'Risk Order', description: 'Drag the entry, then the stop loss and take profit on the chart; the volume follows your risk setting.' }} onClick={() => workspace.set({ tool: tool === 'riskOrder' ? 'cursor' : 'riskOrder' })} />
      <ToolButton icon="oneClick" text="One-Click" textLevel={1} isActive={isOneClickEnabled} hint={{ title: 'One-Click Trading', description: 'Buy and sell from the chart immediately, without a confirmation ticket.' }} onClick={toggleOneClick} />
      <ToolButton text="New Order" isPrimary isDisabled={isReplaying} hint={{ title: 'New Order', shortcut: 'F9', description: isReplaying ? `${replayTradingHint}.` : 'Open the order ticket for the active symbol.' }} onClick={() => newOrder()} />
    </ToolGroup>
  );
}

// The chart bar is the same in both modes, so moving between them never rearranges what the user
// reaches for: what is charted on the left, editing in the middle, and on the right the trading
// actions (trade mode only), chart tools and panels.
export function Toolbar() {
  const state = useStore(workspace, (current) => current);
  const isAnalysis = state.isAnalysisMode;
  const chart = activeChart(state);
  const hasChart = chart !== undefined;
  const ui = useStore(chartUi, (current) => (chart ? current.byId[chart.id] : undefined));
  const engine = () => chartInstance(chart?.id);
  const { toolbar, level } = useCompactToolbar();

  return (
    <div ref={toolbar} className="toolbar chart-toolbar" data-level={level} role="toolbar" aria-label="Chart">
      <SymbolPicker />
      <ToolButton icon="plus" hint={{ title: 'New Tab', description: 'Open a tab with a copy of the active chart.' }} onClick={() => (chart ? openTab() : openChart(defaultSymbol()))} />
      <LayoutPicker />
      <span className="toolbar-divider" />
      <TimeframePicker />
      <span className="toolbar-divider" />
      <ToolGroup label="Chart">
        <ChartTypePicker />
        <IndicatorsButton chartId={chart?.id} />
        <ToolButton icon="alert" text="Alert" textLevel={1} hint={{ title: 'Price Alerts', description: 'Get notified when price reaches a level.' }} onClick={() => openDialog({ kind: 'alerts' })} />
        <ReplayButton isDisabled={!ui} />
      </ToolGroup>
      <span className="toolbar-divider" />
      <ToolGroup label="Edit">
        {!isAnalysis && <ToolButton icon="trend" isActive={state.isTradeDrawingToolbarShown} hint={{ title: 'Drawing Toolbar', description: 'Show or hide the drawing tools on the left of the charts.' }} onClick={() => togglePanel('isTradeDrawingToolbarShown')} />}
        <DrawingSyncMenu />
        <ToolButton icon="undo" isDisabled={!ui?.canUndo} hint={{ title: 'Undo', shortcut: 'Ctrl+Z', description: 'Undo the last change to drawings or indicators.' }} onClick={() => engine()?.undo()} />
        <ToolButton icon="redo" isDisabled={!ui?.canRedo} hint={{ title: 'Redo', shortcut: 'Ctrl+Y' }} onClick={() => engine()?.redo()} />
      </ToolGroup>
      <div className="toolbar-spacer" />
      {!isAnalysis && <TradingActions />}
      {!isAnalysis && <span className="toolbar-divider" />}
      <ToolGroup label="View">
        <ToolButton icon="objectTree" isActive={!!ui?.isObjectTreeShown} isDisabled={!ui} hint={{ title: 'Object Tree', description: 'List the indicators and drawings on the chart.' }} onClick={() => engine()?.toggleObjectTree()} />
        <ToolButton icon="chartSettings" isDisabled={!ui} hint={{ title: 'Chart Settings', description: 'Colours, status line, scales and appearance of the active chart.' }} onClick={() => engine()?.openChartSettings()} />
        <ToolButton icon="camera" isDisabled={!hasChart} hint={{ title: 'Save Chart Image' }} onClick={() => window.dispatchEvent(new Event('openterm:chart-image'))} />
        <PanelsMenu isAnalysis={isAnalysis} />
      </ToolGroup>
    </div>
  );
}
