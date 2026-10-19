# Backtesting

A backtest replays history bar by bar while you trade a simulated account, the way you would trade
it live. Orders fill on the bars the replay passes, stops and targets trigger inside them, and the
session keeps every trade, its statistics and its equity curve. Sessions are saved, so you can stop
and come back to one later.

Backtests use your logged-in account's symbols and history. Nothing is sent to the broker: the
simulated account is separate from the real one, which stays visible in the Toolbox throughout.

## Starting a session

Click **Backtest** in the top bar (or **Tools > Backtesting...**), open **New Session** and choose:

- **Symbol.** If the layout in front does not show it, the active chart switches to it. Every chart
  of the layout takes part, and any symbol they show can be traded in the session.
- **Start** and, optionally, **End**, in chart time. The replay starts at the first bar every chart
  has, so it may start a little later than asked. With an end date the replay stops there.
- **Starting balance**, in the account's currency, and **Leverage**.
- **Spread**: each symbol's spread as the broker quotes it when the session first prices it, or a
  fixed number of points for every symbol.
- **Slippage** in points, taken against you on market orders, stop orders and stop losses.
- **Commission** in account currency per lot, charged when a position opens and again when it closes.
- **Stop out**, the margin level at which the most losing position is closed (0 turns it off).

**Start Backtest** loads enough history to reach the start, then begins the replay there. Use the
replay bar as usual: play (Shift+Down), step (Shift+Right), change the speed or the update interval.

A backtest only moves forward. Instead of Select Bar, the replay bar offers **Jump To**:

- the next **Sydney**, **Tokyo**, **London** or **New York** open, by each city's local time with its
  daylight saving, placed on the broker's clock;
- a later date;
- the session's end date.

Orders fill, and stops trigger, on every bar the jump passes. Picking an earlier bar on a chart puts
the replay back where the backtest stands.

## Trading in a backtest

Every chart of the replay trades in the backtest, in trade and analysis mode alike:

- **Buy and sell buttons** on each chart, with a volume, trade at the replay price.
- **New Order** (F9, the panel's button or the chart's context menu **Backtest** submenu) opens the
  backtest ticket: market, limit, stop and stop limit orders, sized in lots or by risk (% of balance
  or equity, or an amount), stops and targets as prices, points or pips, an expiration and a comment.
  Right-click above or below the price for a limit or stop at that level.
- **The Risk Order tool** plans an order on the chart as it does live: drag the entry, then click the
  stop loss and take profit. The volume follows your risk setting, sized against the backtest's
  balance or equity.
- **Lines on the chart**: drag a stop loss, take profit or order price to move it; drag **SL** or
  **TP** off a position's entry line to add one; the line's × closes the position or deletes the
  order. A change applies when you let go.
- Trades are marked on the bars they opened and closed in: an arrow at the entry and a cross at the
  exit, joined by a dotted line in the colour of the result.

The live account's One-Click panel, Risk Order planner and order tickets are not used on these
charts while the backtest runs.

## How orders fill

- History is bid prices, as in MetaTrader. The ask is the bid plus the spread. Buys open at the ask
  and close at the bid; sells the other way round.
- A market order fills at the replay's current price, plus slippage against you.
- Pending orders, stop losses and take profits trigger when the price they act on reaches them:
  buy limits, buy stops and the stops and targets of sells watch the ask; the rest watch the bid.
- Inside a bar, the price is taken to have gone from the open to the low, then the high, then the
  close when the bar rose, and to the high before the low when it fell. That decides which comes
  first when one bar reaches both a stop and a target.
- An order the bar opens beyond (a gap) fills at the opening price: better than asked for a limit or
  take profit, worse for a stop or stop loss.
- A stop limit becomes a limit at its limit price once its stop price trades, and can fill later in
  the same bar.
- A pending order with an expiration is removed when the first bar at or after that time opens.
- Margin is lots times contract size times the opening price, in account currency, divided by the
  leverage. An order that would
  need more than the free margin is refused, or cancelled if it is a pending order when it triggers.
- Fills use the finest history the broker has for that period, from M1 up to the replay's update
  interval. MetaTrader serves about the latest 20 000 bars of each timeframe, so M1 reaches back about
  two weeks, M15 about seven months and H1 about three years.
- Profits convert to the account currency at the symbol's own price when it is quoted against the
  account currency (EURUSD or USDJPY on a USD account). Other symbols, crosses such as EURGBP on a USD
  account, convert at the rate when the session first priced them.
- Swap is not charged.

## The backtest panel

Under the replay bar, the panel shows the simulated account (balance, equity, open profit, free
margin, margin level, the change since the start and the deepest drawdown) and five tabs:

- **Positions** and **Orders**, with the same context menus as the Toolbox: modify, close, close
  half, break-even, reverse, close all, close profitable or losing, delete orders.
- **History**: each closed trade with its exit (market, stop loss, take profit or stop out),
  commission, net result, the result in R (multiples of the money its first stop loss risked), and
  its maximum adverse and favourable excursion. **Export CSV** saves the list.
- **Statistics**: net profit and return, win rate (long and short), profit factor, expectancy,
  average R, maximum drawdown, recovery factor, average win and loss, streaks and average hold, with
  the equity and balance curve.
- **Journal**: every fill, trigger, change and expiry, at replay time.

The chevron folds the panel down to its account line.

## Saving and resuming

A session saves itself as it goes. **End Session** (or **Exit Replay**) saves it and returns the
charts to live. In **Backtest > Sessions** you can:

- **Resume** a session: the replay starts again where it stopped, with its positions and orders.
- **Restart** it from its start date with its starting balance.
- **Delete** it.
- Rename it with a double-click on its name.

Sessions are kept on this computer, not with the account, so any logged-in account that offers the
session's symbols can resume it.
