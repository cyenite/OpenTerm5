import { listThemes } from '@meridian/charts/themes';
import type { MenuItem } from '../components/MenuBar';
import { chartInstance } from './chart-instances';
import { popoutMenuItems } from './popouts';
import { timeframeMenuItems } from './timeframe-favorites';
import { formatPrice } from './format';
import { indicatorMenuItems, studyTitle } from './indicator-menu';
import { session } from './session';
import { placeBacktestOrder, setChartType, setTimeframe, toggleDepth, zoom } from './commands';
import { visibleChartIds } from './chart-tabs';
import { isLinkGroupShown, layoutMenuItems, linkGroupMenuItems, syncMenuItems } from './layout-menu';
import {
  applyIndicatorsToLayout,
  chartTypes,
  closeChart,
  focusChart,
  moveChart,
  openDialog,
  setChartTheme,
  tabOfChart,
  toggleMaximized,
  updateChart,
  workspace,
  type ChartConfig,
} from './workspace';
import { isReplayingChart, replay, replayTradingHint } from './replay-session';
import { activeBacktest, backtest, closeBacktestPositions, isBacktestingChart, reportBacktest } from './backtest/runtime';

const separator: MenuItem = { label: '', isSeparator: true };

function tradingItems(chartId: string, symbol: string, price: number | undefined, digits: number): MenuItem[] {
  const tick = session.get().ticks[symbol];
  const items: MenuItem[] = [
    { label: 'New Order', shortcut: 'F9', action: () => openDialog({ kind: 'order', symbol, chartId }) },
    { label: 'Buy by Market', action: () => openDialog({ kind: 'order', symbol, chartId, type: 'buy' }) },
    { label: 'Sell by Market', action: () => openDialog({ kind: 'order', symbol, chartId, type: 'sell' }) },
  ];
  if (price === undefined || !tick) return items;
  const level = Number(price.toFixed(digits));
  const label = formatPrice(level, digits);
  const pending: MenuItem[] = level < tick.bid
    ? [{ label: `Buy Limit at ${label}`, action: () => openDialog({ kind: 'order', symbol, chartId, type: 'buyLimit', price: level }) }, { label: `Sell Stop at ${label}`, action: () => openDialog({ kind: 'order', symbol, chartId, type: 'sellStop', price: level }) }]
    : level > tick.ask
      ? [{ label: `Sell Limit at ${label}`, action: () => openDialog({ kind: 'order', symbol, chartId, type: 'sellLimit', price: level }) }, { label: `Buy Stop at ${label}`, action: () => openDialog({ kind: 'order', symbol, chartId, type: 'buyStop', price: level }) }]
      : [];
  return pending.length ? [...items, separator, ...pending] : items;
}

// The backtest's entries in place of the live Trading submenu. Orders are planned on the chart
// with the Risk Order tool.
function backtestItems(symbol: string): MenuItem[] {
  const positions = activeBacktest(backtest.get())?.book.positions.filter((position) => position.symbol === symbol) ?? [];
  return [
    { label: 'Place Order', shortcut: 'F9', action: placeBacktestOrder },
    { label: `Close All ${symbol}`, isDisabled: !positions.length, action: () => reportBacktest(closeBacktestPositions((position) => position.symbol === symbol)) },
  ];
}

function themeItems(chart: ChartConfig): MenuItem[] {
  return [
    { label: 'Match Application', isChecked: !chart.theme, action: () => setChartTheme(chart.id, undefined) },
    separator,
    ...listThemes().map((theme) => ({ label: theme.label, isChecked: chart.theme === theme.id, action: () => setChartTheme(chart.id, theme.id) })),
  ];
}

const chartTypeItems = (chart: ChartConfig): MenuItem[] => chartTypes.map((type) => ({ label: type.label, shortcut: type.shortcut, isChecked: chart.type === type.key, action: () => setChartType(type.key) }));

// A Lite pop-out can be made small, so its menu keeps to watching the price: what is charted, how it
// looks and where the window goes. Everything else is a switch to Full away.
export function liteChartMenu(chartId: string): MenuItem[] {
  focusChart(chartId);
  const state = workspace.get();
  const chart = state.charts.find((candidate) => candidate.id === chartId);
  const tab = tabOfChart(state, chartId);
  if (!chart || !tab) return [];
  return [
    { label: 'Timeframes', items: timeframeMenuItems(chart.timeframe, setTimeframe) },
    { label: 'Chart Type', items: chartTypeItems(chart) },
    { label: 'Theme', items: themeItems(chart) },
    { label: 'Reset Chart View', shortcut: 'Alt+R', action: () => chartInstance(chartId)?.resetView() },
    separator,
    ...popoutMenuItems(tab.id),
  ];
}

// Mirrors MT5's chart context menu, with TradingView's layout commands in place of MT5's window
// commands.
export function chartMenu(chartId: string, price?: number): MenuItem[] {
  focusChart(chartId);
  const state = workspace.get();
  const chart = state.charts.find((candidate) => candidate.id === chartId);
  if (!chart) return [];
  const digits = session.get().symbols[chart.symbol]?.digits ?? 5;
  const tab = tabOfChart(state, chartId);
  const others = tab ? tab.chartIds.filter((id) => id !== chartId) : [];
  const isMultiChart = !!tab && visibleChartIds(tab).length > 1;
  const layout: MenuItem[] = tab ? [
    { label: 'Layout', items: layoutMenuItems(tab) },
    { label: 'Sync in Layout', items: syncMenuItems(tab) },
    ...(isLinkGroupShown(tab) ? [{ label: 'Sync Group', items: linkGroupMenuItems(chart) }] : []),
    { label: 'Move Chart', isDisabled: !isMultiChart, items: [{ label: 'Forward', action: () => moveChart(chartId, 1) }, { label: 'Back', action: () => moveChart(chartId, -1) }] },
    { label: state.isChartMaximized ? 'Restore Layout' : 'Maximize Chart', shortcut: 'Alt+Enter', isDisabled: !isMultiChart, action: toggleMaximized },
    { label: 'Apply Indicators to All Charts', isDisabled: !others.length, action: () => applyIndicatorsToLayout(chartId) },
  ] : [];
  // A replaying chart keeps the submenu's place, disabled, so the reason is where trading was; in a
  // running backtest it trades the backtest instead, in either mode.
  const isBacktesting = isBacktestingChart(chartId);
  const trading: MenuItem[] = isBacktesting
    ? [{ label: 'Backtest', items: backtestItems(chart.symbol) }, separator]
    : state.isAnalysisMode ? [] : [
      isReplayingChart(replay.get().session, chartId)
        ? { label: replayTradingHint, isDisabled: true }
        : { label: 'Trading', items: tradingItems(chartId, chart.symbol, price, digits) },
      { label: 'Depth of Market', shortcut: 'Alt+B', action: () => toggleDepth(chart.symbol) },
      separator,
    ];
  return [
    ...trading,
    { label: 'Timeframes', items: timeframeMenuItems(chart.timeframe, setTimeframe) },
    ...chartTypeItems(chart),
    separator,
    { label: 'Indicators', items: indicatorMenuItems(chartId) },
    {
      label: 'Indicators List',
      isDisabled: !chart.indicators.length,
      items: chart.indicators.map((indicator) => ({
        label: `Delete ${studyTitle(indicator.kind)}`,
        action: () => updateChart(chartId, (current) => ({ indicators: current.indicators.filter((candidate) => candidate.id !== indicator.id) })),
      })),
    },
    { label: 'Objects List...', shortcut: 'Ctrl+B', action: () => openDialog({ kind: 'objects', chartId }) },
    { label: 'Template', items: [{ label: 'Save Template...', action: () => openDialog({ kind: 'template', chartId }) }] },
    { label: 'Theme', items: themeItems(chart) },
    separator,
    { label: 'Grid', shortcut: 'Ctrl+G', isChecked: chart.isGridShown, action: () => updateChart(chartId, (current) => ({ isGridShown: !current.isGridShown })) },
    { label: 'Volumes', shortcut: 'Ctrl+L', isChecked: chart.isVolumeShown, action: () => updateChart(chartId, (current) => ({ isVolumeShown: !current.isVolumeShown })) },
    { label: 'Zoom In', shortcut: '+', action: () => zoom(1.25) },
    { label: 'Zoom Out', shortcut: '-', action: () => zoom(0.8) },
    { label: 'Save As Picture...', action: () => window.dispatchEvent(new Event('openterm:chart-image')) },
    separator,
    ...layout,
    separator,
    { label: 'Close', shortcut: 'Ctrl+F4', action: () => closeChart(chartId) },
    { label: 'Close Other Charts', isDisabled: !others.length, action: () => others.forEach((other) => closeChart(other)) },
  ];
}
