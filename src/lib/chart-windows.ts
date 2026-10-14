export interface ChartFrame {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export const windowArrangements = [
  { key: 'cascade', label: 'Cascade' },
  { key: 'tile', label: 'Tile Windows', shortcut: 'Alt+R' },
  { key: 'tileHorizontally', label: 'Tile Horizontally' },
  { key: 'tileVertically', label: 'Tile Vertically' },
] as const;

export type WindowArrangement = (typeof windowArrangements)[number]['key'];

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const resizeEdges: readonly ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

export const minimumFrame = { width: 0.12, height: 0.14 };

const cascadeStep = 0.035;
const cascadeSize = 0.68;

export function arrangeFrames(count: number, arrangement: WindowArrangement): ChartFrame[] {
  if (count <= 0) return [];
  if (arrangement === 'cascade') {
    const steps = Math.max(1, Math.floor((1 - cascadeSize) / cascadeStep));
    return Array.from({ length: count }, (_, index) => {
      const offset = (index % (steps + 1)) * cascadeStep;
      return { left: offset, top: offset, width: cascadeSize, height: cascadeSize };
    });
  }
  if (arrangement === 'tileHorizontally') return Array.from({ length: count }, (_, index) => ({ left: 0, top: index / count, width: 1, height: 1 / count }));
  if (arrangement === 'tileVertically') return Array.from({ length: count }, (_, index) => ({ left: index / count, top: 0, width: 1 / count, height: 1 }));
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / columns);
    const isLastRow = row === rows - 1;
    const inRow = isLastRow ? count - columns * (rows - 1) : columns;
    const column = index - row * columns;
    return { left: column / inRow, top: row / rows, width: 1 / inRow, height: 1 / rows };
  });
}

export function clampFrame(frame: ChartFrame): ChartFrame {
  const width = Math.min(1, Math.max(minimumFrame.width, frame.width));
  const height = Math.min(1, Math.max(minimumFrame.height, frame.height));
  return {
    width,
    height,
    left: Math.min(1 - width, Math.max(0, frame.left)),
    top: Math.min(1 - height, Math.max(0, frame.top)),
  };
}

export function moveFrame(frame: ChartFrame, deltaX: number, deltaY: number): ChartFrame {
  return clampFrame({ ...frame, left: frame.left + deltaX, top: frame.top + deltaY });
}

// Resizing pins the opposite edge, so a frame dragged past its minimum size stops instead of sliding.
export function resizeFrame(frame: ChartFrame, edge: ResizeEdge, deltaX: number, deltaY: number): ChartFrame {
  let { left, top, width, height } = frame;
  const right = left + width;
  const bottom = top + height;
  if (edge.includes('e')) width = Math.min(1 - left, Math.max(minimumFrame.width, width + deltaX));
  if (edge.includes('s')) height = Math.min(1 - top, Math.max(minimumFrame.height, height + deltaY));
  if (edge.includes('w')) { left = Math.min(right - minimumFrame.width, Math.max(0, left + deltaX)); width = right - left; }
  if (edge.includes('n')) { top = Math.min(bottom - minimumFrame.height, Math.max(0, top + deltaY)); height = bottom - top; }
  return { left, top, width, height };
}

export function isFrame(value: unknown): value is ChartFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Record<string, unknown>;
  return ['top', 'left', 'width', 'height'].every((key) => typeof frame[key] === 'number' && Number.isFinite(frame[key]) && (frame[key] as number) >= 0 && (frame[key] as number) <= 1);
}

export function raise(stack: readonly string[], id: string): string[] {
  return [...stack.filter((candidate) => candidate !== id), id];
}
