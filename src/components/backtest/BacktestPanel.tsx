import { orderType } from '../../../shared/protocol';
import type { MenuItem } from '../MenuBar';
import { accountFigures, floatingProfit } from '../../lib/backtest/engine';
import { dealReasonLabel, type SimOrder, type SimPosition } from '../../lib/backtest/model';
import {
  activeBacktest,
  backtest,
  backtestPanelTabs,
  breakEvenBacktestPositions,
  cancelBacktestOrder,
  cancelBacktestOrders,
  closeBacktestPosition,
  closeBacktestPositions,
  dismissBacktestNotice,
  downloadBacktestTrades,
  endBacktest,
  modifyBacktestPosition,
  reportBacktest,
  reverseBacktestPosition,
  setBacktestPanel,
  useActiveBacktest,
} from '../../lib/backtest/runtime';
import { simulationOf, type BacktestSession } from '../../lib/backtest/session-model';
import { netOf, rMultiple } from '../../lib/backtest/stats';
import { openContextMenu } from '../../lib/context-menu';
import { formatMoney, formatPrice, formatTime, formatVolume } from '../../lib/format';
import { useStore } from '../../lib/store';
import { activeChart, openDialog, workspace } from '../../lib/workspace';
import { ToolButton } from '../Toolbar';
import { BacktestStatistics } from './BacktestStatistics';

const profitClass = (value: number | null) => (value === null ? '' : value > 0 ? 'is-profit' : value < 0 ? 'is-loss' : '');
const separator: MenuItem = { label: '', isSeparator: true };

// The symbol a new ticket starts on: the active chart's, as F9 does.
const ticketSymbol = (item: BacktestSession) => activeChart(workspace.get())?.symbol ?? item.symbol;

function closeHalf(position: SimPosition, step: number): void {
  const half = Math.floor(position.volume / 2 / step) * step;
  reportBacktest(half > 0 ? closeBacktestPosition(position.ticket, Number(half.toFixed(8))) : `#${position.ticket} is too small to halve.`);
}

interface PositionsTableProps {
  item: BacktestSession;
}

function PositionsTable({ item }: PositionsTableProps) {
  const bids = useStore(backtest, (state) => state.bids);
  const simulation = simulationOf(item);
  const { positions } = item.book;
  const menu = (event: React.MouseEvent, position?: SimPosition) => openContextMenu(event, [
    { label: 'New Order', shortcut: 'F9', action: () => openDialog({ kind: 'backtestOrder', symbol: position?.symbol ?? ticketSymbol(item) }) },
    ...(position ? [
      separator,
      { label: 'Modify or Close...', action: () => openDialog({ kind: 'backtestPosition', ticket: position.ticket }) },
      { label: 'Close Position', action: () => reportBacktest(closeBacktestPosition(position.ticket)) },
      { label: 'Close Half', action: () => closeHalf(position, item.terms[position.symbol]?.volumeStep ?? 0.01) },
      { label: 'Move Stop to Break-even', action: () => reportBacktest(modifyBacktestPosition(position.ticket, position.priceOpen, position.tp)) },
      { label: 'Reverse Position', action: () => void reverseBacktestPosition(position.ticket).then(reportBacktest) },
    ] : []),
    separator,
    { label: 'Close All Positions', isDisabled: !positions.length, action: () => reportBacktest(closeBacktestPositions()) },
    { label: 'Close Profitable', isDisabled: !positions.length, action: () => reportBacktest(closeBacktestPositions((candidate) => (floatingProfit(simulation, candidate, bids) ?? 0) > 0)) },
    { label: 'Close Losing', isDisabled: !positions.length, action: () => reportBacktest(closeBacktestPositions((candidate) => (floatingProfit(simulation, candidate, bids) ?? 0) < 0)) },
    { label: 'Move All Stops to Break-even', isDisabled: !positions.length, action: () => reportBacktest(breakEvenBacktestPositions()) },
  ]);
  if (!positions.length) return <p className="empty" onContextMenu={(event) => menu(event)}>No open positions. Trade from the chart, the buttons above, or New Order (F9).</p>;
  return (
    <table className="grid trades" onContextMenu={(event) => menu(event)}>
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
          <th className="num">Profit</th>
          <th className="num">R</th>
          <th>Comment</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {positions.map((position) => {
          const digits = item.terms[position.symbol]?.digits ?? 5;
          const profit = floatingProfit(simulation, position, bids);
          const bid = bids[position.symbol];
          const spread = (item.terms[position.symbol]?.spreadPoints ?? 0) * (item.terms[position.symbol]?.point ?? 0);
          const current = bid === undefined ? undefined : position.side === 'buy' ? bid : bid + spread;
          const r = profit !== null && position.initialRisk > 0 ? profit / position.initialRisk : null;
          return (
            <tr key={position.ticket} onDoubleClick={() => openDialog({ kind: 'backtestPosition', ticket: position.ticket })} onContextMenu={(event) => menu(event, position)}>
              <td>{position.symbol}</td>
              <td className="num">{position.ticket}</td>
              <td>{formatTime(position.time, false)}</td>
              <td className={`side-${position.side}`}>{position.side}</td>
              <td className="num">{formatVolume(position.volume)}</td>
              <td className="num">{formatPrice(position.priceOpen, digits)}</td>
              <td className="num">{formatPrice(position.sl, digits)}</td>
              <td className="num">{formatPrice(position.tp, digits)}</td>
              <td className="num">{formatPrice(current, digits)}</td>
              <td className={`num ${profitClass(profit)}`}>{formatMoney(profit ?? undefined)}</td>
              <td className={`num ${profitClass(r)}`}>{r === null ? '' : r.toFixed(2)}</td>
              <td>{position.comment}</td>
              <td><button className="row-close" title="Close position" aria-label={`Close #${position.ticket}`} onClick={() => reportBacktest(closeBacktestPosition(position.ticket))}>×</button></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface OrdersTableProps {
  item: BacktestSession;
}

function OrdersTable({ item }: OrdersTableProps) {
  const { orders } = item.book;
  const menu = (event: React.MouseEvent, order?: SimOrder) => openContextMenu(event, [
    { label: 'New Order', shortcut: 'F9', action: () => openDialog({ kind: 'backtestOrder', symbol: order?.symbol ?? ticketSymbol(item) }) },
    ...(order ? [
      { label: 'Modify Order...', action: () => openDialog({ kind: 'backtestOrderEdit', ticket: order.ticket }) },
      { label: 'Delete Order', action: () => reportBacktest(cancelBacktestOrder(order.ticket)) },
    ] : []),
    separator,
    { label: 'Delete All Pending Orders', isDisabled: !orders.length, action: () => reportBacktest(cancelBacktestOrders()) },
  ]);
  if (!orders.length) return <p className="empty" onContextMenu={(event) => menu(event)}>No pending orders.</p>;
  return (
    <table className="grid trades" onContextMenu={(event) => menu(event)}>
      <thead>
        <tr>
          <th>Symbol</th>
          <th className="num">Ticket</th>
          <th>Time</th>
          <th>Type</th>
          <th className="num">Volume</th>
          <th className="num">Price</th>
          <th className="num">Stop limit</th>
          <th className="num">S / L</th>
          <th className="num">T / P</th>
          <th>Expires</th>
          <th>Comment</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => {
          const digits = item.terms[order.symbol]?.digits ?? 5;
          return (
            <tr key={order.ticket} className="is-order" onDoubleClick={() => openDialog({ kind: 'backtestOrderEdit', ticket: order.ticket })} onContextMenu={(event) => menu(event, order)}>
              <td>{order.symbol}</td>
              <td className="num">{order.ticket}</td>
              <td>{formatTime(order.time, false)}</td>
              <td>{orderType(order.type)?.label.toLowerCase()}</td>
              <td className="num">{formatVolume(order.volume)}</td>
              <td className="num">{formatPrice(order.price, digits)}</td>
              <td className="num">{formatPrice(order.stopLimit, digits)}</td>
              <td className="num">{formatPrice(order.sl, digits)}</td>
              <td className="num">{formatPrice(order.tp, digits)}</td>
              <td>{order.expiration ? formatTime(order.expiration, false) : 'GTC'}</td>
              <td>{order.comment}</td>
              <td><button className="row-close" title="Delete order" aria-label={`Delete order #${order.ticket}`} onClick={() => reportBacktest(cancelBacktestOrder(order.ticket))}>×</button></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface HistoryTableProps {
  item: BacktestSession;
}

function HistoryTable({ item }: HistoryTableProps) {
  const trades = [...item.book.trades].sort((left, right) => right.closeTime - left.closeTime);
  const menu = (event: React.MouseEvent) => openContextMenu(event, [{ label: 'Export CSV', isDisabled: !trades.length, action: () => downloadBacktestTrades(item) }]);
  if (!trades.length) return <p className="empty">Closed trades appear here, with their result in money and in R.</p>;
  return (
    <table className="grid trades" onContextMenu={menu}>
      <thead>
        <tr>
          <th className="num">Ticket</th>
          <th>Symbol</th>
          <th>Type</th>
          <th className="num">Volume</th>
          <th>Opened</th>
          <th className="num">Price</th>
          <th>Closed</th>
          <th className="num">Price</th>
          <th>Exit</th>
          <th className="num">Commission</th>
          <th className="num">Net</th>
          <th className="num">R</th>
          <th className="num">MAE</th>
          <th className="num">MFE</th>
          <th>Comment</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((trade) => {
          const digits = item.terms[trade.symbol]?.digits ?? 5;
          const net = netOf(trade);
          const r = rMultiple(trade);
          return (
            <tr key={trade.ticket}>
              <td className="num">{trade.ticket}</td>
              <td>{trade.symbol}</td>
              <td className={`side-${trade.side}`}>{trade.side}</td>
              <td className="num">{formatVolume(trade.volume)}</td>
              <td>{formatTime(trade.openTime, false)}</td>
              <td className="num">{formatPrice(trade.priceOpen, digits)}</td>
              <td>{formatTime(trade.closeTime, false)}</td>
              <td className="num">{formatPrice(trade.priceClose, digits)}</td>
              <td>{dealReasonLabel(trade.reason)}</td>
              <td className="num">{formatMoney(trade.commission)}</td>
              <td className={`num ${profitClass(net)}`}>{formatMoney(net)}</td>
              <td className={`num ${profitClass(r)}`}>{r === null ? '' : r.toFixed(2)}</td>
              <td className="num">{formatMoney(trade.mae)}</td>
              <td className="num">{formatMoney(trade.mfe)}</td>
              <td>{trade.comment}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface JournalTableProps {
  item: BacktestSession;
}

function JournalTable({ item }: JournalTableProps) {
  const lines = [...item.book.journal].reverse();
  if (!lines.length) return <p className="empty">Fills, stops and changes to orders are recorded here at replay time.</p>;
  return (
    <table className="grid journal">
      <tbody>
        {lines.map((line, index) => (
          <tr key={`${line.time}-${index}`}>
            <td>{formatTime(line.time, false)}</td>
            <td>{line.message}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface BacktestSummaryProps {
  item: BacktestSession;
}

function BacktestSummary({ item }: BacktestSummaryProps) {
  const bids = useStore(backtest, (state) => state.bids);
  const figures = accountFigures(item.book, simulationOf(item), bids);
  const net = figures.equity - item.settings.balance;
  const { currency } = item;
  return (
    <dl className="backtest-figures">
      <div><dt>Balance</dt><dd>{formatMoney(figures.balance)} {currency}</dd></div>
      <div><dt>Equity</dt><dd>{formatMoney(figures.equity)}</dd></div>
      <div><dt>Open P/L</dt><dd className={profitClass(figures.profit)}>{formatMoney(figures.profit)}</dd></div>
      <div><dt>Free margin</dt><dd>{formatMoney(figures.freeMargin)}</dd></div>
      {figures.marginLevel !== null && <div><dt>Margin level</dt><dd>{formatMoney(figures.marginLevel)} %</dd></div>}
      <div><dt>Since start</dt><dd className={profitClass(net)}>{net >= 0 ? '+' : ''}{(net / item.settings.balance * 100).toFixed(2)} %</dd></div>
      <div><dt>Max DD</dt><dd>{item.book.maxDrawdownPercent.toFixed(1)} %</dd></div>
    </dl>
  );
}

// The running backtest under the replay toolbar: the simulated account, its positions and
// orders, its closed trades and statistics. It works the same in trade and analysis mode.
export function BacktestPanel() {
  const item = useActiveBacktest();
  const tab = useStore(backtest, (state) => state.panelTab);
  const isCollapsed = useStore(backtest, (state) => state.isPanelCollapsed);
  const isStarting = useStore(backtest, (state) => state.isStarting);
  const notice = useStore(backtest, (state) => state.notice);
  const problems = useStore(backtest, (state) => state.problems);
  if (!item) return null;
  const counts: Partial<Record<(typeof backtestPanelTabs)[number]['key'], number>> = { positions: item.book.positions.length, orders: item.book.orders.length, history: item.book.trades.length };
  const problemList = Object.values(problems);

  return (
    <section className={`backtest-panel${isCollapsed ? ' is-collapsed' : ''}`} aria-label={`Backtest ${item.name}`}>
      <header className="backtest-header">
        <ToolButton icon="chevron" isActive={!isCollapsed} hint={{ title: isCollapsed ? 'Show Backtest Panel' : 'Hide Backtest Panel' }} onClick={() => setBacktestPanel({ isPanelCollapsed: !isCollapsed })} />
        <strong className="backtest-name" title={`Started ${formatTime(item.startTime, false)} on ${item.account}`}>{item.name}</strong>
        {isStarting ? <span className="backtest-figures is-muted"><span className="spinner" aria-hidden /> Loading history…</span> : <BacktestSummary item={item} />}
        <ToolButton text="New Order" isPrimary hint={{ title: 'New Order', shortcut: 'F9', description: 'A market or pending order in the backtest.' }} onClick={() => openDialog({ kind: 'backtestOrder', symbol: ticketSymbol(activeBacktest(backtest.get()) ?? item) })} />
        <ToolButton text="Sessions" hint={{ title: 'Backtest Sessions', description: 'Start, resume or restart a session.' }} onClick={() => openDialog({ kind: 'backtests' })} />
        <ToolButton icon="exit" text="End Session" textLevel={1} hint={{ title: 'End Session', description: 'Save the backtest and go back to live charts. Resume it any time from Sessions.' }} onClick={endBacktest} />
      </header>
      {(notice || problemList.length > 0) && (
        <div className="backtest-notice" role="status">
          <span>{notice ?? problemList[0]}</span>
          {notice && <button type="button" className="row-close" aria-label="Dismiss" onClick={dismissBacktestNotice}>×</button>}
        </div>
      )}
      {!isCollapsed && (
        <>
          <div className="backtest-body scroll">
            {tab === 'positions' && <PositionsTable item={item} />}
            {tab === 'orders' && <OrdersTable item={item} />}
            {tab === 'history' && <HistoryTable item={item} />}
            {tab === 'statistics' && <BacktestStatistics item={item} />}
            {tab === 'journal' && <JournalTable item={item} />}
          </div>
          <div className="panel-tabs" role="tablist" aria-label="Backtest">
            {backtestPanelTabs.map((candidate) => (
              <button key={candidate.key} role="tab" aria-selected={tab === candidate.key} className={tab === candidate.key ? 'is-active' : ''} onClick={() => setBacktestPanel({ panelTab: candidate.key })}>
                {candidate.label}{counts[candidate.key] ? ` (${counts[candidate.key]})` : ''}
              </button>
            ))}
            <div className="toolbar-spacer" />
            {tab === 'history' && <button type="button" className="panel-tabs-action" disabled={!item.book.trades.length} onClick={() => downloadBacktestTrades(item)}>Export CSV</button>}
          </div>
        </>
      )}
    </section>
  );
}
