import { useEffect, useState } from 'react';
import { cursor } from '../lib/cursor';
import { formatPrice, formatTime } from '../lib/format';
import { session } from '../lib/session';
import { useStore } from '../lib/store';
import { openDialog } from '../lib/workspace';
import { JournalingStatus } from './journaling/JournalingStatus';

const RESULT_MS = 6000;

function formatElapsed(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function TradeActivity() {
  const pending = useStore(session, (state) => state.pendingTrades);
  const last = useStore(session, (state) => state.lastTrade);
  const [, setTick] = useState(0);
  const isResultShown = !!last && Date.now() - last.finishedAt < RESULT_MS;
  const isActive = pending.length > 0 || isResultShown;

  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setTick((tick) => tick + 1), 100);
    return () => clearInterval(timer);
  }, [isActive]);

  if (pending.length) {
    const [first] = pending;
    return (
      <span className="status-cell status-trade is-pending" role="status" aria-live="polite">
        <span className="spinner" aria-hidden />
        {first.label}{pending.length > 1 ? ` +${pending.length - 1}` : ''} · awaiting broker {formatElapsed(performance.now() - first.startedAt)}
      </span>
    );
  }
  if (!last || !isResultShown) return null;
  return (
    <span className={`status-cell status-trade ${last.isSuccess ? 'is-done' : 'is-failed'}`} role="status" aria-live="polite" title={last.comment}>
      {last.isSuccess ? '✓' : '✕'} {last.label} · {last.isSuccess ? 'done' : last.comment || 'failed'} · {formatElapsed(last.elapsedMs)}
    </span>
  );
}

export function StatusBar() {
  const link = useStore(session, (state) => state.link);
  const status = useStore(session, (state) => state.status);
  const account = useStore(session, (state) => state.account);
  const hover = useStore(cursor, (state) => state);
  const isOpen = link.state === 'open';
  const isTerminalConnected = isOpen && status?.isConnected !== false;
  const connection = !isOpen
    ? link.error ?? (link.state === 'connecting' ? 'Connecting…' : 'No connection')
    : status?.connectionState === 'login-required'
      ? 'Login required'
      : status?.connectionState === 'authenticating'
        ? 'Signing in…'
        : !isTerminalConnected
          ? 'Broker offline'
          : `${link.latency ?? 0} ms`;
  const { bar, digits } = hover;

  return (
    <footer className="status-bar">
      {isTerminalConnected && <span className="status-cell" title={status?.isTradeAllowed && status.capabilities?.trading ? 'This account can submit orders.' : 'Orders are unavailable for this connection or account.'}>{status?.isTradeAllowed && status.capabilities?.trading ? 'Trading enabled' : 'Read only'}</span>}
      <span className="status-cell">{account ? `${account.login} ${account.server}` : 'Default'}</span>
      <TradeActivity />
      <JournalingStatus />
      {bar && (
        <span className="status-cell status-ohlc">
          {formatTime(bar.time * 1000, hover.hasSeconds)} O: {formatPrice(bar.open, digits)} H: {formatPrice(bar.high, digits)} L: {formatPrice(bar.low, digits)} C:{' '}
          {formatPrice(bar.close, digits)} V: {bar.volume}
        </span>
      )}
      <button className={`status-cell status-link is-${isTerminalConnected ? 'up' : 'down'}`} onClick={() => openDialog({ kind: 'connection' })} title={link.url || 'Connection settings'}>
        <span className="status-bars" aria-hidden />
        {connection}
      </button>
    </footer>
  );
}
