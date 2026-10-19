import { formatDuration } from '../../lib/backtest/chart-time';
import type { BacktestSession } from '../../lib/backtest/session-model';
import { backtestStats } from '../../lib/backtest/stats';
import { formatMoney } from '../../lib/format';
import { EquityCurve } from './EquityCurve';

interface StatTileProps {
  label: string;
  value: string;
  detail?: string;
  tone?: 'is-profit' | 'is-loss' | '';
}

function StatTile({ label, value, detail, tone = '' }: StatTileProps) {
  return (
    <div className="stat-tile">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

const toneOf = (value: number | null) => (value === null ? '' : value > 0 ? 'is-profit' : value < 0 ? 'is-loss' : '');
const money = (value: number | null, currency: string) => (value === null ? '-' : `${formatMoney(value)} ${currency}`);
const percent = (value: number | null, digits = 1) => (value === null ? '-' : `${value.toFixed(digits)} %`);
const ratio = (value: number | null) => (value === null ? '-' : value.toFixed(2));

interface BacktestStatisticsProps {
  item: BacktestSession;
}

export function BacktestStatistics({ item }: BacktestStatisticsProps) {
  const stats = backtestStats(item.book, item.settings.balance);
  const { currency } = item;
  return (
    <div className="backtest-statistics">
      <div className="stat-grid">
        <StatTile label="Net profit" value={money(stats.netProfit, currency)} detail={`${percent(stats.returnPercent, 2)} of the starting balance`} tone={toneOf(stats.netProfit)} />
        <StatTile label="Trades" value={String(stats.trades)} detail={`${stats.wins} won, ${stats.losses} lost`} />
        <StatTile label="Win rate" value={percent(stats.winRate)} detail={`Long ${percent(stats.long.winRate, 0)} of ${stats.long.trades}, short ${percent(stats.short.winRate, 0)} of ${stats.short.trades}`} />
        <StatTile label="Profit factor" value={ratio(stats.profitFactor)} detail={`${formatMoney(stats.grossProfit)} won, ${formatMoney(stats.grossLoss)} lost`} />
        <StatTile label="Expectancy" value={money(stats.expectancy, currency)} detail="Average result per trade" tone={toneOf(stats.expectancy)} />
        <StatTile label="Average R" value={stats.averageR === null ? '-' : `${stats.averageR.toFixed(2)} R`} detail="Over trades that had a stop loss" tone={toneOf(stats.averageR)} />
        <StatTile label="Max drawdown" value={money(-stats.maxDrawdown, currency)} detail={`${percent(stats.maxDrawdownPercent)} of peak equity`} tone={stats.maxDrawdown > 0 ? 'is-loss' : ''} />
        <StatTile label="Recovery factor" value={ratio(stats.recoveryFactor)} detail="Net profit over max drawdown" />
        <StatTile label="Average win" value={money(stats.averageWin, currency)} detail={`Largest ${money(stats.largestWin, currency)}`} />
        <StatTile label="Average loss" value={money(stats.averageLoss, currency)} detail={`Largest ${money(stats.largestLoss, currency)}`} />
        <StatTile label="Streaks" value={`${stats.maxConsecutiveWins} / ${stats.maxConsecutiveLosses}`} detail="Most wins / losses in a row" />
        <StatTile label="Average hold" value={stats.averageHoldMs === null ? '-' : formatDuration(stats.averageHoldMs)} detail={`Commission ${money(stats.commission, currency)}`} />
      </div>
      <EquityCurve points={item.book.curve} currency={currency} initialBalance={item.settings.balance} />
    </div>
  );
}
