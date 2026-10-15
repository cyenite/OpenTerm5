import { useEffect, useRef, useState } from 'react';
import {
  closeActiveChart,
  newOrder,
  setChartType,
  setTimeframe,
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
import { useWatchedSpecs } from '../lib/watchlists';
import { drawingsForSymbol, replaceChartObjects, symbolDrawings } from '../lib/symbol-drawings';
import { windowArrangements } from '../lib/chart-windows';
import {
  activeChart,
  arrangeIcons,
  arrangeWindows,
  focusChart,
  maximizeChart,
  minimizeChart,
  restoreWindows,
  chartTypes,
  tools,
  openChart,
  openDialog,
  loadProfile,
  loadTemplate,
  removeProfile,
  toggleAnalysisMode,
  toggleAnalysisPositions,
  updateActiveChart,
  workspace,
} from '../lib/workspace';
import { chartTimeframes } from '../lib/mt5-timeframes';

export interface MenuItem {
  label: string;
  shortcut?: string;
  isChecked?: boolean;
  isDisabled?: boolean;
  isSeparator?: boolean;
  items?: MenuItem[];
  action?: () => void;
}

const separator: MenuItem = { label: '', isSeparator: true };

function useMenus(): { label: string; items: MenuItem[] }[] {
  const state = useStore(workspace, (current) => current);
  const symbols = useWatchedSpecs();
  const chart = activeChart(state);
  const hasChart = chart !== undefined;
  const symbolObjectCount = useStore(symbolDrawings, (current) => (chart ? drawingsForSymbol(current, chart.symbol).length : 0));
  const hasObjects = !!chart?.drawings.length || symbolObjectCount > 0;
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
        { label: 'Analysis Mode', shortcut: 'Ctrl+Shift+A', isChecked: isAnalysis, action: toggleAnalysisMode },
        { label: 'Show Positions in Analysis', isChecked: state.isAnalysisPositionsShown, isDisabled: !isAnalysis, action: toggleAnalysisPositions },
        separator,
        { label: 'Market Watch', shortcut: 'Ctrl+M', isChecked: state.isMarketWatchShown, action: () => togglePanel('isMarketWatchShown') },
        { label: 'Data Window', shortcut: 'Ctrl+D', isChecked: state.isDataWindowShown, action: () => togglePanel('isDataWindowShown') },
        ...unlessAnalysis([
          { label: 'Navigator', shortcut: 'Ctrl+N', isChecked: state.isNavigatorShown, action: () => togglePanel('isNavigatorShown') },
          { label: 'Toolbox', shortcut: 'Ctrl+T', isChecked: state.isToolboxShown, action: () => togglePanel('isToolboxShown') },
          { label: 'Depth Of Market', shortcut: 'Alt+B', isChecked: state.depthSymbol !== null, action: () => toggleDepth() },
        ]),
        separator,
        { label: 'Status Bar', isChecked: state.isStatusBarShown, action: () => togglePanel('isStatusBarShown') },
        { label: 'Chart Bar', isChecked: state.isChartBarShown, action: () => togglePanel('isChartBarShown') },
        ...unlessAnalysis([{ label: 'Drawing Toolbar', isChecked: state.isTradeDrawingToolbarShown, action: () => togglePanel('isTradeDrawingToolbarShown') }]),
        { label: 'Full Screen', shortcut: 'F11', action: toggleFullScreen },
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
        {
          label: 'Indicators',
          isDisabled: !hasChart,
          items: indicatorMenuItems(chart?.id),
        },
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
        { label: 'Timeframes', isDisabled: !hasChart, items: chartTimeframes.map((timeframe) => ({ label: timeframe.label, isChecked: chart?.timeframe === timeframe.label, action: () => setTimeframe(timeframe.label) })) },
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
        ...unlessAnalysis([{ label: 'New Order', shortcut: 'F9', action: () => newOrder() }]),
        { label: 'Price Alerts...', action: () => openDialog({ kind: 'alerts' }) },
        ...unlessAnalysis([{ label: 'One Click Trading', isChecked: state.isOneClickEnabled, action: toggleOneClick }]),
        separator,
        { label: 'Options', shortcut: 'Ctrl+O', action: () => openDialog({ kind: 'connection' }) },
      ],
    },
    {
      label: 'Window',
      items: [
        ...windowArrangements.map((arrangement) => ({ label: arrangement.label, shortcut: 'shortcut' in arrangement ? arrangement.shortcut : undefined, isDisabled: !hasChart, action: () => arrangeWindows(arrangement.key) })),
        { label: 'Arrange Icons', isDisabled: !hasChart, action: arrangeIcons },
        separator,
        { label: 'Tabbed', isChecked: state.layout === 'tabs', isDisabled: !hasChart, action: () => chart && maximizeChart(chart.id) },
        { label: 'Floating Windows', isChecked: state.layout === 'windows', isDisabled: !hasChart, action: restoreWindows },
        { label: 'Minimize', isDisabled: !hasChart, action: () => chart && minimizeChart(chart.id) },
        separator,
        ...state.charts.map((candidate, index) => ({
          label: `${index + 1} ${candidate.symbol},${candidate.timeframe}${candidate.isMinimized ? ' (minimized)' : ''}`,
          isChecked: candidate.id === chart?.id,
          action: () => focusChart(candidate.id),
        })),
      ],
    },
    { label: 'Help', items: [{ label: 'About OpenTerm5', action: () => openDialog({ kind: 'about' }) }] },
  ];
}

interface MenuListProps {
  items: MenuItem[];
  onDone: () => void;
}

export function MenuList({ items, onDone }: MenuListProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  return (
    <ul className="menu-list" role="menu" onMouseDown={(event) => event.stopPropagation()}>
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

function MenuEntry({ item, onDone, isExpanded, onExpand }: MenuEntryProps) {
  if (item.isSeparator) {
    return <li className="menu-separator" role="separator" />;
  }
  const hasItems = item.items !== undefined && item.items.length > 0;
  return (
    <li
      role="menuitem"
      tabIndex={item.isDisabled ? -1 : 0}
      aria-disabled={item.isDisabled}
      aria-haspopup={hasItems ? 'menu' : undefined}
      aria-expanded={hasItems ? isExpanded : undefined}
      className={`menu-entry${item.isDisabled ? ' is-disabled' : ''}${hasItems ? ' has-items' : ''}${isExpanded ? ' is-expanded' : ''}`}
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
      {hasItems && !item.isDisabled && <MenuList items={item.items!} onDone={onDone} />}
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
