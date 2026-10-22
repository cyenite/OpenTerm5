# Accounts and brokers

OpenTerm5 works with MetaTrader 5 accounts at brokers that offer MT5 web trading. Most MT5 brokers do.
It also connects to [Bybit](#bybit-accounts) Unified Trading Accounts with an API key.

## Logging in

Choose **File → Login to Trade Account**, pick your broker's trade server, and enter your login and
password. [Getting started](../getting-started.md#logging-in) walks through each field.

Your trade server name is in the email your broker sent when the account was opened. It is also in
the broker's client area. It usually looks like `Broker-Server`, `Broker-Demo` or `Broker-Live02`.

## Saved accounts

Every account you log in to is remembered. A saved account consists of its label, login, server and
connection address, and optionally its password.

- **Switch accounts:** click the account chip in the top-right corner, or click the account in the
  Navigator.
- **Edit or remove an account:** right-click it in the Navigator, or use
  **File → Accounts** (Manage Accounts).
- One account is active in the Trading workspace at a time. The copier and signal engines keep their
  own sessions for the other accounts they use.

### Passwords

By default a password is kept only in memory, so OpenTerm5 can reconnect after a network interruption.
It is forgotten when you quit.

Tick **Save password securely** to store it encrypted with your operating system's keychain. This
uses Keychain on macOS, DPAPI on Windows, and GNOME Keyring or KWallet on Linux. OpenTerm5 then logs in
to the most recently used account automatically when it starts. If no secure keychain is available,
the option is disabled; OpenTerm5 never stores a password in plain text.

Accounts that use a one-time code need a fresh code after every disconnection.

### Unique client ID for prop firm accounts

At every login the broker receives a client ID (CID) that identifies your computer. The standard web
terminal picks it from about a million values, so strangers with the same screen, scaling and language
can end up with the same one, and prop firms have closed accounts over shared CIDs.

Tick **Generate unique CID** when you log in to a prop firm account. OpenTerm5 then gives this
computer a CID nobody else has, once, before that login connects. Every account on this computer keeps
sharing it, which is what firms expect from one trader who copies between their own accounts. Once
done, the box stays ticked and greyed out. Accounts already connected in the background pick up the
new CID the next time they connect.

## How OpenTerm5 finds your broker

MT5 web trading has no server field at login. A broker is reached through its own web trading
address, for example `https://mt5webterminal.ftmo.com/terminal`. OpenTerm5 works out that address from
the server name you choose:

1. **Search.** The server list comes from MetaQuotes' public directory of about 2,800 MT5 servers. It
   is downloaded once and refreshed weekly.
2. **Known addresses.** OpenTerm5 ships with a small list of verified broker addresses, such as
   MetaQuotes, FTMO and Pepperstone.
3. **Previous logins.** An address that has logged in successfully for a server is remembered.
4. **Discovery.** For other servers, OpenTerm5 checks the usual hosts on the broker's domain. An
   address is used only if that host's page lists your exact server name.

### Approving an unverified address

An address found by discovery, or one you enter yourself, is marked **Unverified**. The login dialog
shows the host and the broker name its page claims. You must tick **This address belongs to my
broker** before you can log in.

OpenTerm5 cannot prove that an unverified host belongs to your broker, and your password will be sent
to it. Check the address against your broker's website or client area before you approve it. Once a
login succeeds, the address is remembered and no longer needs approval.

### Entering the address yourself

If your server cannot be found, choose **Advanced** in the login dialog. Enter the web trading
address your broker gives for MT5 (often shown as "WebTrader" or "Web Terminal"), then choose
**Check**. Brokers sometimes wrap the terminal in their own page; OpenTerm5 follows the embedded
terminal on the same domain.

### Adding a broker to the directory

If you find the address for a broker that OpenTerm5 does not detect, please open a
[broker compatibility report](https://github.com/cyenite/OpenTerm5/issues/new?template=broker_report.yml)
with the server name and address. Never include your login or password. Verified addresses are added
to `electron/broker-directory.ts`.

## Connection status

The status bar shows the connection latency. The Journal records every connection, disconnection and
login. After a disconnection OpenTerm5 reconnects automatically with the password in memory. It reads
positions, orders and history again. It never re-sends an order whose outcome was not confirmed.

**Tools → Options** shows the raw server address of the current connection. You rarely need to change
it; the login dialog sets it for you.

## Bybit accounts

OpenTerm5 trades the USDT and USDC perpetual and futures contracts of a Bybit Unified Trading
Account. Spot and inverse contracts are not supported yet.

### Creating an API key

1. On Bybit, open **API Management** and create a **system-generated** key. For **Demo trading**,
   switch your Bybit account to Demo Trading first and create the key there; demo keys only work on
   demo. Testnet keys come from testnet.bybit.com.
2. Allow **Contract: Orders and Positions** (read-write).
3. Leave **Withdraw** off. OpenTerm5 refuses a key that can withdraw funds.
4. Optionally bind the key to your IP address. Bybit disables keys without an IP binding after 90
   days; OpenTerm5 warns in the Journal two weeks before.

### Logging in

Choose **File → Login to Trade Account**, set **Platform** to **Bybit**, pick the environment
(**Demo trading**, **Live** or **Testnet**), and paste the API key and secret. Tick **Save API
secret securely** to have it stored in your operating system's credential storage, as for MT5
passwords. Otherwise it stays in memory until you quit.

### How Bybit trading differs

- **Volumes are coin quantities.** A volume of 0.01 on BTCUSDT is 0.01 BTC, not a lot.
- **One position per contract.** Bybit adds every order on a contract to a single position.
  Positions opened from a risk order with several targets therefore show as one position. Each
  target closes only its own share, and each share has its own stop order, so the position closes
  as it would in MT5.
- **Leverage is set per contract on Bybit.** The risk ticket shows the current leverage; change it
  and click **Set**. Leverage changes the margin the trade uses and where it would be liquidated,
  not the money at risk. A change also applies to a position already open on that contract.
- **Suggested leverage.** **Suggest** fills in the highest leverage that keeps the liquidation price
  at least one and a half stop distances from the entry, so the stop closes the trade first. With
  isolated margin, the margin it uses is then about the money at risk. It only fills the field; you
  still click **Set**.
- **Margin and liquidation are checked before sending.** A risk order is refused when it needs more
  than the free margin, or when its stop lies beyond the estimated liquidation price, because the
  stop would then not limit the loss, and the message says which leverage would work. The preview
  also warns when liquidation is close behind the stop. The estimate ignores fees, so keep a margin of
  safety.
- **Fees count inside the risk.** The risk includes your own Bybit taker fee on the entry and at the
  stop, read from Bybit.
- **Stops as a percentage.** The risk ticket offers **% of price** as a stop unit, and on Bybit it
  starts at a 1% stop. Its settings, like your watchlists, are kept apart from your MT5 ones.
- **Watchlists.** Bybit accounts have their own watchlists, starting with BTC, ETH, SOL, XRP, BNB
  and DOGE contracts. Your MT5 lists come back when you switch to an MT5 account.
- **Limit prices stay near the market.** Bybit only accepts limit orders within a band around the
  market price (about 1% for BTC): a buy limit cannot be far above the price, nor a sell limit far
  below it. OpenTerm5 tells you the limit before sending. To enter beyond it, use a stop order.
  Orders Bybit refuses are listed in the Journal with what was sent.
- **Not available yet:** market depth, order expiry, close by, and Journaling sync.
