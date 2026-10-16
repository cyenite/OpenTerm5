import { useEffect, useRef, type RefObject } from 'react';
import { DrawingToolbar, ensureStyles, meridianUiVariables, type ToolbarState } from '@meridian/charts';
import { chartInstance, chartUi } from '../../lib/chart-instances';
import { drawingTools, setDrawingTools, toggleDrawingFavorite } from '../../lib/drawing-tools';
import { useStore } from '../../lib/store';
import { themeStore } from '../../lib/theme';
import { activeChart, workspace } from '../../lib/workspace';

interface DrawingRailProps {
  // Where flyouts and the favourites bar open: the whole chart body, so they can cover the charts.
  overlay: RefObject<HTMLDivElement | null>;
}

const activeEngine = () => chartInstance(activeChart(workspace.get())?.id);

// The one drawing rail of the layout, as TradingView has it: Meridian's own toolbar, mounted once
// beside the charts instead of inside each. Removing and the object tree act on the active chart.
export function DrawingRail({ overlay }: DrawingRailProps) {
  const host = useRef<HTMLDivElement>(null);
  const rail = useRef<DrawingToolbar | null>(null);
  const tools = useStore(drawingTools, (state) => state);
  const theme = useStore(themeStore, (state) => state.theme);
  const activeId = useStore(workspace, (state) => activeChart(state)?.id);
  const isObjectTreeShown = useStore(chartUi, (state) => !!(activeId && state.byId[activeId]?.isObjectTreeShown));
  const state: ToolbarState = { ...tools, isObjectTreeShown };
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!host.current || !overlay.current) return;
    ensureStyles(document);
    const toolbar = new DrawingToolbar(host.current, overlay.current, {
      selectTool: (tool) => setDrawingTools({ tool }),
      selectCursor: (cursor) => setDrawingTools({ cursor, tool: null }),
      setMagnet: (magnet) => setDrawingTools({ magnet }),
      toggleStayMode: () => setDrawingTools({ isStayMode: !drawingTools.get().isStayMode }),
      toggleLock: () => setDrawingTools({ isLocked: !drawingTools.get().isLocked }),
      toggleHidden: () => setDrawingTools({ isHidden: !drawingTools.get().isHidden }),
      toggleFavorite: toggleDrawingFavorite,
      removeDrawings: () => activeEngine()?.removeAllDrawings(),
      removeStudies: () => activeEngine()?.removeAllStudies(),
      toggleObjectTree: () => activeEngine()?.toggleObjectTree(),
    }, stateRef.current);
    toolbar.setVisible(true);
    rail.current = toolbar;
    return () => {
      toolbar.destroy();
      rail.current = null;
    };
  }, [overlay]);

  useEffect(() => {
    rail.current?.update(state);
    rail.current?.setVisible(true);
  }, [tools, isObjectTreeShown]);

  useEffect(() => {
    const element = overlay.current;
    if (!element) return;
    for (const [name, value] of Object.entries(meridianUiVariables(theme))) element.style.setProperty(name, value);
  }, [overlay, theme]);

  return <div ref={host} className="drawing-rail" />;
}
