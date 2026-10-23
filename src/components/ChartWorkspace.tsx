import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { isEquivalentDivider, layoutCells, layoutDividers, layoutOf, linkGroups, resizeLayout, type CellRect, type LayoutDivider, type SplitSizes } from '../lib/chart-layouts';
import { tabActiveChartId, tabSizes, visibleChartIds, type ChartTab } from '../lib/chart-tabs';
import { openContextMenu, openMenuAt } from '../lib/context-menu';
import { isLinkGroupShown, linkGroupMenuItems, tabTitle } from '../lib/layout-menu';
import { dockedTabId, dockTab, isPoppedOut, popOutTab, popoutMenuItems, popoutModeOf, popouts, tabDragType, type Popout } from '../lib/popouts';
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
import { useSurface } from './ui/Surface';

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

interface ChartCellProps {
  chart: ChartConfig;
  rect: CellRect | null;
  isLite: boolean;
  isActive: boolean;
  isOutlined: boolean;
  isLinkShown: boolean;
}

// Every chart stays a keyed child of the chart area, whatever tab or slot shows it, so switching
// tabs or layouts never remounts a chart or reloads its history. Charts not on screen keep the
// full size, hidden, as background charts always have.
function ChartCell({ chart, rect, isLite, isActive, isOutlined, isLinkShown }: ChartCellProps) {
  const group = linkGroups.find((candidate) => candidate.key === chart.linkGroup);
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
      <ChartWindow chart={chart} isActive={isActive} isLite={isLite} />
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

interface ChartLayoutProps {
  // Every tab whose charts this area keeps mounted; only `tab` is on screen.
  tabs: readonly ChartTab[];
  tab: ChartTab | undefined;
  isLite?: boolean;
  children?: ReactNode;
}

// A tab's charts in its layout, with the dividers between them: the main window's chart area, or a
// popped-out tab's window.
export function ChartLayout({ tabs, tab, isLite = false, children }: ChartLayoutProps) {
  const charts = useStore(workspace, (state) => state.charts);
  const isMaximized = useStore(workspace, (state) => state.isChartMaximized);
  const [draft, setDraft] = useState<ResizeDraft | null>(null);
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
    <div className={['chart-area', isMultiChart && 'is-multi', draft && 'is-resizing'].filter(Boolean).join(' ')}>
      {children}
      {charts.filter((chart) => mounted.has(chart.id)).map((chart) => (
        <ChartCell
          key={chart.id}
          chart={chart}
          rect={rectOf(chart.id)}
          isLite={isLite}
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
  );
}

const hasTab = (event: DragEvent) => event.dataTransfer.types.includes(tabDragType);

// Whether the tab being dragged was last over the tab bar. A tab released anywhere else, inside the
// main window or outside it, leaves for its own window.
let isDragOverTabBar = false;

interface TabLabelProps {
  tab: ChartTab;
  charts: readonly ChartConfig[];
  popout: Popout | undefined;
  isActive: boolean;
  isDropBefore: boolean;
  onDragDone: () => void;
}

function TabLabel({ tab, charts, popout, isActive, isDropBefore, onDragDone }: TabLabelProps) {
  const title = tabTitle(tab, charts);
  const count = visibleChartIds(tab).length;
  const menu = () => [
    { label: 'New Tab', action: openTab },
    { label: 'Close Tab', action: () => closeTab(tab.id) },
    { label: '', isSeparator: true },
    ...popoutMenuItems(tab.id),
  ];
  const classes = ['chart-tab', isActive && 'is-active', popout && 'is-popped-out', isDropBefore && 'is-drop-before'].filter(Boolean).join(' ');
  const hint = popout ? `${title}: in its own window (${popoutModeOf(popout.mode).label}). Click to show it, or drag it back onto the tab bar.` : `${title}. Drag it out of the tab bar to open it in its own window.`;
  return (
    <div
      role="tab"
      aria-selected={isActive}
      className={classes}
      data-tab-id={tab.id}
      title={count > 1 ? `${hint} ${count} charts.` : hint}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(tabDragType, tab.id);
        event.dataTransfer.effectAllowed = 'move';
        isDragOverTabBar = true;
      }}
      onDragEnd={(event) => {
        onDragDone();
        if (event.dataTransfer.dropEffect !== 'none' || isDragOverTabBar || isPoppedOut(tab.id)) return;
        // Wayland reports no screen position; the window then opens where the system puts it.
        const at = event.screenX || event.screenY ? { x: event.screenX, y: event.screenY } : undefined;
        popOutTab(tab.id, 'lite', at);
      }}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        if (popout) popOutTab(tab.id, popout.mode);
        else focusTab(tab.id);
      }}
      onAuxClick={(event) => event.button === 1 && closeTab(tab.id)}
      onContextMenu={(event) => { if (!popout) focusTab(tab.id); openContextMenu(event, menu()); }}
    >
      {popout && <Icon name="popout" size={12} />}
      {count > 1 && <LayoutIcon layout={tab.layout} />}
      <span>{title}</span>
      <button className="chart-tab-close" title="Close tab" aria-label={`Close ${title}`} draggable={false} onMouseDown={(event) => event.stopPropagation()} onClick={() => closeTab(tab.id)}>×</button>
    </div>
  );
}

interface TabBarProps {
  tabs: readonly ChartTab[];
  shownTabId: string | undefined;
}

// The tab bar takes tabs dropped on it, from itself (reordering) or from a pop-out window's handle
// (docking), in front of the tab under the pointer.
function TabBar({ tabs, shownTabId }: TabBarProps) {
  const charts = useStore(workspace, (state) => state.charts);
  const list = useStore(popouts, (state) => state.list);
  const view = useSurface();
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const onOver = (event: Event) => { isDragOverTabBar = !!(event.target as Element | null)?.closest?.('.chart-bar'); };
    const onLeave = (event: Event) => { if (!(event as MouseEvent).relatedTarget) isDragOverTabBar = false; };
    view.addEventListener('dragover', onOver);
    view.document.addEventListener('dragleave', onLeave);
    return () => {
      view.removeEventListener('dragover', onOver);
      view.document.removeEventListener('dragleave', onLeave);
    };
  }, [view]);

  const targetOf = (event: DragEvent): string | null => {
    const label = (event.target as Element).closest?.('.chart-tab') as HTMLElement | null;
    const id = label?.dataset.tabId;
    if (!label || !id) return null;
    const box = label.getBoundingClientRect();
    if (event.clientX < box.left + box.width / 2) return id;
    return tabs[tabs.findIndex((tab) => tab.id === id) + 1]?.id ?? null;
  };

  return (
    <nav
      className={`chart-bar${dropBefore !== undefined ? ' is-drop-target' : ''}`}
      role="tablist"
      aria-label="Chart tabs"
      onDragOver={(event) => {
        if (!hasTab(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setDropBefore(targetOf(event));
      }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropBefore(undefined); }}
      onDrop={(event) => {
        const id = event.dataTransfer.getData(tabDragType);
        setDropBefore(undefined);
        if (!id) return;
        event.preventDefault();
        dockTab(id, targetOf(event));
      }}
    >
      {tabs.map((candidate) => (
        <TabLabel
          key={candidate.id}
          tab={candidate}
          charts={charts}
          popout={list.find((popout) => popout.tabId === candidate.id)}
          isActive={candidate.id === shownTabId}
          isDropBefore={dropBefore === candidate.id}
          onDragDone={() => setDropBefore(undefined)}
        />
      ))}
      {tabs.length > 0 && <button className={`chart-bar-add${dropBefore === null ? ' is-drop-before' : ''}`} title="New tab with a copy of the active chart" aria-label="New tab" onClick={openTab}>+</button>}
    </nav>
  );
}

export function ChartWorkspace() {
  const tabs = useStore(workspace, marketTabs);
  const activeId = useStore(workspace, (state) => activeTab(state)?.id);
  const isChartBarShown = useStore(workspace, (state) => state.isChartBarShown);
  const replayTabId = useStore(replay, (state) => state.session?.tabId);
  const replayPurpose = useStore(replay, (state) => state.session?.purpose);
  const isBacktestMode = useStore(workspace, (state) => state.isBacktestMode);
  const isRailShown = useStore(workspace, (state) => state.isAnalysisMode || state.isTradeDrawingToolbarShown);
  const poppedIds = useStore(popouts, (state) => state.list.map((popout) => popout.tabId));
  const body = useRef<HTMLDivElement>(null);
  const shownBefore = useRef<string | undefined>(undefined);
  const docked = tabs.filter((candidate) => !poppedIds.includes(candidate.id));
  const tabId = dockedTabId(docked.map((candidate) => candidate.id), activeId, shownBefore.current);
  const tab = docked.find((candidate) => candidate.id === tabId);
  useEffect(() => { shownBefore.current = tabId; });

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
        {isRailShown && docked.length > 0 && <DrawingRail overlay={body} />}
        <ChartLayout tabs={docked} tab={tab}>
          {!tabs.length && <p className="empty">Drag a symbol from Market Watch here, or use File &gt; New Chart</p>}
          {tabs.length > 0 && !docked.length && <p className="empty">Every tab is in its own window. Drag one back onto the tab bar, or right-click it and choose Return to Main Window.</p>}
        </ChartLayout>
        {isBacktestMode && (replayPurpose === undefined || replayPurpose === 'backtest' && replayTabId === tab?.id) && <BacktestTransport />}
      </div>
      {replayPurpose === 'replay' && replayTabId === tab?.id && <ReplayToolbar />}
      {isChartBarShown && <TabBar tabs={tabs} shownTabId={tab?.id} />}
    </div>
  );
}
