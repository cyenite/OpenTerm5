# Changelog

All notable changes to OpenTerm5 are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Hyperliquid charts: search any Hyperliquid perpetual or spot market from a chart's symbol search,
  logged in or not. Prices, history and live bars come straight from Hyperliquid. The charts are data
  only: every trading control is off on them, and orders for them are refused, because your broker
  may not offer the market.

## [0.9.0] - 2026-10-27

### Added

- Type a letter on a chart to search for a symbol, as in TradingView. The box opens with the letter
  you typed and lists matching symbols; Enter or a click switches the chart. It works in pop-out
  windows too.
- Select several drawings: Ctrl+click adds or removes one, and Ctrl+drag on the chart selects every
  drawing with a point in the box. They move, copy (Ctrl+C) and delete together.
- Chart keys from TradingView: Ctrl+Up and Ctrl+Down zoom, Ctrl or Alt with Left and Right scroll ten
  bars, Shift+Left and Shift+Right jump to the first loaded bar and back to the latest.
- Rectangles have handles on their sides and corners, with resize pointers.
- Twelve new themes under **View > Theme**, adapted from popular editor palettes: Tokyo Night,
  Catppuccin Mocha, Nord, Dracula, Rosé Pine, Gruvbox Dark, Kanagawa and GitHub Dark Dimmed, and
  the light Catppuccin Latte, Solarized Light, Rosé Pine Dawn and GitHub Light. Prices and P/L stay
  readable in all of them. The menu now lists dark themes first, then light ones.
- Seven chart themes for a single chart, under **Theme** in a chart's right-click menu: Classic,
  Aurora, Amber Terminal, Colour-blind Safe (blue up, orange down), Ink, Daylight and High Contrast.

### Changed

- Chart zoom works like TradingView's. Each wheel notch changes the zoom by up to a tenth, so fast
  scrolling no longer leaps several levels, and the latest bar stays in place (Ctrl zooms around the
  pointer). You can zoom in until two bars fill the chart, and wide candles get thicker wicks.
  Dragging the time axis left now spreads the bars.
- The chart's right-click menu is shorter, as in TradingView: Reset Chart View, Copy Price, Paste,
  Add Alert, Trading, Object Tree, Remove, Theme, Layout and Settings. Timeframes, chart types,
  indicators, templates, grid, volumes, zoom, replay, picture and close are on the chart bar and the
  menus.
- Drawing handles look and behave like TradingView's: blue rings with a halo under the pointer, shown
  when you hover a drawing as well as when it is selected, with TradingView's pointers over them.
- The magnet snaps the crosshair to the bar's open, high, low or close while you draw or edit, as in
  TradingView, within 50px with the weak magnet. It no longer snaps without a drawing tool, and Ctrl
  turns it the other way.
- Drawing toolbar icons redrawn in TradingView's style.

### Fixed

- Ctrl+=, Ctrl+- and Ctrl+0 now zoom the interface from pop-out windows too.
- Text on coloured buttons and tags stays readable in every theme. Buy and Sell buttons, One-Click
  trading, order-line labels, the chart's price tags and the crosshair labels switch to dark text
  where white would be too faint, so Meridian Dark's Buy, Sell and accent buttons now have dark
  labels. Meridian Light's profit, loss and warning colours are slightly darker so they read on white,
  and the open-position line is a darker grey.

## [0.8.0] - 2026-10-26

### Added

- Two-way drawing sync with TradingView. In **File > Import from TradingView > Sync**, link a
  TradingView symbol to an account symbol: its drawings then stay in step both ways. Changes made
  in TradingView show here within seconds, and edits, deletions and undos here are saved to the
  TradingView account. Only the settings you changed are written back, so TradingView-only settings
  survive. When both sides edit the same setting, the newer edit wins and the Journal notes it.
  Deleting more than 20 synced drawings at once waits for you to confirm or restore them. Drawings
  you create here stay here for now.

## [0.7.0] - 2026-10-26

### Added

- Type a timeframe on a chart to switch to it, as in TradingView. The first digit opens a box on the
  chart with what you type; Enter switches and Escape cancels. A number is minutes (`15`, `240`), and
  `s`, `h`, `D`, `W` and `M` after it mean seconds, hours, days, weeks and months (`5s`, `4h`, `1D`,
  `1W`, `1M`); MetaTrader names (`M15`, `H4`) work in the box too. It works in pop-out windows,
  Lite included.
- Favourite timeframes. Star timeframes in any timeframe menu to put them on the chart bar, or take
  them off; M1, M5, M15, M30, H1, H4 and D1 are the starting set, and the chart's current timeframe
  always shows.
- A chart can have a theme of its own: right-click it and choose one under **Theme**. Charts opened
  afterwards start with the theme chosen last, including after a restart, and **Match Application**
  puts a chart back on the window's theme. Choosing a theme this way resets the chart's own colours
  from Chart Settings so the theme shows in full.

### Changed

- Right-clicking a chart in a Lite picture-in-picture window opens a short menu: timeframes, chart
  type, theme, reset view and the window commands.

### Fixed

- Submenus stay inside their window. In a small window, such as a Lite picture-in-picture window,
  they open to the left or over the menu when there is no room on the right, end above the window's
  bottom edge and scroll when they are taller than it, instead of running off the window (the
  Timeframes submenu showed nothing usable).

## [0.6.0] - 2026-10-26

### Added

- Automatic updates. OpenTerm5 checks GitHub Releases at start and every four hours, downloads a new
  version in the background on Windows and Linux (AppImage and `.deb`) and installs it when you
  choose Restart to update in the status bar or quit. It never restarts on its own, so the trade
  copier, signal API and equity guards keep running. Progress and errors appear in the Journal,
  Help > Check for Updates checks now, and Tools > Options turns automatic checks off. On macOS,
  which only installs signed updates, the status bar links to the new release instead.
- Binance accounts. Log in to Binance USDⓈ-M futures (demo trading or live) with an HMAC API key or a
  self-generated Ed25519 key, and trade its USDT contracts with the same risk ticket, leverage
  suggestion and margin and liquidation checks as Bybit. Stop losses and take profits follow each
  fill as conditional orders; a fill whose stop Binance refuses is closed again. Keys that can
  withdraw funds are refused.
- Picture-in-picture tabs. A chart tab can leave the main window for its own always-on-top window
  with its whole layout, so it can sit on another monitor: drag it out of the tab bar (it opens in
  Lite), or right-click it and choose **Picture in Picture**. **Lite** shows the charts alone for
  monitoring; **Full** adds the chart toolbar, layout setup, drawing tools and trading panels, and its
  menus and dialogs open in that window. Drag the window's tab handle back onto the tab bar, choose
  **Return to Main Window**, or close the window to put the tab back.

### Changed

- Chart tabs belong to the kind of account they were opened on. Crypto tabs show only on Bybit and
  Binance accounts and forex tabs only on MT5 accounts; each side keeps the tab you last had in
  front, and the first crypto login starts with BTC, ETH, SOL and XRP charts. Tabs saved before this
  are sorted by their symbols.
- Bybit and Binance accounts share one set of crypto watchlists and risk ticket settings.
- The crypto risk ticket says "No liquidation at this size" instead of showing a liquidation price of
  0 when the free margin covers a fall to zero.

### Fixed

- Charts no longer look washed out when zoomed out, most visibly on light themes. Candles fill their
  bar spacing as TradingView's do instead of leaving background between thin bodies, and the chart
  canvas matches the screen's pixels at any interface zoom or display scaling instead of being
  stretched and blurred. Volume columns are sharper and half opaque.

## [0.5.0] - 2026-10-23

### Added

- Bybit accounts. Log in to a Bybit Unified Trading Account (demo trading, live or testnet) with an
  API key, and trade its USDT and USDC perpetual and futures contracts. Risk orders size by coin
  quantity with Bybit's taker fee inside the risk, and set partial take-profits and stops on one
  position. They check the free margin at the contract's leverage and refuse a stop beyond the
  estimated liquidation price. The risk ticket shows and sets the contract's leverage and suggests
  one that keeps liquidation well behind the stop. Bybit accounts keep their own watchlists (starting
  with major crypto contracts) and risk ticket settings. Keys that can withdraw funds are refused.
- Stops can be set as a percentage of the price in the risk ticket and as a signal source's default.
- Backtesting. A backtest session hides the layout's later bars from a start date (optionally to an
  end date) and moves forward on its own clock while you trade a simulated account with its own
  balance, leverage, spread, slippage, commission and stop out. Backtesting is a mode beside Trade
  and Analysis (the mode switch, the toolbar's Backtest button or View > Backtest Mode): it gives
  the interface to the charts and the session, with Analysis mode's layout, no watchlist and the
  Backtest panel, and leaving it puts the previous layout back. Place Order on the
  floating controls (or F9) plans each order with lines on the chart: the entry, stop loss and take
  profit, with the volume from the risk set in the planner. Orders fill on the bars the backtest
  passes, along each bar's open, low, high and close (or high before low), with gaps filled at the
  opening price, from the finest history available. The controls also play, step and jump to the
  next Sydney, Tokyo, London or New York open. A resizable
  Backtest side panel shows the account, an equity curve, performance statistics, positions,
  orders, trades with R, MAE and MFE, and a journal, in sections that fold; trades are marked on the
  chart. Sessions save as they go and can be resumed, restarted or deleted; trades export to CSV.
  Bar replay is not used: the Replay button stays off and the charts are not shaded.

### Fixed

- The order dialog and risk ticket no longer keep a pending price (and the dialog's stop loss and take
  profit) from the previous symbol after you switch symbols, which sent orders at another symbol's
  price.
- Bybit limit orders priced outside Bybit's band around the market are refused with the price Bybit
  will accept, before anything is sent, and every order Bybit refuses is recorded in the Journal.

## [0.4.0] - 2026-10-19

### Added

- TradingView-style chart layouts. Each tab in the chart bar holds one of 55 layouts of 1 to 16
  charts, chosen from the new layout button. Dividers resize (Shift moves matching dividers, a
  double-click evens them out) and sizes are kept per layout. Alt+Enter maximises the active chart,
  Tab and Shift+Tab move between charts, and Move Chart swaps neighbours.
- Sync in layout, per tab: symbol, interval, crosshair (on by default), time and date range, with
  five coloured sync groups for symbol and interval. Sync Drawings sends new drawings to every chart
  of the symbol in the tab or in every tab.
- One drawing toolbar for the whole layout, as in TradingView: the tool, magnet, lock and hide apply
  to every chart, and a drawing goes on whichever chart is clicked.
- An Indicators dialog as in TradingView, holding every indicator: built-in studies, MetaTrader's
  formulas and Pine scripts. It has search, a sidebar by source (Favorites, My scripts, Technicals,
  Popular), stars for favourites, and a click to add; `/` opens it. The chevron beside the toolbar's
  Indicators button lists favourites, as does Insert > Favorite Indicators.
- Pine Script indicators (v5 and v6), run with LuxAlgo's PineTS in a background worker. Import an
  open-source script from its TradingView link, or paste the source, in the Indicators dialog's My
  scripts. Plots, fills (including gradients), hlines, plotshape, plotchar, plotarrow, bgcolor,
  barcolor, lines, boxes, labels, polylines, linefills, tables and request.security() draw on the
  chart, with inputs in the study's settings. Each script shows its author and licence. Strategies,
  libraries, scripts that import TradingView libraries, plotcandle and plotbar are not supported yet.
- Import TradingView's popular open-source indicators in one go (Indicators dialog > Popular, top 50
  to 1000), in its Popular-list order. Requests are spaced a second apart and pause when TradingView asks.
  The import runs in the background and can be cancelled, and running it again carries on or picks up
  new versions. Scripts are stored in IndexedDB.
- Bar replay runs every chart of a layout on one clock (or only the active chart). It has a replay
  bar under the charts, an update interval, speeds from 10x to 0.1x, and starts from a bar, a date,
  the first available bar or a random bar. Shift+Right steps and Shift+Down plays. Longer timeframes
  show their current bar forming from bars of the update interval.
- Resizable, movable panels ([#22](https://github.com/cyenite/OpenTerm5/issues/22)). Drag the
  edges of the side docks, the lines between stacked panels and the line above the Toolbox to resize
  them. Market Watch, the Data Window, the Navigator and the Trade Assistant move to either side of
  the charts by dragging their title bar, the arrow beside **×** or the title bar's menu. Sizes and
  sides are kept.
- A Trade Assistant panel ([#23](https://github.com/cyenite/OpenTerm5/issues/23)), View > Trade
  Assistant. It trades the active chart's symbol with risk-based sizing: risk, stop and R targets
  (several for taking profit in parts), a sell and buy preview side by side, and one-click Sell and
  Buy at market, limit or stop. Its Close tab closes all, profitable, losing, buy or sell positions,
  deletes pending orders, moves stops to break-even or closes a percentage, for the symbol or the
  whole account; its Manage tab sets break-even, trailing and hidden stops for its trades.
  The planned entry, stop and targets are drawn on every chart of the symbol, for the buy or sell
  side, and dragging them changes the plan.
- Interface zoom: Ctrl+= and Ctrl+- (Cmd on macOS) scale the whole application from 50% to 200%,
  Ctrl+0 returns to 100%, and View > Zoom offers the same with the current level. The level is kept
  between sessions. The keys work in dialogs and text fields too; + and - alone still zoom the chart.

### Changed

- Dragging a stop loss or take profit line on the chart, or an SL/TP tab, sends the change on
  release, without an Apply/Cancel step. A level on the wrong side of the price is refused and the
  line returns. Moving a pending order's entry still asks for Apply.
- Trade focus on charts: pointing at a position's or order's label, or its Toolbox row, highlights
  its entry, stop and target with its ticket and red and green risk and reward bands, and fades
  every other trade line. A click keeps the focus; Escape or a click elsewhere clears it.
- OpenTerm5 is now licensed under the GNU Affero General Public License v3.0 (AGPL-3.0-only), as
  PineTS requires. Releases up to 0.3.0 remain available under the MIT License.
- MT5 floating chart windows, Cascade, Tile and Arrange Icons give way to layout tabs. Saved
  workspaces and profiles migrate: tabbed charts open as a tab each, floating windows as one layout.
- New charts (File > New Chart, Market Watch, the + button) open in a tab of their own. Dropping a
  symbol on a chart changes that chart.
- Charts in bar replay no longer place or change live orders: One-Click, trade line dragging, the
  Trading menu, the risk planner and New Order are switched off for them.

### Fixed

- The trade copier marked new copies as "closed on the follower" a moment after opening them, when
  the follower's last snapshot did not list the copy yet. From then on it ignored the copy, so the
  master's closes, partial closes and stop and target changes never reached it. A copy now counts
  as closed only after it has been missing for 10 seconds; a master that closes before the copy
  shows up still closes it; and copies already marked that way are followed again while both sides
  are open.
- The trade copier's activity log and copies tables kept their columns aligned only while messages
  were short: a long message widened the table past its card and shifted every column. Columns now
  have fixed widths, messages and notes wrap, and a narrow window scrolls the table inside its card.
- Trade Assistant plan lines no longer blink or drop the drag while the plan is recalculated, and a
  line dragged past the chart's edge stays under the pointer. Crowded labels on the chart move apart
  instead of overlapping.

## [0.3.0] - 2026-10-16

### Added

- Analysis mode (View → Analysis Mode, Ctrl+Shift+A): a chart-first layout with a top bar for symbol
  search, timeframes, chart types, indicators and alerts, drawing tools on a left rail and the
  watchlist on the right. Order tickets, One-Click trading, the risk planner, Depth of Market and the
  Toolbox are withdrawn, while accounts, copiers, signals and automation keep running in the
  background. Open positions and pending orders can be shown on the charts, read-only.
- Meridian (`packages/meridian-charts`), OpenTerm5's own chart engine, now draws every chart. Charts
  gain area, baseline and Heikin Ashi styles, loading older history on scroll, axis dragging, resizable
  panes and a legend with settings for each study. 38 Meridian studies sit next to MetaTrader's own
  indicator formulas. Analysis mode shows the drawing toolbar: 75 tools in six groups with sectioned
  flyouts, favourites, a magnet, a style bar for the selected object, and measure and zoom tools.
- Seconds timeframes S1, S5, S15 and S30, built from the quotes OpenTerm5 receives. MetaTrader
  supplies neither seconds bars nor past ticks, so a seconds chart starts with the first quote for its
  symbol and keeps up to four hours. Seconds show on the time axis, crosshair, status bar and Data
  Window.
- Meridian themes (View → Theme): Meridian Dark, Light and Midnight, or Match System. One theme colours
  the whole window and its charts, and hosts can define their own.
- Advanced charting: undo and redo (Ctrl+Z, Ctrl+Y) for drawings and indicators; copy and paste of
  drawings between charts; text edited in place on the chart; a context menu on drawings (settings,
  copy, clone, stacking order, lock, hide, remove) and on the price axis (auto scale, regular,
  percent, indexed and logarithmic scales, invert); an object tree; bar replay with play, step and
  speed; Chart Settings for candle, wick and border colours, status line, scales, grid, crosshair and
  watermark, saved with each chart and its templates; crosshairs that follow each other across chart
  windows; and price alerts drawn on the chart, with **Add Alert** in the chart's context menu.
- Drawing settings in tabs (Style, Levels, Text, Coordinates, Visibility), with editable Fibonacci and
  Gann levels and per-timeframe visibility. New tools: pitchfan, Fibonacci spiral, fixed Gann square,
  forecast, bars pattern and ghost feed, bringing the toolbar to 82 tools. Fibonacci, Gann, pitchfork,
  channel, position, regression, VWAP and volume profile tools gain TradingView-style options.
- 48 more Meridian studies (86 in all), among them DEMA, TEMA, KAMA, ALMA, Williams Alligator,
  Chandelier Exit, ZigZag, Williams Fractals, TTM Squeeze, Vortex, Choppiness, Connors RSI, Fisher
  Transform, Schaff Trend Cycle, KST, PPO, TSI and Klinger. The indicator menus split Meridian's
  studies into **Trend & Overlays** and **Oscillators & Volume**.
- Hollow candles chart type.
- Alt shortcuts on a focused chart: Alt+T trend line, Alt+H horizontal line, Alt+J horizontal ray,
  Alt+V vertical line, Alt+C cross line, Alt+F Fibonacci retracement, Alt+R reset the chart view,
  Alt+I invert the scale, Alt+L logarithmic and Alt+P percent scale. Shift-click measures.
- Import from TradingView (File menu): sign in to TradingView in its own window, choose which symbols'
  drawings to copy and which account symbol receives each, and import saved TradingView chart themes.
  Imported drawings belong to their symbol and show on every chart of it; imported themes appear
  under View → Theme and in each chart's Chart Settings › Template menu. Drawings land on the
  broker's bars: its server clock, daylight saving changes included, is read from its own forex
  history. Drawings copied before are kept unless you choose to replace them.
- Chart Settings: a Template menu applies any chart theme's colours to that chart, a gradient
  background (top and bottom colours) and a chart text colour. Themes can define a gradient.
- Drawing templates: save a drawing's look under a name and apply it from any drawing's settings
  (Template menu), and copy the templates saved in TradingView.
- TradingView-style drawing settings: text on trend lines, rays, horizontal and vertical lines and
  rectangles (alignment, position, bold, italic); price and time labels that can be hidden; arrow
  ends; line opacity; more line stats (percent change, date range, middle point, show on select);
  Fibonacci level text, percentages, label size and the trend line; long and short positions with
  compact labels, hideable stats and labels, and their own colours; text boxes with background and
  border.
- Import TradingView chart settings (File → Import from TradingView → Chart settings): pick one chart
  from your TradingView layouts and apply its background, grids, candles, scales, status line,
  crosshair, margins and, optionally, chart type to every chart and to new charts. Chart Settings
  gains the options this needs: separate vertical and horizontal grid colours and styles, candle
  bodies, crosshair width, scale line colour and font size, pane separator colour, last price line
  colour and width, top and bottom margins, bar change and indicator inputs in the status line, and
  the crosshair's price and time labels.
- Journaling (Ctrl+5): connect a Tradescribe journal and the account you are logged in to sends its
  MT5 deals there automatically, marked verified. The first sync brings in the last 90 days. The page
  shows your plan and monthly usage, sync status for each account with Sync now, today's trades with
  a quick review (rating, tags, mistakes, playbook and notes) and the day note, with links into
  Tradescribe for the calendar, reports and AI review. A notice offers to review each trade as it
  closes, and the status bar shows when the journal last synced. Connect from the Journaling page
  (your browser asks you to allow it), with a code from Tradescribe, or with an `openterm5://` link,
  which always asks before connecting. Self-hosters set the journaling platform under Tools >
  Options.
- Equity guards can cap trade requests per trading day (FTMO allows 2,000). Every order, change, close
  and delete from any source is counted per account; past the limit only closes and deletes go
  through, and the Journal warns at 80%.
- News blackout: an equity guard can block new trades for set minutes before and after economic
  releases of a chosen impact, matched to the currencies each symbol depends on. The calendar comes
  from ForexFactory, is downloaded only while a guard uses it, and the guard lists the week's releases.
- Trade Copier: Export audit saves a copier's settings, copies and full log with tickets, times,
  account logins and the client ID, so a trader can show a prop firm that they copied between their
  own accounts.

### Changed

- The top of the window is two rows instead of three, the same in trading and analysis mode: an app
  bar with the menus, workspaces, a Trade/Analysis switch and the account, and a chart bar with the
  symbol, timeframes (more in a menu), one chart type menu, indicators, alerts, replay, undo and redo,
  then the trading actions (trade mode only), chart tools and a Panels menu. Drawing tools are on the
  chart's left rail: always in analysis mode, and in trade mode when opened with the chart bar's
  Drawing Toolbar button (also View → Drawing Toolbar); zoom stays on the mouse wheel, `+`/`-`
  and the Charts menu.
- Candles are painted on whole screen pixels, as TradingView does, so their colours are as solid and
  vivid as TradingView's. Before, every body edge and wick was half blended with the background.
- Long and short positions are edited as in TradingView: the target and stop handles sit on the entry
  side and one handle on the far side sets the length, which can now also extend to the left.
- MetaTrader's chart colour schemes (Green on Black, Color on White, Black on White) are replaced by
  Meridian themes. Profiles and templates no longer store a colour scheme.
- Saved charts move to Meridian's format on first start: indicators keep their MetaTrader formulas
  and settings, and drawings keep their anchors. The indicator parameter dialog is replaced by the
  settings on each study's legend row.
- The drawing toolbar's flyout arrows are visible without hovering.
- Undo and redo on a chart no longer revert or revive drawings changed elsewhere (another chart of the
  same symbol, an import). Changes made to the chart from its menus and dialogs, such as Delete All
  Objects, can now be undone on that chart. The Object Tree follows those changes.
- The client ID (CID) sent to the broker at login is now kept between connections and restarts, as
  the official web terminal does. Before, every connection sent a new one, so brokers saw a new device
  each time.
- New client IDs use a 128-bit random seed instead of the official web terminal's number up to
  1,000,000, which strangers with the same screen, scaling and language can share. Prop firms have
  closed accounts over shared CIDs. Ticking **Generate unique CID** when logging in replaces an older
  CID once, in the background; the CID is not shown anywhere in the app.
- Equity guards choose when the trading day starts: broker server time, Prague time (FTMO), New York,
  UTC or this computer, at any hour. The daily loss can be measured from the balance at the reset (as
  at FTMO), the equity, or the higher of the two (as at The5ers). New guards default to broker server
  midnight and the higher value; saved guards keep their previous behaviour. Copier equity protection
  has the same settings.
- Copy Trading is now called Trade Copier (workspace tab, Ctrl+2 and the docs).
- While the saved account signs in at startup or after an account switch, the window says so: the
  account chip, status bar, Navigator, Market Watch, charts, Toolbox and Depth of Market show which
  account is signing in, and login actions wait until it finishes. A failed sign-in stays visible
  with its reason instead of only appearing in the Journal.
- Drawing settings look and behave like TradingView's: a draggable dialog with Style, Text,
  Coordinates and Visibility tabs, colour swatches with a palette, custom colours, opacity and
  thickness, line style lists, bold and italic toggles, and a Template menu (Save as, Apply default,
  remove a template). Edits show on the chart as you make them; Cancel puts the drawing back.
  Visibility can be limited to a range of intervals in each band (for example M5 to M30).
- The floating toolbar of a selected drawing follows TradingView: a drag handle (it stays where you
  leave it), templates, line, background and text colours, width, style, settings, lock, remove and a
  More menu. The drawing context menu gains Template, Visual order and Visibility on intervals
  submenus.
- Long and short positions start minimal: compact price labels, with the risk/reward stats shown only
  while the position is selected. Compact stats mode and Always show stats are in its settings.

### Removed

- The TradingView Lightweight Charts dependency.

### Fixed

- A new drawing now starts with the style of the last one of its tool you restyled or applied a
  template to, as in TradingView, instead of resetting to the default. It is remembered across
  restarts.
- On macOS the window controls no longer cover the File and View menus. They are centred on the top
  bar, and the bar stops leaving room for them in full screen. The account name stays on one line, and
  on narrow windows the top bar compacts instead of clipping.
- In light themes, hovering an item in a submenu (Indicators, Panels, the menu bar, context menus) no
  longer turns the other items' text white, which made the submenu unreadable.

## [0.2.0] - 2026-10-14

### Added

- Orders show their progress immediately. Order and modify dialogs switch to a "Sending to the
  broker" view, the status bar shows each order in flight with a live timer and then its result,
  Toolbox rows show a spinner while their position or order is being closed, and One-Click and the
  chart risk planner show which order is pending.
- Watchlists in Market Watch: create, rename, duplicate and delete named lists, switch between them,
  group symbols under foldable sections, and drag rows to reorder them. Lists are kept across
  restarts and accounts, and each account shows them under its own symbol names, so a list made on
  a broker that writes `EURUSD.pro` shows `EURUSDm` on another and `GOLD` where a broker calls
  `XAUUSD` that. Symbols an account does not offer stay in the list, marked unavailable. Saved
  Market Watch sets from earlier versions become watchlists.
- Symbol search when adding to Market Watch: results appear as you type, ranked by name, broker
  decoration, other names for the instrument (gold, nas100) and description, with market filters,
  arrow keys and Enter. Typing while Market Watch is focused starts a search.
- Copy trading previews what a master symbol will copy as on the follower before you add a mapping.

### Changed

- Orders overlap the way the official web client sends them: the next order goes to the broker as
  soon as the previous one is admitted, instead of waiting for its final execution result. Closing
  several positions or deleting several orders at once sends them back to back. Risk-order legs and
  Reverse remain sequential so a failed step still stops the next one.

### Fixed

- Typing a symbol into Market Watch could not add names with lowercase broker suffixes such as
  `EURUSDm` or `EURUSD.m`.
- A chart saved on another broker no longer stops every quote from updating. Its old symbol name
  made the broker reject the whole quote subscription until the chart was re-pointed.
- Copy trading: an explicit symbol mapping written plainly (`DE40 -> GER40`) now also applies when
  the master's symbol is decorated (`DE40.m`), and its target follows the follower's decoration.
  Copies with an unknown outcome can be matched again after a restart, and a `BRK.B` trade is no
  longer copied as `BRK.A`.
- Market Watch no longer re-filters every broker symbol and rebuilds its symbol suggestions on every
  quote. This took most of the interface's processing time and delayed clicks, order results and
  risk previews by up to several hundred milliseconds.
- A second click on a Toolbox close or delete button no longer sends a duplicate request while the
  first is in flight.
- Warm orders and cached trading prerequisites no longer wait for active chart/history reads or
  account refreshes. Orders remain serialized and login waits for existing orders to settle.
- The Journal reports order queue/preparation and broker-confirmation timings separately.
- Risk previews start immediately, coalesce pending edits and ignore obsolete results. Existing quote
  subscriptions are reused instead of restoring the same stream repeatedly during preparation.

## [0.1.2] - 2026-10-14

### Fixed

- Broker discovery returns on an exact match and cancels unused probes, avoiding delays from slow
  speculative hosts. Verified broker terminals are checked before guessed addresses.
- Orders and their prerequisite reads take priority over queued chart/history requests. Quotes wake
  on incoming ticks, and confirmed orders return without waiting for an account refresh.
- Broker relay pages remain available for 30 idle seconds, avoiding renderer recreation during
  login and reconnects. Hidden relays no longer prevent normal main-window close or macOS activation.
- Signal allowlists and copier symbol filters keep decorated symbols distinct, so an entry such as
  `BRK.A` cannot admit `BRK.B`. Signal allowlists check the broker symbol actually selected for trading.
- Copier reconciliation after an unknown outcome requires the exact mapped follower symbol before
  adopting a position. Getting-started instructions now use the published installer filenames.

## [0.1.0] - 2026-10-14

First public release of OpenTerm5 (previously developed as Terminal5), under the MIT License.

### Upgrading from a development build

- On first start, OpenTerm5 copies the previous Terminal5 or OpenTerm profile, so connection settings,
  saved accounts, chart layouts and automation settings carry over.
- Saved passwords are tied to the old application name in the operating system keychain, so enter
  each password once more.
- Webhook HMAC headers are `X-OpenTerm-Source`, `X-OpenTerm-Timestamp` and `X-OpenTerm-Signature`. The
  earlier `X-T5-*` names are still accepted.

### Added

- **Trading terminal with an MT5-style workflow:** Market Watch, Navigator, Toolbox (Trade, Exposure,
  History, Journal), Data Window, Depth of Market, and New Order and Modify dialogs, with context menus
  throughout.
- **Direct connection to MetaTrader 5 accounts** through the MT5 web trading protocol, with no Wine,
  virtual machine or Windows terminal. Positions and orders stay live from trade transaction
  notifications.
- **Broker detection from the trade server name:** a searchable list of about 2,800 MT5 servers.
  Unverified addresses need explicit approval before a password is sent.
- **Charts:**
  - all 21 MT5 timeframes, 15 indicator families and 6 drawing tools;
  - floating or tabbed chart windows with cascade and tile;
  - profiles and templates.
- **Chart trading:**
  - drag SL, TP and pending orders;
  - money values on every trade line;
  - ghost TP/SL handles;
  - a risk planner that sizes an order from a dragged stop.
- **Risk-based orders and position management:** risk by % of balance or equity or by money; split
  targets; break-even, trailing stops, partial closes, hidden stops and time exits; per-account
  equity guards.
- **Copy trading** between any accounts and brokers, with risk modes, symbol mapping, filters, trading
  hours and equity protection.
- **Webhook signal API** for TradingView and bots: token or HMAC authentication, replay protection,
  rate limits, idempotency, dry run, and notifications to Discord, Slack, Telegram or JSON endpoints.
- **Installers** for Windows (NSIS), macOS (DMG) and Linux (AppImage and .deb), with the OpenTerm5 icon.
  Builds are not yet code-signed.
- **Project files:** documentation under `docs/`, a contributing guide, code of conduct, security
  policy, issue and pull request templates, and CI on Linux, macOS and Windows.

[Unreleased]: https://github.com/cyenite/OpenTerm5/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/cyenite/OpenTerm5/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/cyenite/OpenTerm5/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/cyenite/OpenTerm5/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/cyenite/OpenTerm5/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/cyenite/OpenTerm5/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/cyenite/OpenTerm5/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/cyenite/OpenTerm5/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/cyenite/OpenTerm5/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/cyenite/OpenTerm5/compare/v0.1.1...v0.1.2
[0.1.0]: https://github.com/cyenite/OpenTerm5/releases/tag/v0.1.0
