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

Seconds timeframes (S1, S5, S15 and S30) are in the same lists, with S5 on the toolbar. MetaTrader
does not provide seconds bars or past ticks, so OpenTerm5 builds them from the bid quotes it receives,
with the number of ticks as the volume. A seconds chart therefore starts from the first quote
OpenTerm5 received for that symbol, and it says so until two bars exist. OpenTerm5 keeps the last
four hours of seconds history per symbol while it runs, for symbols in Market Watch or open in a
chart. Closing OpenTerm5 or switching accounts starts the history again.

Switch between bar, candlestick and line charts with Alt+1, Alt+2 and Alt+3. Hollow candles, area,
baseline and Heikin Ashi charts are on the toolbar and in the **Charts** menu.

Charts are drawn by Meridian, OpenTerm5's own chart engine. Drag the chart or use the mouse wheel to
scroll and zoom; scrolling back loads older history. Drag the price axis to rescale it (double-click it
to return to automatic scaling), drag the time axis to change the bar spacing, and drag the boundary
between panes to resize them. The last price with the bar countdown, the ask line and each study's
latest value sit on the price axis.

Right-click the price axis to choose a regular, percent, indexed (to 100) or logarithmic scale, to
invert it, or to turn automatic scaling back on. Right-click the chart for **Reset Chart View**, undo,
redo, paste, **Add Alert** at the price under the pointer, the object tree, bar replay and **Chart
Settings…**, followed by the usual chart menu. Chart Settings sets the candle body, border and wick
colours, what the status line shows, the scale mode, the last-price line and label, the countdown, the
right margin, the background, grid, crosshair and the symbol watermark. Settings are saved with the
chart and with its templates; colours you leave unchanged follow the theme.

When the pointer is over one chart, the other chart windows show a crosshair at the same time.

### Chart tools

- **Undo and redo** (Ctrl+Z and Ctrl+Y, or the arrows in the analysis top bar) step back through
  changes to drawings and indicators.
- **Object tree** (the button at the bottom of the drawing toolbar, or the top bar) lists the chart's
  indicators and drawings. Click a drawing to select it, double-click for its settings, and use the
  row's buttons to hide, lock or remove it.
- **Bar replay** (**Replay** in the top bar, or the chart's context menu) hides the later bars. Click
  the bar to start from, then play, step one bar at a time or change the speed. The square button ends
  the replay. Indicators and drawings work as usual while replaying.
### Indicators

Add an indicator from **Insert → Indicators**, from the chart's context menu, or by clicking it in the
Navigator. Indicators come in two groups:

- **MetaTrader 5:** MetaTrader's own formulas: Moving Average (simple or exponential), Bollinger
  Bands, Ichimoku Kinko Hyo, Parabolic SAR, ADX Wilder, RSI, Stochastic, CCI, Momentum, Rate of
  Change, Williams %R, MACD, Average True Range, On Balance Volume and Money Flow Index.
- **Trend & Overlays** and **Oscillators & Volume:** Meridian's 86 further studies, among them EMA,
  DEMA, TEMA, Hull, KAMA and volume-weighted moving averages, VWAP, SuperTrend, Ichimoku Cloud,
  Keltner and Donchian channels, Williams Alligator, ZigZag, fractals, pivot points, Stochastic RSI,
  Aroon, ADX, TTM Squeeze, Vortex, Fisher Transform, Schaff Trend Cycle, Klinger and the Ultimate
  Oscillator.

An indicator starts with its default settings. Hover over its legend row and use **Settings** to change
them (or double-click the row), **Hide** to hide it or **Remove** to remove it. **Indicators List** in the chart's context menu also
removes indicators. Volume-based indicators use tick volume.

Charts made with versions before Meridian keep their indicators, which now use the MetaTrader 5
group.

### Drawing objects

The toolbar and **Insert → Objects** provide the common tools: horizontal and vertical lines,
trendlines, horizontal rays, rectangles and Fibonacci retracements. In analysis mode, every chart also
shows the drawing toolbar down its left side, with 82 tools in six groups: trend lines, channels and
pitchforks; Fibonacci and Gann tools; chart patterns, Elliott waves and cycles; long and short
positions, volume profiles and measurers; brushes, arrows and shapes; and text and notes. Each group
button shows the tool you last used from it; the arrow beside it opens the full list, where the star
adds a tool to the favourites bar above the chart. Below the groups are the measure and zoom tools,
the magnet (which snaps anchors to the bar's open, high, low or close), stay in drawing mode, lock,
hide and remove.

Click to place each anchor, or press and drag for two-point tools. Polylines and paths end with a
double-click. Shift-click anywhere to measure. Select an object to move it, drag its anchors, or change
its colour, width and style from the bar that appears above the chart; double-click it for all its
settings. The settings come in tabs: **Style**, **Levels** (for Fibonacci, Gann and pitchfork tools,
each level with its own value, colour and visibility), **Text**, **Coordinates** and **Visibility**,
which chooses the timeframes the object shows on. Double-clicking a text object edits its text in
place: Enter keeps it, Shift+Enter starts a new line and Escape cancels.

Right-click an object to copy it (Ctrl+C), clone it, change its stacking order, lock, hide or remove
it. Ctrl+V pastes a copied object, also into another chart. Delete removes the selected object.
**Objects List…** (Ctrl+B) edits anchor coordinates and deletes objects.

### Themes

**View → Theme** chooses a Meridian theme for the whole window, charts included: Meridian Dark,
Meridian Light or Meridian Midnight. **Match System** follows your operating system's light or dark
setting. Themes replace MetaTrader's chart colour schemes.

### Profiles, templates and images

- **File → Profiles** saves the set of open charts and their layout.
- **Charts → Templates** saves a chart's indicators, drawings and appearance, so you can apply them to
  another symbol.
- **Save As Picture…** in the chart's context menu exports a PNG of the chart.

### Analysis mode

**View → Analysis Mode** (Ctrl+Shift+A), or the analysis button on the toolbar, turns the window into
a chart-first layout for studying the market: a top bar with symbol search, timeframes, chart types,
indicators and alerts, drawing tools on a rail down the left, and the watchlist on the right.

Analysis mode removes everything that places or changes trades: the order ticket and F9, One-Click
trading, the risk planner, Depth of Market, the Toolbox and the trading items in chart and Market
Watch menus. Your account stays connected, and copiers, the Signal API and automation keep running.
The top bar shows when any of them are active. In this mode, double-clicking a symbol in the watchlist or
moving through it with the arrow keys shows that symbol on the active chart.

Open positions and pending orders are hidden by default. Turn on **Show Positions** in the top bar,
or **View → Show Positions in Analysis**, to draw them on the charts. They are read-only: you cannot
drag or close them until you return to trading. Ctrl+Shift+A, or **Trading** in the top bar,
switches back. The terminal reopens in whichever mode you left it in.

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

Window positions are saved with your profile and restored when OpenTerm5 starts.

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
connection drops before the broker confirms an order, OpenTerm5 reports the outcome as unknown. It
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
- **Close from the chart:** click the **×** on the entry line. OpenTerm5 asks for confirmation unless
  one-click trading is on.

### One-click trading

**Tools → One Click Trading** shows buy and sell buttons on every chart and sends orders without a
confirmation dialog. Turn it on only when you understand that a single click places a trade.

### Depth of Market

**View → Depth Of Market** (Alt+B) shows the order book when your broker publishes market depth.
Otherwise it shows a price ladder without volumes. Clicking a price opens an order ticket at that
price; it never sends an order directly.

## Price alerts

**Tools → Price Alerts…** sets alerts on the bid or ask price, and **Add Alert** in the chart's context
menu sets one at the price under the pointer. Active alerts show as dashed lines labelled **Alert** on
the symbol's charts. An alert fires once, in the Journal and as a notice in the window, while OpenTerm5
is running and connected to that account.

## History

**Toolbox → History** lists deals for the selected period, with total profit and deposits. Right-click
it to change the period, or choose **Export CSV** to save deals and orders with UTC timestamps.
