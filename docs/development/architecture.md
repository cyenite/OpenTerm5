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
| `mt5-web-trading.ts`, `-history.ts`, `-market.ts`, `-models.ts`, `-depth.ts` | Record parsers and request encoders |
| `session-pool.ts` | One `Mt5WebLink` per account; the UI account shares the interface's link |
| `broker-directory.ts`, `mt5-web-discovery.ts` | Server search and broker address resolution |
| `accounts.ts`, `account-registry.ts` | Saved accounts and `safeStorage` password encryption |
| `automation-host.ts` | Creates the engines, their stores and the automation IPC |
| `trade-manager.ts` | Risk-based orders, position rules, equity guards and bulk actions |
| `copier.ts`, `copier-math.ts` | Copy trading reconciliation and sizing |
| `webhook-server.ts`, `webhook-signal.ts`, `signal-executor.ts`, `signal-ownership.ts` | Signal API |
| `notifier.ts` | Discord, Slack, Telegram and JSON notifications |
| `json-store.ts` | Atomic JSON files and rotating JSON Lines logs |

`shared/` holds code that both processes use: the IPC contract (`protocol.ts`, `automation.ts`) and
pure logic for risk sizing (`risk.ts`), currency valuation (`valuation.ts`) and order planning
(`order-plan.ts`). Shared code must not import Node.js or DOM APIs.

## Renderer modules

| Path | Responsibility |
|---|---|
| `src/lib/session.ts` | Broker state: account, symbols, quotes, positions, orders, journal |
| `src/lib/workspace.ts` | Layout state: workspace, panels, charts, chart windows, dialogs (persisted) |
| `src/lib/automation.ts` | Automation state mirrored from the main process |
| `src/lib/store.ts` | A minimal observable store with a `useStore` hook |
| `src/components/chart/` | Chart controller (Lightweight Charts), trade overlay and chart windows |
| `src/components/dialogs/` | Order, modify, login and other dialogs |
| `src/components/pages/` | Copy Trading, Signals and Automation workspaces |

## Data flow

### Market data

1. `Mt5WebClient` receives quote notifications and decodes them against the symbol table.
2. `Mt5WebLink` applies the symbol's spread adjustment and publishes `tick` events.
3. The renderer's session store updates Market Watch, charts and the trade overlay.

Chart bars are requested on demand (command 11). Timeframes that the server does not provide are
aggregated from smaller bars.

### Trading

1. A dialog or engine sends an `order.send` request.
2. The link encodes it (command 12), registers the request ID and waits for the final result
   (notification 19). Admission by the server is not treated as execution.
3. Trade transaction notifications (notification 10) update positions, orders and the balance, and a
   `trade` event refreshes the interface.

A request whose outcome is unknown, for example after a disconnection, is reported as unknown and is
never repeated. The engines follow the same rule: the copier looks for a matching position and the
trade manager pauses the rule.

### Accounts

`SessionPool` keeps one link per account. The Trading workspace uses the active account's link.
The copier and signal sources acquire links for the other accounts they need. MT5 allows one web
session per login, so every account has exactly one link.

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

See [SECURITY.md](../../SECURITY.md) for how to report a vulnerability.
