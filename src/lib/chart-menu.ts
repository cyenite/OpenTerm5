import type { MenuItem } from '../components/MenuBar';
import { chartInstance } from './chart-instances';
import { themeGroups } from './theme';
import { popoutMenuItems } from './popouts';
import { timeframeMenuItems } from './timeframe-favorites';
import { formatPrice } from './format';
import { log, session } from './session';
import { priceAlerts, updateAlerts } from './price-alerts';
import { chartObjects, replaceChartObjects } from './symbol-drawings';
import { placeBacktestOrder, setChartType, setTimeframe } from './commands';
import { visibleChartIds } from './chart-tabs';
import {
  applyIndicatorsToLayout,
  chartTypes,
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
import { canTradeSymbol, dataOnlyHint } from '../../shared/feeds';
import { feedSymbols } from './feed-symbols';
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
    ...themeGroups(true).flatMap((group, index) => [
      ...(index ? [separator] : []),
      ...group.map((theme) => ({ label: theme.label, isChecked: chart.theme === theme.id, action: () => setChartTheme(chart.id, theme.id) })),
    ]),
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

function addAlert(symbol: string, price: number, digits: number): void {
  const profileId = session.get().profileId;
  const bid = session.get().ticks[symbol]?.bid;
  if (!profileId) return;
  const level = Number(price.toFixed(digits));
  const condition = bid !== undefined && level < bid ? 'bidBelow' : 'bidAbove';
  try {
    updateAlerts([...priceAlerts.get().alerts, { id: crypto.randomUUID(), profileId, symbol, condition, price: level, createdAt: Date.now(), triggeredAt: null, isEnabled: true }]);
    log(`${symbol}: alert added at ${formatPrice(level, digits)}.`, 'Alerts');
  } catch {
    log('The alert could not be saved.', 'Alerts');
  }
}

// TradingView's chart menu: the view, the price under the pointer, trading at it, what is on the
// chart and its settings. Timeframes, chart types, indicators, templates, grid, zoom, replay and
// images are on the chart bar and the menu bar, so they are left out; only what has no other place
// (the chart's own theme and its place in a layout) is kept.
export function chartMenu(chartId: string, price?: number): MenuItem[] {
  focusChart(chartId);
  const state = workspace.get();
  const chart = state.charts.find((candidate) => candidate.id === chartId);
  if (!chart) return [];
  const instance = chartInstance(chartId);
  const digits = session.get().symbols[chart.symbol]?.digits ?? feedSymbols.get().symbols[chart.symbol]?.digits ?? 5;
  const level = price === undefined ? undefined : formatPrice(Number(price.toFixed(digits)), digits);
  const tab = tabOfChart(state, chartId);
  const others = tab ? tab.chartIds.filter((id) => id !== chartId) : [];
  const isMultiChart = !!tab && visibleChartIds(tab).length > 1;
  const hasDrawings = chartObjects(chart).length > 0;
  const view: MenuItem[] = [
    { label: 'Reset Chart View', shortcut: 'Alt+R', action: () => instance?.resetView() },
    ...(level === undefined ? [] : [{ label: `Copy Price ${level}`, action: () => void navigator.clipboard.writeText(level).catch(() => undefined) }]),
    ...(instance?.canPaste() ? [{ label: 'Paste', shortcut: 'Ctrl+V', action: () => instance.paste() }] : []),
  ];
  // Alerts are checked against the broker's quotes, which a data feed's market does not have.
  const alert: MenuItem[] = price !== undefined && session.get().profileId && canTradeSymbol(chart.symbol) ? [{ label: `Add Alert at ${level}`, action: () => addAlert(chart.symbol, price, digits) }] : [];
  // A replaying chart keeps the submenu's place, disabled, so the reason is where trading was; in a
  // running backtest it trades the backtest instead, in either mode.
  const trading: MenuItem[] = isBacktestingChart(chartId)
    ? [{ label: 'Backtest', items: backtestItems(chart.symbol) }]
    : state.isAnalysisMode ? [] : [
      !canTradeSymbol(chart.symbol)
        ? { label: dataOnlyHint(chart.symbol), isDisabled: true }
        : isReplayingChart(replay.get().session, chartId)
          ? { label: replayTradingHint, isDisabled: true }
          : { label: 'Trading', items: tradingItems(chartId, chart.symbol, price, digits) },
    ];
  const layout: MenuItem[] = isMultiChart ? [{
    label: 'Layout',
    items: [
      { label: state.isChartMaximized ? 'Restore Layout' : 'Maximize Chart', shortcut: 'Alt+Enter', action: toggleMaximized },
      { label: 'Move Chart Forward', action: () => moveChart(chartId, 1) },
      { label: 'Move Chart Back', action: () => moveChart(chartId, -1) },
      separator,
      { label: 'Apply Indicators to All Charts', isDisabled: !others.length, action: () => applyIndicatorsToLayout(chartId) },
    ],
  }] : [];
  const groups: MenuItem[][] = [
    view,
    [...alert, ...trading],
    [
      { label: 'Object Tree', isChecked: !!instance?.isObjectTreeShown(), action: () => instance?.toggleObjectTree() },
      {
        label: 'Remove',
        isDisabled: !hasDrawings && !chart.indicators.length,
        items: [
          { label: 'Drawings', isDisabled: !hasDrawings, action: () => replaceChartObjects(chart, []) },
          { label: 'Indicators', isDisabled: !chart.indicators.length, action: () => updateChart(chartId, { indicators: [] }) },
        ],
      },
    ],
    [{ label: 'Theme', items: themeItems(chart) }, ...layout],
    [{ label: 'Settings...', action: () => instance?.openChartSettings() }],
  ];
  return groups.filter((group) => group.length).flatMap((group, index) => index ? [separator, ...group] : group);
}
