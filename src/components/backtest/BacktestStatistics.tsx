import { formatDuration } from '../../lib/backtest/chart-time';
import type { BacktestSession } from '../../lib/backtest/session-model';
import { backtestStats } from '../../lib/backtest/stats';
import { formatMoney } from '../../lib/format';

interface StatTileProps {
  label: string;
  value: string;
  detail?: string;
  tone?: 'is-profit' | 'is-loss' | '';
}

export function StatTile({ label, value, detail, tone = '' }: StatTileProps) {
  return (
    <div className="stat-tile" title={detail}>
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

export const toneOf = (value: number | null) => (value === null ? '' : value > 0 ? 'is-profit' : value < 0 ? 'is-loss' : '');
const money = (value: number | null) => (value === null ? '-' : formatMoney(value));
const percent = (value: number | null, digits = 1) => (value === null ? '-' : `${value.toFixed(digits)} %`);
const ratio = (value: number | null) => (value === null ? '-' : value.toFixed(2));

interface PerformanceGridProps {
  item: BacktestSession;
}

// The session's statistics over its closed trades, money in the account currency.
export function PerformanceGrid({ item }: PerformanceGridProps) {
  const stats = backtestStats(item.book, item.settings.balance);
  return (
    <div className="stat-grid">
      <StatTile label="Net profit" value={money(stats.netProfit)} detail={`${percent(stats.returnPercent, 2)} of the starting balance`} tone={toneOf(stats.netProfit)} />
      <StatTile label="Win rate" value={percent(stats.winRate)} detail={`${stats.wins} won, ${stats.losses} lost of ${stats.trades}`} />
      <StatTile label="Profit factor" value={ratio(stats.profitFactor)} detail={`${formatMoney(stats.grossProfit)} won, ${formatMoney(stats.grossLoss)} lost`} />
      <StatTile label="Average R" value={stats.averageR === null ? '-' : `${stats.averageR.toFixed(2)} R`} detail="Over trades that had a stop loss" tone={toneOf(stats.averageR)} />
      <StatTile label="Expectancy" value={money(stats.expectancy)} detail="Average result per trade" tone={toneOf(stats.expectancy)} />
      <StatTile label="Max drawdown" value={percent(stats.maxDrawdownPercent)} detail={`${formatMoney(-stats.maxDrawdown)} from peak equity`} tone={stats.maxDrawdown > 0 ? 'is-loss' : ''} />
      <StatTile label="Average win" value={money(stats.averageWin)} detail={`Largest ${money(stats.largestWin)}`} />
      <StatTile label="Average loss" value={money(stats.averageLoss)} detail={`Largest ${money(stats.largestLoss)}`} />
      <StatTile label="Long / short" value={`${percent(stats.long.winRate, 0)} / ${percent(stats.short.winRate, 0)}`} detail={`Win rate of ${stats.long.trades} long and ${stats.short.trades} short trades`} />
      <StatTile label="Streaks" value={`${stats.maxConsecutiveWins} / ${stats.maxConsecutiveLosses}`} detail="Most wins / losses in a row" />
      <StatTile label="Recovery factor" value={ratio(stats.recoveryFactor)} detail="Net profit over max drawdown" />
      <StatTile label="Average hold" value={stats.averageHoldMs === null ? '-' : formatDuration(stats.averageHoldMs)} detail={`Commission ${money(stats.commission)} ${item.currency}`} />
    </div>
  );
}
