# OpenTerm

**An open-source desktop trading terminal for MetaTrader 5 accounts, on Linux, macOS and Windows.**

[![CI](https://github.com/cyenite/OpenTerm5/actions/workflows/ci.yml/badge.svg)](https://github.com/cyenite/OpenTerm5/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

OpenTerm gives you the familiar MetaTrader 5 desktop workflow without Wine, a virtual machine or a
Windows-only terminal. It connects directly to your broker's MT5 trading servers. On top of that
workflow it adds tools that traders usually buy as Expert Advisors or third-party services: risk-based
order sizing, trade management, copy trading between accounts, and an HTTP signal API for
TradingView alerts and bots.

> **Risk warning.** Trading foreign exchange, CFDs and other leveraged products carries a high level of
> risk and may not be suitable for all investors. OpenTerm is provided "as is", without warranty of any
> kind. Test every feature on a demo account before using it with real money. You are responsible for
> every order placed from your accounts.

## Features

**A complete trading terminal**

- Market Watch with symbol sets, a Navigator, Data Window and Depth of Market. The Toolbox has Trade,
  Exposure, History (with CSV export) and Journal tabs.
- Charts with all 21 MT5 timeframes, 15 indicator families, line studies and Fibonacci tools, profiles
  and templates.
- Floating or tabbed chart windows with cascade, tile and minimise, as in MT5.
- Market and pending orders, SL/TP modification, partial close, Close By and one-click trading.
- Context menus throughout, with MT5 keyboard shortcuts.

**Trading from the chart**

- Drag stop loss, take profit and pending order lines. Every line shows its value in money.
- Drag ghost **TP** and **SL** handles off a position's entry line to add the levels it is missing.
- Draw a trade with the risk planner: drag the entry and stop, and OpenTerm sizes the order to your
  chosen risk.

**Risk and automation**

- Size orders by % of balance, % of equity or a fixed amount. Commission counts inside the risk.
- Split the position across up to five take-profit levels.
- Manage open positions with break-even, trailing stops, partial targets, hidden stops and time exits.
- Equity guards per account: daily loss limits, maximum drawdown, a profit lock and exposure caps.

**Copy trading**

- Copy from a master account to any number of followers, across brokers.
- Six risk modes, symbol mapping, filters, trading hours and equity protection.

**Signal API**

- A local HTTP server that turns TradingView alerts and bot messages into orders.
- Token or HMAC authentication, replay protection, rate limits, idempotency and a dry-run mode.
- Notifications to Discord, Slack, Telegram or any JSON endpoint.

**Broker login by server name**

- Search for your broker's trade server (for example `FTMO-Server`). OpenTerm finds its address, and an
  unverified address must be approved before your password is sent.

## Getting started

Pre-built installers will be published on the [releases page](https://github.com/cyenite/OpenTerm5/releases).
To run OpenTerm from source, install [Node.js 22.12 or later](https://nodejs.org/), then:

```bash
git clone https://github.com/cyenite/OpenTerm5.git
cd OpenTerm5
npm ci
npm run dev
```

Then choose **File → Login to Trade Account**, search for your broker's server and log in. The
[Getting started guide](docs/getting-started.md) covers installation, packaging and first steps in
detail.

## Documentation

| Guide | Contents |
|---|---|
| [Getting started](docs/getting-started.md) | Install, build, log in and find your way around |
| [Trading](docs/user-guide/trading.md) | Charts, windows, orders and trading from the chart |
| [Accounts and brokers](docs/user-guide/accounts-and-brokers.md) | Logging in, saved accounts and broker detection |
| [Risk and automation](docs/user-guide/risk-and-automation.md) | Risk-based orders, position management and equity guards |
| [Copy trading](docs/user-guide/copy-trading.md) | Copying trades between accounts |
| [Signal API](docs/user-guide/signal-api.md) | Webhook reference for TradingView and bots |
| [Keyboard shortcuts](docs/user-guide/keyboard-shortcuts.md) | Shortcut reference |
| [Troubleshooting](docs/troubleshooting.md) | Common problems and their fixes |
| [Architecture](docs/development/architecture.md) | How OpenTerm is built |
| [Roadmap](docs/roadmap.md) | Known gaps and planned work |

## How it works

OpenTerm is an [Electron](https://www.electronjs.org/) application written in TypeScript. The
interface is built with React and
[TradingView Lightweight Charts™](https://www.tradingview.com/lightweight-charts/).

The main process contains an independent client for the protocol that MT5 web trading uses. It keeps
one broker session per account. The trade management, copy trading and signal engines run alongside
it, so they keep working while you use the interface. They need OpenTerm to be running and connected.
See [Architecture](docs/development/architecture.md).

## Project status

OpenTerm is young software. Its behaviour has been verified against the MetaQuotes demo server, and
brokers including FTMO and Pepperstone have been confirmed reachable. Margin figures, some MT5 features
and broader broker coverage are still in progress. The [roadmap](docs/roadmap.md) lists what is
missing. Reports from other brokers are very welcome.

## Contributing

Contributions of all sizes are welcome: bug reports, broker compatibility reports, documentation and
code. Read the [contributing guide](CONTRIBUTING.md) to get started, and follow the
[code of conduct](CODE_OF_CONDUCT.md). Please report security issues privately as described in
[SECURITY.md](SECURITY.md).

## Licence

OpenTerm is released under the [MIT License](LICENSE). Third-party components and their licences are
listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

MetaTrader and MetaQuotes are trademarks of MetaQuotes Ltd. OpenTerm is an independent project and is
not affiliated with, endorsed by or sponsored by MetaQuotes Ltd. or any broker.
