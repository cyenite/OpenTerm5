import { useEffect, useMemo, useState } from 'react';
import type { ChartSettings } from '@meridian/charts';
import { tradingViewDrawingId } from '@meridian/charts/interop/tradingview';
import type { TradingViewAccount, TradingViewSkippedLayout, TradingViewSymbol } from '../../../shared/tradingview';
import { importedThemes, removeImportedTheme } from '../../lib/custom-themes';
import { session } from '../../lib/session';
import { useStore } from '../../lib/store';
import { setThemePreference } from '../../lib/theme';
import { applyTradingViewChartSettings, importTradingViewDrawings, importTradingViewTemplates, importTradingViewTheme, signInToTradingView, signOutOfTradingView, tradingViewAccount, tradingViewChartSettings, tradingViewSymbols, tradingViewThemes, type ChartSettingsChoice, type ChartSettingsSummary, type ClockSource, type DrawingImportSummary, type TemplateImportSummary } from '../../lib/tradingview';
import { suggestedSymbol, themeIdentity } from '../../lib/tradingview-model';
import { symbolDrawingIds, symbolDrawings } from '../../lib/symbol-drawings';
import { confirmDeletions, restoreDeletions, startSyncing, stopSyncing, syncedCount, syncNow, tradingViewSync, type LinkStatus, type SyncStartSummary } from '../../lib/tradingview-sync';
import type { SyncLink } from '../../lib/tradingview-sync-model';
import { drawingTemplates } from '../../lib/drawing-templates';
import { chartTypes, closeDialog, workspace } from '../../lib/workspace';
import { Segmented } from '../ui/Controls';
import { Dialog } from './Dialog';


const tabs = [
  { key: 'drawings', label: 'Drawings' },
  { key: 'sync', label: 'Sync' },
  { key: 'templates', label: 'Drawing templates' },
  { key: 'themes', label: 'Chart themes' },
  { key: 'settings', label: 'Chart settings' },
] as const;

type Tab = (typeof tabs)[number]['key'];

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

interface AccountBarProps {
  account: TradingViewAccount | null | undefined;
  onAccount: (account: TradingViewAccount | null) => void;
  onError: (message: string) => void;
}

function AccountBar({ account, onAccount, onError }: AccountBarProps) {
  const [isBusy, setIsBusy] = useState(false);
  const run = (work: () => Promise<TradingViewAccount | null>) => {
    setIsBusy(true);
    onError('');
    work().then(onAccount, (error) => onError(messageOf(error))).finally(() => setIsBusy(false));
  };
  if (account === undefined) return <p className="is-muted">Checking your TradingView sign-in…</p>;
  if (!account) {
    return (
      <div className="stack">
        <p>Sign in to TradingView to copy your drawings, chart themes and chart settings. TradingView's own sign-in page opens in a separate window; OpenTerm5 keeps that session apart from your trading accounts and only reads your layouts, drawings and themes.</p>
        <div className="dialog-actions">
          <button className="is-primary" disabled={isBusy} onClick={() => run(signInToTradingView)}>{isBusy ? 'Waiting for sign-in…' : 'Sign in to TradingView…'}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="tradingview-account">
      <span>Signed in to TradingView as <strong>{account.username}</strong>.</span>
      <button disabled={isBusy} onClick={() => run(() => signOutOfTradingView().then(() => null))}>Sign out</button>
    </div>
  );
}

interface SymbolChoice {
  isChosen: boolean;
  target: string;
}

interface SymbolRowProps {
  symbol: TradingViewSymbol;
  choice: SymbolChoice;
  copiedCount: number;
  isListed: boolean;
  isDisabled: boolean;
  onChange: (choice: SymbolChoice) => void;
}

function SymbolRow({ symbol, choice, copiedCount, isListed, isDisabled, onChange }: SymbolRowProps) {
  const layouts = [...new Set(symbol.sources.map((source) => (source.scope === 'synced' ? 'all layouts' : source.layoutName)))];
  return (
    <tr>
      <td><input type="checkbox" aria-label={`Copy ${symbol.symbol}`} checked={choice.isChosen} disabled={isDisabled} onChange={(event) => onChange({ ...choice, isChosen: event.target.checked })} /></td>
      <td title={layouts.join(', ')}>{symbol.symbol}</td>
      <td>{symbol.count}</td>
      <td className={copiedCount ? undefined : 'is-muted'}>{copiedCount}</td>
      <td><input list="tradingview-targets" aria-label={`Symbol for ${symbol.symbol}`} value={choice.target} disabled={isDisabled || !choice.isChosen} onChange={(event) => onChange({ ...choice, target: event.target.value.trim() })} /></td>
      <td className={isListed ? 'is-muted' : 'is-loss'}>{!choice.target ? 'Enter a symbol' : isListed ? '' : 'Not offered by this account'}</td>
    </tr>
  );
}

interface SkippedLayoutsProps {
  layouts: readonly TradingViewSkippedLayout[];
  // What the layouts would have given, as the sentence names it.
  subject?: string;
}

function SkippedLayouts({ layouts, subject = 'drawings' }: SkippedLayoutsProps) {
  if (!layouts.length) return null;
  return (
    <div className="stack">
      <p className="is-muted">TradingView would not open {layouts.length === 1 ? 'this layout' : `these ${layouts.length} layouts`}, so {layouts.length === 1 ? 'its' : 'their'} {subject} {subject.endsWith('s') ? 'are' : 'is'} left out:</p>
      <ul>{layouts.map((layout) => <li key={layout.layoutName}>{layout.layoutName}: {layout.reason}</li>)}</ul>
    </div>
  );
}

const utcLabel = (offsetMs: number) => {
  const minutes = Math.round(Math.abs(offsetMs) / 60_000);
  const sign = offsetMs < 0 ? '-' : '+';
  return `UTC${sign}${Math.floor(minutes / 60)}${minutes % 60 ? `:${String(minutes % 60).padStart(2, '0')}` : ''}`;
};

interface ClockNoteProps {
  clock: ClockSource;
}

function ClockNote({ clock }: ClockNoteProps) {
  const now = clock.reportedMs === null ? '' : ` (${utcLabel(clock.reportedMs)} now)`;
  if (clock.symbol) return <p className="is-muted">Times follow the broker's server clock{now}, read from {clock.weeks} weeks of {clock.symbol} history, including its daylight saving changes.</p>;
  if (clock.reportedMs !== null) return <p className="is-muted">Times follow the server's reported clock{now}. No forex history was available, so intraday drawings from the other daylight saving season may sit an hour off.</p>;
  return <p className="is-loss">The broker's server clock could not be read, so intraday drawings may be off by its offset from UTC.</p>;
}

interface SummaryProps {
  summary: DrawingImportSummary;
}

function ImportSummary({ summary }: SummaryProps) {
  const copied = summary.count ? `Copied ${summary.count} drawing${summary.count === 1 ? '' : 's'} into ${summary.targets.join(', ')}. They show on every chart of ${summary.targets.length === 1 ? 'that symbol' : 'those symbols'}.` : 'No new drawings were copied.';
  const kept = summary.keptCount ? ` ${summary.keptCount} copied before were left as they are; tick "Replace drawings copied before" to copy them again.` : '';
  return (
    <div className="stack" role="status">
      <p>{copied}{kept}</p>
      {summary.count > 0 && <ClockNote clock={summary.clock} />}
      <SkippedLayouts layouts={summary.skippedLayouts} />
      {summary.skipped.length > 0 && (
        <>
          <p className="is-muted">Not copied:</p>
          <ul>{summary.skipped.map((entry) => <li key={entry.reason}>{entry.count} × {entry.reason}</li>)}</ul>
        </>
      )}
    </div>
  );
}

function DrawingImport() {
  const specs = useStore(session, (state) => state.symbols);
  const hasAccount = useStore(session, (state) => !!state.account);
  const bySymbol = useStore(symbolDrawings, (state) => state.bySymbol);
  const names = useMemo(() => Object.keys(specs).sort(), [specs]);
  const listed = useMemo(() => new Set(names), [names]);
  const copiedIds = useMemo(() => symbolDrawingIds({ bySymbol }), [bySymbol]);
  const [symbols, setSymbols] = useState<readonly TradingViewSymbol[] | null>(null);
  const [skippedLayouts, setSkippedLayouts] = useState<readonly TradingViewSkippedLayout[]>([]);
  const [choices, setChoices] = useState<Record<string, SymbolChoice>>({});
  const [summary, setSummary] = useState<DrawingImportSummary | null>(null);
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);

  const copiedCount = (symbol: TradingViewSymbol) => symbol.ids.filter((id) => copiedIds.has(tradingViewDrawingId(id))).length;
  const newCount = (symbol: TradingViewSymbol) => Math.max(0, symbol.count - copiedCount(symbol));

  const load = () => {
    setIsBusy(true);
    setError('');
    setSummary(null);
    tradingViewSymbols().then(({ symbols: found, skippedLayouts: skipped }) => {
      setSymbols(found);
      setSkippedLayouts(skipped);
      setChoices(Object.fromEntries(found.map((symbol) => [symbol.symbol, { isChosen: newCount(symbol) > 0, target: suggestedSymbol(symbol.symbol, names) }])));
    }, (failure) => setError(messageOf(failure))).finally(() => setIsBusy(false));
  };

  const chosen = (symbols ?? []).filter((symbol) => choices[symbol.symbol]?.isChosen);
  const copyCount = chosen.reduce((total, symbol) => total + (isReplacing ? symbol.count : newCount(symbol)), 0);
  const canImport = !isBusy && hasAccount && copyCount > 0 && chosen.every((symbol) => choices[symbol.symbol].target);
  const isAllChosen = !!symbols?.length && chosen.length === symbols.length;
  const hasCopies = (symbols ?? []).some((symbol) => copiedCount(symbol) > 0);

  const copy = () => {
    setIsBusy(true);
    setError('');
    importTradingViewDrawings(chosen.map((symbol) => ({ symbol, target: choices[symbol.symbol].target })), isReplacing)
      .then(setSummary, (failure) => setError(messageOf(failure)))
      .finally(() => setIsBusy(false));
  };

  return (
    <div className="stack">
      <p className="is-muted">Each TradingView symbol's drawings are copied to the symbol you choose and show on every chart of it. Drawings copied before are left alone, with any changes you made to them; later changes in TradingView are not followed. To keep a symbol's drawings in step both ways, use the Sync tab.</p>
      {!hasAccount && <p className="is-loss">Log in to a trading account first: drawings are placed on its bars using the broker's server clock, which OpenTerm5 reads from the account.</p>}
      {!symbols && <div className="dialog-actions"><button className="is-primary" disabled={isBusy} onClick={load}>{isBusy ? 'Reading your layouts…' : 'Find my drawings'}</button></div>}
      {symbols && !symbols.length && <p>{skippedLayouts.length ? 'The layouts TradingView opened have no drawings.' : 'Your TradingView layouts have no drawings.'}</p>}
      {!summary && <SkippedLayouts layouts={skippedLayouts} />}
      {symbols && symbols.length > 0 && (
        <>
          <datalist id="tradingview-targets">{names.map((name) => <option key={name} value={name} />)}</datalist>
          <div className="scroll" style={{ maxHeight: 280 }}>
            <table className="grid">
              <thead>
                <tr>
                  <th><input type="checkbox" aria-label="Copy every symbol" checked={isAllChosen} disabled={isBusy} onChange={(event) => setChoices((current) => Object.fromEntries(Object.entries(current).map(([key, choice]) => [key, { ...choice, isChosen: event.target.checked }])))} /></th>
                  <th>TradingView symbol</th>
                  <th>Drawings</th>
                  <th>Copied before</th>
                  <th>Copy into</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {symbols.map((symbol) => (
                  <SymbolRow
                    key={symbol.symbol}
                    symbol={symbol}
                    choice={choices[symbol.symbol]}
                    copiedCount={copiedCount(symbol)}
                    isListed={!names.length || listed.has(choices[symbol.symbol].target)}
                    isDisabled={isBusy}
                    onChange={(choice) => setChoices((current) => ({ ...current, [symbol.symbol]: choice }))}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {hasCopies && (
            <label className="check">
              <input type="checkbox" checked={isReplacing} disabled={isBusy} onChange={(event) => setIsReplacing(event.target.checked)} />
              Replace drawings copied before (changes you made to them in OpenTerm5 are lost)
            </label>
          )}
          <div className="dialog-actions">
            <button disabled={isBusy} onClick={load}>Reload</button>
            <button className="is-primary" disabled={!canImport} onClick={copy}>{isBusy ? 'Copying…' : copyCount ? `Copy ${copyCount} ${isReplacing ? '' : 'new '}drawing${copyCount === 1 ? '' : 's'}` : 'Nothing new to copy'}</button>
          </div>
        </>
      )}
      {summary && <ImportSummary summary={summary} />}
      {error && <p role="alert" className="is-loss">{error}</p>}
    </div>
  );
}

const statusLabels: Readonly<Record<LinkStatus['state'], string>> = {
  starting: 'Reading TradingView',
  live: 'In sync',
  saving: 'Saving to TradingView',
  waiting: 'Waiting',
  paused: 'Paused',
  error: 'Not syncing',
};

interface LinkRowProps {
  link: SyncLink;
  status: LinkStatus | undefined;
  count: number;
}

function LinkRow({ link, status, count }: LinkRowProps) {
  const state = status?.state ?? 'starting';
  const isTrouble = state === 'error' || state === 'paused' || state === 'waiting';
  return (
    <>
      <tr>
        <td>{link.tradingView.symbol}</td>
        <td>{link.symbol}</td>
        <td>{count}</td>
        <td className={isTrouble ? 'is-loss' : state === 'live' ? undefined : 'is-muted'}>{statusLabels[state]}</td>
        <td><button onClick={() => syncNow(link.symbol)}>Sync now</button></td>
        <td><button onClick={() => void stopSyncing(link.symbol)}>Stop</button></td>
      </tr>
      {isTrouble && status?.message && (
        <tr>
          <td colSpan={6} className="sync-detail">
            {state === 'paused' && status.heldDeletions ? (
              <div className="dialog-actions">
                <span className="is-muted">{status.heldDeletions} drawings were deleted here at once. Delete them in TradingView too?</span>
                <button onClick={() => restoreDeletions(link.symbol)}>Restore them here</button>
                <button className="is-danger" onClick={() => confirmDeletions(link.symbol)}>Delete in TradingView</button>
              </div>
            ) : <span className="is-muted">{status.message}</span>}
          </td>
        </tr>
      )}
    </>
  );
}

interface SyncChoiceRowProps {
  symbol: TradingViewSymbol;
  choice: SymbolChoice;
  isListed: boolean;
  isDisabled: boolean;
  onChange: (choice: SymbolChoice) => void;
}

function SyncChoiceRow({ symbol, choice, isListed, isDisabled, onChange }: SyncChoiceRowProps) {
  return (
    <tr>
      <td><input type="checkbox" aria-label={`Sync ${symbol.symbol}`} checked={choice.isChosen} disabled={isDisabled} onChange={(event) => onChange({ ...choice, isChosen: event.target.checked })} /></td>
      <td>{symbol.symbol}</td>
      <td>{symbol.count}</td>
      <td><input list="tradingview-sync-targets" aria-label={`Symbol to sync ${symbol.symbol} with`} value={choice.target} disabled={isDisabled || !choice.isChosen} onChange={(event) => onChange({ ...choice, target: event.target.value.trim() })} /></td>
      <td className={isListed ? 'is-muted' : 'is-loss'}>{!choice.target ? 'Enter a symbol' : isListed ? '' : 'Not offered by this account'}</td>
    </tr>
  );
}

interface SyncSummaryProps {
  summary: SyncStartSummary;
}

function SyncSummary({ summary }: SyncSummaryProps) {
  return (
    <div className="stack" role="status">
      <p>Syncing {summary.synced} drawing{summary.synced === 1 ? '' : 's'}.{summary.copiedOnly ? ` ${summary.copiedOnly} saved inside an older TradingView layout were copied but can't sync.` : ''}</p>
      <SkippedLayouts layouts={summary.skippedLayouts} />
      {summary.skipped.length > 0 && (
        <>
          <p className="is-muted">Not synced:</p>
          <ul>{summary.skipped.map((entry) => <li key={entry.reason}>{entry.count} × {entry.reason}</li>)}</ul>
        </>
      )}
    </div>
  );
}

function DrawingSync() {
  const specs = useStore(session, (state) => state.symbols);
  const hasAccount = useStore(session, (state) => !!state.account);
  const links = useStore(tradingViewSync, (state) => state.links);
  const statuses = useStore(tradingViewSync, (state) => state.statuses);
  const names = useMemo(() => Object.keys(specs).sort(), [specs]);
  const listed = useMemo(() => new Set(names), [names]);
  const [symbols, setSymbols] = useState<readonly TradingViewSymbol[] | null>(null);
  const [skippedLayouts, setSkippedLayouts] = useState<readonly TradingViewSkippedLayout[]>([]);
  const [choices, setChoices] = useState<Record<string, SymbolChoice>>({});
  const [summary, setSummary] = useState<SyncStartSummary | null>(null);
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);

  const linkedSymbols = new Set(links.map((link) => link.tradingView.symbol));
  const unlinked = (symbols ?? []).filter((symbol) => !linkedSymbols.has(symbol.symbol));
  const chosen = unlinked.filter((symbol) => choices[symbol.symbol]?.isChosen);
  const canStart = !isBusy && hasAccount && chosen.length > 0 && chosen.every((symbol) => choices[symbol.symbol].target);

  const load = () => {
    setIsBusy(true);
    setError('');
    setSummary(null);
    tradingViewSymbols().then(({ symbols: found, skippedLayouts: skipped }) => {
      setSymbols(found);
      setSkippedLayouts(skipped);
      setChoices(Object.fromEntries(found.map((symbol) => [symbol.symbol, { isChosen: false, target: suggestedSymbol(symbol.symbol, names) }])));
    }, (failure) => setError(messageOf(failure))).finally(() => setIsBusy(false));
  };

  const start = () => {
    setIsBusy(true);
    setError('');
    startSyncing(chosen.map((symbol) => ({ symbol, target: choices[symbol.symbol].target })))
      .then(setSummary, (failure) => setError(messageOf(failure)))
      .finally(() => setIsBusy(false));
  };

  return (
    <div className="stack">
      <p className="is-muted">A synced symbol's drawings stay in step both ways: changes made in TradingView show here within seconds, and edits and deletions here are saved to your TradingView account. Starting replaces this symbol's earlier copies with TradingView's current drawings. Drawings you add here stay here for now.</p>
      {!hasAccount && <p className="is-loss">Log in to a trading account first: synced drawings are placed on its bars using the broker's server clock.</p>}
      {links.length > 0 && (
        <div className="scroll" style={{ maxHeight: 220 }}>
          <table className="grid">
            <thead>
              <tr>
                <th>TradingView symbol</th>
                <th>Synced with</th>
                <th>Drawings</th>
                <th>Status</th>
                <th />
                <th />
              </tr>
            </thead>
            <tbody>
              {links.map((link) => <LinkRow key={link.symbol} link={link} status={statuses[link.symbol]} count={syncedCount(link.symbol)} />)}
            </tbody>
          </table>
        </div>
      )}
      {!symbols && <div className="dialog-actions"><button className={links.length ? undefined : 'is-primary'} disabled={isBusy} onClick={load}>{isBusy ? 'Reading your layouts…' : 'Add symbols to sync'}</button></div>}
      {symbols && !unlinked.length && <p>{symbols.length ? 'Every TradingView symbol with drawings is synced.' : 'Your TradingView layouts have no drawings.'}</p>}
      {!summary && <SkippedLayouts layouts={skippedLayouts} />}
      {unlinked.length > 0 && (
        <>
          <datalist id="tradingview-sync-targets">{names.map((name) => <option key={name} value={name} />)}</datalist>
          <div className="scroll" style={{ maxHeight: 240 }}>
            <table className="grid">
              <thead>
                <tr>
                  <th />
                  <th>TradingView symbol</th>
                  <th>Drawings</th>
                  <th>Sync with</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {unlinked.map((symbol) => (
                  <SyncChoiceRow
                    key={symbol.symbol}
                    symbol={symbol}
                    choice={choices[symbol.symbol]}
                    isListed={!names.length || listed.has(choices[symbol.symbol].target)}
                    isDisabled={isBusy}
                    onChange={(choice) => setChoices((current) => ({ ...current, [symbol.symbol]: choice }))}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="dialog-actions">
            <button disabled={isBusy} onClick={load}>Reload</button>
            <button className="is-primary" disabled={!canStart} onClick={start}>{isBusy ? 'Starting…' : chosen.length ? `Start syncing ${chosen.length} symbol${chosen.length === 1 ? '' : 's'}` : 'Choose symbols to sync'}</button>
          </div>
        </>
      )}
      {summary && <SyncSummary summary={summary} />}
      {error && <p role="alert" className="is-loss">{error}</p>}
    </div>
  );
}

function TemplateImport() {
  const count = useStore(drawingTemplates, (state) => Object.values(state.byType).reduce((total, list) => total + list.length, 0));
  const [summary, setSummary] = useState<TemplateImportSummary | null>(null);
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);

  const copy = () => {
    setIsBusy(true);
    setError('');
    importTradingViewTemplates(isReplacing).then(setSummary, (failure) => setError(messageOf(failure))).finally(() => setIsBusy(false));
  };

  return (
    <div className="stack">
      <p className="is-muted">Copies the templates you saved for each drawing tool in TradingView (a "BOS" trend line, an "FVG" rectangle). Apply one from a drawing's settings: Template, then its name. Saving your own works the same way.</p>
      {count > 0 && (
        <label className="check">
          <input type="checkbox" checked={isReplacing} disabled={isBusy} onChange={(event) => setIsReplacing(event.target.checked)} />
          Replace templates with the same name ({count} saved here)
        </label>
      )}
      <div className="dialog-actions"><button className="is-primary" disabled={isBusy} onClick={copy}>{isBusy ? 'Reading your templates…' : 'Copy my drawing templates'}</button></div>
      {summary && (
        <div className="stack" role="status">
          <p>{summary.added ? `Copied ${summary.added} template${summary.added === 1 ? '' : 's'}.` : 'No new templates were copied.'}{summary.kept ? ` ${summary.kept} with names already here were left as they are.` : ''}</p>
          {summary.tools.length > 0 && <ul>{summary.tools.map((tool) => <li key={tool.label}>{tool.label}: {tool.names.join(', ')}</li>)}</ul>}
        </div>
      )}
      {error && <p role="alert" className="is-loss">{error}</p>}
    </div>
  );
}

function ThemeImport() {
  const imported = useStore(importedThemes, (state) => state.themes);
  const preference = useStore(workspace, (state) => state.theme);
  const [names, setNames] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [busyName, setBusyName] = useState<string | null>(null);

  const load = () => {
    setBusyName('');
    setError('');
    tradingViewThemes().then(setNames, (failure) => setError(messageOf(failure))).finally(() => setBusyName(null));
  };
  const add = (name: string) => {
    setBusyName(name);
    setError('');
    importTradingViewTheme(name).then(() => undefined, (failure) => setError(messageOf(failure))).finally(() => setBusyName(null));
  };

  return (
    <div className="stack">
      <p className="is-muted">A TradingView theme brings its chart background, grid, scale, crosshair and candle colours. The rest of OpenTerm5 keeps the built-in theme of the same brightness. Imported themes are listed under View › Theme.</p>
      {!names && <div className="dialog-actions"><button className="is-primary" disabled={busyName !== null} onClick={load}>{busyName === '' ? 'Reading your themes…' : 'Find my themes'}</button></div>}
      {names && !names.length && <p>Your TradingView account has no saved chart themes. Save one in TradingView's chart settings (Template › Save as) first.</p>}
      {names && names.length > 0 && (
        <table className="grid">
          <thead><tr><th>TradingView theme</th><th /></tr></thead>
          <tbody>{names.map((name) => <tr key={name}><td>{name}</td><td><button disabled={busyName !== null} onClick={() => add(name)}>{busyName === name ? 'Importing…' : imported.some((theme) => theme.id === themeIdentity(name).id) ? 'Import again' : 'Import'}</button></td></tr>)}</tbody>
        </table>
      )}
      {imported.length > 0 && (
        <table className="grid">
          <thead><tr><th>Imported theme</th><th /><th /></tr></thead>
          <tbody>
            {imported.map((theme) => (
              <tr key={theme.id}>
                <td>{theme.label}</td>
                <td>{preference === theme.id ? <span className="is-muted">In use</span> : <button onClick={() => setThemePreference(theme.id)}>Use</button>}</td>
                <td><button onClick={() => removeImportedTheme(theme.id)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error && <p role="alert" className="is-loss">{error}</p>}
    </div>
  );
}

const chartTypeLabel = (type: string | undefined) => chartTypes.find((candidate) => candidate.key === type)?.label;

// TradingView names intervals in minutes ("15", "240") or by unit ("1D", "W").
function intervalLabel(interval: string): string {
  const minutes = Number(interval);
  if (!Number.isInteger(minutes) || minutes <= 0) return interval;
  return minutes % 60 ? `${minutes}m` : `${minutes / 60}h`;
}

interface SettingsSwatchProps {
  settings: ChartSettings;
}

function SettingsSwatch({ settings }: SettingsSwatchProps) {
  const background = settings.background && settings.backgroundGradient ? `linear-gradient(${settings.background}, ${settings.backgroundGradient})` : settings.background ?? undefined;
  return (
    <span className="tradingview-swatch" style={{ background }} title="Background, up and down candles" aria-hidden="true">
      <span style={{ background: settings.upColor ?? undefined }} />
      <span className="is-down" style={{ background: settings.downColor ?? undefined }} />
    </span>
  );
}

interface SettingsRowProps {
  choice: ChartSettingsChoice;
  isChosen: boolean;
  isDisabled: boolean;
  onChoose: () => void;
}

function SettingsRow({ choice, isChosen, isDisabled, onChoose }: SettingsRowProps) {
  const chart = `${choice.symbol}${choice.interval ? `, ${intervalLabel(choice.interval)}` : ''}`;
  return (
    <tr>
      <td><input type="radio" name="tradingview-chart-settings" aria-label={`Use ${chart} in ${choice.layoutName}`} checked={isChosen} disabled={isDisabled} onChange={onChoose} /></td>
      <td>{choice.layoutName}</td>
      <td>{chart}</td>
      <td><SettingsSwatch settings={choice.settings} /></td>
      <td className="is-muted">{chartTypeLabel(choice.chartType) ?? ''}</td>
    </tr>
  );
}

interface SettingsSummaryProps {
  choice: ChartSettingsChoice;
  summary: ChartSettingsSummary;
}

function SettingsSummary({ choice, summary }: SettingsSummaryProps) {
  const charts = `${summary.count} chart${summary.count === 1 ? '' : 's'}`;
  const type = summary.chartType ? `, now drawn as ${chartTypeLabel(summary.chartType)}` : '';
  return (
    <div className="stack" role="status">
      <p>Applied the settings of {choice.symbol} in "{choice.layoutName}" to {charts}{type}.{summary.isDefault ? ' New charts start with them too.' : ''} Change them for any chart in its Chart Settings.</p>
    </div>
  );
}

function ChartSettingsImport() {
  const chartCount = useStore(workspace, (state) => state.charts.length);
  const [choices, setChoices] = useState<readonly ChartSettingsChoice[] | null>(null);
  const [skippedLayouts, setSkippedLayouts] = useState<readonly TradingViewSkippedLayout[]>([]);
  const [chosenKey, setChosenKey] = useState('');
  const [applied, setApplied] = useState<{ choice: ChartSettingsChoice; summary: ChartSettingsSummary } | null>(null);
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isDefault, setIsDefault] = useState(true);
  const [isSwitchingType, setIsSwitchingType] = useState(false);

  const chosen = choices?.find((choice) => choice.key === chosenKey);
  const typeLabel = chartTypeLabel(chosen?.chartType);
  const canApply = !isBusy && !!chosen && (chartCount > 0 || isDefault);

  const load = () => {
    setIsBusy(true);
    setError('');
    setApplied(null);
    tradingViewChartSettings().then(({ choices: found, skippedLayouts: skipped }) => {
      setChoices(found);
      setSkippedLayouts(skipped);
      setChosenKey(found[0]?.key ?? '');
    }, (failure) => setError(messageOf(failure))).finally(() => setIsBusy(false));
  };

  const apply = () => {
    if (!chosen) return;
    setError('');
    try {
      setApplied({ choice: chosen, summary: applyTradingViewChartSettings(chosen, isDefault, isSwitchingType && !!chosen.chartType) });
    } catch (failure) {
      setError(messageOf(failure));
    }
  };

  return (
    <div className="stack">
      <p className="is-muted">Copies the chart settings of one chart in your TradingView layouts: background, grid, candles, scales, status line, crosshair and margins. They apply to every open chart and stay editable in each chart's Chart Settings.</p>
      {!choices && <div className="dialog-actions"><button className="is-primary" disabled={isBusy} onClick={load}>{isBusy ? 'Reading your layouts…' : 'Find my chart settings'}</button></div>}
      {choices && !choices.length && <p>{skippedLayouts.length ? 'The layouts TradingView opened have no charts with settings to copy.' : 'Your TradingView account has no saved layouts with chart settings.'}</p>}
      <SkippedLayouts layouts={skippedLayouts} subject="chart settings" />
      {choices && choices.length > 0 && (
        <>
          <div className="scroll" style={{ maxHeight: 240 }}>
            <table className="grid">
              <thead>
                <tr>
                  <th />
                  <th>Layout</th>
                  <th>Chart</th>
                  <th>Colours</th>
                  <th>Chart type</th>
                </tr>
              </thead>
              <tbody>
                {choices.map((choice) => (
                  <SettingsRow key={choice.key} choice={choice} isChosen={choice.key === chosenKey} isDisabled={isBusy} onChoose={() => setChosenKey(choice.key)} />
                ))}
              </tbody>
            </table>
          </div>
          <label className="check">
            <input type="checkbox" checked={isDefault} disabled={isBusy} onChange={(event) => setIsDefault(event.target.checked)} />
            Also use for new charts
          </label>
          {typeLabel && (
            <label className="check">
              <input type="checkbox" checked={isSwitchingType} disabled={isBusy} onChange={(event) => setIsSwitchingType(event.target.checked)} />
              Also switch charts to {typeLabel}
            </label>
          )}
          <div className="dialog-actions">
            <button disabled={isBusy} onClick={load}>Reload</button>
            <button className="is-primary" disabled={!canApply} onClick={apply}>{chartCount ? 'Apply to all charts' : 'Use for new charts'}</button>
          </div>
        </>
      )}
      {applied && <SettingsSummary choice={applied.choice} summary={applied.summary} />}
      {error && <p role="alert" className="is-loss">{error}</p>}
    </div>
  );
}

export function TradingViewDialog() {
  const [account, setAccount] = useState<TradingViewAccount | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>('drawings');
  const [error, setError] = useState('');

  useEffect(() => {
    tradingViewAccount().then(setAccount, (failure) => { setAccount(null); setError(messageOf(failure)); });
  }, []);

  return (
    <Dialog title="Import from TradingView" width={640}>
      <div className="stack tradingview-import">
        <AccountBar account={account} onAccount={setAccount} onError={setError} />
        {error && <p role="alert" className="is-loss">{error}</p>}
        {account && <Segmented label="Import" value={tab} options={tabs} onChange={setTab} />}
        {account && tab === 'drawings' && <DrawingImport />}
        {account && tab === 'sync' && <DrawingSync />}
        {account && tab === 'templates' && <TemplateImport />}
        {account && tab === 'themes' && <ThemeImport />}
        {account && tab === 'settings' && <ChartSettingsImport />}
        <div className="dialog-actions"><button onClick={closeDialog}>Close</button></div>
      </div>
    </Dialog>
  );
}
