import type { Book, ClosedTrade, Side } from './model';

export interface SideStats {
  readonly trades: number;
  readonly winRate: number | null;
  readonly netProfit: number;
}

export interface BacktestStats {
  readonly wins: number;
  readonly trades: number;
  readonly losses: number;
  readonly winRate: number | null;
  readonly netProfit: number;
  readonly grossLoss: number;
  readonly commission: number;
  readonly expectancy: number | null;
  readonly averageR: number | null;
  readonly grossProfit: number;
  readonly averageWin: number | null;
  readonly largestWin: number | null;
  readonly averageLoss: number | null;
  readonly largestLoss: number | null;
  readonly maxDrawdown: number;
  readonly profitFactor: number | null;
  readonly returnPercent: number;
  readonly averageHoldMs: number | null;
  readonly recoveryFactor: number | null;
  readonly maxDrawdownPercent: number;
  readonly maxConsecutiveWins: number;
  readonly maxConsecutiveLosses: number;
  readonly long: SideStats;
  readonly short: SideStats;
}

// A trade's result after commission.
export const netOf = (trade: ClosedTrade) => trade.profit + trade.commission;

// The trade's result in multiples of what its first stop loss risked; null without one.
export const rMultiple = (trade: ClosedTrade) => (trade.initialRisk > 0 ? netOf(trade) / trade.initialRisk : null);

const average = (values: readonly number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

function streaks(trades: readonly ClosedTrade[]): { wins: number; losses: number } {
  let wins = 0;
  let losses = 0;
  let run = 0;
  for (const trade of trades) {
    const net = netOf(trade);
    run = net > 0 ? Math.max(1, run + 1) : net < 0 ? Math.min(-1, run - 1) : 0;
    wins = Math.max(wins, run);
    losses = Math.max(losses, -run);
  }
  return { wins, losses };
}

function sideStats(trades: readonly ClosedTrade[], side: Side): SideStats {
  const own = trades.filter((trade) => trade.side === side);
  const wins = own.filter((trade) => netOf(trade) > 0).length;
  return { trades: own.length, winRate: own.length ? wins / own.length * 100 : null, netProfit: own.reduce((sum, trade) => sum + netOf(trade), 0) };
}

// Statistics over the closed trades, in the order they closed. Break-even trades count as neither
// wins nor losses.
export function backtestStats(book: Book, initialBalance: number): BacktestStats {
  const trades = [...book.trades].sort((left, right) => left.closeTime - right.closeTime);
  const nets = trades.map(netOf);
  const winning = nets.filter((net) => net > 0);
  const losing = nets.filter((net) => net < 0);
  const grossProfit = winning.reduce((sum, net) => sum + net, 0);
  const grossLoss = losing.reduce((sum, net) => sum + net, 0);
  const netProfit = grossProfit + grossLoss;
  const decided = winning.length + losing.length;
  const rs = trades.map(rMultiple).filter((value): value is number => value !== null);
  const { wins, losses } = streaks(trades);
  return {
    wins: winning.length,
    trades: trades.length,
    losses: losing.length,
    winRate: decided ? winning.length / decided * 100 : null,
    netProfit,
    grossLoss,
    commission: trades.reduce((sum, trade) => sum + trade.commission, 0),
    expectancy: average(nets),
    averageR: average(rs),
    grossProfit,
    averageWin: average(winning),
    largestWin: winning.length ? Math.max(...winning) : null,
    averageLoss: average(losing),
    largestLoss: losing.length ? Math.min(...losing) : null,
    maxDrawdown: book.maxDrawdown,
    profitFactor: grossLoss < 0 ? grossProfit / -grossLoss : null,
    returnPercent: initialBalance > 0 ? (book.balance - initialBalance) / initialBalance * 100 : 0,
    averageHoldMs: average(trades.map((trade) => trade.closeTime - trade.openTime)),
    recoveryFactor: book.maxDrawdown > 0 ? netProfit / book.maxDrawdown : null,
    maxDrawdownPercent: book.maxDrawdownPercent,
    maxConsecutiveWins: wins,
    maxConsecutiveLosses: losses,
    long: sideStats(trades, 'buy'),
    short: sideStats(trades, 'sell'),
  };
}

const csvCell = (value: string | number) => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const isoTime = (time: number) => new Date(time).toISOString().slice(0, 19).replace('T', ' ');

// One row per closed trade, times in chart time as the panel shows them.
export function tradesCsv(trades: readonly ClosedTrade[], digitsOf: (symbol: string) => number): string {
  const header = ['Ticket', 'Symbol', 'Side', 'Volume', 'Open Time', 'Open Price', 'Close Time', 'Close Price', 'Exit', 'Profit', 'Commission', 'Net', 'R', 'MAE', 'MFE', 'Comment'];
  const rows = [...trades].sort((left, right) => left.closeTime - right.closeTime).map((trade) => {
    const digits = digitsOf(trade.symbol);
    const r = rMultiple(trade);
    return [trade.ticket, trade.symbol, trade.side, trade.volume.toFixed(2), isoTime(trade.openTime), trade.priceOpen.toFixed(digits), isoTime(trade.closeTime), trade.priceClose.toFixed(digits), trade.reason, trade.profit.toFixed(2), trade.commission.toFixed(2), netOf(trade).toFixed(2), r === null ? '' : r.toFixed(2), trade.mae.toFixed(2), trade.mfe.toFixed(2), trade.comment];
  });
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
}
