import { feedSymbol } from '../../shared/feeds';
import type { MenuItem } from '../components/MenuBar';
import { drawingSyncs, layoutGroups, layoutSyncs, linkGroups } from './chart-layouts';
import { hasSync, tabActiveChartId, visibleChartIds, type ChartTab } from './chart-tabs';
import { activeChart, marketTabs, openTab, openTabCopy, setDrawingSync, setLinkGroup, setTabLayout, toggleLayoutSync, workspace, type ChartConfig, type WorkspaceState } from './workspace';

export function tabTitle(tab: ChartTab, charts: readonly ChartConfig[]): string {
  const chart = charts.find((candidate) => candidate.id === tabActiveChartId(tab));
  return chart ? `${feedSymbol(chart.symbol)},${chart.timeframe}` : 'Empty';
}

export function layoutLabel(tab: ChartTab, charts: readonly ChartConfig[]): string {
  const count = visibleChartIds(tab).length;
  return `${tabTitle(tab, charts)}${count > 1 ? ` (${count} charts)` : ''}`;
}

// A new layout starts blank, on the active chart's symbol alone, or as a copy of an open one with
// its charts, drawings and settings.
export function newLayoutMenuItems(state: WorkspaceState): MenuItem[] {
  return [
    { label: 'Blank Layout', isDisabled: !activeChart(state), action: openTab },
    { label: '', isSeparator: true },
    ...marketTabs(state).map((tab) => ({ label: `Copy of ${layoutLabel(tab, state.charts)}`, action: () => openTabCopy(tab.id) })),
  ];
}

export function layoutMenuItems(tab: ChartTab): MenuItem[] {
  return layoutGroups().map((group) => ({
    label: group.count === 1 ? '1 Chart' : `${group.count} Charts`,
    isChecked: group.layouts.some((layout) => layout.key === tab.layout),
    items: group.layouts.map((layout) => ({ label: layout.label, isChecked: layout.key === tab.layout, action: () => setTabLayout(tab.id, layout.key) })),
  }));
}

export function syncMenuItems(tab: ChartTab): MenuItem[] {
  return layoutSyncs.map((sync) => ({ label: sync.label, isChecked: hasSync(tab, sync.key), action: () => toggleLayoutSync(tab.id, sync.key) }));
}

// Groups only matter while the layout shows several charts and syncs their symbol or interval.
export function isLinkGroupShown(tab: ChartTab): boolean {
  return visibleChartIds(tab).length > 1 && (hasSync(tab, 'symbol') || hasSync(tab, 'interval'));
}

export function linkGroupMenuItems(chart: ChartConfig): MenuItem[] {
  return [
    { label: 'No Group', isChecked: !chart.linkGroup, action: () => setLinkGroup(chart.id, undefined) },
    ...linkGroups.map((group) => ({ label: `${group.label} Group`, isChecked: chart.linkGroup === group.key, action: () => setLinkGroup(chart.id, group.key) })),
  ];
}

export function drawingSyncMenuItems(): MenuItem[] {
  const current = workspace.get().drawingSync;
  return drawingSyncs.map((sync) => ({ label: sync.label, isChecked: sync.key === current, action: () => setDrawingSync(sync.key) }));
}
