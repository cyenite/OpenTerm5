import type { ReactNode } from 'react';
import { orderType } from '../../../shared/protocol';
import type { MenuItem } from '../MenuBar';
import { accountFigures, floatingProfit } from '../../lib/backtest/engine';
import { dealReasonLabel, type SimOrder, type SimPosition } from '../../lib/backtest/model';
import {
  backtest,
  breakEvenBacktestPositions,
  cancelBacktestOrder,
  cancelBacktestOrders,
  closeBacktestPosition,
  closeBacktestPositions,
  downloadBacktestTrades,
  endBacktest,
  exitBacktestMode,
  modifyBacktestPosition,
  reportBacktest,
  restartBacktest,
  resumeBacktest,
  reverseBacktestPosition,
  toggleBacktestSection,
  useActiveBacktest,
  type BacktestSection,
} from '../../lib/backtest/runtime';
import { simulationOf, type BacktestSession } from '../../lib/backtest/session-model';
import { backtestStats, netOf, rMultiple } from '../../lib/backtest/stats';
import { placeBacktestOrder, togglePanel } from '../../lib/commands';
import { openContextMenu } from '../../lib/context-menu';
import { formatMoney, formatPrice, formatTime, formatVolume } from '../../lib/format';
import { useStore } from '../../lib/store';
import { openDialog, workspace } from '../../lib/workspace';
import { Panel } from '../Panel';
import { EquityCurve } from './EquityCurve';
import { PerformanceGrid, StatTile, toneOf } from './BacktestStatistics';

const separator: MenuItem = { label: '', isSeparator: true };

// Month, day and time: the year is in the session's period above.
const shortTime = (time: number) => formatTime(time, false).slice(5);

interface SectionProps {
  section: BacktestSection;
  title: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
}

function Section({ section, title, count, actions, children }: SectionProps) {
  const isCollapsed = useStore(backtest, (state) => state.collapsedSections.includes(section));
  return (
    <section className={`backtest-section${isCollapsed ? ' is-collapsed' : ''}`}>
      <header>
        <button type="button" className="backtest-section-toggle" aria-expanded={!isCollapsed} onClick={() => toggleBacktestSection(section)}>
          <span className="backtest-chevron" aria-hidden>›</span>
          {title}
          {count !== undefined && count > 0 && <span className="backtest-count">{count}</span>}
        </button>
        {!isCollapsed && actions}
      </header>
      {!isCollapsed && children}
    </section>
  );
}

function closeHalf(position: SimPosition, step: number): void {
  const half = Math.floor(position.volume / 2 / step) * step;
  reportBacktest(half > 0 ? closeBacktestPosition(position.ticket, Number(half.toFixed(8))) : `#${position.ticket} is too small to halve.`);
}

interface ItemProps {
  item: BacktestSession;
}

function Positions({ item }: ItemProps) {
  const bids = useStore(backtest, (state) => state.bids);
  const simulation = simulationOf(item);
  const { positions } = item.book;
  const menu = (event: React.MouseEvent, position?: SimPosition) => openContextMenu(event, [
    { label: 'Place Order', shortcut: 'F9', action: placeBacktestOrder },
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
  if (!positions.length) return <p className="backtest-empty" onContextMenu={(event) => menu(event)}>No open positions. Place Order (F9) puts the entry, stop loss and take profit on the chart as lines; the volume follows your risk.</p>;
  return (
    <table className="grid backtest-rows" onContextMenu={(event) => menu(event)}>
      <tbody>
        {positions.map((position) => {
          const digits = item.terms[position.symbol]?.digits ?? 5;
          const profit = floatingProfit(simulation, position, bids);
          const r = profit !== null && position.initialRisk > 0 ? profit / position.initialRisk : null;
          const levels = [position.sl ? `SL ${formatPrice(position.sl, digits)}` : '', position.tp ? `TP ${formatPrice(position.tp, digits)}` : ''].filter(Boolean).join(', ');
          return (
            <tr key={position.ticket} title={`#${position.ticket} opened ${formatTime(position.time, false)}${levels ? `; ${levels}` : ''}`} onDoubleClick={() => openDialog({ kind: 'backtestPosition', ticket: position.ticket })} onContextMenu={(event) => menu(event, position)}>
              <td><span className={`side-tag is-${position.side}`}>{position.side}</span> {position.symbol}</td>
              <td className="num">{formatVolume(position.volume)}</td>
              <td className="num is-wide">{formatPrice(position.priceOpen, digits)}</td>
              <td className={`num ${toneOf(profit)}`}>{formatMoney(profit ?? undefined)}</td>
              <td className={`num ${toneOf(r)}`}>{r === null ? '' : `${r.toFixed(2)}R`}</td>
              <td><button className="row-close" title="Close position" aria-label={`Close #${position.ticket}`} onClick={() => reportBacktest(closeBacktestPosition(position.ticket))}>×</button></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Orders({ item }: ItemProps) {
  const { orders } = item.book;
  const menu = (event: React.MouseEvent, order?: SimOrder) => openContextMenu(event, [
    ...(order ? [
      { label: 'Modify Order...', action: () => openDialog({ kind: 'backtestOrderEdit', ticket: order.ticket }) },
      { label: 'Delete Order', action: () => reportBacktest(cancelBacktestOrder(order.ticket)) },
      separator,
    ] : []),
    { label: 'Delete All Pending Orders', isDisabled: !orders.length, action: () => reportBacktest(cancelBacktestOrders()) },
  ]);
  if (!orders.length) return <p className="backtest-empty">No pending orders.</p>;
  return (
    <table className="grid backtest-rows" onContextMenu={(event) => menu(event)}>
      <tbody>
        {orders.map((order) => {
          const digits = item.terms[order.symbol]?.digits ?? 5;
          return (
            <tr key={order.ticket} title={`#${order.ticket} placed ${formatTime(order.time, false)}${order.expiration ? `, expires ${formatTime(order.expiration, false)}` : ''}`} onDoubleClick={() => openDialog({ kind: 'backtestOrderEdit', ticket: order.ticket })} onContextMenu={(event) => menu(event, order)}>
              <td>{orderType(order.type)?.label} {order.symbol}</td>
              <td className="num">{formatVolume(order.volume)}</td>
              <td className="num">{formatPrice(order.price, digits)}</td>
              <td><button className="row-close" title="Delete order" aria-label={`Delete order #${order.ticket}`} onClick={() => reportBacktest(cancelBacktestOrder(order.ticket))}>×</button></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Trades({ item }: ItemProps) {
  const trades = [...item.book.trades].sort((left, right) => right.closeTime - left.closeTime);
  if (!trades.length) return <p className="backtest-empty">Closed trades appear here with their result in money and in R.</p>;
  return (
    <table className="grid backtest-rows">
      <tbody>
        {trades.map((trade) => {
          const digits = item.terms[trade.symbol]?.digits ?? 5;
          const net = netOf(trade);
          const r = rMultiple(trade);
          return (
            <tr key={trade.ticket} title={`#${trade.ticket} closed ${formatTime(trade.closeTime, false)} by ${dealReasonLabel(trade.reason).toLowerCase()}, ${formatVolume(trade.volume)} lots, ${formatPrice(trade.priceOpen, digits)} to ${formatPrice(trade.priceClose, digits)}, opened ${formatTime(trade.openTime, false)}; MAE ${formatMoney(trade.mae)}, MFE ${formatMoney(trade.mfe)}`}>
              <td className="is-muted is-wide">{shortTime(trade.closeTime)}</td>
              <td><span className={`side-tag is-${trade.side}`}>{trade.side}</span> {trade.symbol}</td>
              <td className="is-muted is-wide">{dealReasonLabel(trade.reason)}</td>
              <td className={`num ${toneOf(net)}`}>{formatMoney(net)}</td>
              <td className={`num ${toneOf(r)}`}>{r === null ? '' : `${r.toFixed(2)}R`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Journal({ item }: ItemProps) {
  const lines = [...item.book.journal].reverse().slice(0, 300);
  if (!lines.length) return <p className="backtest-empty">Fills, stops and changes to orders, at replay time.</p>;
  return (
    <ol className="backtest-journal">
      {lines.map((line, index) => <li key={`${line.time}-${index}`}><time>{shortTime(line.time)}</time> {line.message}</li>)}
    </ol>
  );
}

function Account({ item }: ItemProps) {
  const bids = useStore(backtest, (state) => state.bids);
  const isStarting = useStore(backtest, (state) => state.isStarting);
  const figures = accountFigures(item.book, simulationOf(item), bids);
  const change = (figures.equity - item.settings.balance) / item.settings.balance * 100;
  return (
    <div className="backtest-account">
      <div className="backtest-equity">
        <span>Equity</span>
        <strong>{formatMoney(figures.equity)} <small>{item.currency}</small></strong>
        <em className={toneOf(change)}>{change >= 0 ? '+' : ''}{change.toFixed(2)} %</em>
      </div>
      <div className="stat-grid is-compact">
        <StatTile label="Balance" value={formatMoney(figures.balance)} />
        <StatTile label="Open P/L" value={formatMoney(figures.profit)} tone={toneOf(figures.profit)} />
        <StatTile label="Free margin" value={formatMoney(figures.freeMargin)} detail={figures.marginLevel === null ? undefined : `Margin level ${formatMoney(figures.marginLevel)} %`} />
        <StatTile label="Max DD" value={`${item.book.maxDrawdownPercent.toFixed(1)} %`} tone={item.book.maxDrawdownPercent > 0 ? 'is-loss' : ''} />
      </div>
      {isStarting && <p className="backtest-empty"><span className="spinner" aria-hidden /> Loading history…</p>}
    </div>
  );
}

function SessionView({ item }: ItemProps) {
  const problems = useStore(backtest, (state) => Object.values(state.problems));
  return (
    <>
      <div className="backtest-session">
        <strong title={item.name}>{item.name}</strong>
        <span className="is-muted">{item.symbol} {item.timeframe} · from {formatTime(item.startTime, false).slice(0, 10)}{item.endTime ? ` to ${formatTime(item.endTime, false).slice(0, 10)}` : ''} · 1:{item.settings.leverage}</span>
      </div>
      {problems.map((problem) => <p key={problem} className="backtest-problem">{problem}</p>)}
      <Account item={item} />
      <EquityCurve points={item.book.curve} currency={item.currency} initialBalance={item.settings.balance} />
      <Section section="performance" title="Performance"><PerformanceGrid item={item} /></Section>
      <Section section="positions" title="Positions" count={item.book.positions.length}><Positions item={item} /></Section>
      <Section section="orders" title="Orders" count={item.book.orders.length}><Orders item={item} /></Section>
      <Section section="trades" title="Trades" count={item.book.trades.length} actions={<button type="button" className="backtest-link" disabled={!item.book.trades.length} onClick={() => downloadBacktestTrades(item)}>Export CSV</button>}>
        <Trades item={item} />
      </Section>
      <Section section="journal" title="Journal"><Journal item={item} /></Section>
      <div className="backtest-actions">
        <button type="button" className="is-primary" onClick={placeBacktestOrder}>Place Order</button>
        <button type="button" onClick={endBacktest}>End Session</button>
      </div>
    </>
  );
}

function SessionList() {
  const sessions = useStore(backtest, (state) => state.sessions);
  const isBacktestMode = useStore(workspace, (state) => state.isBacktestMode);
  const resume = (id: string) => void resumeBacktest(id).catch((error: Error) => reportBacktest(error.message));
  const menu = (event: React.MouseEvent, item: BacktestSession) => openContextMenu(event, [
    { label: 'Resume', action: () => resume(item.id) },
    { label: 'Restart from the Start Date', action: () => { if (window.confirm(`Restart "${item.name}"? Its trades are cleared.`)) void restartBacktest(item.id).catch((error: Error) => reportBacktest(error.message)); } },
    separator,
    { label: 'Manage Sessions...', action: () => openDialog({ kind: 'backtests' }) },
  ]);
  return (
    <div className="backtest-idle">
      <p className="is-muted">Replay history bar by bar and trade it on a simulated account, placing orders with lines on the chart sized by your risk. Sessions save as you go.</p>
      <div className="backtest-actions">
        <button type="button" className="is-primary" onClick={() => openDialog({ kind: 'backtests' })}>New Session</button>
        {isBacktestMode && <button type="button" title="Leave Backtest Mode and go back to the layout you had" onClick={exitBacktestMode}>Leave Mode</button>}
      </div>
      {sessions.length > 0 && <h4>Recent sessions</h4>}
      <ul className="backtest-sessions-list">
        {sessions.slice(0, 12).map((item) => {
          const stats = backtestStats(item.book, item.settings.balance);
          const change = (item.book.balance - item.settings.balance) / item.settings.balance * 100;
          return (
            <li key={item.id} onDoubleClick={() => resume(item.id)} onContextMenu={(event) => menu(event, item)}>
              <div>
                <strong title={item.name}>{item.name}</strong>
                <span className="is-muted">{item.symbol} · {stats.trades} trades{stats.winRate === null ? '' : ` · ${stats.winRate.toFixed(0)} % won`} · {formatTime(item.book.time ?? item.startTime, false).slice(0, 10)}</span>
              </div>
              <em className={toneOf(change)}>{change >= 0 ? '+' : ''}{change.toFixed(1)} %</em>
              <button type="button" onClick={() => resume(item.id)}>Resume</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// The Backtest panel: a resizable dock panel with the running session's account, equity curve,
// performance, positions, orders, trades and journal, each section folding on its own; with no
// session running, the sessions to resume.
export function BacktestPanel() {
  const item = useActiveBacktest();
  return (
    <Panel title="Backtest" dock="backtest" onClose={() => togglePanel('isBacktestPanelShown')}>
      <div className="backtest-panel scroll">
        {item ? <SessionView item={item} /> : <SessionList />}
      </div>
    </Panel>
  );
}
