# Backtesting

A backtest replays history bar by bar while you trade it on a simulated account, placing each order
with lines on the chart sized by your risk. Orders fill on the bars the backtest passes, and stops
and targets trigger inside them. The session keeps every trade, its statistics and its
equity curve, and saves itself as it goes, so you can stop and come back later.

Backtests use your logged-in account's symbols and history. Nothing is sent to the broker: the
simulated account is separate from the real one, which stays in the Toolbox throughout.

## Backtest mode

Backtesting has its own mode beside Trade and Analysis. Choose **Backtest** in the mode switch at the
top right, click **Backtest** in the chart toolbar, or use **View > Backtest Mode**. The whole
interface changes for it:

- a chart-first layout, as in Analysis mode: no workspace tabs, Toolbox, Navigator or live trading
  controls (order tickets, One-Click, Depth of Market), and no Replay or Alert in the toolbar;
- the watchlist hidden, so the charts and the session's statistics have the room;
- the **Backtest panel** on the right, docked like the other side panels (drag its title bar to the
  other side, or drag its edge to resize it);
- the backtest's controls floating at the bottom of the charts.

Before a session runs, the panel lists your recent sessions with their result (double-click one, or
click **Resume**, to carry on where it stopped), and the floating bar and the panel both offer
**New Session**. **Tools > Backtest Sessions...** manages them all (rename, restart, delete).

Leaving Backtest mode, by choosing Trade or Analysis, clicking **Backtest** again, **Leave Mode**,
or ending the session, saves any running session and puts your previous layout back: the mode, the
watchlist and the Backtest panel return to how they were, even if OpenTerm5 was closed during the
session.

## Starting a session

In **New Session**, choose:

- **Symbol.** If the layout in front does not show it, the active chart switches to it. Every chart
  of the layout takes part, and any symbol they show can be traded in the session.
- **Start** and, optionally, **End**, in chart time. The backtest starts at the first bar every chart
  has, so it may start a little later than asked. With an end date it stops there.
- **Starting balance**, in the account's currency, and **Leverage**.
- **Spread**: each symbol's spread as the broker quotes it when the session first prices it, or a
  fixed number of points for every symbol.
- **Slippage** in points, taken against you on market orders, stop orders and stop losses.
- **Commission** in account currency per lot, charged when a position opens and again when it closes.
- **Stop out**, the margin level at which the most losing position is closed (0 turns it off).

**Start Backtest** (which switches to Backtest mode if you started it from elsewhere) loads enough
history to reach the start and hides every later bar on the layout's charts. A backtest is not bar
replay: there is no replay toolbar, and the charts are not shaded.

## Moving through time

The backtest's controls float at the bottom of the charts:

- **Play** (Shift+Down) and **Step** (Shift+Right), with a **speed** from 10x to 0.1x.
- **Step size**: how far each step moves the clock, by default the shortest timeframe of the layout.
  Charts on longer timeframes show their current bar forming.
- **Jump To**: the next **Sydney**, **Tokyo**, **London** or **New York** open (each city's local
  hour with its daylight saving, placed on the broker's clock), a later date, or the session's end
  date. Orders fill, and stops trigger, on every bar the jump passes.
- **Place Order** plans an order on the chart (see below).
- **Analytics** shows or hides the Backtest panel; **End Session** saves the session, returns the
  charts to live and leaves Backtest mode.

A backtest only moves forward. To test an earlier period, restart the session.

## Placing orders

**Place Order** on the backtest's controls (or F9, or **Place Order** in the Backtest panel and the
chart's **Backtest** menu) turns on the lot-by-risk tool, as the Risk Order tool does live:

1. Drag on the chart to place the entry.
2. Click or drag to place the stop loss, then the take profit (or place the order without one).
3. In the planner beside the lines, choose the risk: a percentage of balance or equity, or an
   amount. The volume follows it, and the planner shows the risk in money and percent, the entry
   and the reward in R.
4. Drag any line to adjust, switch **Execute at market** to fill at the backtest's price instead of
   the entry line, and click **Place order**.

The entry against the backtest's price decides the order type: at the price it fills at market;
above or below it becomes a buy or sell limit or stop, depending on which side the stop loss is on.
Escape, or Place Order again, cancels.

Once placed, the lines stay on the chart: drag a stop loss, take profit or pending order price to
move it; drag **SL** or **TP** off a position's entry line to add one; the line's × closes the
position or deletes the order. Hovering a trade's line highlights the trade. Trades are marked on
the bars they opened and closed in: an arrow at the entry and a cross at the exit, joined by a dotted
line in the colour of the result.

## How orders fill

- History is bid prices, as in MetaTrader. The ask is the bid plus the spread. Buys open at the ask
  and close at the bid; sells the other way round.
- A market order fills at the backtest's current price, plus slippage against you.
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
  leverage. An order that would need more than the free margin is refused, or cancelled if it is a
  pending order when it triggers.
- Fills use the finest history the broker has for that period, from M1 up to the step size.
  MetaTrader serves about the latest 20 000 bars of each timeframe, so M1 reaches back about two
  weeks, M15 about seven months and H1 about three years.
- Profits convert to the account currency at the symbol's own price when it is quoted against the
  account currency (EURUSD or USDJPY on a USD account). Other symbols, crosses such as EURGBP on a USD
  account, convert at the rate when the session first priced them.
- Swap is not charged.

## Session analytics

While a session runs, the Backtest panel shows:

- the session, its period and leverage, and the account: equity and its change since the start,
  balance, open profit, free margin and the deepest drawdown;
- the **equity and balance curve** (hover it to read any point);
- **Performance**: net profit, win rate, profit factor, average R, expectancy, maximum drawdown,
  average win and loss, long and short win rates, streaks, recovery factor and average hold;
- **Positions** and **Orders**, with the Toolbox's context menus (modify, close, close half,
  break-even, reverse, close all, close profitable or losing, delete orders);
- **Trades**: each closed trade's side, exit (stop loss, take profit, closed or stop out), net result
  and R (multiples of the money its first stop loss risked); hover a row for its prices, times and
  maximum adverse and favourable excursion. **Export CSV** saves the list.
- **Journal**: every fill, trigger, stop move and expiry, at backtest time.

Each section folds with its heading, and stays as you left it. In a narrow panel, the trade list
drops its time and exit columns; widen the panel to see them.

## Saving and resuming

A session saves itself as it goes. **End Session** saves it, returns the charts to live and leaves
Backtest mode.
Sessions are kept on this computer, not with the account, so any logged-in account that offers the
session's symbols can resume them.
