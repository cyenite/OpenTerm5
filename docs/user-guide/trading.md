# Trading

This guide covers the Trading workspace: quotes, charts, chart layouts, orders and trading directly
from the chart.

## Market Watch

Market Watch lists live bid and ask prices, the spread and the time of the last quote.

- **Add a symbol:** type its name in the **+ click to add** row and press Enter, or open
  **Symbols…** (Ctrl+U) to browse every symbol your broker offers.
- **Open an order:** double-click a symbol.
- **Open a chart:** right-click a symbol and choose **Chart in New Tab**, or drag it onto a chart to
  show it there.
- **Symbol details:** select a symbol and switch to the **Details** tab, or choose
  **Specification…** from its context menu. Both show contract size, volume limits, swaps and trading
  hours.
- **Symbol sets:** type a name in the set field and choose **Save** to store the visible symbols.
  Choose **Load** to show a saved set again, or **×** to delete it. Sets belong to the account they
  were saved on.

## Arranging the panels

Market Watch, the Data Window, the Navigator and the Trade Assistant sit in docks on either side of
the charts, and the Toolbox sits below them.

- **Resize:** drag the edge between a dock and the charts, the line between two stacked panels, or
  the line above the Toolbox. Double-click a line to reset it. With a line focused, the arrow keys
  move it too.
- **Move a panel to the other side:** drag its title bar across the charts and drop it on the
  highlighted side, click the arrow beside its **×**, or right-click its title bar and choose
  **Dock Left** or **Dock Right**.

To make everything larger or smaller, zoom the interface with **Ctrl+=** and **Ctrl+−** (Cmd on
macOS), or **View → Zoom**; **Ctrl+0** returns to 100%. The level is kept when OpenTerm5 restarts.

Sizes and sides are kept when OpenTerm5 restarts. If the window becomes too short, the Toolbox gives
way so the charts stay at least 120 pixels tall. In analysis mode the watchlist and Data Window always
sit on the right.

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

When a tab shows several charts, the others mirror the crosshair at the same time (and price, on the
same symbol). See [Chart layouts](#chart-layouts) for this and the other sync options.

### Chart tools

- **Undo and redo** (Ctrl+Z and Ctrl+Y, or the arrows in the analysis top bar) step back through
  changes to drawings and indicators.
- **Object tree** (the button at the bottom of the drawing toolbar, or the top bar) lists the chart's
  indicators and drawings. Click a drawing to select it, double-click for its settings, and use the
  row's buttons to hide, lock or remove it.
- **Bar replay** (**Replay** in the top bar, or the chart's context menu) hides the later bars. Click
  a bar on any chart to start from, then use the replay bar under the charts to play (Shift+Down),
  step forward (Shift+Right), change the speed or pick another start (a date, the first available
  bar or a random one). **Exit Replay** goes back to live charts. Indicators and drawings work as
  usual while replaying.
  - In a multi-chart layout every chart replays on one clock by default, so each shows only what had
    happened by the replay time. The menu beside **Replay** switches to replaying the active chart
    alone.
  - Each step moves the clock by the **update interval**, by default the shortest timeframe in the
    layout. Charts on longer timeframes show their current bar forming step by step, built from bars
    of the update interval. Where the broker's history at that interval does not reach back far
    enough, the forming bar stays hidden until it is complete.
  - A chart with no history at the replay time stays live, and the replay bar says so.
  - A replaying chart does not trade, because an order would still fill at the live price, not the
    one on screen. Its One-Click panel, Risk Order tool, position and order line dragging, close
    buttons and context menu **Trading** submenu are off, and **New Order** (F9) is refused while it
    is the active chart; each says "Trading is off while this chart replays". Charts outside the
    replay, Market Watch and the Toolbox still trade.
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
trendlines, horizontal rays, rectangles and Fibonacci retracements. In analysis mode (or with
**Drawing Toolbar** on in trade mode) the drawing toolbar runs down the left of the chart area, with
one toolbar for all the charts of a layout, as in TradingView. The tool you pick goes on whichever
chart you click, and the magnet, lock and hide switches apply to every chart; remove and the object
tree act on the active chart. It has 82 tools in six groups: trend lines, channels and
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

## Chart layouts

Each tab in the chart bar below the charts holds a layout of 1 to 16 charts, as in TradingView. Click
the layout button next to the symbol search to choose one: layouts are grouped by how many charts they
show.

| Action | How |
|---|---|
| Switch tabs | Click a tab in the chart bar. **+** opens a new tab with a copy of the active chart |
| Close a tab | The **×** on its tab, or middle-click it |
| Choose the active chart | Click it, or press **Tab** and **Shift+Tab** to move between charts in reading order |
| Resize charts | Drag the line between two charts. **Shift**+drag moves the matching lines too; double-click resets |
| Maximise a chart | **Alt+Enter**, or **Maximize Chart** in the chart menu. Press it again, or choose any layout, to restore |
| Swap charts | Right-click a chart and choose **Move Chart → Forward** or **Back** |
| Close a chart | Right-click it and choose **Close**, or Ctrl+F4. The layout steps down to fit the charts left |

Switching to a smaller layout hides the extra charts rather than closing them, and a larger layout
brings them back before adding copies of the active chart. Each layout remembers its own divider
positions.

### Sync in layout

The switches under **Sync in layout** (in the layout button, the **Window** menu or a chart's menu)
apply to the current tab:

| Sync | What it does |
|---|---|
| Symbol | Changing the symbol of one chart changes the others |
| Interval | Changing the timeframe of one chart changes the others |
| Crosshair | The other charts show the crosshair at the same time, and at the same price on the same symbol. On by default |
| Time | Clicking a chart scrolls the others to that moment |
| Date Range | The other charts show the same dates as the active chart while it scrolls and zooms |

With symbol or interval sync on, a link button appears in the bottom right corner of each chart. Put
charts in a coloured **sync group** there to sync only within the group; charts outside any group sync
with each other.

### Sync drawings

The link button in the chart toolbar sets where new drawings go: **This Layout** (the default) shows
them on every chart of the same symbol in the tab, **All Layouts** on every chart of the symbol in
every tab, and **Off** keeps them on the chart they were drawn on.

Tabs, layouts, sizes and sync settings are saved with your profile and restored when OpenTerm5 starts.
Charts saved by earlier versions open as one tab each, or as one layout if they were floating windows.

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

### Trade Assistant

**View → Trade Assistant** opens a panel, docked on the right by default, for trading the active
chart's symbol without opening a dialog. It follows whichever chart is active.

- **Trade:** set the risk (a share of equity or balance, or an amount of money), the stop loss in
  pips, points or price, and the take profit as multiples of the stop (R). Enter several, such as
  `1, 2, 3`, to take profit in parts. The panel shows the volume, entry, stop, targets and money at
  risk for a sell and a buy side by side, and the **Sell** and **Buy** buttons place the order at
  once. Choose **Limit** or **Stop** to place a pending order at the entry price instead.
  **Plan on chart…** starts the chart's risk planner, which shares the same risk setting.
- **Lines on chart:** every chart of the symbol shows the plan for the side chosen here (**Buy** or
  **Sell**, or **Off**) as a position box on the right part of the chart, apart from your open
  trades: a red zone from the entry to the stop loss, a green zone to the targets, and dotted lines
  for the entry with its volume, the stop loss with the money at risk, and each target with its R. Drag the stop or a target to change the
  plan; the stop distance, the R and the volume follow. For a limit or stop entry, drag the entry
  line too.
- **Close:** close every position, the profitable or losing ones, the buys or sells, delete pending
  orders or move stops to break-even, for this symbol or for all symbols. **Close in parts** closes a
  share of each position, in the symbol's volume steps, and never leaves less than the minimum
  volume open.
- **Manage:** break-even after the first target or at a set R, a trailing stop and hidden stops for
  trades placed from the panel, and the commission counted inside the risk.

The Trade Assistant is hidden in analysis mode, and its buttons are off while the active chart
replays.

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

- **Move a stop loss or take profit:** drag its line. The value updates as you drag, and the change is
  sent as soon as you release, for positions and pending orders alike. A level on the wrong side of
  the price is explained, not sent, and the line returns to where it was.
- **Move a pending order:** drag its entry line, then choose **Apply** to send the new price or
  **Cancel** to discard it.
- **Add a missing stop or target:** a position without a stop loss or take profit shows **SL** or
  **TP** tabs on its entry line. Drag a tab up or down and release to set the level.
- **Close from the chart:** click the **×** on the entry line. OpenTerm5 asks for confirmation unless
  one-click trading is on.
- **Focus one trade:** with several trades on a chart, point at a trade's label on the chart, or at
  its row in **Toolbox → Trade**, to see which stop and target belong to it. Its entry, stop loss and
  take profit stay bright with its ticket number, a red band runs from the entry to the stop and a
  green band to the target, and every other line fades. Click the label or the row to keep the
  focus; click it again, click elsewhere or press Escape to clear it. Dragging a line focuses its
  trade too.

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
