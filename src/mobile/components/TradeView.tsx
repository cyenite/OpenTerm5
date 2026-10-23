import type { Account, Order, Position } from '../../../shared/protocol';
import { orderType } from '../../../shared/protocol';
import { formatMoney, formatPrice, formatVolume } from '../../lib/format';
import { isTradePending, sendOrder, session } from '../../lib/session';
import { useStore } from '../../lib/store';
import { bridge, canTrade } from '../bridge';
import { openSheet } from '../navigation';
import { ConfirmButton } from './ConfirmButton';

interface AccountCardProps {
  account: Account;
}

function AccountCard({ account }: AccountCardProps) {
  const rows = [
    ['Balance', formatMoney(account.balance)],
    ['Equity', formatMoney(account.equity)],
    ['Margin', formatMoney(account.margin)],
    ['Free margin', formatMoney(account.marginFree)],
  ] as const;
  return (
    <section className="phone-card">
      <div className="phone-card-head">
        <span><b>{account.login}</b> · {account.server}</span>
        <span className={account.tradeMode === 'real' ? 'phone-badge is-real' : 'phone-badge'}>{account.tradeMode}</span>
      </div>
      <p className={`phone-profit ${account.profit >= 0 ? 'is-profit' : 'is-loss'}`}>{formatMoney(account.profit)} {account.currency}</p>
      <dl className="phone-figures">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </section>
  );
}

interface PositionRowProps {
  position: Position;
}

function PositionRow({ position }: PositionRowProps) {
  const digits = useStore(session, (state) => state.symbols[position.symbol]?.digits ?? 5);
  const currency = useStore(session, (state) => state.account?.currency ?? '');
  const isPending = useStore(session, (state) => isTradePending(state, { position: position.ticket }));
  return (
    <li>
      <button type="button" className="phone-row" disabled={isPending} onClick={() => openSheet({ kind: 'position', ticket: position.ticket })}>
        <span className="phone-row-main">
          <b><span className={position.side === 'buy' ? 'is-buy-text' : 'is-sell-text'}>{position.side === 'buy' ? 'Buy' : 'Sell'} {formatVolume(position.volume)}</span> {position.symbol}</b>
          <small>{formatPrice(position.priceOpen, digits)} → {formatPrice(position.priceCurrent, digits)}{position.sl ? ` · SL ${formatPrice(position.sl, digits)}` : ''}{position.tp ? ` · TP ${formatPrice(position.tp, digits)}` : ''}</small>
        </span>
        <span className={position.profit >= 0 ? 'is-profit' : 'is-loss'}>{isPending ? 'Sending…' : `${formatMoney(position.profit)} ${currency}`}</span>
      </button>
    </li>
  );
}

interface OrderRowProps {
  order: Order;
}

function OrderRow({ order }: OrderRowProps) {
  const digits = useStore(session, (state) => state.symbols[order.symbol]?.digits ?? 5);
  const isTrader = useStore(bridge, canTrade);
  const isPending = useStore(session, (state) => isTradePending(state, { order: order.ticket }));
  return (
    <li className="phone-row is-static">
      <span className="phone-row-main">
        <b>{orderType(order.type)?.label ?? order.type} {formatVolume(order.volume)} {order.symbol}</b>
        <small>at {formatPrice(order.priceOpen, digits)}{order.sl ? ` · SL ${formatPrice(order.sl, digits)}` : ''}{order.tp ? ` · TP ${formatPrice(order.tp, digits)}` : ''}</small>
      </span>
      {isTrader && <ConfirmButton label="Delete" confirmLabel="Delete order?" isBusy={isPending} onConfirm={() => void sendOrder({ action: 'remove', order: order.ticket })} />}
    </li>
  );
}

export function TradeView() {
  const account = useStore(session, (state) => state.account);
  const positions = useStore(session, (state) => state.positions);
  const orders = useStore(session, (state) => state.orders);
  const lastTrade = useStore(session, (state) => state.lastTrade);
  const isTrader = useStore(bridge, canTrade);
  return (
    <div className="phone-page">
      <h1>Trade</h1>
      {!isTrader && <p className="phone-banner">This phone can view only. Allow trading for it in File, Phone Access on the computer.</p>}
      {lastTrade && <p className={`phone-banner ${lastTrade.isSuccess ? 'is-good' : 'is-bad'}`}>{lastTrade.label}: {lastTrade.comment}</p>}
      {account ? <AccountCard account={account} /> : <p className="phone-muted">No account is signed in on the computer.</p>}
      <section className="phone-group">
        <h2>Positions</h2>
        {positions.length ? <ul className="phone-list">{positions.map((position) => <PositionRow key={position.ticket} position={position} />)}</ul> : <p className="phone-muted">No open positions.</p>}
      </section>
      <section className="phone-group">
        <h2>Pending orders</h2>
        {orders.length ? <ul className="phone-list">{orders.map((order) => <OrderRow key={order.ticket} order={order} />)}</ul> : <p className="phone-muted">No pending orders.</p>}
      </section>
    </div>
  );
}
