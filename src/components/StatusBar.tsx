import { cursor } from '../lib/cursor';
import { formatPrice, formatTime } from '../lib/format';
import { session } from '../lib/session';
import { useStore } from '../lib/store';
import { openDialog } from '../lib/workspace';

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
      {bar && (
        <span className="status-cell status-ohlc">
          {formatTime(bar.time * 1000, false)} O: {formatPrice(bar.open, digits)} H: {formatPrice(bar.high, digits)} L: {formatPrice(bar.low, digits)} C:{' '}
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
