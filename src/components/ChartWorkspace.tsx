import { useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { isEquivalentDivider, layoutCells, layoutDividers, layoutOf, linkGroups, resizeLayout, type CellRect, type LayoutDivider, type SplitSizes } from '../lib/chart-layouts';
import { tabActiveChartId, tabSizes, visibleChartIds, type ChartTab } from '../lib/chart-tabs';
import { openContextMenu, openMenuAt } from '../lib/context-menu';
import { isLinkGroupShown, linkGroupMenuItems, tabTitle } from '../lib/layout-menu';
import { dockChart, popOutChart, popoutMenuItems, popoutModeOf, popoutOf, popouts, type Popout } from '../lib/popouts';
import { setLayoutResizing } from '../lib/layout-sync';
import { replay } from '../lib/replay';
import { useStore } from '../lib/store';
import { activeTab, closeTab, marketTabs, focusChart, focusTab, openChart, openTab, resetTabSizes, setChartSymbol, setTabSizes, workspace, type ChartConfig } from '../lib/workspace';
import { ChartWindow } from './chart/ChartWindow';
import { DrawingRail } from './chart/DrawingRail';
import { LayoutIcon } from './chart/LayoutIcon';
import { ReplayToolbar } from './chart/ReplayToolbar';
import { BacktestTransport } from './backtest/BacktestTransport';
import { Icon } from './ui/Icon';

const symbolType = 'text/x-openterm-symbol';
// Space between neighbouring charts; the divider's grab strip is wider than the gap it sits in.
const gap = 4;
const whole: CellRect = { top: 0, left: 0, width: 1, height: 1 };

const hasSymbol = (event: DragEvent) => event.dataTransfer.types.includes(symbolType);

// Edges inside the layout give up half the gap each; edges on the workspace border stay flush.
function cellStyle(rect: CellRect): CSSProperties {
  const epsilon = 1e-6;
  const left = rect.left > epsilon ? gap / 2 : 0;
  const top = rect.top > epsilon ? gap / 2 : 0;
  const right = rect.left + rect.width < 1 - epsilon ? gap / 2 : 0;
  const bottom = rect.top + rect.height < 1 - epsilon ? gap / 2 : 0;
  return {
    left: `calc(${rect.left * 100}% + ${left}px)`,
    top: `calc(${rect.top * 100}% + ${top}px)`,
    width: `calc(${rect.width * 100}% - ${left + right}px)`,
    height: `calc(${rect.height * 100}% - ${top + bottom}px)`,
  };
}

interface PoppedOutChartProps {
  chart: ChartConfig;
  popout: Popout;
}

// What the layout shows in the slot of a chart that is in its own window.
function PoppedOutChart({ chart, popout }: PoppedOutChartProps) {
  return (
    <div className="chart-window is-popped-out" onMouseDown={() => focusChart(chart.id)}>
      <div className="popped-out-notice" role="status">
        <Icon name="popout" size={20} />
        <strong>{chart.symbol} {chart.timeframe}</strong>
        <span>Shown in its own window ({popoutModeOf(popout.mode).label})</span>
        <div className="popped-out-actions">
          <button type="button" onClick={() => popOutChart(chart.id, popout.mode)}>Show Window</button>
          <button type="button" onClick={() => dockChart(chart.id)}>Return Here</button>
        </div>
      </div>
    </div>
  );
}

interface ChartCellProps {
  chart: ChartConfig;
  rect: CellRect | null;
  isActive: boolean;
  isOutlined: boolean;
  isLinkShown: boolean;
}

// Every chart stays a keyed child of the chart area, whatever tab or slot shows it, so switching
// tabs or layouts never remounts a chart or reloads its history. Charts not on screen keep the
// full size, hidden, as background charts always have.
function ChartCell({ chart, rect, isActive, isOutlined, isLinkShown }: ChartCellProps) {
  const group = linkGroups.find((candidate) => candidate.key === chart.linkGroup);
  const popout = useStore(popouts, (state) => popoutOf(state, chart.id));
  const classes = ['chart-cell', !rect && 'is-background', isOutlined && 'is-active'].filter(Boolean).join(' ');
  return (
    <div
      className={classes}
      style={rect ? cellStyle(rect) : { inset: 0 }}
      onDragOver={(event) => hasSymbol(event) && event.preventDefault()}
      onDrop={(event) => {
        const symbol = event.dataTransfer.getData(symbolType);
        if (!symbol) return;
        event.stopPropagation();
        focusChart(chart.id);
        setChartSymbol(chart.id, symbol);
      }}
    >
      {popout ? <PoppedOutChart chart={chart} popout={popout} /> : <ChartWindow chart={chart} isActive={isActive} />}
      {rect && !popout && (
        <button
          type="button"
          className={`chart-popout${isLinkShown ? ' is-beside-link' : ''}`}
          title="Picture in picture: open the chart in its own window, on top of other windows"
          aria-label="Picture in picture"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            openMenuAt(box.left, box.top - 4, popoutMenuItems(chart.id));
          }}
        >
          <Icon name="popout" size={13} />
        </button>
      )}
      {rect && isLinkShown && (
        <button
          type="button"
          className={`chart-link${group ? ' is-linked' : ''}`}
          style={group ? { color: group.color } : undefined}
          title={group ? `${group.label} sync group` : 'Not in a sync group: syncs with the other charts outside any group'}
          aria-label="Sync group"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            openMenuAt(box.left, box.bottom + 4, linkGroupMenuItems(chart));
          }}
        >
          <Icon name="link" size={13} />
        </button>
      )}
    </div>
  );
}

interface DividerHandleProps {
  divider: LayoutDivider;
  isHighlighted: boolean;
  onBegin: (divider: LayoutDivider) => void;
  onDrag: (delta: number, isLinked: boolean) => void;
  onEnd: () => void;
  onReset: () => void;
}

function DividerHandle({ divider, isHighlighted, onBegin, onDrag, onEnd, onReset }: DividerHandleProps) {
  const drag = useRef<{ start: number; extent: number } | null>(null);
  const isColumns = divider.axis === 'columns';
  const position = (event: ReactPointerEvent) => isColumns ? event.clientX : event.clientY;
  const style: CSSProperties = isColumns
    ? { left: `calc(${divider.offset * 100}% - 4px)`, top: `${divider.bounds.top * 100}%`, height: `${divider.bounds.height * 100}%` }
    : { top: `calc(${divider.offset * 100}% - 4px)`, left: `${divider.bounds.left * 100}%`, width: `${divider.bounds.width * 100}%` };
  const finish = () => {
    if (!drag.current) return;
    drag.current = null;
    onEnd();
  };
  return (
    <div
      className={`layout-divider is-${divider.axis}${isHighlighted ? ' is-highlighted' : ''}`}
      style={style}
      title="Drag to resize. Shift+drag moves the matching dividers too. Double-click to make every chart the same size."
      onPointerDown={(event) => {
        const area = event.currentTarget.parentElement?.getBoundingClientRect();
        if (event.button !== 0 || !area) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { start: position(event), extent: isColumns ? area.width * divider.bounds.width : area.height * divider.bounds.height };
        onBegin(divider);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current && current.extent > 0) onDrag((position(event) - current.start) / current.extent, event.shiftKey);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={onReset}
    />
  );
}

interface ResizeDraft {
  readonly tabId: string;
  readonly start: SplitSizes;
  readonly sizes: SplitSizes;
  readonly divider: LayoutDivider;
  readonly isLinked: boolean;
}

interface TabLabelProps {
  tab: ChartTab;
  charts: readonly ChartConfig[];
  isActive: boolean;
}

function TabLabel({ tab, charts, isActive }: TabLabelProps) {
  const title = tabTitle(tab, charts);
  const count = visibleChartIds(tab).length;
  const menu = () => [
    { label: 'New Tab', action: openTab },
    { label: 'Close Tab', action: () => closeTab(tab.id) },
  ];
  return (
    <div
      role="tab"
      aria-selected={isActive}
      className={['chart-tab', isActive && 'is-active'].filter(Boolean).join(' ')}
      title={count > 1 ? `${title} and ${count - 1} more chart${count > 2 ? 's' : ''}` : title}
      onMouseDown={(event) => event.button === 0 && focusTab(tab.id)}
      onAuxClick={(event) => event.button === 1 && closeTab(tab.id)}
      onContextMenu={(event) => { focusTab(tab.id); openContextMenu(event, menu()); }}
    >
      {count > 1 && <LayoutIcon layout={tab.layout} />}
      <span>{title}</span>
      <button className="chart-tab-close" title="Close tab" aria-label={`Close ${title}`} onMouseDown={(event) => event.stopPropagation()} onClick={() => closeTab(tab.id)}>×</button>
    </div>
  );
}

export function ChartWorkspace() {
  const tabs = useStore(workspace, marketTabs);
  const charts = useStore(workspace, (state) => state.charts);
  const tabId = useStore(workspace, (state) => activeTab(state)?.id);
  const isMaximized = useStore(workspace, (state) => state.isChartMaximized);
  const isChartBarShown = useStore(workspace, (state) => state.isChartBarShown);
  const replayTabId = useStore(replay, (state) => state.session?.tabId);
  const replayPurpose = useStore(replay, (state) => state.session?.purpose);
  const isBacktestMode = useStore(workspace, (state) => state.isBacktestMode);
  const isRailShown = useStore(workspace, (state) => state.isAnalysisMode || state.isTradeDrawingToolbarShown);
  const body = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<ResizeDraft | null>(null);
  const tab = tabs.find((candidate) => candidate.id === tabId);
  const tree = tab ? layoutOf(tab.layout).tree : 0;
  const sizes = tab && draft?.tabId === tab.id ? draft.sizes : tab ? tabSizes(tab) : [];
  const cells = layoutCells(tree, sizes);
  const visible = tab ? visibleChartIds(tab) : [];
  const activeId = tab ? tabActiveChartId(tab) : '';
  const isMultiChart = visible.length > 1;
  const isMaximizedShown = isMaximized && isMultiChart;
  const isLinkShown = !!tab && isLinkGroupShown(tab);
  const mounted = new Set(tabs.flatMap(visibleChartIds));
  const dividers = tab && isMultiChart && !isMaximizedShown ? layoutDividers(tree, sizes) : [];

  const rectOf = (chartId: string): CellRect | null => {
    const slot = visible.indexOf(chartId);
    if (slot < 0) return null;
    if (isMaximizedShown) return chartId === activeId ? whole : null;
    return cells[slot] ?? null;
  };
  const begin = (divider: LayoutDivider) => {
    if (!tab) return;
    setLayoutResizing(true);
    setDraft({ tabId: tab.id, start: sizes, sizes, divider, isLinked: false });
  };
  const drag = (delta: number, isLinked: boolean) => setDraft((current) => current && { ...current, isLinked, sizes: resizeLayout(tree, current.start, current.divider, delta, isLinked) });
  const end = () => {
    if (draft) setTabSizes(draft.tabId, draft.sizes);
    setDraft(null);
    setLayoutResizing(false);
  };

  return (
    <div
      className="chart-workspace"
      onDragOver={(event) => hasSymbol(event) && event.preventDefault()}
      onDrop={(event) => {
        const symbol = event.dataTransfer.getData(symbolType);
        if (symbol) openChart(symbol);
      }}
    >
      <div ref={body} className="chart-body">
        {isRailShown && tabs.length > 0 && <DrawingRail overlay={body} />}
        <div className={['chart-area', isMultiChart && 'is-multi', draft && 'is-resizing'].filter(Boolean).join(' ')}>
          {!tabs.length && <p className="empty">Drag a symbol from Market Watch here, or use File &gt; New Chart</p>}
          {charts.filter((chart) => mounted.has(chart.id)).map((chart) => (
            <ChartCell
              key={chart.id}
              chart={chart}
              rect={rectOf(chart.id)}
              isActive={chart.id === activeId}
              isOutlined={chart.id === activeId && isMultiChart && !isMaximizedShown}
              isLinkShown={isLinkShown}
            />
          ))}
          {dividers.map((divider) => (
            <DividerHandle
              key={`${divider.path.join('.')}:${divider.index}`}
              divider={divider}
              isHighlighted={!!draft?.isLinked && isEquivalentDivider(divider, draft.divider)}
              onBegin={begin}
              onDrag={drag}
              onEnd={end}
              onReset={() => tab && resetTabSizes(tab.id)}
            />
          ))}
        </div>
        {isBacktestMode && (replayPurpose === undefined || replayPurpose === 'backtest' && replayTabId === tab?.id) && <BacktestTransport />}
      </div>
      {replayPurpose === 'replay' && replayTabId === tab?.id && <ReplayToolbar />}
      {isChartBarShown && (
        <nav className="chart-bar" role="tablist" aria-label="Chart tabs">
          {tabs.map((candidate) => <TabLabel key={candidate.id} tab={candidate} charts={charts} isActive={candidate.id === tab?.id} />)}
          {tabs.length > 0 && <button className="chart-bar-add" title="New tab with a copy of the active chart" aria-label="New tab" onClick={openTab}>+</button>}
        </nav>
      )}
    </div>
  );
}
