import { useState } from 'react';
import { hubScopes } from '../../../shared/hub';
import { session } from '../../lib/session';
import { useStore } from '../../lib/store';
import { bridge, forgetPairing, pairWith } from '../bridge';
import { hubStates } from '../hub-client';
import { mobileTabs, navigation } from '../navigation';
import { ChartList } from './ChartList';
import { ChartView } from './ChartView';
import { QuoteList } from './QuoteList';
import { SheetHost } from './Sheets';
import { TradeView } from './TradeView';

function PairScreen() {
  const detail = useStore(bridge, (state) => state.detail);
  const isConnecting = useStore(bridge, (state) => state.state === 'connecting');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const pair = () => {
    setError('');
    void pairWith(link).catch((reason: Error) => setError(reason.message));
  };
  return (
    <div className="phone-page phone-pair">
      <h1>OpenTerm5</h1>
      <p>Use the charts and accounts of OpenTerm5 on your computer from this phone.</p>
      <ol>
        <li>On the computer, open File, Phone Access, and turn on phone access.</li>
        <li>Choose Show pairing code, then scan it with this phone's camera.</li>
      </ol>
      <p className="phone-muted">Or paste the pairing link here:</p>
      <input className="phone-search" type="url" placeholder="http://…/#pair=…" value={link} autoComplete="off" onChange={(event) => setLink(event.target.value)} />
      <button type="button" className="phone-primary" disabled={!link.trim() || isConnecting} onClick={pair}>{isConnecting ? 'Pairing…' : 'Pair'}</button>
      {(error || detail) && <p className="phone-error" role="alert">{error || detail}</p>}
    </div>
  );
}

function ConnectionBanner() {
  const state = useStore(bridge, (value) => value.state);
  const detail = useStore(bridge, (value) => value.detail);
  const hubName = useStore(bridge, (value) => value.pairing?.hubName ?? 'the computer');
  const isBrokerOpen = useStore(session, (value) => value.link.state === 'open');
  if (state === 'ready' && isBrokerOpen) return null;
  const text = state === 'ready' ? `${hubName} is not connected to its broker.` : state === 'connecting' ? `Connecting to ${hubName}…` : `${hubName} is unreachable. Check that OpenTerm5 is open and this phone is on the same network.`;
  return <p className={`phone-connection is-${state}`} role="status" title={detail ?? undefined}>{text}</p>;
}

function MorePanel() {
  const pairing = useStore(bridge, (state) => state.pairing);
  const ready = useStore(bridge, (state) => state.ready);
  const state = useStore(bridge, (value) => value.state);
  const [isConfirming, setIsConfirming] = useState(false);
  const scope = hubScopes.find((item) => item.key === (ready?.device.scope ?? pairing?.scope));
  return (
    <div className="phone-page">
      <h1>More</h1>
      <section className="phone-card">
        <div className="phone-card-head"><b>{pairing?.hubName ?? 'Computer'}</b><span className="phone-badge">{hubStates.find((item) => item.key === state)?.label ?? 'Not paired'}</span></div>
        <p className="phone-muted">This phone: {ready?.device.name ?? 'paired device'}. Access: {scope?.label}. {scope?.description}</p>
        <p className="phone-muted">Last address: {pairing?.addresses[0] ?? 'none'}. OpenTerm5 {ready?.hub.version ?? ''} on the computer.</p>
      </section>
      <p className="phone-muted">Unpairing forgets the computer on this phone. Remove the phone in Phone Access on the computer as well.</p>
      {isConfirming
        ? <div className="phone-actions"><button type="button" className="phone-primary is-close" onClick={forgetPairing}>Unpair this phone</button><button type="button" onClick={() => setIsConfirming(false)}>Keep</button></div>
        : <button type="button" onClick={() => setIsConfirming(true)}>Unpair…</button>}
    </div>
  );
}

function TabBar() {
  const tab = useStore(navigation, (state) => state.tab);
  return (
    <nav className="phone-tabs" aria-label="Sections">
      {mobileTabs.map((item) => (
        <button key={item.key} type="button" aria-current={tab === item.key ? 'page' : undefined} className={tab === item.key ? 'is-active' : ''} onClick={() => navigation.set({ tab: item.key, ...(item.key === tab ? { chartId: null } : {}) })}>{item.label}</button>
      ))}
    </nav>
  );
}

function Section() {
  const tab = useStore(navigation, (state) => state.tab);
  const chartId = useStore(navigation, (state) => state.chartId);
  if (tab === 'charts') return chartId ? <ChartView key={chartId} chartId={chartId} /> : <ChartList />;
  if (tab === 'quotes') return <QuoteList />;
  if (tab === 'trade') return <TradeView />;
  return <MorePanel />;
}

export function MobileApp() {
  const state = useStore(bridge, (value) => value.state);
  const hasDevice = useStore(bridge, (value) => !!value.pairing?.deviceId);
  if (state === 'unpaired' || state === 'refused' || (!hasDevice && state !== 'ready')) return <PairScreen />;
  return (
    <div className="phone-shell">
      <ConnectionBanner />
      <main className="phone-main"><Section /></main>
      <TabBar />
      <SheetHost />
    </div>
  );
}
