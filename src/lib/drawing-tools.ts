import { drawingFavorites, saveDrawingFavorites, type MeridianChart, type MeridianDrawingTools } from '@meridian/charts';
import { Store } from './store';
import { tools, workspace } from './workspace';

// One drawing rail serves every chart, as in TradingView: the tool, cursor, magnet and the lock,
// hide and stay-in-drawing-mode switches are the same on every chart, so a drawing goes on
// whichever chart is clicked. A change made on one chart (its keyboard shortcuts, or a drawing
// finishing) reaches the others through here.

export interface DrawingToolsState extends MeridianDrawingTools {
  readonly favorites: readonly string[];
}

const engines = new Set<MeridianChart>();

export const drawingTools = new Store<DrawingToolsState>({ tool: null, cursor: 'cross', magnet: 'off', isStayMode: false, isLocked: false, isHidden: false, favorites: drawingFavorites() });

export function setDrawingTools(patch: Partial<MeridianDrawingTools>): void {
  drawingTools.set(patch);
  engines.forEach((engine) => engine.setDrawingTools(patch));
}

export function toggleDrawingFavorite(type: string): void {
  const { favorites } = drawingTools.get();
  const next = favorites.includes(type) ? favorites.filter((candidate) => candidate !== type) : [...favorites, type];
  saveDrawingFavorites(next);
  drawingTools.set({ favorites: next });
}

export function attachDrawingTools(engine: MeridianChart): () => void {
  const { favorites, ...shared } = drawingTools.get();
  engines.add(engine);
  engine.setDrawingTools(shared);
  const unsubscribe = engine.onDrawingToolsChange((next) => {
    const current = drawingTools.get();
    const changed = Object.fromEntries(Object.entries(next).filter(([key, value]) => current[key as keyof MeridianDrawingTools] !== value));
    if (Object.keys(changed).length) setDrawingTools(changed);
  });
  return () => {
    unsubscribe();
    engines.delete(engine);
  };
}

// The terminal's own quick tools (Insert menu, shortcuts) pick a rail tool; when the rail moves
// on to something else, the quick tool goes back to the cursor.
let appTool = workspace.get().tool;
workspace.subscribe(() => {
  const next = workspace.get().tool;
  if (next === appTool) return;
  appTool = next;
  const drawing = tools.find((candidate) => candidate.key === next)?.drawing ?? null;
  if (drawing || drawingTools.get().tool !== null) setDrawingTools({ tool: drawing });
});
drawingTools.subscribe(() => {
  const drawing = tools.find((candidate) => candidate.key === appTool)?.drawing;
  if (!drawing || drawingTools.get().tool === drawing) return;
  // Recorded first, so the workspace listener above does not take the rail's new tool away.
  appTool = 'cursor';
  workspace.set({ tool: 'cursor' });
});
