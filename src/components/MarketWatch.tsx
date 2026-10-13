import { Component, useCallback, useState } from 'react';
import type { SymbolSpec } from '../../shared/protocol';
import { newOrder, toggleDepth, togglePanel } from '../lib/commands';
import { formatClock, formatPrice } from '../lib/format';
import { session, setSymbolVisible, log, watchlist } from '../lib/session';
import { useStore } from '../lib/store';
import { openChart, openDialog } from '../lib/workspace';
import { applyWatchlist, restoreWatchlists, saveWatchlist, watchlistScope, watchlistStorageKey, type WatchlistPreset } from '../lib/watchlist-presets';
import { ContextMenu, type ContextMenuState } from './ContextMenu';
import { Panel } from './Panel';

const tabs = ['Symbols', 'Details'] as const;

interface QuoteRowProps {
  spec: SymbolSpec;
  isSelected: boolean;
  onSelect: () => void;
  onMenu: (event: React.MouseEvent) => void;
}

function QuoteRow({ spec, isSelected, onSelect, onMenu }: QuoteRowProps) {
  const tick = useStore(session, (state) => state.ticks[spec.name]);
  const direction = useStore(session, (state) => state.directions[spec.name] ?? 'flat');
  const spread = tick ? Math.round((tick.ask - tick.bid) / spec.point) : spec.spread;
  return (
    <tr
      className={`quote-row is-${direction}${isSelected ? ' is-selected' : ''}`}
      onMouseDown={onSelect}
      onDoubleClick={() => newOrder(spec.name)}
      onContextMenu={onMenu}
      draggable
      onDragStart={(event) => event.dataTransfer.setData('text/x-terminal5-symbol', spec.name)}
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

export function MarketWatch() {
  const symbols = useStore(session, watchlist);
  const all = useStore(session, (state) => state.symbols);
  const [tab, setTab] = useState<(typeof tabs)[number]>('Symbols');
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const time = useStore(session, (state) => Math.max(0, ...Object.values(state.ticks).map((tick) => tick.time)));

  const hide = (name: string) => setSymbolVisible(name, false).catch((error: Error) => log(`cannot hide ${name}: ${error.message}`));

  const addSymbol = () => {
    const name = query.trim().toUpperCase();
    if (!name) {
      return;
    }
    if (!all[name]) {
      log(`symbol ${name} not found`);
      return;
    }
    void setSymbolVisible(name, true).catch((error: Error) => log(`cannot show ${name}: ${error.message}`));
    setQuery('');
  };

  const openMenu = (event: React.MouseEvent, name: string) => {
    event.preventDefault();
    setSelected(name);
    setMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        { label: 'New Order', shortcut: 'F9', action: () => newOrder(name) },
        { label: 'Chart Window', action: () => openChart(name) },
        { label: 'Depth of Market', shortcut: 'Alt+B', action: () => toggleDepth(name) },
        { label: 'Specification...', action: () => openDialog({ kind: 'specification', symbol: name }) },
        { label: '', isSeparator: true },
        { label: 'Hide', action: () => hide(name) },
        { label: 'Symbols...', shortcut: 'Ctrl+U', action: () => openDialog({ kind: 'symbols' }) },
      ],
    });
  };

  return (
    <Panel title={`Market Watch: ${time ? formatClock(time) : '--:--:--'}`} onClose={() => togglePanel('isMarketWatchShown')}>
      <MarketWatchSets />
      {tab === 'Symbols' ? (
        <div className="scroll">
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
              {symbols.map((spec) => (
                <QuoteRow key={spec.name} spec={spec} isSelected={selected === spec.name} onSelect={() => setSelected(spec.name)} onMenu={(event) => openMenu(event, spec.name)} />
              ))}
              <tr className="quote-add">
                <td colSpan={5}>
                  <input
                    value={query}
                    list="terminal5-symbols"
                    placeholder="+ click to add"
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && addSymbol()}
                  />
                  <datalist id="terminal5-symbols">
                    {Object.values(all)
                      .filter((spec) => !spec.visible)
                      .map((spec) => (
                        <option key={spec.name} value={spec.name}>
                          {spec.description}
                        </option>
                      ))}
                  </datalist>
                </td>
              </tr>
            </tbody>
          </table>
          <div className="panel-footer">{symbols.length} / {Object.keys(all).length}</div>
        </div>
      ) : (
        <div className="scroll">
          <SymbolDetails spec={selected ? all[selected] : symbols[0]} />
        </div>
      )}
      <div className="panel-tabs">
        {tabs.map((name) => (
          <button key={name} className={tab === name ? 'is-active' : ''} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </div>
      {menu && <ContextMenu menu={menu} onClose={closeMenu} />}
    </Panel>
  );
}


interface WatchSetsState {
  name: string;
  error: string;
  presets: WatchlistPreset[];
  isBusy: boolean;
}

class MarketWatchSets extends Component<Record<string, never>, WatchSetsState> {
  state: WatchSetsState = { name: '', error: '', presets: [], isBusy: false };
  private unsubscribe?: () => void;
  private isActive = false;

  componentDidMount() {
    this.isActive = true;
    this.unsubscribe = session.subscribe(() => this.forceUpdate());
    try {
      const raw = localStorage.getItem(watchlistStorageKey);
      this.setState({ presets: raw ? restoreWatchlists(JSON.parse(raw)) : [] });
    } catch (reason) { this.fail(reason); }
  }

  componentWillUnmount() {
    this.isActive = false;
    this.unsubscribe?.();
  }

  private scope = () => {
    const current = session.get();
    return current.account ? watchlistScope(current.link.url, current.profileId ?? `${current.account.login}:${current.account.server}`) : '';
  };

  private fail = (reason: unknown) => {
    if (this.isActive) this.setState({ error: reason instanceof Error ? reason.message : 'Market Watch set failed.', isBusy: false });
  };

  private save = () => {
    try {
      const presets = saveWatchlist(this.state.presets, this.scope(), this.state.name, watchlist(session.get()).map((spec) => spec.name));
      localStorage.setItem(watchlistStorageKey, JSON.stringify(presets));
      this.setState({ presets, error: '' });
    } catch (reason) { this.fail(reason); }
  };

  private apply = async () => {
    const scope = this.scope();
    const preset = this.state.presets.find((entry) => entry.scope === scope && entry.name === this.state.name);
    if (!preset) { this.fail(new Error('Select a saved set for this account.')); return; }
    this.setState({ isBusy: true, error: '' });
    try {
      await applyWatchlist(preset, scope, Object.values(session.get().symbols), setSymbolVisible, this.scope);
      if (this.isActive) this.setState({ isBusy: false });
    } catch (reason) { this.fail(reason); }
  };

  private remove = () => {
    try {
      const scope = this.scope();
      const presets = this.state.presets.filter((entry) => entry.scope !== scope || entry.name !== this.state.name);
      localStorage.setItem(watchlistStorageKey, JSON.stringify(presets));
      this.setState({ presets, name: '', error: '' });
    } catch (reason) { this.fail(reason); }
  };

  render() {
    const { name, error, presets, isBusy } = this.state;
    const scope = this.scope();
    const available = presets.filter((preset) => preset.scope === scope);
    const hasSet = available.some((preset) => preset.name === name);
    return (
      <div className="panel-footer">
        <label>Set <input aria-label="Market Watch set name" value={name} list="terminal5-watch-sets" placeholder="Name" disabled={isBusy} style={{ width: 80 }} onChange={(event) => this.setState({ name: event.target.value })} /></label>
        <datalist id="terminal5-watch-sets">{available.map((preset) => <option key={preset.name} value={preset.name} />)}</datalist>
        <button disabled={!scope || isBusy} onClick={this.save}>Save</button>
        <button disabled={!hasSet || isBusy} onClick={this.apply}>{isBusy ? 'Applying…' : 'Apply'}</button>
        <button disabled={!hasSet || isBusy} onClick={this.remove}>Delete</button>
        {error && <p role="alert" className="is-loss">{error}</p>}
      </div>
    );
  }
}
