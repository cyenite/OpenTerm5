# Roadmap

OpenTerm5 aims to cover the everyday MetaTrader 5 desktop workflow, and to add the tools traders
otherwise buy as Expert Advisors. This page lists what is not built yet, roughly in order of impact.
Issues tagged `roadmap` track each item; comment there before starting work on one.

## Planned

1. **Margin model.** Calculate margin, free margin and margin level for open positions, and check
   margin before sending an order. Equity and profit are already live.
2. **Broader broker coverage.** Grow the verified broker directory, and verify order flows with more
   brokers and account types (netting accounts, exchange instruments).
3. **Trade history on the chart.** Entry and exit arrows from account history.
4. **Market Watch.** Ticks and Trading tabs, daily high, low and change columns, sorting and
   statistics.
5. **Reports.** Balance and equity curves, drawdown, win rate, profit factor and per-symbol results,
   also for copier analytics.
6. **Indicators and objects.** The rest of the MT5 indicator catalogue, object styling, editable
   Fibonacci levels, direct dragging of drawn objects, and custom indicators.
7. **Alerts and notifications.** Price alerts that keep working while OpenTerm5 is closed, and push
   notifications.
8. **Execution modes and market data.** Request execution with requotes, exchange Time & Sales, tick
   history export, and custom symbols.
9. **Phone Access beyond the local network.** A relay so phones can reach the computer from
   anywhere without a VPN, and a headless OpenTerm5 that runs the broker sessions and automation on
   a server, which phones and the desktop both connect to.
10. **Signed releases.** Code-signed and notarised installers for Windows and macOS. Automatic
   updates already work on Windows and Linux; macOS only links to the new release until the app is
   signed and notarised, which Squirrel.Mac requires before it installs an update.

## Not planned

- **MQL5 Expert Advisors and indicators, MetaEditor and the Strategy Tester.** OpenTerm5 does not run
  compiled MT5 programs. Its automation, trade copier and signal API cover the most common reasons to
  use them.
- **MetaQuotes services** such as the Market, Signals and VPS.
- **Broker services** such as account opening, deposits and withdrawals; use your broker's client
  area.

## Known limitations

- Automation, copying and signals run inside OpenTerm5 and stop when it is closed. So does Phone
  Access, which reaches the computer only over a local or private network.
- Copies are observed through each master's own session, so they are slower than a copier running on
  the broker's server.
- Brokers whose web trading address cannot be detected need the address entered once by hand.
- Behaviour has been verified mainly against the MetaQuotes demo server; FTMO and Pepperstone servers
  have been confirmed reachable.
