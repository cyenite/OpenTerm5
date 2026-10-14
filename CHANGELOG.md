# Changelog

All notable changes to OpenTerm5 are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/cyenite/OpenTerm5/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/cyenite/OpenTerm5/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/cyenite/OpenTerm5/compare/v0.1.1...v0.1.2
[0.1.0]: https://github.com/cyenite/OpenTerm5/releases/tag/v0.1.0
