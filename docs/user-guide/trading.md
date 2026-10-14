# Trading

This guide covers the Trading workspace: quotes, charts, chart windows, orders and trading directly
from the chart.

## Market Watch

Market Watch lists live bid and ask prices, the spread and the time of the last quote.

- **Add a symbol:** type its name in the **+ click to add** row and press Enter, or open
  **Symbols…** (Ctrl+U) to browse every symbol your broker offers.
- **Open an order:** double-click a symbol.
- **Open a chart:** drag a symbol onto the chart area, or right-click it and choose **Chart Window**.
- **Symbol details:** select a symbol and switch to the **Details** tab, or choose
  **Specification…** from its context menu. Both show contract size, volume limits, swaps and trading
  hours.
- **Symbol sets:** type a name in the set field and choose **Save** to store the visible symbols.
  Choose **Load** to show a saved set again, or **×** to delete it. Sets belong to the account they
  were saved on.

## Charts

### Timeframes and chart types

All 21 MetaTrader 5 timeframes are available from the toolbar and the chart's context menu. Nine come
directly from the broker (M1, M5, M15, M30, H1, H4, D1, W1, MN1). The others are built from real
broker bars, aligned to the broker's trading day. Gaps in the data stay as gaps.

Switch between bar, candlestick and line charts with Alt+1, Alt+2 and Alt+3.

### Indicators

Add an indicator from **Insert → Indicators**, from the chart's context menu, or by clicking it in the
Navigator. Available indicators:

- **Trend:** Moving Average (simple or exponential), Bollinger Bands, Ichimoku Kinko Hyo, Parabolic
  SAR, ADX Wilder.
- **Oscillators:** RSI, Stochastic, CCI, Momentum, Rate of Change, Williams %R, MACD.
- **Volatility:** Average True Range.
- **Volume:** On Balance Volume, Money Flow Index.

Volume-based indicators use tick volume. To remove an indicator, use **Indicators List** in the
chart's context menu.

### Drawing objects

The toolbar and **Insert → Objects** provide:

- horizontal and vertical lines;
- trendlines and horizontal rays;
- rectangles;
- Fibonacci retracements.

Two-point objects ask for a second click. **Objects List…** (Ctrl+B) edits coordinates and deletes
objects.

### Profiles, templates and images

- **File → Profiles** saves the set of open charts and their layout.
- **Charts → Templates** saves a chart's indicators, drawings and appearance, so you can apply them to
  another symbol.
- **Save As Picture…** in the chart's context menu exports a PNG of the chart.

## Chart windows

Charts can be shown as tabs or as floating windows, as in MetaTrader 5.

| Action | How |
|---|---|
| Switch charts | Click a tab in the chart bar below the charts |
| Close a chart | The **×** on its tab, middle-click the tab, or Ctrl+F4 |
| Float the windows | **Window → Floating Windows**, or the restore button at the right of the chart bar |
| Maximise a window | Double-click its title bar, or its **□** button |
| Move or resize | Drag the title bar, or any edge or corner |
| Minimise | The **−** button. Minimised windows line up along the bottom; click one to restore it |
| Arrange | **Window → Cascade, Tile Windows (Alt+R), Tile Horizontally, Tile Vertically, Arrange Icons** |

Window positions are saved with your profile and restored when OpenTerm starts.

## Placing orders

Press **F9**, choose **New Order** on the toolbar, or right-click a chart and choose **Trading**.

### Market orders

Choose the symbol and volume, and optionally a stop loss and take profit. Then choose **Sell by
Market** or **Buy by Market**. The broker fills the order at the current price, so the fill price can
differ from the price shown when prices move quickly.

### Pending orders

Switch the order type to **Pending**. Choose Buy Limit, Sell Limit, Buy Stop, Sell Stop, Buy Stop
Limit or Sell Stop Limit, then set the price and an optional expiry.

Right-clicking a chart offers the pending orders that make sense at the price under the pointer. For
example, below the current price it offers **Buy Limit at 1.0850** and **Sell Stop at 1.0850**.

### Risk-based orders

Switch the order dialog to **Risk-based** to size the order from the money you are willing to lose.
See [Risk and automation](risk-and-automation.md#risk-based-orders).

### Order results

Every request is reported in the dialog and in the Journal with the broker's return code. If the
connection drops before the broker confirms an order, OpenTerm reports the outcome as unknown. It
never re-sends the order automatically, so check **Toolbox → Trade** before trying again.

## Managing open positions

Open positions and pending orders are listed in **Toolbox → Trade**. The summary row shows balance,
equity and floating profit.

- **Double-click** a position to open the position dialog.
- **Right-click** a position to close it, close it by an opposite position, modify it, manage it or
  reverse it. Bulk actions such as **Close All Positions** and **Close Losing** are also there.
- **Click the ×** at the end of a row to close a position immediately.

### The position dialog

- **Summary:** side, symbol and volume, time open, open and current price, profit and points.
- **Stop loss and take profit:**
  - Enter each level as a price, a distance in points, or an amount of money. Each field shows the
    money and points at that level.
  - **Break-even** moves the stop to the open price once the trade is in profit.
  - **1R**, **2R** and **3R** set the take profit at one, two or three times the stop distance.
  - Below the fields, the dialog shows the risk to reward ratio and the share of your balance at risk.
- **Close:**
  - Choose the share to close with the slider, the volume field or the **25%**, **50%**, **75%** and
    **All** buttons.
  - The close button shows the price and the profit or loss you will realise.
- **Shortcuts:** trailing stop and partial targets, close by an opposite position, reverse, and add
  to the position.

## Trading from the chart

Open positions and orders are drawn on the chart:

| Line | Shows |
|---|---|
| Entry (grey) | Side, volume and live floating profit, with a **×** to close the position |
| Stop loss (red) | The loss if the stop is hit |
| Take profit (green) | The profit if the target is hit |
| Pending order (orange) | Order type and volume |

- **Move a level:** drag a stop loss, take profit or pending order line. The value updates as you drag.
  When you release, choose **Apply** to send the change or **Cancel** to discard it. A level on the
  wrong side of the price is explained and cannot be applied.
- **Add a missing stop or target:** a position without a stop loss or take profit shows **SL** or
  **TP** tabs on its entry line. Drag a tab up or down to place the level, then choose **Apply**.
- **Close from the chart:** click the **×** on the entry line. OpenTerm asks for confirmation unless
  one-click trading is on.

### One-click trading

**Tools → One Click Trading** shows buy and sell buttons on every chart and sends orders without a
confirmation dialog. Turn it on only when you understand that a single click places a trade.

### Depth of Market

**View → Depth Of Market** (Alt+B) shows the order book when your broker publishes market depth.
Otherwise it shows a price ladder without volumes. Clicking a price opens an order ticket at that
price; it never sends an order directly.

## Price alerts

**Tools → Price Alerts…** sets alerts on the bid or ask price. An alert fires once, in the Journal and
as a notice in the window, while OpenTerm is running and connected to that account.

## History

**Toolbox → History** lists deals for the selected period, with total profit and deposits. Right-click
it to change the period, or choose **Export CSV** to save deals and orders with UTC timestamps.
