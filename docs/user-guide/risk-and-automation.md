# Risk and automation

OpenTerm includes the tools traders usually add to MetaTrader 5 with Expert Advisors: order sizing
from risk, automatic trade management and account-wide limits. They live in the **Automation**
workspace (Ctrl+4), the order dialog and the chart.

> Automation runs inside OpenTerm. It acts only while OpenTerm is running and connected to the account.
> Keep a broker-side stop loss on every position that you cannot watch.

## Risk-based orders

Open the order dialog (F9) and switch to **Risk-based**. Instead of choosing a volume, you choose how
much to risk and where the stop is; OpenTerm calculates the volume.

| Setting | Options |
|---|---|
| Risk | % of balance, % of equity, an amount of money, or fixed lots |
| Stop loss | A price, or a distance in points or pips |
| Take profit | Up to 5 targets, as prices, distances or multiples of the risk (R) |
| Commission | Optional commission per lot, counted inside the risk |
| Management | Trailing stop, break-even, hidden stops |

How the volume is calculated:

- The volume is the largest that fits the budget. It is always rounded **down** to the symbol's volume
  step, so the risk is never exceeded.
- If even the minimum volume would risk more than the budget, the order is refused. It is never
  over-risked.
- Profit is converted from the symbol's profit currency to your account currency with live rates.
- With several targets, the volume is split into one position per target. Later positions can move
  to break-even when the first target is hit.

The preview shows the volume, the money at risk, the entry and the reward before anything is sent.

## The chart risk planner

The risk planner sizes an order from lines you draw on the chart.

1. Choose the **R%** tool on the toolbar.
2. Drag on the chart to place the **entry**. Then click or drag to place the **stop loss**, and
   optionally the **take profit**.
3. OpenTerm decides the order type from the lines. With the stop below the entry it is a buy; above,
   a sell. An entry away from the current price becomes a limit or stop order. An entry at the current
   price becomes a market order.
4. The panel on the left shows the risk mode, the volume, the money at risk and the reward multiple.
   Drag any line to adjust it.
5. Choose **Place order**, or press Escape to cancel.

The risk mode and amount you choose are remembered between sessions.

## Position management

Right-click a position and choose **Manage…**, or use the shortcut in the position dialog.

| Tool | What it does |
|---|---|
| Break-even | Moves the stop loss to the open price, plus an optional lock-in, after a profit in points |
| Trailing stop | Follows the price at a set distance once a start profit is reached, in steps |
| Partial targets | Closes up to four portions of the position at set profits |
| Hidden stop and target | Closes the position at levels that are not sent to the broker |
| Time exit | Closes the position at a chosen time |

Hidden levels are useful when you do not want stops to be visible on the broker's server. They work
only while OpenTerm is running, so combine them with a wider broker-side stop.

If an action fails in a way that leaves the outcome unknown, the rule is paused rather than repeated.
The Automation workspace lists every managed position and its state.

## Equity guards

An equity guard protects one account with prop-firm style limits. Configure it in the Automation
workspace.

| Limit | Meaning |
|---|---|
| Daily loss (money) | Maximum loss since the start of the trading day |
| Daily loss (percent) | The same, as a percentage of the day's starting equity |
| Maximum drawdown | Maximum fall from the highest equity, as a percentage. Reset manually |
| Daily profit lock | Stop trading for the day once this profit is reached |
| Maximum open positions | A cap on the number of open positions |
| Maximum lots per symbol | A cap on total volume in one symbol |
| Day starts at | The local hour at which the trading day resets |

When a limit is reached, the guard either **blocks new trades** or **closes everything and blocks**.
A block applies to every source: manual orders, the risk ticket, the chart, signals and the copier.

## One-click actions

The Automation workspace and the **Toolbox → Trade** context menu offer bulk actions:

- close all, profitable, losing, buy or sell positions;
- close every position in one symbol;
- delete all pending orders;
- move all stops to break-even;
- reverse a position.

Each order is sent separately, and the Journal reports each result.

## Live profit and equity

Floating profit is calculated from live quotes, converting the symbol's profit currency to the
account currency. Every symbol's calculation is checked against the profit the broker reports. If
they disagree, OpenTerm uses the broker's figures and notes the difference in the Journal. Margin
figures are not yet calculated; see the [roadmap](../roadmap.md).
