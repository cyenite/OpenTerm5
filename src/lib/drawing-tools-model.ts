import type { CursorMode, MagnetMode, MeridianDrawingTools } from '@meridian/charts';

export type SavedDrawingTools = Omit<MeridianDrawingTools, 'tool'>;

// The eraser is left out: a restart that kept it would delete the first drawing clicked.
const savedCursors: readonly CursorMode[] = ['cross', 'dot', 'arrow-cursor'];
const magnets: readonly MagnetMode[] = ['off', 'weak', 'strong'];

export const defaultDrawingTools: SavedDrawingTools = { cursor: 'cross', magnet: 'off', isStayMode: false, isLocked: false, isHidden: false };

export function parseDrawingTools(value: unknown): SavedDrawingTools {
  if (!value || typeof value !== 'object') return defaultDrawingTools;
  const saved = value as Partial<Record<keyof SavedDrawingTools, unknown>>;
  const flag = (key: 'isStayMode' | 'isLocked' | 'isHidden') => typeof saved[key] === 'boolean' ? saved[key] : defaultDrawingTools[key];
  return {
    cursor: savedCursors.find((cursor) => cursor === saved.cursor) ?? defaultDrawingTools.cursor,
    magnet: magnets.find((magnet) => magnet === saved.magnet) ?? defaultDrawingTools.magnet,
    isStayMode: flag('isStayMode'),
    isLocked: flag('isLocked'),
    isHidden: flag('isHidden'),
  };
}

export function savedDrawingTools({ cursor, magnet, isStayMode, isLocked, isHidden }: MeridianDrawingTools): SavedDrawingTools {
  return { cursor, magnet, isStayMode, isLocked, isHidden };
}
