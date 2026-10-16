// Multi-chart layouts: each layout is a split tree whose leaves are chart slots, and the user's
// divider positions are kept per layout as a tree of fractions mirroring it.

export type SplitAxis = 'columns' | 'rows';

export interface LayoutSplit {
  readonly axis: SplitAxis;
  readonly children: readonly LayoutNode[];
}

export type LayoutNode = number | LayoutSplit;

export interface SplitShare {
  readonly fraction: number;
  readonly children?: SplitSizes;
}

export type SplitSizes = readonly SplitShare[];

export interface CellRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface LayoutDivider {
  readonly axis: SplitAxis;
  readonly index: number;
  readonly offset: number;
  readonly bounds: CellRect;
  readonly path: readonly number[];
}

const columns = (...children: LayoutNode[]): LayoutSplit => ({ axis: 'columns', children });
const rows = (...children: LayoutNode[]): LayoutSplit => ({ axis: 'rows', children });
const slots = (from: number, count: number, step = 1) => Array.from({ length: count }, (_, index) => from + index * step);
const line = (axis: SplitAxis, count: number): LayoutSplit => ({ axis, children: slots(0, count) });

// Slots fill each row first, or each column first. Filling by column keeps the first charts of a
// smaller layout in the left column when the layout grows.
function grid(rowCount: number, columnCount: number, isByColumn: boolean): LayoutSplit {
  return rows(...slots(0, rowCount).map((row) => columns(...slots(0, columnCount).map((column) => isByColumn ? column * rowCount + row : row * columnCount + column))));
}

// Declaration order is the picker's order; the picker groups consecutive layouts by chart count.
// Keys match TradingView's layout ids so layouts stay recognisable across both.
export const chartLayouts = [
  { key: 's', label: 'One chart', tree: 0 },
  { key: '2h', label: 'Two side by side', tree: line('columns', 2) },
  { key: '2v', label: 'Two stacked', tree: line('rows', 2) },
  { key: '3h', label: 'Three side by side', tree: line('columns', 3) },
  { key: '3v', label: 'Three stacked', tree: line('rows', 3) },
  { key: '3s', label: 'One left, two stacked right', tree: columns(0, rows(1, 2)) },
  { key: '3r', label: 'Two stacked left, one right', tree: columns(rows(0, 1), 2) },
  { key: '2-1', label: 'Two above one', tree: rows(columns(0, 2), 1) },
  { key: '1-2', label: 'One above two', tree: rows(0, columns(1, 2)) },
  { key: '4', label: 'Two by two', tree: grid(2, 2, true) },
  { key: '4v', label: 'Four stacked', tree: line('rows', 4) },
  { key: '4h', label: 'Four side by side', tree: line('columns', 4) },
  { key: '4s', label: 'One left, three stacked right', tree: columns(0, rows(1, 2, 3)) },
  { key: '4s-l', label: 'Three stacked left, one right', tree: columns(rows(1, 2, 3), 0) },
  { key: '1-3', label: 'One above three', tree: rows(0, columns(1, 2, 3)) },
  { key: '3-1', label: 'Three above one', tree: rows(columns(0, 1, 2), 3) },
  { key: '2-2-l', label: 'Two columns, two stacked right', tree: columns(0, 1, rows(2, 3)) },
  { key: '2-2-r', label: 'Two stacked left, two columns', tree: columns(rows(0, 1), 2, 3) },
  { key: '2-2', label: 'Two above two stacked', tree: rows(columns(0, 1), rows(2, 3)) },
  { key: '1-4', label: 'One above four', tree: rows(0, columns(1, 2, 3, 4)) },
  { key: '5h', label: 'Five side by side', tree: line('columns', 5) },
  { key: '5v', label: 'Five stacked', tree: line('rows', 5) },
  { key: '5s', label: 'One left, four stacked right', tree: columns(0, rows(1, 2, 3, 4)) },
  { key: '5s-l', label: 'Four stacked left, one right', tree: columns(rows(1, 2, 3, 4), 0) },
  { key: '2-3', label: 'Two above three', tree: rows(columns(0, 1), columns(2, 3, 4)) },
  { key: '3-2', label: 'Three above two', tree: rows(columns(0, 1, 2), columns(3, 4)) },
  { key: '4-1', label: 'Four above one', tree: rows(columns(0, 1, 2, 3), 4) },
  { key: '2-3-l', label: 'Two columns, three stacked right', tree: columns(0, 1, rows(2, 3, 4)) },
  { key: '2-3-r', label: 'Three stacked left, two columns', tree: columns(rows(0, 1, 2), 3, 4) },
  { key: '6', label: 'Two rows of three', tree: grid(2, 3, true) },
  { key: '6h', label: 'Six side by side', tree: line('columns', 6) },
  { key: '6v', label: 'Six stacked', tree: line('rows', 6) },
  { key: '6c', label: 'Three rows of two', tree: grid(3, 2, false) },
  { key: '2-4', label: 'Two above four', tree: rows(columns(0, 1), columns(2, 3, 4, 5)) },
  { key: '4-2', label: 'Four above two', tree: rows(columns(0, 1, 2, 3), columns(4, 5)) },
  { key: '4-3', label: 'Four above three', tree: rows(columns(0, 1, 2, 3), columns(4, 5, 6)) },
  { key: '7h', label: 'Seven side by side', tree: line('columns', 7) },
  { key: '7s', label: 'One left, six stacked right', tree: columns(0, rows(...slots(1, 6))) },
  { key: '8', label: 'Two rows of four', tree: grid(2, 4, true) },
  { key: '8c', label: 'Four rows of two', tree: grid(4, 2, false) },
  { key: '8h', label: 'Eight side by side', tree: line('columns', 8) },
  { key: '8v', label: 'Eight stacked', tree: line('rows', 8) },
  { key: '9s', label: 'Three by three', tree: grid(3, 3, false) },
  { key: '5-4', label: 'Five above four', tree: rows(columns(...slots(0, 5)), columns(...slots(5, 4))) },
  { key: '9h', label: 'Nine side by side', tree: line('columns', 9) },
  { key: '9v', label: 'Nine stacked', tree: line('rows', 9) },
  { key: '10c5', label: 'Two rows of five', tree: grid(2, 5, true) },
  { key: '10h', label: 'Ten side by side', tree: line('columns', 10) },
  { key: '10v', label: 'Ten stacked', tree: line('rows', 10) },
  { key: '12c6', label: 'Two rows of six', tree: grid(2, 6, true) },
  { key: '12c4', label: 'Four rows of three', tree: grid(4, 3, true) },
  { key: '12h', label: 'Twelve side by side', tree: line('columns', 12) },
  { key: '14c7', label: 'Two rows of seven', tree: grid(2, 7, true) },
  { key: '16c8', label: 'Two rows of eight', tree: grid(2, 8, true) },
  { key: '16c4', label: 'Four by four', tree: grid(4, 4, true) },
] as const satisfies readonly { key: string; label: string; tree: LayoutNode }[];

export type LayoutKey = (typeof chartLayouts)[number]['key'];

export type ChartLayout = (typeof chartLayouts)[number];

export const layoutSyncs = [
  { key: 'symbol', label: 'Symbol', description: 'Changing the symbol of one chart changes every chart in its sync group.' },
  { key: 'interval', label: 'Interval', description: 'Changing the timeframe of one chart changes every chart in its sync group.' },
  { key: 'crosshair', label: 'Crosshair', description: 'The other charts show the crosshair at the same time, and at the same price on the same symbol.' },
  { key: 'time', label: 'Time', description: 'Clicking a chart scrolls the other charts to that moment.' },
  { key: 'dateRange', label: 'Date Range', description: 'The other charts show the same dates as the active chart while it scrolls and zooms.' },
] as const;

export type LayoutSync = (typeof layoutSyncs)[number]['key'];

export const linkGroups = [
  { key: 'red', label: 'Red', color: '#f23645' },
  { key: 'green', label: 'Green', color: '#22ab94' },
  { key: 'blue', label: 'Blue', color: '#2962ff' },
  { key: 'amber', label: 'Amber', color: '#ff9800' },
  { key: 'violet', label: 'Violet', color: '#9c27b0' },
] as const;

export type LinkGroup = (typeof linkGroups)[number]['key'];

export const drawingSyncs = [
  { key: 'off', label: 'Off', description: 'New drawings stay on the chart they were drawn on.' },
  { key: 'layout', label: 'This Layout', description: 'New drawings appear on every chart of the same symbol in this tab.' },
  { key: 'global', label: 'All Layouts', description: 'New drawings appear on every chart of the same symbol in every tab.' },
] as const;

export type DrawingSync = (typeof drawingSyncs)[number]['key'];

// A divider never squeezes either neighbour below this share of their split.
export const minimumShare = 0.05;

const isSplit = (node: LayoutNode): node is LayoutSplit => typeof node !== 'number';

export function isLayoutKey(value: unknown): value is LayoutKey {
  return chartLayouts.some((layout) => layout.key === value);
}

export function layoutOf(key: LayoutKey): ChartLayout {
  return chartLayouts.find((layout) => layout.key === key) ?? chartLayouts[0];
}

export function slotCount(node: LayoutNode): number {
  return isSplit(node) ? node.children.reduce<number>((sum, child) => sum + slotCount(child), 0) : 1;
}

export function layoutCount(key: LayoutKey): number {
  return slotCount(layoutOf(key).tree);
}

export const maximumCharts = Math.max(...chartLayouts.map((layout) => slotCount(layout.tree)));

// The picker's rows: consecutive layouts with the same chart count.
export function layoutGroups(): { count: number; layouts: ChartLayout[] }[] {
  const groups: { count: number; layouts: ChartLayout[] }[] = [];
  for (const layout of chartLayouts) {
    const count = slotCount(layout.tree);
    if (groups.at(-1)?.count === count) groups.at(-1)!.layouts.push(layout);
    else groups.push({ count, layouts: [layout] });
  }
  return groups;
}

// The first layout holding `count` charts, or the nearest smaller count that has one.
export function layoutForCount(count: number): LayoutKey {
  for (let wanted = Math.min(maximumCharts, Math.floor(count)); wanted > 1; wanted--) {
    const layout = chartLayouts.find((candidate) => slotCount(candidate.tree) === wanted);
    if (layout) return layout.key;
  }
  return 's';
}

// An unknown id (from a newer version or TradingView) becomes a known layout with as many charts:
// '11x' holds 11, '3-3' holds 6.
export function restoreLayoutKey(value: unknown): LayoutKey {
  if (isLayoutKey(value)) return value;
  if (typeof value !== 'string') return 's';
  const parts = value.match(/^(\d+)-(\d+)/);
  const count = parts ? Number(parts[1]) + Number(parts[2]) : Number(value.match(/^\d+/)?.[0] ?? 1);
  return layoutForCount(count);
}

export function defaultSizes(node: LayoutNode): SplitSizes {
  if (!isSplit(node)) return [];
  return node.children.map((child) => isSplit(child) ? { fraction: 1 / node.children.length, children: defaultSizes(child) } : { fraction: 1 / node.children.length });
}

// Saved sizes that no longer fit the tree (a corrupt or foreign value) fall back to equal shares.
export function restoreSizes(value: unknown, node: LayoutNode): SplitSizes {
  if (!isSplit(node)) return [];
  if (!Array.isArray(value) || value.length !== node.children.length) return defaultSizes(node);
  const fractions = value.map((share) => typeof share === 'object' && share !== null ? (share as Record<string, unknown>).fraction : undefined);
  if (!fractions.every((fraction): fraction is number => typeof fraction === 'number' && Number.isFinite(fraction) && fraction > 0)) return defaultSizes(node);
  const total = fractions.reduce((sum, fraction) => sum + fraction, 0);
  return node.children.map((child, index) => {
    const fraction = fractions[index] / total;
    return isSplit(child) ? { fraction, children: restoreSizes((value[index] as Record<string, unknown>).children, child) } : { fraction };
  });
}

function splitRects(bounds: CellRect, axis: SplitAxis, sizes: SplitSizes): CellRect[] {
  let start = 0;
  return sizes.map((share, index) => {
    const end = index === sizes.length - 1 ? 1 : start + share.fraction;
    const rect = axis === 'columns'
      ? { top: bounds.top, left: bounds.left + start * bounds.width, width: (end - start) * bounds.width, height: bounds.height }
      : { top: bounds.top + start * bounds.height, left: bounds.left, width: bounds.width, height: (end - start) * bounds.height };
    start = end;
    return rect;
  });
}

const whole: CellRect = { top: 0, left: 0, width: 1, height: 1 };

// Each slot's rectangle as fractions of the layout area, indexed by slot.
export function layoutCells(node: LayoutNode, sizes: SplitSizes, bounds: CellRect = whole): CellRect[] {
  const cells: CellRect[] = [];
  const visit = (current: LayoutNode, shares: SplitSizes, rect: CellRect) => {
    if (!isSplit(current)) {
      cells[current] = rect;
      return;
    }
    splitRects(rect, current.axis, shares).forEach((child, index) => visit(current.children[index], shares[index].children ?? [], child));
  };
  visit(node, sizes, bounds);
  return cells;
}

export function layoutDividers(node: LayoutNode, sizes: SplitSizes): LayoutDivider[] {
  const dividers: LayoutDivider[] = [];
  const visit = (current: LayoutNode, shares: SplitSizes, bounds: CellRect, path: number[]) => {
    if (!isSplit(current)) return;
    const rects = splitRects(bounds, current.axis, shares);
    rects.forEach((rect, index) => {
      if (index > 0) dividers.push({ axis: current.axis, index: index - 1, offset: current.axis === 'columns' ? rect.left : rect.top, bounds, path });
      visit(current.children[index], shares[index].children ?? [], rect, [...path, index]);
    });
  };
  visit(node, sizes, whole, []);
  return dividers;
}

// Dividers at the same place in sibling splits, such as the two halves of the middle line of a
// two-by-two grid. Shift-dragging one moves them all.
export function isEquivalentDivider(left: LayoutDivider, right: LayoutDivider): boolean {
  return left.axis === right.axis && left.index === right.index && left.path.length === right.path.length && left.path.slice(0, -1).every((step, index) => step === right.path[index]);
}

function sharesAt(sizes: SplitSizes, path: readonly number[]): SplitSizes {
  return path.reduce<SplitSizes>((shares, step) => shares[step]?.children ?? [], sizes);
}

function replaceAt(sizes: SplitSizes, path: readonly number[], update: (shares: SplitSizes) => SplitSizes): SplitSizes {
  if (!path.length) return update(sizes);
  const [step, ...rest] = path;
  return sizes.map((share, index) => index === step ? { ...share, children: replaceAt(share.children ?? [], rest, update) } : share);
}

// Moves a divider by `delta`, a fraction of its split's extent. Only its two neighbours change, and
// neither shrinks below `minimumShare`. With `isLinked`, equivalent dividers take the same shares.
export function resizeLayout(node: LayoutNode, sizes: SplitSizes, divider: LayoutDivider, delta: number, isLinked = false): SplitSizes {
  const shares = sharesAt(sizes, divider.path);
  const before = shares[divider.index];
  const after = shares[divider.index + 1];
  if (!before || !after) return sizes;
  const pair = before.fraction + after.fraction;
  const fraction = Math.min(pair - minimumShare, Math.max(minimumShare, before.fraction + delta));
  const resized = shares.map((share, index) => index === divider.index ? { ...share, fraction } : index === divider.index + 1 ? { ...share, fraction: pair - fraction } : share);
  let next = replaceAt(sizes, divider.path, () => resized);
  if (!isLinked) return next;
  for (const other of layoutDividers(node, next)) {
    if (other.path.join() === divider.path.join() || !isEquivalentDivider(other, divider)) continue;
    next = replaceAt(next, other.path, (current) => current.length === resized.length ? current.map((share, index) => ({ ...share, fraction: resized[index].fraction })) : current);
  }
  return next;
}

// Slots in reading order (top to bottom, then left to right), for moving between charts.
export function visualOrder(cells: readonly CellRect[]): number[] {
  const epsilon = 1e-6;
  return cells.map((_, slot) => slot).sort((left, right) => cells[left].top - cells[right].top > epsilon ? 1 : cells[right].top - cells[left].top > epsilon ? -1 : cells[left].left - cells[right].left);
}
