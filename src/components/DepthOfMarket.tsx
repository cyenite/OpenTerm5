import { Component } from 'react';
import type { Book, OrderTypeKey } from '../../shared/protocol';
import { canTradeSymbol } from '../../shared/feeds';
import { formatPrice } from '../lib/format';
import { session, signingIn, terminal, type SessionState } from '../lib/session';
import { openDialog, workspace } from '../lib/workspace';
import { Panel } from './Panel';
import { SigningIn } from './ui/SigningIn';

interface DomVolumeProps {
  readonly volume: number;
  readonly largest: number;
}

class DomVolume extends Component<DomVolumeProps> {
  render() {
    return <><span className="dom-bar" style={{ width: `${this.props.volume / this.props.largest * 100}%` }} />{this.props.volume}</>;
  }
}

interface DepthOfMarketProps {
  readonly symbol: string;
}

interface DepthOfMarketState {
  readonly book: Book | null;
  readonly error: string;
  readonly snapshot: SessionState;
}

export class DepthOfMarket extends Component<DepthOfMarketProps, DepthOfMarketState> {
  private epoch = 0;
  private isSubscribed = false;
  private offBook?: () => void;
  private offSession?: () => void;
  state: DepthOfMarketState = { book: null, error: '', snapshot: session.get() };

  componentDidMount(): void {
    this.offBook = terminal.on('book', (book) => {
      if (book.symbol === this.props.symbol) this.setState({ book, error: '' });
    });
    this.offSession = session.subscribe(() => {
      this.setState({ snapshot: session.get() });
      this.subscribe();
    });
    this.subscribe();
  }

  componentDidUpdate(previous: DepthOfMarketProps): void {
    if (previous.symbol !== this.props.symbol) {
      this.epoch++;
      this.isSubscribed = false;
      void terminal.request('book.unsubscribe', { symbol: previous.symbol }).catch(() => {});
      this.setState({ book: null, error: '' });
      this.subscribe();
    }
  }

  componentWillUnmount(): void {
    this.epoch++;
    // StrictMode remounts this same instance in development; the next mount must subscribe again.
    this.isSubscribed = false;
    this.offBook?.();
    this.offSession?.();
    void terminal.request('book.unsubscribe', { symbol: this.props.symbol }).catch(() => {});
  }

  private subscribe(): void {
    const snapshot = session.get();
    if (!snapshot.status?.isConnected || snapshot.link.state !== 'open') {
      if (this.isSubscribed) { this.epoch++; this.isSubscribed = false; this.setState({ book: null }); }
      return;
    }
    if (this.isSubscribed) return;
    this.isSubscribed = true;
    const epoch = ++this.epoch;
    void terminal.request('book.subscribe', { symbol: this.props.symbol }).then((book) => {
      if (this.epoch === epoch) this.setState((state) => ({ book: state.book ?? book }));
    }).catch((error: Error) => {
      if (this.epoch === epoch) this.setState({ error: error.message, book: null });
    });
  }

  private order(type: OrderTypeKey, price?: number): void {
    openDialog({ kind: 'order', symbol: this.props.symbol, type, ...(price === undefined ? {} : { price }) });
  }

  render() {
    const symbol = this.props.symbol;
    const snapshot = this.state.snapshot;
    const spec = snapshot.symbols[symbol];
    const tick = snapshot.ticks[symbol];
    const signIn = signingIn(snapshot);
    const digits = spec?.digits ?? 5;
    const step = spec?.tickSize || spec?.point || 10 ** -digits;
    const canTrade = snapshot.status?.isTradeAllowed === true && snapshot.link.state === 'open' && canTradeSymbol(symbol);
    const levels = this.state.book?.levels ?? [];
    const hasDepth = levels.length > 0;
    const largest = Math.max(1, ...levels.map((level) => level.volume));
    const prices = hasDepth ? [...new Set(levels.map((level) => level.price))] : tick && tick.bid > 0 && tick.ask > 0 ? [...new Set(Array.from({ length: 10 }, (_, index) => [Number((tick.ask + index * step).toFixed(digits)), Number((tick.bid - index * step).toFixed(digits))]).flat().filter((price) => price > 0))] : [];
    prices.sort((left, right) => right - left);
    return (
      <Panel title={`Depth Of Market: ${symbol}`} onClose={() => workspace.set({ depthSymbol: null })}>
        <div className="dom-actions">
          <button className="is-sell" disabled={!canTrade} onClick={() => this.order('sell')}>Sell</button>
          <button className="is-buy" disabled={!canTrade} onClick={() => this.order('buy')}>Buy</button>
        </div>
        <p className="empty">{hasDepth ? 'Broker depth · volume in instrument units. Select a price to review an order.' : 'Quote ladder · no broker depth volumes received. Select a price to review an order.'}</p>
        {this.state.error && <p className="empty">{this.state.error}</p>}
        <div className="scroll">
          <table className="grid dom">
            <thead><tr><th className="num">Sell</th><th className="num">Price</th><th className="num">Buy</th></tr></thead>
            <tbody>{prices.map((price) => {
              const sell = levels.find((level) => level.side === 'sell' && level.price === price);
              const buy = levels.find((level) => level.side === 'buy' && level.price === price);
              return <tr key={price} className={sell || price >= (tick?.ask ?? Infinity) ? 'dom-sell' : 'dom-buy'}>
                <td className="num dom-volume"><button disabled={!canTrade || !tick} aria-label={`Sell at ${price}`} onClick={() => this.order(price >= (tick?.bid ?? 0) ? 'sellLimit' : 'sellStop', price)}>{sell ? <DomVolume volume={sell.volume} largest={largest} /> : 'Sell'}</button></td>
                <td className="num">{formatPrice(price, digits)}</td>
                <td className="num dom-volume"><button disabled={!canTrade || !tick} aria-label={`Buy at ${price}`} onClick={() => this.order(price <= (tick?.ask ?? 0) ? 'buyLimit' : 'buyStop', price)}>{buy ? <DomVolume volume={buy.volume} largest={largest} /> : 'Buy'}</button></td>
              </tr>;
            })}</tbody>
          </table>
          {!prices.length && <p className="empty">{signIn ? <SigningIn signIn={signIn} /> : snapshot.status?.isConnected ? 'Waiting for broker quotes and depth…' : 'Log in to view market depth and quotes.'}</p>}
        </div>
      </Panel>
    );
  }
}
