import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { chartInstance, chartUi } from '../../lib/chart-instances';
import { tabActiveChartId, visibleChartIds, type ChartTab } from '../../lib/chart-tabs';
import { handleShortcut, handleChartTypingKey } from '../../lib/commands';
import { tabTitle } from '../../lib/layout-menu';
import { dockTab, forgetPopout, popoutModeOf, popouts, registerPopoutWindow, setPopoutMode, tabDragType, type Popout, type PopoutMode } from '../../lib/popouts';
import { replay } from '../../lib/replay';
import { log } from '../../lib/session';
import { useStore } from '../../lib/store';
import { focusChart, marketTabs, workspace } from '../../lib/workspace';
import { BacktestTransport } from '../backtest/BacktestTransport';
import { ChartLayout } from '../ChartWorkspace';
import { ChartTypePicker, IndicatorsButton, SymbolPicker, TimeframePicker, ToolButton, ToolGroup } from '../Toolbar';
import { Icon } from '../ui/Icon';
import { SurfaceProvider, useSurface } from '../ui/Surface';
import { DrawingRail } from './DrawingRail';
import { LayoutPicker } from './LayoutPicker';
import { ReplayToolbar } from './ReplayToolbar';

const copyMark = 'data-openterm-copy';
// A fresh frame name per window: reusing one can hand back a window that is still closing.
let windowCount = 0;

// The pop-out window starts empty: it takes the main window's stylesheets, theme variables and
// platform classes, and keeps taking them, so a theme change or a reloaded stylesheet reaches it.
function mirrorDocument(target: Document): () => void {
  const copyHead = () => {
    target.head.querySelectorAll(`[${copyMark}]`).forEach((node) => node.remove());
    const anchor = target.head.firstChild;
    for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
      const copy = node instanceof HTMLLinkElement ? Object.assign(target.createElement('link'), { rel: 'stylesheet', href: node.href }) : node.cloneNode(true) as Element;
      copy.setAttribute(copyMark, '');
      // Meridian's stylesheet keeps its id, so the engine finds it instead of adding its own.
      target.head.insertBefore(copy, anchor);
    }
  };
  const copyAttributes = () => {
    for (const [source, copy] of [[document.documentElement, target.documentElement], [document.body, target.body]] as const) {
      for (const { name } of [...copy.attributes]) if (!source.hasAttribute(name)) copy.removeAttribute(name);
      for (const { name, value } of [...source.attributes]) copy.setAttribute(name, value);
    }
  };
  copyHead();
  copyAttributes();
  const headObserver = new MutationObserver(copyHead);
  headObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
  const attributeObserver = new MutationObserver(copyAttributes);
  attributeObserver.observe(document.documentElement, { attributes: true });
  attributeObserver.observe(document.body, { attributes: true });
  return () => {
    headObserver.disconnect();
    attributeObserver.disconnect();
  };
}

interface PopoutWindowProps {
  popout: Popout;
  title: string;
  children: ReactNode;
}

// Opens the tab's always-on-top window (the main process recognises the frame name) and renders
// into it. Closing the window returns the tab to the main window.
function PopoutWindow({ popout, title, children }: PopoutWindowProps) {
  const [target, setTarget] = useState<{ view: Window; root: HTMLElement } | null>(null);
  const { tabId } = popout;

  useEffect(() => {
    const { width, height } = popoutModeOf(popout.mode);
    const place = popout.at ? `,left=${Math.round(popout.at.x - 80)},top=${Math.round(popout.at.y - 20)}` : '';
    const view = window.open('', `openterm-pip-${tabId}-${++windowCount}`, `popup,width=${width},height=${height}${place}`);
    if (!view) {
      log('The chart tab could not open in its own window.', 'Charts');
      forgetPopout(tabId);
      return;
    }
    const stopMirror = mirrorDocument(view.document);
    const root = view.document.createElement('div');
    root.className = 'popout-root';
    view.document.body.replaceChildren(root);
    const unregister = registerPopoutWindow(tabId, view);
    const onClose = () => forgetPopout(tabId);
    view.addEventListener('pagehide', onClose);
    setTarget({ view, root });
    return () => {
      view.removeEventListener('pagehide', onClose);
      unregister();
      stopMirror();
      setTarget(null);
      view.close();
    };
  }, [tabId]);

  useEffect(() => {
    if (target) target.view.document.title = title;
  }, [target, title]);

  // A mode keeps the size the user gave the window until the mode changes.
  const shownMode = useRef(popout.mode);
  useEffect(() => {
    if (!target || shownMode.current === popout.mode) return;
    shownMode.current = popout.mode;
    const { width, height } = popoutModeOf(popout.mode);
    target.view.resizeTo(width, height);
  }, [target, popout.mode]);

  if (!target) return null;
  return createPortal(<SurfaceProvider view={target.view}>{children}</SurfaceProvider>, target.root);
}

interface TabHandleProps {
  tab: ChartTab;
  title: string;
}

// The pop-out's own tab: dragged onto the main window's tab bar, it puts the tab back there.
function TabHandle({ tab, title }: TabHandleProps) {
  return (
    <div
      className="popout-tab-handle"
      draggable
      title="Drag onto the main window's tab bar to put this tab back"
      onDragStart={(event) => {
        event.dataTransfer.setData(tabDragType, tab.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
    >
      <Icon name="grip" size={12} />
      <span>{title}</span>
    </div>
  );
}

interface ReturnButtonProps {
  tabId: string;
}

function ReturnButton({ tabId }: ReturnButtonProps) {
  return <ToolButton icon="dock" hint={{ title: 'Return to Main Window', description: 'Close this window and put the tab back in the main window.' }} onClick={() => dockTab(tabId)} />;
}

interface TabPopoutBarProps {
  tab: ChartTab;
  title: string;
}

// Full mode's toolbar: the main toolbar's chart controls for the tab's active chart. Any press in the
// window makes one of its charts the active chart first, so the controls act on it.
function TabPopoutBar({ tab, title }: TabPopoutBarProps) {
  const chartId = tabActiveChartId(tab);
  const ui = useStore(chartUi, (state) => state.byId[chartId]);
  const engine = () => chartInstance(chartId);
  return (
    <div className="toolbar chart-toolbar popout-toolbar" role="toolbar" aria-label="Chart">
      <TabHandle tab={tab} title={title} />
      <span className="toolbar-divider" />
      <SymbolPicker chartId={chartId} />
      <LayoutPicker tabId={tab.id} />
      <span className="toolbar-divider" />
      <TimeframePicker chartId={chartId} />
      <span className="toolbar-divider" />
      <ToolGroup label="Chart">
        <ChartTypePicker chartId={chartId} />
        <IndicatorsButton chartId={chartId} />
      </ToolGroup>
      <span className="toolbar-divider" />
      <ToolGroup label="Edit">
        <ToolButton icon="undo" isDisabled={!ui?.canUndo} hint={{ title: 'Undo', shortcut: 'Ctrl+Z' }} onClick={() => engine()?.undo()} />
        <ToolButton icon="redo" isDisabled={!ui?.canRedo} hint={{ title: 'Redo', shortcut: 'Ctrl+Y' }} onClick={() => engine()?.redo()} />
        <ToolButton icon="objectTree" isActive={!!ui?.isObjectTreeShown} isDisabled={!ui} hint={{ title: 'Object Tree' }} onClick={() => engine()?.toggleObjectTree()} />
        <ToolButton icon="chartSettings" isDisabled={!ui} hint={{ title: 'Chart Settings' }} onClick={() => engine()?.openChartSettings()} />
      </ToolGroup>
      <div className="toolbar-spacer" />
      <ToolButton icon="compress" hint={{ title: 'Lite Mode', description: 'Only the charts, for watching the price.' }} onClick={() => setPopoutMode(tab.id, 'lite')} />
      <ReturnButton tabId={tab.id} />
    </div>
  );
}

interface LiteBarProps {
  tab: ChartTab;
  title: string;
}

const barHeight = 26;
// Below the strip too: on Windows the strip's drag area gets no pointer moves at all.
const revealHeight = 40;
const revealDelay = 150;

// Lite mode's only chrome. The window has no title bar, so its top band always moves the window;
// the strip shows over it while the pointer is at the top. It goes away only on clear signs the
// pointer is elsewhere: a move down onto the charts, a leave from below the strip, or the window
// losing focus. A drag area takes the pointer from the page (on Linux the page is told it left;
// while the window moves it hears nothing), so a leave from the top keeps the strip.
function LiteBar({ tab, title }: LiteBarProps) {
  const view = useSurface();
  const [isShown, setIsShown] = useState(false);

  useEffect(() => {
    let revealTimer = 0;
    let lastY = Infinity;
    const hide = () => {
      view.clearTimeout(revealTimer);
      revealTimer = 0;
      setIsShown(false);
    };
    const onMove = (event: PointerEvent) => {
      lastY = event.clientY;
      if (lastY > revealHeight) hide();
      else if (!revealTimer) revealTimer = view.setTimeout(() => setIsShown(true), revealDelay);
    };
    const onLeave = () => { if (lastY > revealHeight) hide(); };
    view.document.addEventListener('pointermove', onMove);
    view.document.documentElement.addEventListener('pointerleave', onLeave);
    view.addEventListener('blur', hide);
    return () => {
      view.clearTimeout(revealTimer);
      view.document.removeEventListener('pointermove', onMove);
      view.document.documentElement.removeEventListener('pointerleave', onLeave);
      view.removeEventListener('blur', hide);
    };
  }, [view]);

  // The controls are left out while hidden rather than faded: drag areas ignore opacity, and their
  // non-drag holes would make parts of the band refuse to move the window.
  return (
    <>
      <div className="popout-lite-grab" style={{ height: barHeight }} title="Drag to move the window" />
      {isShown && (
        <div className="popout-lite-bar" style={{ height: barHeight }}>
          <TabHandle tab={tab} title={title} />
          <div className="popout-lite-move" />
          <button type="button" className="popout-lite-button" title="Full mode: toolbar, drawing tools and trading panels" aria-label="Full mode" onClick={() => setPopoutMode(tab.id, 'full')}>
            <Icon name="expand" size={13} />
          </button>
          <button type="button" className="popout-lite-button" title="Return to main window" aria-label="Return to main window" onClick={() => dockTab(tab.id)}>
            <Icon name="dock" size={13} />
          </button>
        </div>
      )}
    </>
  );
}

interface PopoutTabProps {
  tab: ChartTab;
  title: string;
  mode: PopoutMode;
}

function PopoutTab({ tab, title, mode }: PopoutTabProps) {
  const body = useRef<HTMLDivElement>(null);
  const replayTabId = useStore(replay, (state) => state.session?.tabId);
  const replayPurpose = useStore(replay, (state) => state.session?.purpose);
  const isFull = mode === 'full';
  const tabId = tab.id;

  // Full mode answers the terminal's shortcuts, as the main window does; Lite only a typed timeframe or symbol.
  useEffect(() => {
    const view = body.current?.ownerDocument.defaultView;
    if (!view) return;
    const onKey = (event: KeyboardEvent) => {
      if (workspace.get().dialog) return;
      if (isFull) handleShortcut(event);
      else {
        const current = workspace.get().tabs.find((candidate) => candidate.id === tabId);
        handleChartTypingKey(event, current && tabActiveChartId(current));
      }
    };
    view.addEventListener('keydown', onKey);
    return () => view.removeEventListener('keydown', onKey);
  }, [isFull, tabId]);

  return (
    <div className={`popout is-${mode}`} onMouseDownCapture={() => focusChart(tabActiveChartId(tab))}>
      {isFull && <TabPopoutBar tab={tab} title={title} />}
      <div ref={body} className="chart-body">
        {isFull && <DrawingRail overlay={body} />}
        <ChartLayout tabs={[tab]} tab={tab} isLite={!isFull} />
        {isFull && replayPurpose === 'backtest' && replayTabId === tab.id && <BacktestTransport />}
      </div>
      {isFull && replayPurpose === 'replay' && replayTabId === tab.id && <ReplayToolbar />}
      {!isFull && <LiteBar tab={tab} title={title} />}
    </div>
  );
}

export function ChartPopouts() {
  const list = useStore(popouts, (state) => state.list);
  const tabs = useStore(workspace, marketTabs);
  const charts = useStore(workspace, (state) => state.charts);

  // A tab closed while popped out, or one of the other market after an account change, takes its
  // window with it.
  useEffect(() => {
    for (const popout of list) if (!tabs.some((tab) => tab.id === popout.tabId)) forgetPopout(popout.tabId);
  }, [list, tabs]);

  return list.map((popout) => {
    const tab = tabs.find((candidate) => candidate.id === popout.tabId);
    if (!tab) return null;
    const title = tabTitle(tab, charts);
    const count = visibleChartIds(tab).length;
    return (
      <PopoutWindow key={popout.tabId} popout={popout} title={`${title}${count > 1 ? ` +${count - 1}` : ''} · OpenTerm5`}>
        <PopoutTab tab={tab} title={title} mode={popout.mode} />
      </PopoutWindow>
    );
  });
}
