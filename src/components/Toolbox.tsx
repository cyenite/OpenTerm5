import { useEffect, useMemo, useState } from 'react';
import { orderType, type Account, type History, type Order, type Position } from '../../shared/protocol';
import { showToolbox, togglePanel } from '../lib/commands';
import { downloadHistory } from '../lib/history-export';
import { formatMoney, formatPrice, formatTime, formatVolume } from '../lib/format';
import { closePosition, isTradePending, log, sendOrder, session, terminal } from '../lib/session';
import { useStore } from '../lib/store';
import { openDialog, workspace, type ToolboxTab } from '../lib/workspace';
import { openContextMenu } from '../lib/context-menu';
import { defaultSymbol } from '../lib/broker-symbols';
import { bulkKinds, type BulkKind } from '../../shared/automation';
import { runBulkTrades } from '../lib/automation';

async function runBulk(kind: BulkKind, ticket?: number, symbol?: string): Promise<void> {
  const label = `${bulkKinds.find((candidate) => candidate.key === kind)?.label ?? kind}${ticket ? ` #${ticket}` : ''}${symbol ? ` ${symbol}` : ''}`;
  try {
    const outcomes = await runBulkTrades(label, { kind, ticket, symbol });
    const failed = outcomes.filter((outcome) => !outcome.result.isSuccess);
    if (failed.length) log(`${kind}: ${failed.length} of ${outcomes.length} failed: ${failed[0].result.comment}`, 'Trades');
  } catch (error) {
    log(`${kind}: ${(error as Error).message}`, 'Trades');
  }
}

const tabs: { key: ToolboxTab; label: string }[] = [
  { key: 'trade', label: 'Trade' },
  { key: 'exposure', label: 'Exposure' },
  { key: 'history', label: 'History' },
  { key: 'journal', label: 'Journal' },
];

const historyPeriods = [
  { key: 'today', label: 'Today', days: 1 },
  { key: 'week', label: 'Last week', days: 7 },
  { key: 'month', label: 'Last month', days: 31 },
  { key: 'quarter', label: 'Last 3 months', days: 92 },
  { key: 'all', label: 'All history', days: 36500 },
] as const;

function useDigits(symbol: string): number {
  return useStore(session, (state) => state.symbols[symbol]?.digits ?? 5);
}

function profitClass(value: number): string {
  return value > 0 ? 'is-profit' : value < 0 ? 'is-loss' : '';
}

interface PositionRowProps {
  position: Position;
  onMenu: (event: React.MouseEvent) => void;
}

function PositionRow({ position, onMenu }: PositionRowProps) {
  const digits = useDigits(position.symbol);
  const isClosing = useStore(session, (state) => isTradePending(state, { position: position.ticket }));
  const close = async () => {
    const result = await closePosition(position);
    if (!result.isSuccess) {
      log(`close #${position.ticket} failed: ${result.comment}`, 'Trades');
    }
  };
  return (
    <tr className={isClosing ? 'is-pending' : undefined} aria-busy={isClosing} onDoubleClick={() => openDialog({ kind: 'modifyPosition', ticket: position.ticket })} onContextMenu={onMenu}>
      <td>{position.symbol}</td>
      <td className="num">{position.ticket}</td>
      <td>{formatTime(position.time)}</td>
      <td className={`side-${position.side}`}>{position.side}</td>
      <td className="num">{formatVolume(position.volume)}</td>
      <td className="num">{formatPrice(position.priceOpen, digits)}</td>
      <td className="num">{formatPrice(position.sl, digits)}</td>
      <td className="num">{formatPrice(position.tp, digits)}</td>
      <td className="num">{formatPrice(position.priceCurrent, digits)}</td>
      <td className="num">{formatMoney(position.swap)}</td>
      <td className={`num ${profitClass(position.profit)}`}>{formatMoney(position.profit)}</td>
      <td>{position.comment}</td>
      <td>
        <button className="row-close" title={isClosing ? 'Sending to the broker…' : 'Close position'} disabled={isClosing} onClick={close}>{isClosing ? <span className="spinner" aria-hidden /> : '×'}</button>
      </td>
    </tr>
  );
}

interface OrderRowProps {
  order: Order;
  onMenu: (event: React.MouseEvent) => void;
}

function OrderRow({ order, onMenu }: OrderRowProps) {
  const digits = useDigits(order.symbol);
  const isRemoving = useStore(session, (state) => isTradePending(state, { order: order.ticket }));
  const cancel = async () => {
    const result = await sendOrder({ action: 'remove', order: order.ticket });
    if (!result.isSuccess) {
      log(`delete order #${order.ticket} failed: ${result.comment}`, 'Trades');
    }
  };
  return (
    <tr className={isRemoving ? 'is-order is-pending' : 'is-order'} aria-busy={isRemoving} onDoubleClick={() => openDialog({ kind: 'modifyOrder', ticket: order.ticket })} onContextMenu={onMenu}>
      <td>{order.symbol}</td>
      <td className="num">{order.ticket}</td>
      <td>{formatTime(order.time)}</td>
      <td>{orderType(order.type)?.label.toLowerCase() ?? order.type}</td>
      <td className="num">{formatVolume(order.volume)}</td>
      <td className="num">{formatPrice(order.priceOpen, digits)}</td>
      <td className="num">{formatPrice(order.sl, digits)}</td>
      <td className="num">{formatPrice(order.tp, digits)}</td>
      <td className="num">{formatPrice(order.priceCurrent, digits)}</td>
      <td />
      <td className="num is-muted">placed</td>
      <td>{order.comment}</td>
      <td>
        <button className="row-close" title={isRemoving ? 'Sending to the broker…' : 'Delete order'} disabled={isRemoving} onClick={cancel}>{isRemoving ? <span className="spinner" aria-hidden /> : '×'}</button>
      </td>
    </tr>
  );
}

interface AccountSummaryProps {
  account: Account | null;
}

function AccountSummary({ account }: AccountSummaryProps) {
  if (!account) {
    return <span className="is-muted">No account information</span>;
  }
  const currency = account.currency;
  return (
    <span className="account-summary">
      Balance: <b>{formatMoney(account.balance)} {currency}</b>&nbsp;&nbsp; Equity: <b>{formatMoney(account.equity)}</b>&nbsp;&nbsp; Margin:{' '}
      <b>{formatMoney(account.margin)}</b>&nbsp;&nbsp; Free Margin: <b>{formatMoney(account.marginFree)}</b>&nbsp;&nbsp; Margin Level:{' '}
      <b>{account.margin ? `${formatMoney(account.marginLevel)} %` : ''}</b>
      {!Number.isFinite(account.margin) && <span className="is-muted"> Equity and margin estimates unavailable for this account state.</span>}
    </span>
  );
}

function TradeTab() {
  const positions = useStore(session, (state) => state.positions);
  const orders = useStore(session, (state) => state.orders);
  const account = useStore(session, (state) => state.account);
  const total = positions.reduce((sum, position) => sum + position.profit + position.swap, 0);

  const positionMenu = (event: React.MouseEvent, position: Position) => {
    openContextMenu(event, [
      { label: 'New Order', shortcut: 'F9', action: () => openDialog({ kind: 'order', symbol: position.symbol }) },
      { label: 'Close Position', action: () => void closePosition(position) },
      { label: 'Close By...', isDisabled: !account?.isHedging || account?.isFifo !== false || !positions.some((other) => other.symbol === position.symbol && other.side !== position.side), action: () => openDialog({ kind: 'closeBy', ticket: position.ticket }) },
      { label: 'Modify or Delete', action: () => openDialog({ kind: 'modifyPosition', ticket: position.ticket }) },
      { label: 'Manage (trailing, break-even, partials)...', action: () => openDialog({ kind: 'manage', ticket: position.ticket }) },
      { label: 'Reverse Position', action: () => { if (window.confirm(`Close #${position.ticket} and open ${position.volume} ${position.symbol} the other way?`)) void runBulk('reverse', position.ticket); } },
      { label: '', isSeparator: true },
      { label: 'Close All Positions', isDisabled: positions.length === 0, action: () => { if (window.confirm('Close every open position?')) void runBulk('closeAll'); } },
      { label: 'Close Profitable', isDisabled: positions.length === 0, action: () => void runBulk('closeProfitable') },
      { label: 'Close Losing', isDisabled: positions.length === 0, action: () => { if (window.confirm('Close every losing position?')) void runBulk('closeLosing'); } },
      { label: `Close All ${position.symbol}`, action: () => void runBulk('closeSymbol', undefined, position.symbol) },
      { label: 'Move All Stops to Break-even', isDisabled: positions.length === 0, action: () => void runBulk('breakEvenAll') },
    ]);
  };

  const orderMenu = (event: React.MouseEvent, order: Order) => {
    openContextMenu(event, [
      { label: 'Modify Order', action: () => openDialog({ kind: 'modifyOrder', ticket: order.ticket }) },
      { label: 'Delete Order', action: () => void sendOrder({ action: 'remove', order: order.ticket }) },
    ]);
  };

  const areaMenu = (event: React.MouseEvent) => openContextMenu(event, [
    { label: 'New Order', shortcut: 'F9', action: () => openDialog({ kind: 'order', symbol: positions[0]?.symbol ?? defaultSymbol() }) },
    { label: '', isSeparator: true },
    { label: 'Close All Positions', isDisabled: positions.length === 0, action: () => { if (window.confirm('Close every open position?')) void runBulk('closeAll'); } },
    { label: 'Close Profitable', isDisabled: positions.length === 0, action: () => void runBulk('closeProfitable') },
    { label: 'Close Losing', isDisabled: positions.length === 0, action: () => { if (window.confirm('Close every losing position?')) void runBulk('closeLosing'); } },
    { label: 'Delete All Pending Orders', isDisabled: orders.length === 0, action: () => { if (window.confirm('Delete every pending order?')) void runBulk('deletePending'); } },
    { label: 'Move All Stops to Break-even', isDisabled: positions.length === 0, action: () => void runBulk('breakEvenAll') },
  ]);

  return (
    <div className="scroll" onContextMenu={areaMenu}>
      <table className="grid trades">
        <thead>
          <tr>
            <th>Symbol</th>
            <th className="num">Ticket</th>
            <th>Time</th>
            <th>Type</th>
            <th className="num">Volume</th>
            <th className="num">Price</th>
            <th className="num">S / L</th>
            <th className="num">T / P</th>
            <th className="num">Price</th>
            <th className="num">Swap</th>
            <th className="num">Profit</th>
            <th>Comment</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {positions.map((position) => (
            <PositionRow key={position.ticket} position={position} onMenu={(event) => positionMenu(event, position)} />
          ))}
          <tr className="summary-row">
            <td colSpan={10}>
              <AccountSummary account={account} />
            </td>
            <td className={`num ${profitClass(total)}`}>{formatMoney(total)}</td>
            <td colSpan={2} />
          </tr>
          {orders.map((order) => (
            <OrderRow key={order.ticket} order={order} onMenu={(event) => orderMenu(event, order)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExposureTab() {
  const positions = useStore(session, (state) => state.positions);
  const symbols = useStore(session, (state) => state.symbols);
  const currency = useStore(session, (state) => state.account?.currency ?? '');
  const rows = useMemo(() => {
    const totals = new Map<string, { volume: number; profit: number }>();
    for (const position of positions) {
      const spec = symbols[position.symbol];
      const units = position.volume * (spec?.contractSize ?? 1) * (position.side === 'buy' ? 1 : -1);
      const asset = spec?.currencyBase ?? position.symbol;
      const total = totals.get(asset) ?? { volume: 0, profit: 0 };
      totals.set(asset, { volume: total.volume + units, profit: total.profit + position.profit });
    }
    return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [positions, symbols]);

  return (
    <div className="scroll">
      <table className="grid">
        <thead>
          <tr>
            <th>Asset</th>
            <th className="num">Volume</th>
            <th className="num">Profit, {currency}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([asset, total]) => (
            <tr key={asset}>
              <td>{asset}</td>
              <td className="num">{total.volume.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td>
              <td className={`num ${profitClass(total.profit)}`}>{formatMoney(total.profit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="empty">No open positions</p>}
    </div>
  );
}

function HistoryTab() {
  const [period, setPeriod] = useState<(typeof historyPeriods)[number]['key']>('week');
  const [history, setHistory] = useState<History | null>(null);
  const isLinked = useStore(session, (state) => state.link.state === 'open' && (state.status?.mode !== 'mt5-web' || !!state.account));
  const accountLogin = useStore(session, (state) => state.account?.login);
  const positionCount = useStore(session, (state) => state.positions.length + state.orders.length);
  const symbols = useStore(session, (state) => state.symbols);

  useEffect(() => {
    let isCurrent = true;
    setHistory(null);
    if (!isLinked) return;
    const days = historyPeriods.find((candidate) => candidate.key === period)!.days;
    const to = Math.floor(Date.now() / 1000) + 86400;
    terminal
      .request('history.get', { from: to - days * 86400 - 86400, to })
      .then((result) => { if (isCurrent) setHistory(result); })
      .catch((error: Error) => log(`history request failed: ${error.message}`, 'History'));
    return () => { isCurrent = false; };
  }, [period, isLinked, positionCount, accountLogin]);

  const deals = [...(history?.deals ?? [])].sort((left, right) => right.time - left.time);
  const profit = deals.filter((deal) => deal.type === 'buy' || deal.type === 'sell').reduce((sum, deal) => sum + deal.profit + deal.swap + deal.commission + deal.fee, 0);
  const deposit = deals.filter((deal) => deal.type === 'balance').reduce((sum, deal) => sum + deal.profit, 0);

  const menu = (event: React.MouseEvent) => openContextMenu(event, [
    ...historyPeriods.map((candidate) => ({ label: candidate.label, isChecked: period === candidate.key, action: () => setPeriod(candidate.key) })),
    { label: '', isSeparator: true },
    { label: 'Export CSV', isDisabled: !history, action: () => history && downloadHistory(history) },
  ]);

  return (
    <div className="scroll" onContextMenu={menu}>
      <div className="history-filter">
        <label>
          Period{' '}
          <select value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}>
            {historyPeriods.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <button disabled={!history} onClick={() => history && downloadHistory(history)}>Export CSV</button>
      </div>
      <table className="grid trades">
        <thead>
          <tr>
            <th>Time</th>
            <th className="num">Deal</th>
            <th>Symbol</th>
            <th>Type</th>
            <th>Direction</th>
            <th className="num">Volume</th>
            <th className="num">Price</th>
            <th className="num">Order</th>
            <th className="num">Commission</th>
            <th className="num">Swap</th>
            <th className="num">Profit</th>
            <th>Comment</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.ticket}>
              <td>{formatTime(deal.time)}</td>
              <td className="num">{deal.ticket}</td>
              <td>{deal.symbol}</td>
              <td>{deal.type}</td>
              <td>{deal.type === 'buy' || deal.type === 'sell' ? deal.entry : ''}</td>
              <td className="num">{deal.volume ? formatVolume(deal.volume) : ''}</td>
              <td className="num">{formatPrice(deal.price, symbols[deal.symbol]?.digits ?? 5)}</td>
              <td className="num">{deal.order || ''}</td>
              <td className="num">{formatMoney(deal.commission)}</td>
              <td className="num">{formatMoney(deal.swap)}</td>
              <td className={`num ${profitClass(deal.profit)}`}>{formatMoney(deal.profit)}</td>
              <td>{deal.comment}</td>
            </tr>
          ))}
          <tr className="summary-row">
            <td colSpan={12}>
              Profit: <b className={profitClass(profit)}>{formatMoney(profit)}</b>&nbsp;&nbsp; Deposit: <b>{formatMoney(deposit)}</b>&nbsp;&nbsp; Deals: <b>{deals.length}</b>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function JournalTab() {
  const journal = useStore(session, (state) => state.journal);
  const menu = (event: React.MouseEvent) => openContextMenu(event, [
    { label: 'Copy All', isDisabled: !journal.length, action: () => void navigator.clipboard.writeText([...journal].reverse().map((entry) => `${formatTime(entry.time)}\t${entry.source}\t${entry.message}`).join('\n')) },
    { label: 'Clear', isDisabled: !journal.length, action: () => session.set({ journal: [] }) },
  ]);
  return (
    <div className="scroll" onContextMenu={menu}>
      <table className="grid journal">
        <thead>
          <tr>
            <th>Time</th>
            <th>Source</th>
            <th>Message</th>
          </tr>
        </thead>
        <tbody>
          {[...journal].reverse().map((entry, index) => (
            <tr key={`${entry.time}-${index}`}>
              <td>{formatTime(entry.time)}</td>
              <td>{entry.source}</td>
              <td>{entry.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Toolbox() {
  const tab = useStore(workspace, (state) => state.toolboxTab);
  return (
    <section className="toolbox" aria-label="Toolbox">
      <div className="toolbox-side">
        <span>Toolbox</span>
        <button className="panel-close" onClick={() => togglePanel('isToolboxShown')} aria-label="Close Toolbox">×</button>
      </div>
      <div className="toolbox-main">
        <div className="toolbox-content">
          {tab === 'trade' && <TradeTab />}
          {tab === 'exposure' && <ExposureTab />}
          {tab === 'history' && <HistoryTab />}
          {tab === 'journal' && <JournalTab />}
        </div>
        <div className="panel-tabs">
          {tabs.map((candidate) => (
            <button key={candidate.key} className={tab === candidate.key ? 'is-active' : ''} onClick={() => showToolbox(candidate.key)}>
              {candidate.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
