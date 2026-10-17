import { indicatorCatalogue } from '@meridian/charts';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { entryLabel, indicatorEntries, indicatorSections, searchEntries, sectionEntries, type IndicatorEntry, type IndicatorSection } from '../../lib/indicator-catalog';
import { indicatorFavorites, toggleFavoriteIndicator } from '../../lib/indicator-favorites';
import { cancelPopularImport, importPopularScripts, popularCounts, popularImport, type PopularImport, type SkippedScript } from '../../lib/pine/pine-popular';
import { importPineScript, pineScripts, removePineScripts, type PineScript } from '../../lib/pine/pine-scripts';
import { useStore } from '../../lib/store';
import { tradingViewScript } from '../../lib/tradingview';
import { activeChart, addIndicator, workspace } from '../../lib/workspace';
import { Icon, type IconName } from '../ui/Icon';
import { Dialog } from './Dialog';

// TradingView's "Indicators, metrics, and strategies" dialog: every indicator in one place,
// sectioned by source, searchable, with a star to favourite. A click adds the indicator to the
// active chart and the dialog stays open for the next one.

const ROW_HEIGHT = 32;

// Rows drawn beyond the visible ones, so fast scrolling does not show gaps.
const OVERSCAN = 8;

const sectionIcons: Record<IndicatorSection, IconName> = { favorites: 'star', scripts: 'user', technicals: 'indicators', popular: 'flame' };

const emptyTexts: Record<IndicatorSection, string> = {
  favorites: 'Star an indicator to keep it here and in the toolbar\'s favourites menu.',
  scripts: 'Pine scripts you import appear here.',
  technicals: 'No built-in indicators.',
  popular: 'Import TradingView\'s popular open-source indicators to list them here.',
};

// The section the dialog last showed, for the next time it opens.
let lastSection: IndicatorSection = 'technicals';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const isLink = (text: string) => /^https?:\/\//i.test(text.trim());

// Skip reasons with the script-specific part (a library's name) taken out, to count alike ones.
const reasonGroup = (reason: string) => reason.replace(/the TradingView library \S+, which/, 'a TradingView library, which');

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

interface ImportPanelProps {
  onImported: (script: PineScript) => void;
  onClose?: () => void;
}

// One field for a TradingView script link or the Pine source itself.
function ImportPanel({ onImported, onClose }: ImportPanelProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const importScript = async () => {
    setIsBusy(true);
    setError('');
    try {
      let script: PineScript;
      if (isLink(text)) {
        const found = await tradingViewScript(text.trim());
        script = await importPineScript(found.source, { kind: 'tradingview', version: found.version, url: found.url, author: found.author, scriptId: found.scriptId });
      } else {
        script = await importPineScript(text, { kind: 'pasted' });
      }
      setText('');
      onImported(script);
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setIsBusy(false);
    }
  };
  return (
    <form className="indicators-import" onSubmit={(event) => { event.preventDefault(); if (text.trim() && !isBusy) void importScript(); }}>
      <textarea
        value={text}
        disabled={isBusy}
        rows={isLink(text) || !text ? 2 : 8}
        spellCheck={false}
        onChange={(event) => setText(event.target.value)}
        placeholder={'Paste a TradingView script link (open-source scripts only) or Pine Script v5/v6 source'}
        aria-label="TradingView script link or Pine Script source"
        autoFocus
      />
      <div className="indicators-import-actions">
        {error ? <span role="alert" className="is-loss">{error}</span> : <span className="is-muted">Each script keeps its author's licence and stays on this computer.</span>}
        {onClose && <button type="button" onClick={onClose}>Cancel</button>}
        <button className="is-primary" type="submit" disabled={!text.trim() || isBusy}>{isBusy ? 'Importing…' : isLink(text) ? 'Import from TradingView' : 'Import'}</button>
      </div>
    </form>
  );
}

interface SkippedListProps {
  skipped: readonly SkippedScript[];
}

function SkippedList({ skipped }: SkippedListProps) {
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const script of skipped) counts.set(reasonGroup(script.reason), (counts.get(reasonGroup(script.reason)) ?? 0) + 1);
    return [...counts.entries()].sort((left, right) => right[1] - left[1]);
  }, [skipped]);
  return (
    <details className="indicators-skipped">
      <summary>{skipped.length} skipped</summary>
      <ul>{groups.map(([reason, count]) => <li key={reason}>{count} × {reason}</li>)}</ul>
    </details>
  );
}

function progressText({ phase, count, listed, done, added, updated, unchanged, skipped, error }: PopularImport): string {
  const counts = `${added} added, ${updated} updated, ${unchanged} already here, ${skipped.length} skipped`;
  if (phase === 'listing') return `Reading TradingView's list: ${listed} of ${count}.`;
  if (phase === 'importing') return `${done} of ${listed}: ${counts}.`;
  if (phase === 'done') return `Finished ${listed}: ${counts}.`;
  if (phase === 'cancelled') return `Cancelled after ${done} of ${listed || count}: ${counts}. Import again to carry on.`;
  return `Stopped after ${done} of ${listed || count}: ${error ?? 'unknown error'}. Import again to carry on.`;
}

// Fetches TradingView's popular open-source indicators; it carries on with the dialog closed.
function PopularBar() {
  const progress = useStore(popularImport, (state) => state.progress);
  const [count, setCount] = useState<number>(1000);
  const [isRetryingSkipped, setIsRetryingSkipped] = useState(false);
  const isRunning = progress?.phase === 'listing' || progress?.phase === 'importing';
  return (
    <div className="indicators-bar">
      <div className="indicators-bar-row">
        <span className="is-muted" title="TradingView's Popular list, open-source indicators only. Requests go out about one a second; scripts already here at the same version are skipped.">From TradingView's Popular list</span>
        <select value={count} disabled={isRunning} onChange={(event) => setCount(Number(event.target.value))} aria-label="How many scripts">
          {popularCounts.map((option) => <option key={option} value={option}>Top {option}</option>)}
        </select>
        <label className="check" title="Scripts that failed their checks are skipped without a request unless this is ticked.">
          <input type="checkbox" checked={isRetryingSkipped} disabled={isRunning} onChange={(event) => setIsRetryingSkipped(event.target.checked)} />
          Retry skipped
        </label>
        {isRunning
          ? <button onClick={cancelPopularImport}>Cancel</button>
          : <button className="is-primary" onClick={() => void importPopularScripts(count, isRetryingSkipped)}>Import</button>}
      </div>
      {progress && (
        <div className="indicators-bar-row">
          <progress max={progress.phase === 'listing' ? progress.count : Math.max(1, progress.listed)} value={progress.phase === 'listing' ? progress.listed : progress.done} />
          <span role="status" className={progress.phase === 'failed' ? 'is-loss' : 'is-muted'}>
            {progress.waitingUntil ? `TradingView asked for a pause. Carrying on at ${timeOf(progress.waitingUntil)}.` : progressText(progress)}
          </span>
          {progress.skipped.length > 0 && <SkippedList skipped={progress.skipped} />}
        </div>
      )}
    </div>
  );
}

interface IndicatorRowProps {
  entry: IndicatorEntry;
  top: number;
  isFavorite: boolean;
  isConfirming: boolean;
  isHighlighted: boolean;
  isAddable: boolean;
  onAdd: () => void;
  onHover: () => void;
  onRemove: () => void;
  onConfirm: (isConfirming: boolean) => void;
}

function IndicatorRow({ entry, top, isFavorite, isConfirming, isHighlighted, isAddable, onAdd, onHover, onRemove, onConfirm }: IndicatorRowProps) {
  const details = [entry.author && `by ${entry.author}`, entry.license && `licence ${entry.license}`].filter(Boolean).join(', ');
  return (
    <div
      className={`indicator-row${isHighlighted ? ' is-highlighted' : ''}${isAddable ? '' : ' is-disabled'}`}
      role="option"
      aria-selected={isHighlighted}
      title={details ? `${entryLabel(entry)}, ${details}` : entryLabel(entry)}
      style={{ top, height: ROW_HEIGHT }}
      onMouseEnter={onHover}
      onClick={() => isAddable && onAdd()}
    >
      <button
        type="button"
        className={`indicator-star${isFavorite ? ' is-favorite' : ''}`}
        aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        aria-pressed={isFavorite}
        onClick={(event) => { event.stopPropagation(); toggleFavoriteIndicator(entry.type); }}
      >
        <Icon name="star" size={15} />
      </button>
      <span className="indicator-title">{entry.title}</span>
      {entry.badge && <span className="indicator-badge">{entry.badge}</span>}
      <span className="indicator-author">{entry.author ?? ''}</span>
      {entry.scriptId && (isConfirming
        ? <button type="button" className="is-danger indicator-confirm" autoFocus onBlur={() => onConfirm(false)} onClick={(event) => { event.stopPropagation(); onRemove(); }}>Remove from all charts</button>
        : <button type="button" className="indicator-action" aria-label="Remove script" onClick={(event) => { event.stopPropagation(); onConfirm(true); }}><Icon name="trash" size={15} /></button>)}
    </div>
  );
}

interface IndicatorsDialogProps {
  initialSection?: IndicatorSection;
}

export function IndicatorsDialog({ initialSection }: IndicatorsDialogProps) {
  const chart = useStore(workspace, (state) => activeChart(state));
  const scripts = useStore(pineScripts, (state) => state.scripts);
  const favorites = useStore(indicatorFavorites, (state) => state.types);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<IndicatorSection>(initialSection ?? lastSection);
  const [highlight, setHighlight] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const [listHeight, setListHeight] = useState(400);

  // The registry changes with the script store; built-ins never change.
  const entries = useMemo(() => indicatorEntries(indicatorCatalogue(), scripts), [scripts]);
  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const isSearching = !!query.trim();
  const shown = useMemo(() => (isSearching ? searchEntries(entries, query) : sectionEntries(entries, section, favoriteSet)), [entries, query, isSearching, section, favoriteSet]);
  const counts = useMemo(() => Object.fromEntries(indicatorSections.map(({ key }) => [key, sectionEntries(entries, key, favoriteSet).length])) as Record<IndicatorSection, number>, [entries, favoriteSet]);

  useEffect(() => { lastSection = section; }, [section]);
  useEffect(() => { setHighlight(0); setConfirming(null); list.current?.scrollTo({ top: 0 }); }, [section, query]);
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setListHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const add = (entry: IndicatorEntry) => {
    if (!chart) return;
    addIndicator(chart.id, entry.type);
    setNotice(`${entryLabel(entry)} added to ${chart.symbol}, ${chart.timeframe}.`);
  };

  const reveal = (index: number) => {
    const element = list.current;
    if (!element) return;
    if (index * ROW_HEIGHT < element.scrollTop) element.scrollTop = index * ROW_HEIGHT;
    else if ((index + 1) * ROW_HEIGHT > element.scrollTop + element.clientHeight) element.scrollTop = (index + 1) * ROW_HEIGHT - element.clientHeight;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = Math.max(0, Math.min(shown.length - 1, highlight + (event.key === 'ArrowDown' ? 1 : -1)));
      setHighlight(next);
      reveal(next);
    } else if (event.key === 'Enter' && shown[highlight]) {
      event.preventDefault();
      add(shown[highlight]);
    }
  };

  const onImported = (script: PineScript) => {
    setIsImporting(false);
    setQuery('');
    setSection('scripts');
    setNotice(`Imported ${script.name}${script.author ? ` by ${script.author}` : ''}. Click it to add it to the chart.`);
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(shown.length, Math.ceil((scrollTop + listHeight) / ROW_HEIGHT) + OVERSCAN);
  const hasAuthors = shown.some((entry) => entry.author);
  const isScriptsImportShown = !isSearching && section === 'scripts' && (isImporting || counts.scripts === 0);
  let group = '';

  return (
    <Dialog title="Indicators" width={880}>
      <div className="indicators-dialog">
        <label className="indicators-search">
          <Icon name="search" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder="Search" aria-label="Search indicators" aria-controls="indicators-list" autoFocus />
        </label>
        <div className="indicators-body">
          <nav className="indicators-sidebar" aria-label="Indicator sources">
            {indicatorSections.map((item) => {
              const heading = item.group !== group ? item.group : null;
              group = item.group;
              return (
                <div key={item.key}>
                  {heading && <div className="indicators-group">{heading}</div>}
                  <button type="button" className={`indicators-section${!isSearching && section === item.key ? ' is-active' : ''}`} aria-current={!isSearching && section === item.key} onClick={() => { setQuery(''); setSection(item.key); }}>
                    <Icon name={sectionIcons[item.key]} />
                    <span>{item.label}</span>
                    <span className="indicators-count">{counts[item.key] || ''}</span>
                  </button>
                </div>
              );
            })}
          </nav>
          <section className="indicators-main">
            {!isSearching && section === 'scripts' && !isScriptsImportShown && (
              <div className="indicators-bar-row indicators-toolbar">
                <button type="button" onClick={() => setIsImporting(true)}><Icon name="plus" size={14} /> Import script</button>
              </div>
            )}
            {isScriptsImportShown && <ImportPanel onImported={onImported} {...(counts.scripts ? { onClose: () => setIsImporting(false) } : {})} />}
            {!isSearching && section === 'popular' && <PopularBar />}
            <div className="indicators-header">
              <span>{isSearching ? `Results for "${query.trim()}"` : 'Script name'}</span>
              {hasAuthors && <span className="indicator-author">Author</span>}
            </div>
            <div className="indicators-list" id="indicators-list" role="listbox" aria-label="Indicators" ref={list} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
              <div style={{ height: shown.length * ROW_HEIGHT, position: 'relative' }}>
                {shown.slice(first, last).map((entry, offset) => {
                  const index = first + offset;
                  return (
                    <IndicatorRow
                      key={entry.type}
                      entry={entry}
                      top={index * ROW_HEIGHT}
                      isFavorite={favoriteSet.has(entry.type)}
                      isConfirming={confirming === entry.type}
                      isHighlighted={index === highlight}
                      isAddable={!!chart}
                      onAdd={() => add(entry)}
                      onHover={() => setHighlight(index)}
                      onRemove={() => { if (entry.scriptId) removePineScripts([entry.scriptId]); setConfirming(null); setNotice(`Removed ${entry.title}.`); }}
                      onConfirm={(isConfirming) => setConfirming(isConfirming ? entry.type : null)}
                    />
                  );
                })}
              </div>
              {!shown.length && <p className="indicators-empty">{isSearching ? 'No indicators match.' : emptyTexts[section]}</p>}
            </div>
          </section>
        </div>
        <footer className="indicators-footer" role="status">{chart ? notice : 'Open a chart to add indicators.'}</footer>
      </div>
    </Dialog>
  );
}
