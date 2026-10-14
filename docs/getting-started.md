# Getting started

This guide takes you from a fresh download to your first chart and order.

## System requirements

| | Minimum |
|---|---|
| Operating system | Windows 10 or later, macOS 12 or later, or a 64-bit Linux desktop (Ubuntu 22.04 or later, Fedora 38 or later, or similar) |
| Memory | 4 GB RAM (8 GB recommended with many charts) |
| Network | A stable internet connection to your broker |
| Account | An MT5 account with a broker that offers MT5 web trading |

To save passwords on Linux you also need a Secret Service keyring, such as GNOME Keyring or KWallet.
Most desktop environments include one.

## Installing

### From a release

Download the installer for your platform from the
[releases page](https://github.com/cyenite/OpenTerm5/releases):

| Platform | File | How to install |
|---|---|---|
| Windows | `OpenTerm Setup <version>.exe` | Run the installer |
| macOS | `OpenTerm-<version>.dmg` | Open the disk image and drag OpenTerm to Applications |
| Linux | `OpenTerm-<version>.AppImage` | `chmod +x` the file and run it |
| Debian, Ubuntu | `openterm_<version>_amd64.deb` | `sudo apt install ./openterm_<version>_amd64.deb` |

Release builds are not yet code-signed. Windows SmartScreen and macOS Gatekeeper may warn on first
launch:

- **Windows:** choose **More info → Run anyway**.
- **macOS:** right-click the app, choose **Open**, then confirm.

### From source

You need [Node.js](https://nodejs.org/) 22.12 or later and Git.

```bash
git clone https://github.com/cyenite/OpenTerm5.git
cd OpenTerm5
npm ci
npm run dev
```

To build an installer for your own platform:

```bash
npm run dist:linux   # AppImage and .deb
npm run dist:mac     # .dmg (run on macOS)
npm run dist:win     # NSIS installer (run on Windows)
```

The output is written to `release/`. Packaging macOS installers requires a Mac. Windows installers
are most reliably built on Windows.

## Logging in

1. Choose **File → Login to Trade Account**, or click **Log in** in the top-right corner.
2. In **Server**, type part of your broker's name or trade server, for example `ftmo` or
   `MetaQuotes`, and choose your server from the list. Your broker shows the server name in its
   account email and client area.
3. OpenTerm looks up the server's address. A green tick shows the broker and the address it will
   connect to.
4. Enter your **login** and **password**. Fill in **One-time code** only if your account uses
   two-factor authentication.
5. Optionally give the account a **label**, and tick **Save password securely** to log in
   automatically next time.
6. Choose **Login**.

If OpenTerm cannot find your server, or asks you to approve an address, read
[Accounts and brokers](user-guide/accounts-and-brokers.md#how-openterm-finds-your-broker).

To practise without risk, use a demo account. The `MetaQuotes-Demo` server is available to everyone.
Open an account on it from the MetaTrader 5 mobile or desktop app.

## A tour of the window

```
┌ Menu bar ───────────────────────────────────────────────────────────────┐
│ Workspaces: Trading · Copy Trading · Signals · Automation    Account ▾ │
│ Toolbar: panels, New Order, chart tools, timeframes                     │
├──────────────┬──────────────────────────────────────────────────────────┤
│ Market Watch │                                                          │
│              │                   Charts                                 │
├──────────────┤                                                          │
│ Navigator    ├──────────────────────────────────────────────────────────┤
│              │ Toolbox: Trade · Exposure · History · Journal             │
├──────────────┴──────────────────────────────────────────────────────────┤
│ Status bar                                                              │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Workspaces.** The tabs below the menu bar switch between Trading, Copy Trading, Signals and
  Automation (Ctrl+1 to Ctrl+4). The engines behind each workspace keep running while you use another
  one.
- **Account switcher.** The chip in the top-right corner shows the active account and whether it is a
  demo or real account. Click it to switch accounts.
- **Market Watch** lists live quotes. Double-click a symbol to open an order, drag it onto the chart
  area to open a chart, or right-click it for more actions.
- **Navigator** lists your saved accounts and the indicators. Click an account to log in to it.
  Click an indicator to add it to the active chart.
- **Toolbox** shows open positions and orders (**Trade**), net exposure, account history and the
  **Journal**, which records connection events and the result of every order.

Right-click anywhere for actions related to what you clicked. The
[keyboard shortcuts](user-guide/keyboard-shortcuts.md) follow MetaTrader 5.

## Placing your first order

1. Press **F9**, or choose **New Order** on the toolbar.
2. Choose the symbol, volume and optional stop loss and take profit.
3. Choose **Sell by Market** or **Buy by Market**.

The result appears in the dialog and in the Journal. The position appears in **Toolbox → Trade** and
on the chart, where you can drag its stop loss and take profit. See [Trading](user-guide/trading.md)
for pending orders, chart trading and risk-based sizing.

## Where OpenTerm stores data

OpenTerm keeps its settings in the standard application data directory:

| Platform | Location |
|---|---|
| Windows | `%APPDATA%\OpenTerm` |
| macOS | `~/Library/Application Support/OpenTerm` |
| Linux | `~/.config/OpenTerm` |

Passwords are only written to disk when you choose **Save password securely**. They are then encrypted
with your operating system's keychain. The data directory also holds connection settings, saved
accounts, automation and copier state, webhook settings and the signal log. Chart layouts and Market
Watch sets are stored with the interface's local storage in the same directory.
