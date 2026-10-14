import { timeframes } from '../../shared/protocol';
import type { MenuItem } from '../components/MenuBar';
import { formatPrice } from './format';
import { indicatorKinds } from './indicators';
import { session } from './session';
import { setChartType, setTimeframe, toggleDepth, zoom } from './commands';
import {
  chartTypes,
  closeChart,
  focusChart,
  maximizeChart,
  minimizeChart,
  openDialog,
  restoreWindows,
  updateChart,
  workspace,
} from './workspace';

const separator: MenuItem = { label: '', isSeparator: true };

function tradingItems(symbol: string, price: number | undefined, digits: number): MenuItem[] {
  const tick = session.get().ticks[symbol];
  const items: MenuItem[] = [
    { label: 'New Order', shortcut: 'F9', action: () => openDialog({ kind: 'order', symbol }) },
    { label: 'Buy by Market', action: () => openDialog({ kind: 'order', symbol, type: 'buy' }) },
    { label: 'Sell by Market', action: () => openDialog({ kind: 'order', symbol, type: 'sell' }) },
  ];
  if (price === undefined || !tick) return items;
  const level = Number(price.toFixed(digits));
  const label = formatPrice(level, digits);
  const pending: MenuItem[] = level < tick.bid
    ? [{ label: `Buy Limit at ${label}`, action: () => openDialog({ kind: 'order', symbol, type: 'buyLimit', price: level }) }, { label: `Sell Stop at ${label}`, action: () => openDialog({ kind: 'order', symbol, type: 'sellStop', price: level }) }]
    : level > tick.ask
      ? [{ label: `Sell Limit at ${label}`, action: () => openDialog({ kind: 'order', symbol, type: 'sellLimit', price: level }) }, { label: `Buy Stop at ${label}`, action: () => openDialog({ kind: 'order', symbol, type: 'buyStop', price: level }) }]
      : [];
  return pending.length ? [...items, separator, ...pending] : items;
}

// Mirrors MT5's chart context menu; window commands are included because the same menu serves the
// chart canvas, its title bar and its tab.
export function chartMenu(chartId: string, price?: number): MenuItem[] {
  focusChart(chartId);
  const state = workspace.get();
  const chart = state.charts.find((candidate) => candidate.id === chartId);
  if (!chart) return [];
  const digits = session.get().symbols[chart.symbol]?.digits ?? 5;
  const others = state.charts.filter((candidate) => candidate.id !== chartId);
  return [
    { label: 'Trading', items: tradingItems(chart.symbol, price, digits) },
    { label: 'Depth of Market', shortcut: 'Alt+B', action: () => toggleDepth(chart.symbol) },
    separator,
    { label: 'Timeframes', items: timeframes.map((timeframe) => ({ label: timeframe.label, isChecked: chart.timeframe === timeframe.label, action: () => setTimeframe(timeframe.label) })) },
    ...chartTypes.map((type) => ({ label: type.label, shortcut: type.shortcut, isChecked: chart.type === type.key, action: () => setChartType(type.key) })),
    separator,
    { label: 'Indicators', items: indicatorKinds.map((kind) => ({ label: kind.label, action: () => openDialog({ kind: 'indicator', chartId, indicator: kind.key }) })) },
    {
      label: 'Indicators List',
      isDisabled: !chart.indicators.length,
      items: chart.indicators.map((indicator) => ({
        label: `Delete ${indicatorKinds.find((kind) => kind.key === indicator.kind)?.label ?? indicator.kind}`,
        action: () => updateChart(chartId, (current) => ({ indicators: current.indicators.filter((candidate) => candidate.id !== indicator.id) })),
      })),
    },
    { label: 'Objects List...', shortcut: 'Ctrl+B', action: () => openDialog({ kind: 'objects', chartId }) },
    { label: 'Template', items: [{ label: 'Save Template...', action: () => openDialog({ kind: 'template', chartId }) }] },
    separator,
    { label: 'Grid', shortcut: 'Ctrl+G', isChecked: chart.isGridShown, action: () => updateChart(chartId, (current) => ({ isGridShown: !current.isGridShown })) },
    { label: 'Volumes', shortcut: 'Ctrl+L', isChecked: chart.isVolumeShown, action: () => updateChart(chartId, (current) => ({ isVolumeShown: !current.isVolumeShown })) },
    { label: 'Zoom In', shortcut: '+', action: () => zoom(1.25) },
    { label: 'Zoom Out', shortcut: '-', action: () => zoom(0.8) },
    { label: 'Save As Picture...', action: () => window.dispatchEvent(new Event('openterm:chart-image')) },
    separator,
    state.layout === 'tabs'
      ? { label: 'Floating Windows', action: restoreWindows }
      : { label: 'Maximize', action: () => maximizeChart(chartId) },
    { label: 'Minimize', action: () => minimizeChart(chartId) },
    { label: 'Close', shortcut: 'Ctrl+F4', action: () => closeChart(chartId) },
    { label: 'Close Other Charts', isDisabled: !others.length, action: () => others.forEach((other) => closeChart(other.id)) },
  ];
}
