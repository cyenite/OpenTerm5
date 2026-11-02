import { feedSymbol } from '../../shared/feeds';
import type { MenuItem } from '../components/MenuBar';
import { drawingSyncs, layoutGroups, layoutSyncs, linkGroups } from './chart-layouts';
import { hasSync, tabActiveChartId, visibleChartIds, type ChartTab } from './chart-tabs';
import { setDrawingSync, setLinkGroup, setTabLayout, toggleLayoutSync, workspace, type ChartConfig } from './workspace';

export function tabTitle(tab: ChartTab, charts: readonly ChartConfig[]): string {
  const chart = charts.find((candidate) => candidate.id === tabActiveChartId(tab));
  return chart ? `${feedSymbol(chart.symbol)},${chart.timeframe}` : 'Empty';
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
