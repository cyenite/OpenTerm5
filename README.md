# Terminal5

A cross-platform (Windows, macOS, Linux) trading terminal on Electron, modelled on the MetaTrader 5 desktop workflow: Market Watch, Navigator, tabbed or tiled charts with 21 timeframes, indicators, line studies, Toolbox (Trade, Exposure, History, Journal), Data Window, Depth of Market, New Order and Modify dialogs, and One Click Trading.

## How it reaches a broker

Terminal5 uses its independent TypeScript MT5 web-protocol client on every platform:

```
Electron UI → IPC → main process → secure broker web WebSocket
```

## Direct MT5 connection

Configure the web endpoint in **Tools → Options**, apply the connection, then use **File → Login to Trade Account**. The default endpoint serves MetaQuotes demo accounts. For another broker, use that broker's actual web-service WSS endpoint; entering a server name does not change the endpoint.

The independent TypeScript client in `electron/mt5-web-*` runs without Python, `terminal64.exe`, Wine, or a VM. It supplies account and symbol data, spread-adjusted quotes, historical charts, trade history and automatic reconnection to the existing Electron UI. Passwords remain in main-process memory for reconnection and are cleared when changing/disconnecting the connection or quitting. OTP accounts need a fresh login after a disconnect.

Market/pending orders, order modification/removal, SL/TP changes and position closes are implemented. Acceptance for processing is separate from the broker's final trade result. A lost or timed-out result is reported as unknown; orders are never replayed automatically. Local order checking validates fields and symbol limits; broker margin estimates are unavailable, so the UI does not invent them.

Charts support all 21 desktop periods. Nine periods (M1/M5/M15/M30/H1/H4/D1/W1/MN1) come directly from the broker; the remaining twelve aggregate real broker bars with broker-day alignment and summed tick volume. Gaps remain gaps. Genuine DOM subscriptions are supported when the broker supplies depth; otherwise a clearly labelled quote ladder has no invented volumes. Request-price negotiation remains unsupported. Close By is implemented for confirmed non-FIFO hedging accounts with broker permission and opposite positions in the same symbol. Account states requiring client-side financial calculations show unavailable equity/margin values rather than false zero estimates.

Live Linux verification covered actual UI login, quotes, historical bars, account/trade-history reads and reconnect recovery. Trade execution was tested with deterministic broker fixtures; no broker orders were submitted. Other brokers, macOS packaging and MQL5/EX5 execution have not been verified.

The standalone read-only diagnostic is also available:

```bash
npm run probe:mt5-web
npm run probe:mt5-web -- --credentials /absolute/path/to/private-demo-credentials.json
```

The credential file contains `{"login":"12345678","password":"your-demo-password"}` and optionally `"otp"`. Keep it outside tracked files; `.docs/private/` is gitignored. The first command only checks session negotiation and public configuration. The authenticated probe subscribes for 15 seconds and prints raw broker quotes. It never sends orders or creates accounts.

Investigation sources, runtime evidence and known limits are recorded in `../mt5-rea/REPORT.md`.

## Manual trading and chart tools

- **File → Accounts…** adds, switches and forgets saved account profiles. One account is active at a time. The endpoint and login identify each profile, including the same login on different brokers. Switching clears the previous account's live state and cancels queued requests. Default passwords live in main-process memory; **Save password securely** uses OS encryption only when a secure backend exists (Linux plaintext fallback is refused). A saved password can restore the most recently used account on restart; OTP still requires fresh login when requested.
- **File → Find Broker / Server…** lists servers published by an HTTPS broker web-terminal page and saved account endpoints. The public default is MetaQuotes-Demo. This is web-terminal discovery, not a universal desktop server directory; metadata does not prove that an account can log in.
- **Market Watch → Specification…** shows detailed trading conditions. Named Market Watch sets preserve exact broker symbol names and are isolated by account/endpoint. Applying a set reports partial failures rather than silently ignoring missing symbols.
- **View → Depth Of Market** shows broker bid/ask liquidity in instrument units when available. The quote ladder opens a reviewable market/pending ticket at the chosen price. It does not submit an order on a price-cell click. Position context menus expose **Close By…** when eligible.
- **File → Profiles** saves chart groups and preserves edits while switching. **Charts → Templates** saves indicators, drawings and appearance while keeping the destination symbol/period. These are Terminal5 JSON presets, not MT5 binary TPL files; the chart palette remains global.
- **Insert → Indicators** offers Moving Average (simple/exponential), Bollinger Bands, RSI, Ichimoku, SAR, ATR, Stochastic, CCI, Momentum, ROC, Williams %R, ADX Wilder, OBV, MFI and MACD. Volume indicators use tick volume. Warmup bars are omitted. Ichimoku forward spans use logical bar positions instead of invented future dates; Chikou is the defined lagged close line. Full MT5 initialization parity is not claimed.
- **Insert → Objects** or the toolbar provides horizontal/vertical lines, trendlines, horizontal rays, rectangles and Fibonacci retracements. Two-anchor tools prompt for a second click. **Charts → Objects List…** (Ctrl+B) edits coordinates and removes objects. Fibonacci uses the documented default levels and rightward extensions; custom levels, left rays and direct dragging remain open.
- **Tools → Price Alerts…** adds account-bound bid/ask thresholds. Alerts fire once in the Journal and an in-app notice while the matching account is connected. They survive restart, but the closed app and inactive accounts are not monitored.
- **History → Export CSV** exports deals and orders with UTC timestamps and spreadsheet formula protection. **Charts → Save Chart Image…** exports PNG including indicator/drawing primitives.

## Workspaces beyond MT5

The bar under the menu switches between four workspaces (Ctrl+1 to Ctrl+4). The engines behind them run in the main process, so they keep working while you use the Trading workspace. They act only while Terminal5 is open and connected.

### Copy Trading

Copy trades from a master account to any number of followers, on the same or different brokers, modelled on TradersConnect's copier (public feature model in `../mt5-rea/evidence/tradersconnect/`).

- **Risk types:** fixed lot, lot multiplier, balance multiplier, equity multiplier, fixed master balance (compounding) and fixed % risk (needs a master stop). Lot refiner, force min/max lot, contract-size alignment and reverse copying are also available.
- **Stops:** copy SL/TP by the same price or by the same distance from the follower's own fill. Fixed SL/TP pips, refinement, pending-order and expiry copying, and strict close are supported.
- **Filters:** side, master lot range, magic numbers, comments and symbols (copy-only or ignore). Trading hours are per weekday in local time.
- **Symbols:** explicit maps (DE40 to GER40) plus automatic broker-suffix matching (EURUSD to EURUSD.m).
- **Safety:** per-follower equity protection (minimum equity, daily loss %) and a status of Enabled, Monitor existing or Disabled at copier and follower level. Copiers that would loop between accounts are refused. Transient rejections (requote, off quotes, market closed) are retried for up to about 15 minutes. An unknown outcome is never re-sent; the follower is checked for the position instead.
- **How it works:** the engine reconciles master positions, the stored master-to-copy mapping and follower positions on every snapshot (masters poll every 500 ms). Restarts, reconnects and missed events therefore converge, and nothing is duplicated. Copies are not as fast as a server-side copier, because the master is observed through its own web session.

Every account needs its own broker session. Log in to each account once (File > Accounts) and save its password securely, or unlock it from the Connections list after a restart.

### Signals (webhook API)

An HTTP server (off by default, 127.0.0.1:8787) turns signals into trades. Each **source** has its own secret, account, sizing policy, limits and symbol mapping.

| Endpoint | Auth | Use |
|---|---|---|
| `POST /v1/hooks/{sourceId}` | `"secret"` in the JSON body, bearer token, or HMAC | TradingView alerts and tools that cannot set headers |
| `POST /v1/signals` | `Authorization: Bearer`, or `X-T5-Source` + `X-T5-Timestamp` + `X-T5-Signature: sha256=hmac(secret, "ts.body")` | Bots and scripts |
| `GET /v1/signals/{id}` | Bearer | Final status of an accepted signal |
| `GET /v1/health` | none | Liveness |

Signals are JSON (or `buy EURUSD risk=1 sl_pips=20 tp_r=1,2` text). Fields: `action` (buy, sell, buy/sell_limit, buy/sell_stop, reverse, close, close_buy, close_sell, close_all, cancel, cancel_all, modify, breakeven), `symbol`, sizing (`volume`, `risk` %, `risk_money`), stops (`sl`, `sl_points`, `sl_pips`), up to 5 targets (`tp`, `tp_points`, `tp_pips` or `tp_r`), `price`, `expiration_minutes`, `trailing_points`, `breakeven_r`, `close_percent`, `ticket`, `scope` and `id`.

Requests are answered `202` immediately; add `?wait=1` to wait up to 10 s for the result. The pipeline covers 64 KB body limit, auth (constant-time compare; HMAC with a 5 minute replay window), lockout after 20 failed attempts in 10 minutes, per-source rate limit, 24 hour idempotency on `id`, a global kill switch, allowed symbols and actions, a required-stop policy and dry-run mode. Signals for one account run in arrival order, and every one passes through the equity guards and risk sizing. Secrets are stored encrypted when the OS keychain is available (file mode 600 either way) and are stripped from the log. Entries are tagged `T5W <id>`, and close/modify/cancel touch only that source's trades unless the signal says `"scope": "symbol"`. Results can be pushed to Discord, Slack, Telegram or any HTTPS JSON endpoint.

To receive TradingView alerts from the internet, keep the server on 127.0.0.1 and publish it through an HTTPS tunnel (Cloudflare Tunnel, ngrok, Tailscale Funnel) or a TLS reverse proxy. The server speaks plain HTTP.

### Automation and risk-based orders

- **Risk ticket** (New Order > Risk-based): size by % of balance, % of equity, money or fixed lots, from a stop in price, points or pips, with commission counted inside the risk. Volume rounds down, so the budget is never exceeded, and a trade that cannot fit the minimum volume is refused rather than over-risked. Up to 5 R-multiple targets split the volume into separate positions, with break-even for later legs once the first target fills. Trailing, break-even at nR and hidden (stealth) stops can be attached at entry.
- **Position management** (Manage... in a position's menu): break-even with lock-in, trailing stop with start and step, up to 4 partial take-profits, hidden SL/TP and a time exit.
- **Equity guard** per account: daily loss (money or %), max drawdown from peak, daily profit lock, max open positions and max lots per symbol. When a limit trips, the guard blocks new trades from every source (manual, risk ticket, webhooks, copier) and can close everything.
- **One-click actions:** close all, profitable, losing, buys, sells or a symbol; delete pending orders; move all stops to break-even; reverse a position.
- **Live P/L and equity:** floating profit is recomputed from quotes with the symbol's profit currency converted to the account currency. Each symbol is checked against the broker's own position profit on every snapshot, and falls back to broker values if they disagree.

## Remaining gaps for MT5 desktop parity

Not built yet, roughly in order of user impact:

1. **Margin model:** margin, free margin and margin level with open positions, plus a pre-trade margin check. Equity and P/L are live; margin rates per calculation mode have not been verified against a live position.
2. **Live order verification beyond one account:** risk orders, SL and pending drags, the equity guard and webhook entry/close pass a supervised MetaQuotes demo run. The copier needs two live accounts, and other brokers are unverified.
3. **Trading from the chart:** trade arrows from history on the chart (dragging SL/TP, pending orders and the risk planner are done).
4. **Market Watch:** Ticks and Trading tabs, daily high/low/change columns, sorting, and statistics.
5. **Reports:** balance/equity curve, drawdown, win rate, profit factor and per-symbol breakdown from history; this would also serve copier analytics.
6. **More indicators and objects:** the rest of the built-in catalogue, object styling, Fibonacci levels editing and dragging, and custom indicators (the remaining big one).
7. **Alerts and notifications:** price alerts while the app is closed need a server; push and email are available through the notification targets.
8. **Request execution, requotes, exchange Time & Sales**, tick history export and offline/custom symbols.
9. **Broker services:** account opening, deposits and withdrawals, mailbox, news and economic calendar.
10. **Out of scope by design:** MQL5/EX5 execution, MetaEditor, the Strategy Tester, Market/Signals/VPS. Terminal5 replaces the most common EA use cases with the automation above and the signal API instead.

Only MetaQuotes demo on Linux has been verified live. Login detects a broker's web terminal from its server name for MetaQuotes, FTMO and Pepperstone, and for brokers whose terminal sits on a conventional host. For others, enter the address once under Advanced. Other brokers, Windows and macOS packages, and all live write paths remain unverified.

## Develop

```bash
npm install
npm run dev
```

The app starts with the public MetaQuotes demo web endpoint. No Python or local MT5 installation is required. Existing saved web endpoints migrate automatically; obsolete bridge settings are ignored.

```bash
npm run typecheck && npm test
npm run dist:linux   # or dist:mac / dist:win
```
