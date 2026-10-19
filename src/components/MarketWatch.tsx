import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AccountSignIn, SymbolSpec } from '../../shared/protocol';
import { newOrder, showSymbol, toggleDepth, togglePanel } from '../lib/commands';
import { formatClock, formatPrice } from '../lib/format';
import { session, signingIn, signInName } from '../lib/session';
import { useStore } from '../lib/store';
import { openChart, openDialog, workspace } from '../lib/workspace';
import type { WatchRow } from '../lib/watchlist-model';
import {
  addToWatchlist, addWatchSection, deleteActiveWatchlist, duplicateActiveWatchlist, moveWatchEntry, newWatchlist, removeFromWatchlist,
  removeWatchSection, renameActiveWatchlist, renameWatchSection, rowsOf, selectWatchlist, sortActiveWatchlist, toggleWatchSection,
  useActiveWatchlist, watchedSpecs, watchlists,
} from '../lib/watchlists';
import type { MenuItem } from './MenuBar';
import { openContextMenu, openMenuAt } from '../lib/context-menu';
import { Panel } from './Panel';
import { SymbolSearch } from './SymbolSearch';
import { SigningIn } from './ui/SigningIn';

const tabs = ['Symbols', 'Details'] as const;
const entryType = 'text/x-openterm-watch-entry';

type DropSide = 'before' | 'after';

interface DragProps {
  dropSide: DropSide | null;
  onDragStart: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
  onDragEnd: () => void;
}

const dropClass = (side: DropSide | null) => (side ? ` is-drop-${side}` : '');

interface QuoteRowProps extends DragProps {
  spec: SymbolSpec;
  isSelected: boolean;
  onSelect: () => void;
  onMenu: (event: React.MouseEvent) => void;
}

function QuoteRow({ spec, isSelected, dropSide, onSelect, onMenu, onDragStart, onDragOver, onDrop, onDragEnd }: QuoteRowProps) {
  const tick = useStore(session, (state) => state.ticks[spec.name]);
  const direction = useStore(session, (state) => state.directions[spec.name] ?? 'flat');
  const spread = tick ? Math.round((tick.ask - tick.bid) / spec.point) : spec.spread;
  return (
    <tr
      data-key={spec.name}
      className={`quote-row is-${direction}${isSelected ? ' is-selected' : ''}${dropClass(dropSide)}`}
      onMouseDown={onSelect}
      onDoubleClick={() => workspace.get().isAnalysisMode ? showSymbol(spec.name) : newOrder(spec.name)}
      onContextMenu={onMenu}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData('text/x-openterm-symbol', spec.name);
        onDragStart(event);
      }}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <td className="quote-symbol">
        <span className="quote-arrow">{direction === 'up' ? '▲' : direction === 'down' ? '▼' : '◆'}</span>
        {spec.name}
      </td>
      <td className="num quote-price">{formatPrice(tick?.bid, spec.digits)}</td>
      <td className="num quote-price">{formatPrice(tick?.ask, spec.digits)}</td>
      <td className="num">{spread}</td>
      <td className="num is-muted">{tick ? formatClock(tick.time) : ''}</td>
    </tr>
  );
}

interface MissingRowProps extends DragProps {
  name: string;
  signIn: AccountSignIn | null;
  isSelected: boolean;
  isOffline: boolean;
  onSelect: () => void;
  onMenu: (event: React.MouseEvent) => void;
}

function MissingRow({ name, signIn, isSelected, isOffline, dropSide, onSelect, onMenu, onDragStart, onDragOver, onDrop, onDragEnd }: MissingRowProps) {
  return (
    <tr
      data-key={name}
      className={`quote-row is-missing${isSelected ? ' is-selected' : ''}${dropClass(dropSide)}`}
      title={signIn ? `Quotes appear once ${signInName(signIn)} has signed in` : isOffline ? 'Quotes appear once an account is connected' : 'This account does not offer this symbol under any name'}
      onMouseDown={onSelect}
      onContextMenu={onMenu}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <td className="quote-symbol">
        <span className="quote-arrow">◆</span>
        {name}
      </td>
      <td className="num" />
      <td className="num" />
      <td className="num" />
      <td className="num is-muted">{isOffline ? '' : 'n/a'}</td>
    </tr>
  );
}

interface SectionRowProps extends DragProps {
  row: Extract<WatchRow, { kind: 'section' }>;
  isEditing: boolean;
  onEdit: (isEditing: boolean) => void;
  onMenu: (event: React.MouseEvent) => void;
}

function SectionRow({ row, isEditing, dropSide, onEdit, onMenu, onDragStart, onDragOver, onDrop, onDragEnd }: SectionRowProps) {
  const { entry, count } = row;
  return (
    <tr
      className={`watch-section${entry.isCollapsed ? ' is-collapsed' : ''}${dropClass(dropSide)}`}
      onContextMenu={onMenu}
      draggable={!isEditing}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
    >
      <td colSpan={5}>
        {isEditing ? (
          <NameEditor initial={entry.name} label="Section name" onDone={(name) => {
            if (name !== null) renameWatchSection(entry.id, name);
            onEdit(false);
          }} />
        ) : (
          <button type="button" className="watch-section-toggle" aria-expanded={!entry.isCollapsed} title="Click to fold, double-click to rename" onClick={() => toggleWatchSection(entry.id)} onDoubleClick={() => onEdit(true)}>
            <span className="watch-section-caret" aria-hidden>▾</span>
            <span className="watch-section-name">{entry.name}</span>
            <span className="watch-section-count">{count}</span>
          </button>
        )}
      </td>
    </tr>
  );
}

interface NameEditorProps {
  initial: string;
  label: string;
  placeholder?: string;
  onDone: (name: string | null) => void;
}

// Commits on Enter or blur, cancels on Escape. A rejected name keeps the editor open with the reason.
function NameEditor({ initial, label, placeholder, onDone }: NameEditorProps) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const commit = () => {
    if (!value.trim() || value.trim() === initial) return onDone(null);
    try {
      onDone(value);
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  return (
    <span className="watch-name-editor">
      <input
        autoFocus
        value={value}
        aria-label={label}
        placeholder={placeholder}
        maxLength={64}
        aria-invalid={!!error}
        title={error || undefined}
        onFocus={(event) => event.target.select()}
        onChange={(event) => { setValue(event.target.value); setError(''); }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') onDone(null);
        }}
        onBlur={commit}
      />
      {error && <span role="alert" className="watch-name-error">{error}</span>}
    </span>
  );
}

interface DetailsProps {
  spec: SymbolSpec | undefined;
}

function SymbolDetails({ spec }: DetailsProps) {
  if (!spec) {
    return <p className="empty">Select a symbol</p>;
  }
  const rows: [string, string | number][] = [
    ['Description', spec.description],
    ['Path', spec.path],
    ['Digits', spec.digits],
    ['Contract size', spec.contractSize],
    ['Spread', spec.isSpreadFloat ? 'floating' : spec.spread],
    ['Stops level', spec.stopsLevel],
    ['Margin currency', spec.currencyMargin],
    ['Profit currency', spec.currencyProfit],
    ['Minimal volume', spec.volumeMin],
    ['Maximal volume', spec.volumeMax],
    ['Volume step', spec.volumeStep],
    ['Swap long', spec.swapLong],
    ['Swap short', spec.swapShort],
    ['Trade', spec.tradeMode],
  ];
  return (
    <table className="grid details">
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th>{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type Editing = { kind: 'create' } | { kind: 'rename' } | { kind: 'section'; at?: number } | { kind: 'sectionName'; id: string };

interface WatchlistBarProps {
  editing: Editing | null;
  onEdit: (editing: Editing | null) => void;
  onAddSymbol: () => void;
}

function WatchlistBar({ editing, onEdit, onAddSymbol }: WatchlistBarProps) {
  const lists = useStore(watchlists, (state) => state.lists);
  const list = useActiveWatchlist();
  const button = useRef<HTMLButtonElement>(null);

  const openMenu = () => {
    const box = button.current?.getBoundingClientRect();
    if (!box) return;
    openMenuAt(box.left, box.bottom + 2, [
      ...lists.map((item) => ({ label: item.name, isChecked: item.id === list.id, action: () => selectWatchlist(item.id) })),
      { label: '', isSeparator: true },
      { label: 'New Watchlist...', action: () => onEdit({ kind: 'create' }) },
      { label: 'Rename...', action: () => onEdit({ kind: 'rename' }) },
      { label: 'Duplicate', action: duplicateActiveWatchlist },
      { label: 'Add Section...', action: () => onEdit({ kind: 'section' }) },
      { label: 'Sort by Name', isDisabled: list.entries.length < 2, action: sortActiveWatchlist },
      { label: '', isSeparator: true },
      { label: lists.length > 1 ? 'Delete Watchlist' : 'Clear Watchlist', isDisabled: lists.length === 1 && !list.entries.length, action: () => {
        if (window.confirm(lists.length > 1 ? `Delete the watchlist "${list.name}"?` : `Remove every symbol from "${list.name}"?`)) deleteActiveWatchlist();
      } },
    ]);
  };

  const isNaming = editing?.kind === 'create' || editing?.kind === 'rename' || editing?.kind === 'section';
  return (
    <div className="watch-sets">
      <div className="watch-sets-row">
        {isNaming ? (
          <NameEditor
            initial={editing.kind === 'rename' ? list.name : ''}
            label={editing.kind === 'section' ? 'Section name' : 'Watchlist name'}
            placeholder={editing.kind === 'section' ? 'Section name' : 'Watchlist name'}
            onDone={(name) => {
              if (name !== null) {
                if (editing.kind === 'create') newWatchlist(name);
                else if (editing.kind === 'rename') renameActiveWatchlist(name);
                else addWatchSection(name, editing.at);
              }
              onEdit(null);
            }}
          />
        ) : (
          <button ref={button} type="button" className="watch-list-button" aria-haspopup="menu" title="Switch, create or edit watchlists" onClick={openMenu}>
            <span className="watch-list-name">{list.name}</span>
            <span aria-hidden>▾</span>
          </button>
        )}
        <button type="button" title="Add a symbol to this watchlist (or start typing in the list)" onClick={onAddSymbol}>+ Add</button>
      </div>
    </div>
  );
}

export function MarketWatch() {
  const list = useActiveWatchlist();
  const lists = useStore(watchlists, (state) => state.lists);
  const all = useStore(session, (state) => state.symbols);
  const signIn = useStore(session, signingIn);
  const hasCharts = useStore(workspace, (state) => state.charts.length > 0);
  const isAnalysis = useStore(workspace, (state) => state.isAnalysisMode);
  const [tab, setTab] = useState<(typeof tabs)[number]>('Symbols');
  const [selected, setSelected] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ index: number; side: DropSide } | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const search = useRef<SymbolSearch>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const time = useStore(session, (state) => Math.max(0, ...Object.values(state.ticks).map((tick) => tick.time)));
  const symbolCount = useMemo(() => Object.keys(all).length, [all]);
  const rows = rowsOf(list, all);
  const specs = watchedSpecs(list, all);
  const watched = useMemo(() => new Set(specs.map((spec) => spec.name)), [specs]);
  const isOffline = symbolCount === 0;
  const symbolRows = rows.filter((row): row is Extract<WatchRow, { kind: 'symbol' }> => row.kind === 'symbol');
  const keyOf = (row: Extract<WatchRow, { kind: 'symbol' }>) => row.symbol ?? row.name;

  useEffect(() => {
    if (selected) scroller.current?.querySelector(`[data-key="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // Stable, so the search field does not re-render with every quote.
  const pick = useCallback((name: string) => {
    if (!watched.has(name)) addToWatchlist([name]);
    setSelected(name);
  }, [watched]);

  const remove = (name: string) => {
    const index = symbolRows.findIndex((row) => keyOf(row) === name);
    removeFromWatchlist([name]);
    if (selected === name) setSelected(symbolRows[index + 1] ? keyOf(symbolRows[index + 1]) : symbolRows[index - 1] ? keyOf(symbolRows[index - 1]) : null);
  };

  const removeUnused = () => {
    const { positions, orders } = session.get();
    removeFromWatchlist(specs.map((spec) => spec.name).filter((name) => !positions.some((item) => item.symbol === name) && !orders.some((item) => item.symbol === name)));
  };

  const otherLists = (name: string): MenuItem[] => lists.filter((item) => item.id !== list.id).map((item) => ({ label: item.name, action: () => addToWatchlist([name], item.id) }));

  const symbolMenu = (event: React.MouseEvent, row: Extract<WatchRow, { kind: 'symbol' }>) => {
    const name = keyOf(row);
    setSelected(name);
    const others = otherLists(name);
    const isListed = row.symbol !== null;
    openContextMenu(event, [
      ...(isAnalysis ? [] : [{ label: 'New Order', shortcut: 'F9', isDisabled: !isListed, action: () => newOrder(name) }]),
      { label: 'Chart in New Tab', isDisabled: !isListed, action: () => openChart(name) },
      { label: 'Show in Active Chart', isDisabled: !isListed || !hasCharts, action: () => showSymbol(name) },
      ...(isAnalysis ? [] : [{ label: 'Depth of Market', shortcut: 'Alt+B', isDisabled: !isListed, action: () => toggleDepth(name) }]),
      { label: 'Specification...', isDisabled: !isListed, action: () => openDialog({ kind: 'specification', symbol: name }) },
      { label: '', isSeparator: true },
      { label: 'Add to Watchlist', isDisabled: !others.length, items: others },
      { label: 'Add Section Above...', action: () => setEditing({ kind: 'section', at: row.index }) },
      { label: 'Remove', shortcut: 'Del', action: () => remove(name) },
      { label: 'Symbols...', shortcut: 'Ctrl+U', action: () => openDialog({ kind: 'symbols' }) },
    ]);
  };

  const sectionMenu = (event: React.MouseEvent, row: Extract<WatchRow, { kind: 'section' }>) => openContextMenu(event, [
    { label: row.entry.isCollapsed ? 'Expand' : 'Collapse', action: () => toggleWatchSection(row.entry.id) },
    { label: 'Rename...', action: () => setEditing({ kind: 'sectionName', id: row.entry.id }) },
    { label: 'Add Section Above...', action: () => setEditing({ kind: 'section', at: row.index }) },
    { label: '', isSeparator: true },
    { label: 'Remove Section, Keep Symbols', action: () => removeWatchSection(row.entry.id, false) },
    { label: 'Remove Section and Its Symbols', isDisabled: !row.count, action: () => {
      if (window.confirm(`Remove "${row.entry.name}" and its ${row.count} symbol${row.count === 1 ? '' : 's'}?`)) removeWatchSection(row.entry.id, true);
    } },
  ]);

  const drag = (row: WatchRow): DragProps => ({
    dropSide: drop?.index === row.index ? drop.side : null,
    onDragStart: (event) => {
      event.dataTransfer.setData(entryType, String(row.index));
      event.dataTransfer.effectAllowed = 'copyMove';
    },
    onDragOver: (event) => {
      if (!event.dataTransfer.types.includes(entryType)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const box = event.currentTarget.getBoundingClientRect();
      const side: DropSide = event.clientY > box.top + box.height / 2 ? 'after' : 'before';
      if (drop?.index !== row.index || drop.side !== side) setDrop({ side, index: row.index });
    },
    onDrop: (event) => {
      const from = Number(event.dataTransfer.getData(entryType));
      setDrop(null);
      if (!Number.isInteger(from)) return;
      event.preventDefault();
      moveWatchEntry(from, drop?.side === 'after' ? row.index + 1 : row.index);
    },
    onDragEnd: () => setDrop(null),
  });

  const onListKey = (event: React.KeyboardEvent) => {
    if (event.target !== event.currentTarget) return;
    const at = symbolRows.findIndex((row) => keyOf(row) === selected);
    if (event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      search.current?.focusWith(event.key);
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && symbolRows.length) {
      event.preventDefault();
      const next = at < 0 ? 0 : Math.max(0, Math.min(symbolRows.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)));
      setSelected(keyOf(symbolRows[next]));
      // Stepping through the watchlist flips the chart along with it, as in charting apps.
      if (isAnalysis && symbolRows[next].symbol) showSymbol(symbolRows[next].symbol);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && selected && at >= 0) {
      event.preventDefault();
      remove(selected);
    } else if (event.key === 'Enter' && selected && all[selected]) {
      event.preventDefault();
      if (isAnalysis) showSymbol(selected);
      else openChart(selected);
    }
  };

  return (
    <Panel title={`Market Watch: ${time ? formatClock(time) : '--:--:--'}`} dock="marketWatch" onClose={() => togglePanel('isMarketWatchShown')}>
      <WatchlistBar editing={editing} onEdit={setEditing} onAddSymbol={() => { setTab('Symbols'); requestAnimationFrame(() => search.current?.focus()); }} />
      {tab === 'Symbols' ? (
        <div
          ref={scroller}
          className="scroll watch-scroll"
          tabIndex={0}
          aria-label={`Watchlist ${list.name}`}
          onKeyDown={onListKey}
          onContextMenu={(event) => openContextMenu(event, [
            ...(isAnalysis ? [] : [{ label: 'New Order', shortcut: 'F9', action: () => newOrder(selected && all[selected] ? selected : specs[0]?.name) }]),
            { label: 'Add Symbol', action: () => search.current?.focus() },
            { label: 'Add Section...', action: () => setEditing({ kind: 'section' }) },
            { label: 'Sort by Name', isDisabled: list.entries.length < 2, action: sortActiveWatchlist },
            { label: 'Symbols...', shortcut: 'Ctrl+U', action: () => openDialog({ kind: 'symbols' }) },
            { label: 'Remove All Unused', isDisabled: !specs.length, action: removeUnused },
          ])}
        >
          {signIn && <p className="empty"><SigningIn signIn={signIn} /></p>}
          <table className="grid quotes">
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="num">Bid</th>
                <th className="num">Ask</th>
                <th className="num">Spread</th>
                <th className="num">Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (row.kind === 'section') {
                  return <SectionRow key={row.entry.id} row={row} isEditing={editing?.kind === 'sectionName' && editing.id === row.entry.id} onEdit={(isEditing) => setEditing(isEditing ? { kind: 'sectionName', id: row.entry.id } : null)} onMenu={(event) => sectionMenu(event, row)} {...drag(row)} />;
                }
                const key = keyOf(row);
                const spec = row.symbol ? all[row.symbol] : undefined;
                return spec ? (
                  <QuoteRow key={`${row.index}:${key}`} spec={spec} isSelected={selected === key} onSelect={() => setSelected(key)} onMenu={(event) => symbolMenu(event, row)} {...drag(row)} />
                ) : (
                  <MissingRow key={`${row.index}:${key}`} name={row.name} signIn={signIn} isOffline={isOffline} isSelected={selected === key} onSelect={() => setSelected(key)} onMenu={(event) => symbolMenu(event, row)} {...drag(row)} />
                );
              })}
              <tr className="quote-add">
                <td colSpan={5}>
                  <SymbolSearch ref={search} symbols={all} watched={watched} signIn={signIn} onPick={pick} />
                </td>
              </tr>
            </tbody>
          </table>
          <div className="panel-footer">{specs.length} / {symbolCount}</div>
        </div>
      ) : (
        <div className="scroll">
          <SymbolDetails spec={selected ? all[selected] : specs[0]} />
        </div>
      )}
      <div className="panel-tabs">
        {tabs.map((name) => (
          <button key={name} className={tab === name ? 'is-active' : ''} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </div>
    </Panel>
  );
}
