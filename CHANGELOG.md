# Changelog

All notable changes to OpenTerm5 are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The project is now called **OpenTerm5** (previously Terminal5, briefly OpenTerm), as it works with
  MetaTrader 5 accounts only. It is released under the MIT License.
  - On first start, OpenTerm5 copies the previous profile, so connection settings, saved accounts,
    chart layouts and automation settings carry over.
  - Saved passwords are tied to the old application name in the operating system keychain, so enter
    each password once more after upgrading.
- Webhook HMAC headers are now `X-OpenTerm-Source`, `X-OpenTerm-Timestamp` and `X-OpenTerm-Signature`.
  The previous `X-T5-*` names are still accepted.
- Notification payloads sent to custom JSON endpoints report `"source": "openterm"`.
- Updated `concurrently` to 10.0.6 to fix a critical advisory in `shell-quote` (development only).

### Added

- An application icon, rendered from `build/icon.svg` with `npm run icons`.
- Open-source project files: licence, contributing guide, code of conduct, security policy, issue and
  pull request templates, continuous integration on Linux, macOS and Windows, and a documentation
  set under `docs/`.

## [0.1.0] - 2026-10-14

First public version.

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

[Unreleased]: https://github.com/cyenite/OpenTerm5/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/cyenite/OpenTerm5/releases/tag/v0.1.0
