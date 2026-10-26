import { useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import {
  closeActiveChart,
  newOrder,
  setChartType,
  setTimeframe,
  showToolbox,
  toggleDepth,
  toggleFullScreen,
  toggleOneClick,
  togglePanel,
  zoom,
} from '../lib/commands';
import { indicatorMenuItems, studyTitle } from '../lib/indicator-menu';
import { listThemes } from '@meridian/charts/themes';
import { setThemePreference, systemThemeId } from '../lib/theme';
import { useStore } from '../lib/store';
import { appZoom, stepAppZoom } from '../lib/app-zoom';
import { zoomSteps } from '../../shared/zoom';
import { useWatchedSpecs } from '../lib/watchlists';
import { drawingsForSymbol, replaceChartObjects, symbolDrawings } from '../lib/symbol-drawings';
import { drawingSyncMenuItems, layoutMenuItems, syncMenuItems, tabTitle } from '../lib/layout-menu';
import { visibleChartIds } from '../lib/chart-tabs';
import {
  activeChart,
  activeTab,
  closeTab,
  focusTab,
  layoutDrawings,
  openTab,
  stepChart,
  toggleMaximized,
  chartTypes,
  tools,
  openChart,
  marketTabs,
  openDialog,
  loadProfile,
  loadTemplate,
  removeProfile,
  toggleAnalysisPositions,
  updateActiveChart,
  workspace,
} from '../lib/workspace';
import { timeframeMenuItems } from '../lib/timeframe-favorites';
import { useIsReplayingChart } from '../lib/replay-session';
import { chooseMode, modeOf, useIsBacktestingChart } from '../lib/backtest/runtime';
import { requestUpdate } from '../lib/updates';
import { Icon } from './ui/Icon';

export interface MenuItem {
  label: string;
  shortcut?: string;
  isChecked?: boolean;
  isDisabled?: boolean;
  isSeparator?: boolean;
  // A star that toggles without closing the menu, as TradingView's timeframe menu has.
  isFavorite?: boolean;
  items?: MenuItem[];
  action?: () => void;
  onToggleFavorite?: () => void;
}

const separator: MenuItem = { label: '', isSeparator: true };

function useMenus(): { label: string; items: MenuItem[] }[] {
  const state = useStore(workspace, (current) => current);
  const zoomFactor = useStore(appZoom, (current) => current.factor);
  const symbols = useWatchedSpecs();
  const chart = activeChart(state);
  const hasChart = chart !== undefined;
  const isReplaying = useIsReplayingChart(chart?.id);
  const isBacktesting = useIsBacktestingChart(chart?.id);
  const symbolObjectCount = useStore(symbolDrawings, (current) => (chart ? drawingsForSymbol(current, chart.symbol).length : 0));
  const tab = activeTab(state);
  const isMultiChart = !!tab && visibleChartIds(tab).length > 1;
  const tabObjectCount = chart ? layoutDrawings(state, chart).length : 0;
  const hasObjects = !!chart?.drawings.length || tabObjectCount > 0 || symbolObjectCount > 0;
  const isAnalysis = state.isAnalysisMode;
  // Analysis mode keeps the menus for charting and drops what places trades or opens terminal panels.
  const unlessAnalysis = (items: MenuItem[]) => isAnalysis ? [] : items;

  return [
    {
      label: 'File',
      items: [
        { label: 'New Chart', items: symbols.map((symbol) => ({ label: symbol.name, action: () => openChart(symbol.name) })) },
        { label: 'Close', shortcut: 'Ctrl+F4', isDisabled: !hasChart, action: closeActiveChart },
        separator,
        { label: 'Profiles', items: [
          { label: 'Save Profile As...', action: () => openDialog({ kind: 'profile' }) },
          ...state.profiles.map((profile) => ({ label: profile.name, isChecked: state.activeProfile === profile.name, action: () => loadProfile(profile.name) })),
          { label: 'Remove Profile', items: state.profiles.filter((profile) => profile.name !== state.activeProfile && profile.name !== 'Default').map((profile) => ({ label: profile.name, action: () => removeProfile(profile.name) })) },
        ] },
        separator,
        { label: 'Import from TradingView...', action: () => openDialog({ kind: 'tradingview' }) },
        separator,
        { label: 'Accounts...', action: () => openDialog({ kind: 'accounts' }) },
        { label: 'Login to Trade Account', action: () => openDialog({ kind: 'login' }) },
        { label: 'Connection...', action: () => openDialog({ kind: 'connection' }) },
        separator,
        { label: 'Exit', action: () => window.close() },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Analysis Mode', shortcut: 'Ctrl+Shift+A', isChecked: modeOf(state) === 'analysis', action: () => chooseMode(modeOf(state) === 'analysis' ? 'trade' : 'analysis') },
        { label: 'Backtest Mode', isChecked: state.isBacktestMode, action: () => chooseMode(state.isBacktestMode ? 'trade' : 'backtest') },
        { label: 'Show Positions in Analysis', isChecked: state.isAnalysisPositionsShown, isDisabled: !isAnalysis, action: toggleAnalysisPositions },
        separator,
        { label: 'Market Watch', shortcut: 'Ctrl+M', isChecked: state.isMarketWatchShown, action: () => togglePanel('isMarketWatchShown') },
        { label: 'Data Window', shortcut: 'Ctrl+D', isChecked: state.isDataWindowShown, action: () => togglePanel('isDataWindowShown') },
        ...unlessAnalysis([
          { label: 'Navigator', shortcut: 'Ctrl+N', isChecked: state.isNavigatorShown, action: () => togglePanel('isNavigatorShown') },
          { label: 'Toolbox', shortcut: 'Ctrl+T', isChecked: state.isToolboxShown, action: () => togglePanel('isToolboxShown') },
          { label: 'Trade Assistant', isChecked: state.isTradeAssistantShown, action: () => togglePanel('isTradeAssistantShown') },
          { label: 'Depth Of Market', shortcut: 'Alt+B', isChecked: state.depthSymbol !== null, action: () => toggleDepth() },
        ]),
        separator,
        { label: 'Status Bar', isChecked: state.isStatusBarShown, action: () => togglePanel('isStatusBarShown') },
        { label: 'Chart Bar', isChecked: state.isChartBarShown, action: () => togglePanel('isChartBarShown') },
        ...unlessAnalysis([{ label: 'Drawing Toolbar', isChecked: state.isTradeDrawingToolbarShown, action: () => togglePanel('isTradeDrawingToolbarShown') }]),
        { label: 'Full Screen', shortcut: 'F11', action: toggleFullScreen },
        { label: `Zoom (${Math.round(zoomFactor * 100)}%)`, items: zoomSteps.map((step) => ({ label: step.label, shortcut: step.shortcut, action: () => stepAppZoom(step.key) })) },
        separator,
        { label: 'Theme', items: [
          { label: 'Match System', isChecked: state.theme === systemThemeId, action: () => setThemePreference(systemThemeId) },
          separator,
          ...listThemes().map((theme) => ({ label: theme.label, isChecked: state.theme === theme.id, action: () => setThemePreference(theme.id) })),
        ] },
      ],
    },
    {
      label: 'Insert',
      items: [
        ...indicatorMenuItems(chart?.id),
        {
          label: 'Objects',
          isDisabled: !hasChart,
          items: tools.filter((tool) => tool.key !== 'cursor' && tool.key !== 'crosshair' && !(isAnalysis && tool.key === 'riskOrder')).map((tool) => ({ label: tool.label, action: () => workspace.set({ tool: tool.key }) })),
        },
      ],
    },
    {
      label: 'Charts',
      items: [
        ...chartTypes.map((type) => ({ label: type.label, shortcut: type.shortcut, isChecked: chart?.type === type.key, isDisabled: !hasChart, action: () => setChartType(type.key) })),
        separator,
        { label: 'Timeframes', isDisabled: !hasChart, items: timeframeMenuItems(chart?.timeframe, setTimeframe) },
        {
          label: 'Indicators List',
          isDisabled: !chart?.indicators.length,
          items: (chart?.indicators ?? []).map((indicator) => ({
            label: `Delete ${studyTitle(indicator.kind)}`,
            action: () => updateActiveChart((current) => ({ indicators: current.indicators.filter((candidate) => candidate.id !== indicator.id) })),
          })),
        },
        { label: 'Templates', isDisabled: !hasChart, items: [
          { label: 'Save Template...', action: () => chart && openDialog({ kind: 'template', chartId: chart.id }) },
          ...state.templates.map((template) => ({ label: template.name, action: () => chart && loadTemplate(chart.id, template.name) })),
          { label: 'Remove Template', items: state.templates.map((template) => ({ label: template.name, action: () => workspace.set({ templates: state.templates.filter((candidate) => candidate.name !== template.name) }) })) },
        ] },
        { label: 'Objects List...', shortcut: 'Ctrl+B', isDisabled: !hasChart, action: () => chart && openDialog({ kind: 'objects', chartId: chart.id }) },
        { label: 'Save Chart Image...', isDisabled: !hasChart, action: () => window.dispatchEvent(new Event('openterm:chart-image')) },
        { label: 'Delete All Objects', isDisabled: !hasObjects, action: () => chart && replaceChartObjects(chart, []) },
        separator,
        { label: 'Grid', shortcut: 'Ctrl+G', isChecked: chart?.isGridShown, isDisabled: !hasChart, action: () => updateActiveChart((current) => ({ isGridShown: !current.isGridShown })) },
        { label: 'Volumes', shortcut: 'Ctrl+L', isChecked: chart?.isVolumeShown, isDisabled: !hasChart, action: () => updateActiveChart((current) => ({ isVolumeShown: !current.isVolumeShown })) },
        separator,
        { label: 'Zoom In', shortcut: '+', isDisabled: !hasChart, action: () => zoom(1.25) },
        { label: 'Zoom Out', shortcut: '-', isDisabled: !hasChart, action: () => zoom(0.8) },
        { label: 'Scroll to End', shortcut: 'End', isDisabled: !hasChart, action: () => zoom(0) },
      ],
    },
    {
      label: 'Tools',
      items: [
        ...(isBacktesting ? [{ label: 'Place Backtest Order', shortcut: 'F9', action: () => newOrder() }] : unlessAnalysis([{ label: 'New Order', shortcut: 'F9', isDisabled: isReplaying, action: () => newOrder() }])),
        { label: 'Backtest Sessions...', action: () => openDialog({ kind: 'backtests' }) },
        { label: 'Price Alerts...', action: () => openDialog({ kind: 'alerts' }) },
        ...unlessAnalysis([{ label: 'One Click Trading', isChecked: state.isOneClickEnabled, action: toggleOneClick }]),
        separator,
        { label: 'Options', shortcut: 'Ctrl+O', action: () => openDialog({ kind: 'connection' }) },
      ],
    },
    {
      label: 'Window',
      items: [
        { label: 'New Tab', isDisabled: !hasChart, action: openTab },
        { label: 'Close Tab', isDisabled: !tab, action: () => tab && closeTab(tab.id) },
        separator,
        { label: 'Layout', isDisabled: !tab, items: tab ? layoutMenuItems(tab) : [] },
        { label: 'Sync in Layout', isDisabled: !tab, items: tab ? syncMenuItems(tab) : [] },
        { label: 'Sync Drawings', items: drawingSyncMenuItems() },
        separator,
        { label: 'Next Chart', shortcut: 'Tab', isDisabled: !isMultiChart, action: () => stepChart(1) },
        { label: 'Previous Chart', shortcut: 'Shift+Tab', isDisabled: !isMultiChart, action: () => stepChart(-1) },
        { label: 'Maximize Chart', shortcut: 'Alt+Enter', isChecked: state.isChartMaximized, isDisabled: !isMultiChart, action: toggleMaximized },
        separator,
        ...marketTabs(state).map((candidate, index) => ({
          label: `${index + 1} ${tabTitle(candidate, state.charts)}${visibleChartIds(candidate).length > 1 ? ` (${visibleChartIds(candidate).length} charts)` : ''}`,
          isChecked: candidate.id === tab?.id,
          action: () => focusTab(candidate.id),
        })),
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Check for Updates', action: () => { showToolbox('journal'); requestUpdate('updates.check', {}); } },
        separator,
        { label: 'About OpenTerm5', action: () => openDialog({ kind: 'about' }) },
      ],
    },
  ];
}

interface MenuListProps {
  items: MenuItem[];
  ref?: Ref<HTMLUListElement>;
  onDone: () => void;
}

export function MenuList({ items, ref, onDone }: MenuListProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  return (
    <ul ref={ref} className="menu-list" role="menu" onMouseDown={(event) => event.stopPropagation()}>
      {items.map((item, index) => (
        <MenuEntry key={`${item.label}-${index}`} item={item} onDone={onDone} isExpanded={activeIndex === index} onExpand={() => setActiveIndex(index)} />
      ))}
    </ul>
  );
}

interface MenuEntryProps {
  item: MenuItem;
  onDone: () => void;
  isExpanded: boolean;
  onExpand: () => void;
}

const menuMargin = 4;

// A submenu opens beside its entry inside the window: to the left when the right has no room, over
// the menu when neither side has, raised to end above the window's bottom, and scrolling when it is
// taller than the window, so a small pop-out window still shows all of it.
function placeSubmenu(entry: HTMLElement, list: HTMLElement): void {
  const view = list.ownerDocument.defaultView;
  if (!view) return;
  Object.assign(list.style, { left: '', right: '', top: '', maxHeight: `${view.innerHeight - 2 * menuMargin}px` });
  const box = list.getBoundingClientRect();
  const anchor = entry.getBoundingClientRect();
  if (box.right > view.innerWidth - menuMargin) {
    if (anchor.left - box.width >= menuMargin) Object.assign(list.style, { left: 'auto', right: '100%' });
    else list.style.left = `${Math.max(menuMargin, view.innerWidth - menuMargin - box.width) - anchor.left}px`;
  }
  if (box.bottom > view.innerHeight - menuMargin) list.style.top = `${Math.max(menuMargin, view.innerHeight - menuMargin - box.height) - anchor.top}px`;
}

function MenuEntry({ item, onDone, isExpanded, onExpand }: MenuEntryProps) {
  const entry = useRef<HTMLLIElement>(null);
  const submenu = useRef<HTMLUListElement>(null);
  // The menu's items are built when it opens, so a star shows its own toggle at once.
  const [isFavorite, setIsFavorite] = useState(item.isFavorite);
  const hasItems = item.items !== undefined && item.items.length > 0;

  useLayoutEffect(() => {
    if (isExpanded && entry.current && submenu.current) placeSubmenu(entry.current, submenu.current);
  }, [isExpanded]);

  if (item.isSeparator) {
    return <li className="menu-separator" role="separator" />;
  }
  return (
    <li
      ref={entry}
      role="menuitem"
      tabIndex={item.isDisabled ? -1 : 0}
      aria-disabled={item.isDisabled}
      aria-haspopup={hasItems ? 'menu' : undefined}
      aria-expanded={hasItems ? isExpanded : undefined}
      className={`menu-entry${item.isDisabled ? ' is-disabled' : ''}${hasItems ? ' has-items' : ''}${isExpanded ? ' is-expanded' : ''}${item.onToggleFavorite ? ' has-favorite' : ''}`}
      onMouseEnter={onExpand}
      onFocus={onExpand}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.click();
        } else if (event.key === 'ArrowRight' && hasItems) {
          event.preventDefault();
          onExpand();
        }
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (item.isDisabled) return;
        if (hasItems) { onExpand(); return; }
        if (!item.action) {
          return;
        }
        onDone();
        item.action();
      }}
    >
      <span className="menu-check">{item.isChecked ? '✓' : ''}</span>
      <span className="menu-label">{item.label}</span>
      <span className="menu-shortcut">{item.shortcut ?? (hasItems ? '▸' : '')}</span>
      {item.onToggleFavorite && (
        <button
          type="button"
          className={`menu-favorite${isFavorite ? ' is-favorite' : ''}`}
          aria-label={isFavorite ? `Remove ${item.label} from favorites` : `Add ${item.label} to favorites`}
          aria-pressed={!!isFavorite}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          onClick={(event) => {
            event.stopPropagation();
            setIsFavorite(!isFavorite);
            item.onToggleFavorite!();
          }}
        >
          <Icon name="star" size={13} />
        </button>
      )}
      {hasItems && !item.isDisabled && <MenuList ref={submenu} items={item.items!} onDone={onDone} />}
    </li>
  );
}

export function MenuBar() {
  const menus = useMenus();
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!bar.current?.contains(event.target as Node)) {
        setOpen(null);
      }
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, []);

  return (
    <div className="menu-bar" ref={bar} role="menubar">
      {menus.map((menu) => (
        <div
          key={menu.label}
          className={`menu-title${open === menu.label ? ' is-open' : ''}`}
          onMouseDown={() => setOpen(open === menu.label ? null : menu.label)}
          onMouseEnter={() => open && setOpen(menu.label)}
        >
          {menu.label}
          {open === menu.label && <MenuList items={menu.items} onDone={() => setOpen(null)} />}
        </div>
      ))}
    </div>
  );
}
