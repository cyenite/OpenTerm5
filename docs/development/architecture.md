# Architecture

OpenTerm5 is an Electron application written in strict TypeScript. This page explains how its parts
fit together, so you can find where a change belongs.

## Processes

```
┌──────────────────────── Renderer (src/) ────────────────────────┐
│ React interface: workspaces, panels, charts, dialogs             │
│ Stores: session (broker data), workspace (layout), automation    │
└──────────────┬──────────────────────────────────▲────────────────┘
               │ window.terminal / window.automation (preload)    │ events
┌──────────────▼──────────── Main process (electron/) ────────────┴┐
│ IPC handlers (main.ts)                                            │
│ SessionPool ─ Mt5WebLink (UI account) + one link per other account│
│ AutomationHost ─ TradeManager · Copier · SignalExecutor · Webhooks│
│ BrokerDirectory · AccountRegistry · JSON stores                   │
└──────────────┬────────────────────────────────────────────────────┘
               │ Encrypted WebSocket (wss://<broker host>/terminal)
               ▼
        Broker's MT5 web trading server
```

- The **renderer** draws the interface only. It cannot reach the network, the file system or
  Node.js. The window is sandboxed with context isolation, and navigation away from the app is
  blocked.
- The **preload script** (`electron/preload.ts`) exposes two narrow APIs: `window.terminal` for
  broker requests and events, and `window.automation` for the automation engines. Each multiplexes a
  single IPC channel.
- The **main process** owns every broker connection, credential and engine, so automation keeps
  running whichever workspace is shown.

## Main process modules

| Module | Responsibility |
|---|---|
| `main.ts` | Window creation, IPC routing, account switching, automatic login |
| `mt5-web-transport.ts` | WebSocket, encryption, framing and request correlation |
| `mt5-web-codec.ts` | Bounded binary reader and writer |
| `mt5-web-client.ts` | Login, heartbeat, account and symbol commands, quote decoding |
| `mt5-web-link.ts` | One account session: state, subscriptions, polling, reconnection, trading |
| `request-queue.ts` | Serialized requests, urgent trading work and login barriers |
| `browser-network.ts`, `browser-socket.ts`, `relay-preload.ts` | Chromium broker session and WebSocket relay pages |
| `mt5-web-trading.ts`, `-history.ts`, `-market.ts`, `-models.ts`, `-depth.ts` | Record parsers and request encoders |
| `session-pool.ts` | One `Mt5WebLink` per account; the UI account shares the interface's link |
| `broker-directory.ts`, `mt5-web-discovery.ts` | Server search and broker address resolution |
| `accounts.ts`, `account-registry.ts` | Saved accounts and `safeStorage` password encryption |
| `automation-host.ts` | Creates the engines, their stores and the automation IPC |
| `trade-manager.ts` | Risk-based orders, position rules, equity guards and bulk actions |
| `copier.ts`, `copier-math.ts` | Trade Copier reconciliation and sizing |
| `webhook-server.ts`, `webhook-signal.ts`, `signal-executor.ts`, `signal-ownership.ts` | Signal API |
| `notifier.ts` | Discord, Slack, Telegram and JSON notifications |
| `json-store.ts` | Atomic JSON files and rotating JSON Lines logs |
| `hub-host.ts`, `hub-server.ts`, `hub-devices.ts`, `hub-interest.ts`, `hub-crypto.ts` | Phone Access: paired devices, the encrypted WebSocket server, merged quote and bar subscriptions |

`shared/` holds code that both processes use: the IPC contract (`protocol.ts`, `automation.ts`) and
pure logic for risk sizing (`risk.ts`), currency valuation (`valuation.ts`) and order planning
(`order-plan.ts`). Shared code must not import Node.js or DOM APIs.

## Renderer modules

| Path | Responsibility |
|---|---|
| `src/lib/session.ts` | Broker state: account, symbols, quotes, positions, orders, journal |
| `src/lib/workspace.ts` | Layout state: workspace, panels, charts, chart tabs and their layouts, dialogs (persisted) |
| `src/lib/automation.ts` | Automation state mirrored from the main process |
| `src/lib/store.ts` | A minimal observable store with a `useStore` hook |
| `packages/meridian-charts/` | Meridian, the chart engine: scales, canvas rendering, studies, drawing tools and their toolbar, themes (app CSS variables and chart colours) |
| `src/lib/mt5-provider.ts`, `src/lib/mt5-studies.ts` | MT5 history and live bars for Meridian charts; MetaTrader's indicator formulas as Meridian studies |
| `src/lib/tick-bars.ts`, `src/lib/mt5-timeframes.ts` | Seconds bars built from received quotes; the chart timeframes, seconds included |
| `src/lib/theme.ts` | Applies the chosen Meridian theme to the application and the charts |
| `src/lib/chart-model.ts` | Saved studies and drawings, and migration from versions before Meridian |
| `src/lib/chart-layouts.ts`, `src/lib/chart-tabs.ts` | Multi-chart layouts as split trees (geometry, dividers, sizes) and the tab model built on them |
| `src/lib/layout-sync.ts` | Crosshair, time and date range sync between the charts of a tab |
| `src/components/chart/` | Chart windows, the layout picker and the trade overlay (order and position lines aligned to the Meridian price scale) |
| `src/components/dialogs/` | Order, modify, login and other dialogs |
| `src/components/pages/` | Trade Copier, Signals and Automation workspaces |
| `src/lib/hub.ts`, `src/lib/hub-charts.ts` | The window's side of Phone Access: answering phones' chart requests from the workspace and announcing chart changes |
| `src/mobile/` | The phone client (`mobile.html`): a bridge that stands in for the preload over the hub, and the phone screens |

## Data flow

### Market data

1. `Mt5WebClient` receives quote notifications and decodes them against the symbol table.
2. `Mt5WebLink` applies the symbol's spread adjustment and publishes `tick` events.
3. The renderer's session store updates Market Watch, charts and the trade overlay.

Chart bars are requested on demand (command 11). Timeframes that the server does not provide are
aggregated from smaller bars.

Quote requests wake on incoming ticks instead of checking on a polling timer. Cached account,
symbol, subscribed quote and valuation reads return immediately. Orders use a separate serialized
queue, so an active chart/history read or account refresh cannot hold up a warm order. Missing symbol
metadata is loaded through the general request queue before trading. Login waits for earlier orders
to settle; connection-generation checks reject later work captured for the previous account.

Risk Ticket and chart-planner previews use `src/lib/risk-preview.ts` with `shared/latest-task.ts`.
The first calculation starts immediately; while it runs, subsequent edits replace the pending input.
Obsolete replies cannot overwrite a newer preview. Market-price updates trigger fresh calculations
without restarting a trailing debounce timer. The link records successful quote subscriptions and
reuses an unchanged symbol set, clearing that cache on disconnect or reconnect.

### Trading

1. A dialog or engine sends an `order.send` request.
2. The link encodes it (command 12), registers the request ID and waits for the server to admit it.
   The next order is sent as soon as the previous one is admitted, as in the official web client;
   only one command 12 is on the wire at a time because its reply carries no request ID. The caller
   still receives the final result (notification 19), matched by request ID. Admission by the server
   is not treated as execution.
3. Trade transaction notifications (notification 10) update positions, orders and the balance, and a
   `trade` event refreshes the interface.

The final result returns to the caller before a supplementary account refresh runs in the queue.
Broker execution and network round trips still determine the minimum achievable latency.
The Journal reports the time from the main process receiving an order to submission (queue and
preparation), the time until the broker admitted it, and the time until its final result. These timings exclude time
spent in renderer or automation logic before the order reaches the link.

The renderer tracks every order it sends (`trackTrade` in `src/lib/session.ts`, used by `sendOrder`
and the risk and bulk helpers in `src/lib/automation.ts`). Dialogs show a sending state as soon as
an order is submitted, the status bar shows the order in flight and then its result, and Toolbox
rows for a position or order with a request in flight are disabled until it settles.

A request whose outcome is unknown, for example after a disconnection, is reported as unknown and is
never repeated. The engines follow the same rule: the copier looks for a matching position and the
trade manager pauses the rule.

### Accounts

`SessionPool` keeps one link per account. The Trading workspace uses the active account's link.
The copier and signal sources acquire links for the other accounts they need. MT5 allows one web
session per login, so every account has exactly one link.

Broker traffic uses Chromium's persistent broker session. One hidden relay page per broker origin
owns its WebSockets and remains available for 30 seconds after its last socket closes, allowing
login and reconnects to reuse the renderer. Broker discovery checks known hosts before speculative
addresses and cancels the remaining probes when an exact server match arrives. Discovered addresses
still require approval before credentials are sent.

### Phone Access

```
Phone (mobile.html)                         Main process                       Window
 bridge: window.terminal ──┐  WebSocket /hub  ┌─ HubServer ── HubHost ─ terminalRequest ─ UiLink
         window.automation ┼──── encrypted ───┤                        ─ AutomationHost
 HubClient ────────────────┘                  └─ charts.* ── IPC ─────────────────── hub-charts.ts
```

- `shared/hub.ts` is the contract: scopes (`view`, `trade`), the allowlist of terminal, automation
  and chart methods a phone may call, message shapes and the pairing link. `shared/hub-session.ts`
  is the handshake and framing, with the crypto primitives supplied by each end (node:crypto in
  `electron/hub-crypto.ts`, @noble in `src/mobile/hub-crypto.ts`, because a page loaded over plain
  HTTP has no WebCrypto).
- Keys: each phone and the computer hold X25519 static keys. A connection derives per-direction
  AES-256-GCM keys with HKDF from three Diffie-Hellman results (ephemeral-ephemeral, phone
  static-computer ephemeral, phone ephemeral-computer static) and, on first contact, the pairing
  token. Nonces are frame counters, so replayed or reordered frames fail to open.
- Phone requests go through `terminalRequest` in `main.ts`, the same function the window's IPC
  uses, so guards and connection changes apply alike. `TickInterest` merges the window's quote
  subscription with every phone's, because `ticks.subscribe` replaces the link's set;
  `BarInterest` returns a phone's bar subscriptions when it disconnects.
- Chart state lives in the window, so `charts.*` requests are relayed to it over IPC
  (`hub:event` `chartRequest`, answered with `hub.chartReply`). Drawing edits are operations by
  drawing id. The window reports changed charts with `hub.chartsChanged`, and phones reload those.
- Events are filtered per phone (ticks and bars it subscribed to) and coalesced every 250 ms (the
  latest tick per symbol, the latest trade snapshot).
- The same HTTP server serves `dist/mobile.html` and `dist/assets/` to phones, with a strict Content
  Security Policy.

## Persistence

Main process files live in the application data directory (see
[Getting started](../getting-started.md#where-openterm-stores-data)). They are written atomically
(write to a temporary file, then rename) with mode 600.

| File | Contents |
|---|---|
| `connection.json` | Current server address |
| `accounts.json` | Saved accounts and encrypted passwords |
| `automation.json` | Position rules, guards and guard state |
| `copier.json`, `copier-log.jsonl` | Copier configuration, mappings and log |
| `webhooks.json`, `signals.jsonl` | Signal sources (secrets encrypted) and the signal log |
| `signal-tickets.json` | Tickets opened by each signal source |
| `risk-preferences.json` | The chart risk planner's mode and amount |
| `broker-servers.json`, `broker-terminals.json` | Cached server list and resolved broker addresses |
| `hub.json` | Phone Access settings, paired devices and the hub key (private key encrypted; neither saved without secure storage) |

The renderer persists layout, chart profiles, templates, Market Watch sets and alerts in local
storage under `openterm.*` keys.

## Security model

- Passwords stay in main-process memory unless the user saves them with `safeStorage`. They are never
  sent to the renderer after login.
- A guessed broker address receives a password only after the user approves it. Addresses are
  remembered only after a successful login.
- The webhook server binds to `127.0.0.1` by default. It uses constant-time secret comparison,
  HMAC with a replay window, lockouts, rate limits and a body size limit.
- The Content Security Policy allows only the app's own scripts.
- Phone Access is off by default. Phones authenticate with their own keys, can call only the
  methods in `shared/hub.ts` for their scope, and are rate limited on failed handshakes.

See [SECURITY.md](../../SECURITY.md) for how to report a vulnerability.
