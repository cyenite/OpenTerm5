import { useEffect, useRef, useState } from 'react';
import { serverSources, type BrokerServer, type ResolvedServer } from '../../../shared/protocol';
import { terminal } from '../../lib/session';

interface BrokerServerFieldProps {
  initialServer: string;
  initialEndpoint: string;
  isDisabled: boolean;
  onResolved: (server: ResolvedServer | null) => void;
}

type Detection =
  | { state: 'idle' }
  | { state: 'searching'; server: string }
  | { state: 'found'; resolved: ResolvedServer }
  | { state: 'failed'; server: string; message: string };

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return url; } };
const isTrusted = (resolved: ResolvedServer) => serverSources.find((source) => source.key === resolved.source)?.isTrusted ?? false;

export function BrokerServerField({ initialServer, initialEndpoint, isDisabled, onResolved }: BrokerServerFieldProps) {
  const [query, setQuery] = useState(initialServer);
  const [webUrl, setWebUrl] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [isAdvanced, setIsAdvanced] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [listError, setListError] = useState('');
  const [suggestions, setSuggestions] = useState<BrokerServer[]>([]);
  const [detection, setDetection] = useState<Detection>(() => initialServer && initialEndpoint
    ? { state: 'found', resolved: { server: initialServer, broker: '', webUrl: '', webEndpoint: initialEndpoint, isListed: true, source: 'saved' } }
    : { state: 'idle' });
  const attempt = useRef(0);

  useEffect(() => {
    onResolved(detection.state === 'found' && (isTrusted(detection.resolved) || isApproved) ? detection.resolved : null);
  }, [detection, isApproved]);

  useEffect(() => {
    if (!isOpen || query.trim().length < 2) { setSuggestions([]); return; }
    let isCurrent = true;
    const timer = setTimeout(() => {
      terminal.request('brokers.search', { query }).then((found) => {
        if (!isCurrent) return;
        setSuggestions(found);
        setHighlight(0);
        setListError('');
      }).catch((error: Error) => { if (isCurrent) setListError(error.message); });
    }, 180);
    return () => { isCurrent = false; clearTimeout(timer); };
  }, [query, isOpen]);

  const detect = async (server: string, manualUrl?: string) => {
    const name = server.trim();
    if (!name && !manualUrl) { setDetection({ state: 'idle' }); return; }
    const id = ++attempt.current;
    setIsOpen(false);
    setIsApproved(false);
    setDetection({ state: 'searching', server: name });
    try {
      const resolved = await terminal.request('brokers.resolve', manualUrl ? { server: name, webUrl: manualUrl } : { server: name });
      if (id !== attempt.current) return;
      setQuery(resolved.server);
      setDetection({ state: 'found', resolved });
    } catch (error) {
      if (id !== attempt.current) return;
      setDetection({ state: 'failed', server: name, message: (error as Error).message });
      setIsAdvanced(true);
    }
  };

  const choose = (server: string) => {
    setQuery(server);
    void detect(server);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && suggestions.length) { event.preventDefault(); setIsOpen(true); setHighlight((highlight + 1) % suggestions.length); }
    else if (event.key === 'ArrowUp' && suggestions.length) { event.preventDefault(); setHighlight((highlight - 1 + suggestions.length) % suggestions.length); }
    else if (event.key === 'Escape' && isOpen) { event.stopPropagation(); setIsOpen(false); }
    else if (event.key === 'Enter' && (isOpen && suggestions.length || detection.state !== 'found')) {
      event.preventDefault();
      choose(isOpen && suggestions[highlight] ? suggestions[highlight].server : query);
    }
  };

  const isSearching = detection.state === 'searching';
  return (
    <>
      <label className="field">
        <span>Server</span>
        <div className="server-picker">
          <input
            value={query}
            disabled={isDisabled}
            placeholder="Search broker or server, e.g. FTMO"
            autoFocus={!initialServer}
            role="combobox"
            aria-expanded={isOpen && suggestions.length > 0}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            required
            onChange={(event) => { setQuery(event.target.value); setIsOpen(true); if (detection.state !== 'idle') setDetection({ state: 'idle' }); }}
            onFocus={() => setIsOpen(true)}
            onBlur={() => {
              setTimeout(() => setIsOpen(false), 120);
              const exact = suggestions.find((item) => item.server.toLowerCase() === query.trim().toLowerCase());
              if (exact && detection.state === 'idle') choose(exact.server);
            }}
            onKeyDown={onKeyDown}
          />
          {isOpen && suggestions.length > 0 && (
            <ul className="server-suggestions" role="listbox">
              {suggestions.map((item, index) => (
                <li
                  key={item.server}
                  role="option"
                  aria-selected={index === highlight}
                  className={index === highlight ? 'is-highlighted' : undefined}
                  onMouseDown={(event) => { event.preventDefault(); choose(item.server); }}
                  onMouseEnter={() => setHighlight(index)}
                >
                  <b>{item.server}</b>
                  {item.type && <span className="server-kind">{item.type}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </label>
      <div className="server-status" aria-live="polite">
        {detection.state === 'idle' && (listError ? <span className="is-muted">{listError}</span> : <span className="is-muted">Pick your broker's trade server.</span>)}
        {isSearching && <span className="is-muted"><span className="spinner" /> Finding {detection.server}…</span>}
        {detection.state === 'found' && isTrusted(detection.resolved) && (
          <span className={detection.resolved.isListed ? 'is-good' : 'is-warn'}>
            {detection.resolved.isListed ? '✓' : '!'} {detection.resolved.broker || 'Saved server'} via {hostOf(detection.resolved.webEndpoint)}
            {!detection.resolved.isListed && <small> (this terminal does not list {detection.resolved.server}; login will confirm it)</small>}
          </span>
        )}
        {detection.state === 'found' && !isTrusted(detection.resolved) && <span className="is-warn">! Unverified server address. Check it below before you log in.</span>}
        {detection.state === 'failed' && <span className="is-loss">{detection.message}</span>}
        <button type="button" className="is-link" onClick={() => setIsAdvanced(!isAdvanced)}>{isAdvanced ? 'Hide advanced' : 'Advanced'}</button>
      </div>
      {detection.state === 'found' && !isTrusted(detection.resolved) && (
        <div className="server-approval">
          <div><b>{hostOf(detection.resolved.webEndpoint)}</b> says it is <b>{detection.resolved.broker}</b>, {detection.resolved.server}.</div>
          <div className="is-muted">{serverSources.find((source) => source.key === detection.resolved.source)?.label}. OpenTerm cannot confirm this host belongs to your broker; your password will be sent to it.</div>
          <label className="check"><input type="checkbox" checked={isApproved} disabled={isDisabled} onChange={(event) => setIsApproved(event.target.checked)} />This address belongs to my broker</label>
        </div>
      )}
      {isAdvanced && (
        <div className="field">
          <span>Server address</span>
          <div className="server-manual">
            <input value={webUrl} disabled={isDisabled || isSearching} placeholder="https://broker.example/terminal" onChange={(event) => setWebUrl(event.target.value)} />
            <button type="button" disabled={isDisabled || isSearching || !webUrl.trim()} onClick={() => detect(query, webUrl.trim())}>Check</button>
          </div>
        </div>
      )}
    </>
  );
}
