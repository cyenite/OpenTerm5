import { useEffect, useRef, useState, type ReactNode } from 'react';
import { handleShortcut } from '../../lib/commands';
import { createPortal } from 'react-dom';
import { chartInstance, chartUi } from '../../lib/chart-instances';
import { log } from '../../lib/session';
import { dockChart, popoutModeOf, popoutModes, popouts, registerPopoutWindow, setPopoutMode, type Popout, type PopoutMode } from '../../lib/popouts';
import { useStore } from '../../lib/store';
import { activeChart, focusChart, workspace, type ChartConfig } from '../../lib/workspace';
import { ChartTypePicker, IndicatorsButton, SymbolPicker, TimeframePicker, ToolButton, ToolGroup } from '../Toolbar';
import { Segmented } from '../ui/Controls';
import { Icon } from '../ui/Icon';
import { SurfaceProvider } from '../ui/Surface';
import { ChartWindow } from './ChartWindow';
import { DrawingRail } from './DrawingRail';

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

// Opens the chart's always-on-top window (the main process recognises the frame name) and renders
// into it. Closing the window returns the chart to its layout.
function PopoutWindow({ popout, title, children }: PopoutWindowProps) {
  const [target, setTarget] = useState<{ view: Window; root: HTMLElement } | null>(null);
  const { chartId } = popout;

  useEffect(() => {
    const { width, height } = popoutModeOf(popout.mode);
    const view = window.open('', `openterm-pip-${chartId}-${++windowCount}`, `popup,width=${width},height=${height}`);
    if (!view) {
      log('The chart could not open in its own window.', 'Charts');
      dockChart(chartId);
      return;
    }
    const stopMirror = mirrorDocument(view.document);
    const root = view.document.createElement('div');
    root.className = 'popout-root';
    view.document.body.replaceChildren(root);
    const unregister = registerPopoutWindow(chartId, view);
    const onClose = () => dockChart(chartId);
    view.addEventListener('pagehide', onClose);
    setTarget({ view, root });
    return () => {
      view.removeEventListener('pagehide', onClose);
      unregister();
      stopMirror();
      setTarget(null);
      view.close();
    };
  }, [chartId]);

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

interface ModeSwitchProps {
  chartId: string;
  mode: PopoutMode;
}

function ModeSwitch({ chartId, mode }: ModeSwitchProps) {
  return <Segmented label="Window mode" value={mode} options={popoutModes} onChange={(next) => setPopoutMode(chartId, next)} />;
}

interface ChartPopoutBarProps {
  chart: ChartConfig;
}

// Full mode's toolbar: the main toolbar's chart controls, which act on the active chart. Any press
// in the window makes this chart the active one first.
function ChartPopoutBar({ chart }: ChartPopoutBarProps) {
  const ui = useStore(chartUi, (state) => state.byId[chart.id]);
  const engine = () => chartInstance(chart.id);
  return (
    <div className="toolbar chart-toolbar popout-toolbar" role="toolbar" aria-label="Chart">
      <SymbolPicker chartId={chart.id} />
      <span className="toolbar-divider" />
      <TimeframePicker chartId={chart.id} />
      <span className="toolbar-divider" />
      <ToolGroup label="Chart">
        <ChartTypePicker chartId={chart.id} />
        <IndicatorsButton chartId={chart.id} />
      </ToolGroup>
      <span className="toolbar-divider" />
      <ToolGroup label="Edit">
        <ToolButton icon="undo" isDisabled={!ui?.canUndo} hint={{ title: 'Undo', shortcut: 'Ctrl+Z' }} onClick={() => engine()?.undo()} />
        <ToolButton icon="redo" isDisabled={!ui?.canRedo} hint={{ title: 'Redo', shortcut: 'Ctrl+Y' }} onClick={() => engine()?.redo()} />
        <ToolButton icon="objectTree" isActive={!!ui?.isObjectTreeShown} isDisabled={!ui} hint={{ title: 'Object Tree' }} onClick={() => engine()?.toggleObjectTree()} />
        <ToolButton icon="chartSettings" isDisabled={!ui} hint={{ title: 'Chart Settings' }} onClick={() => engine()?.openChartSettings()} />
      </ToolGroup>
      <div className="toolbar-spacer" />
      <ModeSwitch chartId={chart.id} mode="full" />
      <ToolButton icon="dock" hint={{ title: 'Return to Layout', description: 'Close this window and show the chart in its layout again.' }} onClick={() => dockChart(chart.id)} />
    </div>
  );
}

interface LiteControlsProps {
  chartId: string;
}

// Lite mode has no toolbar: these show over the chart's top right corner while the pointer is in the window.
function LiteControls({ chartId }: LiteControlsProps) {
  return (
    <div className="popout-lite-controls">
      <ModeSwitch chartId={chartId} mode="lite" />
      <button type="button" className="popout-lite-dock" title="Return to layout" aria-label="Return to layout" onClick={() => dockChart(chartId)}>
        <Icon name="dock" size={14} />
      </button>
    </div>
  );
}

interface PopoutChartProps {
  chart: ChartConfig;
  mode: PopoutMode;
}

function PopoutChart({ chart, mode }: PopoutChartProps) {
  const body = useRef<HTMLDivElement>(null);
  const isActive = useStore(workspace, (state) => activeChart(state)?.id === chart.id);
  const isFull = mode === 'full';

  // Full mode answers the terminal's shortcuts, as the main window does.
  useEffect(() => {
    const view = body.current?.ownerDocument.defaultView;
    if (!isFull || !view) return;
    const onKey = (event: KeyboardEvent) => { if (!workspace.get().dialog) handleShortcut(event); };
    view.addEventListener('keydown', onKey);
    return () => view.removeEventListener('keydown', onKey);
  }, [isFull]);

  return (
    <div className={`popout is-${mode}`} onMouseDownCapture={() => focusChart(chart.id)}>
      {isFull && <ChartPopoutBar chart={chart} />}
      <div ref={body} className="chart-body">
        {isFull && <DrawingRail overlay={body} />}
        <div className="chart-area">
          <ChartWindow chart={chart} isActive={isActive} isLite={!isFull} />
        </div>
      </div>
      {!isFull && <LiteControls chartId={chart.id} />}
    </div>
  );
}

export function ChartPopouts() {
  const list = useStore(popouts, (state) => state.list);
  const charts = useStore(workspace, (state) => state.charts);

  // A chart closed while popped out (its tab closed, a workspace loaded) takes its window with it.
  useEffect(() => {
    for (const popout of list) if (!charts.some((chart) => chart.id === popout.chartId)) dockChart(popout.chartId);
  }, [list, charts]);

  return list.map((popout) => {
    const chart = charts.find((candidate) => candidate.id === popout.chartId);
    if (!chart) return null;
    return (
      <PopoutWindow key={popout.chartId} popout={popout} title={`${chart.symbol} ${chart.timeframe} · OpenTerm5`}>
        <PopoutChart chart={chart} mode={popout.mode} />
      </PopoutWindow>
    );
  });
}
