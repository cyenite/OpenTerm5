import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chartLayouts, defaultSizes, layoutCells, layoutCount, layoutDividers, layoutForCount, layoutGroups, layoutOf, maximumCharts, minimumShare, resizeLayout, restoreLayoutKey, restoreSizes, slotCount, visualOrder, type CellRect } from './chart-layouts';

const near = (left: number, right: number) => Math.abs(left - right) < 1e-9;
const area = (cells: readonly CellRect[]) => cells.reduce((sum, cell) => sum + cell.width * cell.height, 0);
const overlaps = (left: CellRect, right: CellRect) => left.left + left.width > right.left + 1e-9 && right.left + right.width > left.left + 1e-9 && left.top + left.height > right.top + 1e-9 && right.top + right.height > left.top + 1e-9;

test('every layout tiles the area exactly once with one cell per slot', () => {
  assert.equal(new Set(chartLayouts.map((layout) => layout.key)).size, chartLayouts.length);
  for (const layout of chartLayouts) {
    const cells = layoutCells(layout.tree, defaultSizes(layout.tree));
    const count = slotCount(layout.tree);
    assert.equal(cells.filter(Boolean).length, count, layout.key);
    assert.ok(near(area(cells), 1), layout.key);
    cells.forEach((cell, index) => cells.slice(index + 1).forEach((other) => assert.ok(!overlaps(cell, other), `${layout.key} slots overlap`)));
  }
  assert.equal(chartLayouts.length, 55);
  assert.equal(maximumCharts, 16);
});

test('grid slots fill down each column first, so a grown layout keeps its first charts on the left', () => {
  const cells = layoutCells(layoutOf('4').tree, defaultSizes(layoutOf('4').tree));
  assert.deepEqual(cells.map((cell) => [cell.left, cell.top]), [[0, 0], [0, 0.5], [0.5, 0], [0.5, 0.5]]);
  assert.deepEqual(visualOrder(cells), [0, 2, 1, 3]);
});

test('the picker groups layouts by chart count in declaration order', () => {
  const groups = layoutGroups();
  assert.deepEqual(groups.map((group) => group.count), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16]);
  assert.deepEqual(groups[2].layouts.map((layout) => layout.key), ['3h', '3v', '3s', '3r', '2-1', '1-2']);
  assert.equal(groups.flatMap((group) => group.layouts).length, chartLayouts.length);
});

test('a chart count maps to the first layout holding it, stepping down past missing counts', () => {
  assert.equal(layoutForCount(1), 's');
  assert.equal(layoutForCount(4), '4');
  assert.equal(layoutForCount(11), '10c5');
  assert.equal(layoutForCount(40), '16c8');
  assert.equal(layoutForCount(0), 's');
  assert.equal(restoreLayoutKey('2-2-r'), '2-2-r');
  assert.equal(restoreLayoutKey('3-3'), '6');
  assert.equal(restoreLayoutKey('13x'), '12c6');
  assert.equal(restoreLayoutKey(null), 's');
  assert.equal(layoutCount(restoreLayoutKey('9q')), 9);
});

test('dividing a split resizes only its two neighbours and never below the minimum share', () => {
  const { tree } = layoutOf('3h');
  const sizes = defaultSizes(tree);
  const [first] = layoutDividers(tree, sizes);
  const wider = resizeLayout(tree, sizes, first, 0.1);
  assert.ok(near(wider[0].fraction, 1 / 3 + 0.1));
  assert.ok(near(wider[1].fraction, 1 / 3 - 0.1));
  assert.ok(near(wider[2].fraction, 1 / 3));
  const squeezed = resizeLayout(tree, sizes, first, 5);
  assert.ok(near(squeezed[1].fraction, minimumShare));
  assert.ok(near(squeezed[0].fraction + squeezed[1].fraction, 2 / 3));
});

test('shift-dragging moves the matching divider of sibling splits together', () => {
  const { tree } = layoutOf('4');
  const sizes = defaultSizes(tree);
  const dividers = layoutDividers(tree, sizes);
  assert.equal(dividers.length, 3);
  const topColumns = dividers.find((divider) => divider.axis === 'columns' && divider.path.join() === '0')!;
  const alone = layoutCells(tree, resizeLayout(tree, sizes, topColumns, 0.2));
  assert.ok(near(alone[2].left, 0.7));
  assert.ok(near(alone[3].left, 0.5), 'the bottom row stays put without Shift');
  const linked = layoutCells(tree, resizeLayout(tree, sizes, topColumns, 0.2, true));
  assert.ok(near(linked[2].left, 0.7));
  assert.ok(near(linked[3].left, 0.7));
});

test('saved sizes are normalised, and a shape that does not fit the layout falls back to equal shares', () => {
  const { tree } = layoutOf('3s');
  assert.deepEqual(restoreSizes([{ fraction: 1 }, { fraction: 3, children: [{ fraction: 1 }, { fraction: 1 }] }], tree), [{ fraction: 0.25 }, { fraction: 0.75, children: [{ fraction: 0.5 }, { fraction: 0.5 }] }]);
  assert.deepEqual(restoreSizes([{ fraction: 1 }], tree), defaultSizes(tree));
  assert.deepEqual(restoreSizes([{ fraction: -1 }, { fraction: 1, children: [] }], tree), defaultSizes(tree));
  assert.deepEqual(restoreSizes([{ fraction: 1 }, { fraction: 1, children: 'bad' }], tree), [{ fraction: 0.5 }, { fraction: 0.5, children: [{ fraction: 0.5 }, { fraction: 0.5 }] }]);
  assert.deepEqual(restoreSizes('anything', layoutOf('s').tree), []);
});
