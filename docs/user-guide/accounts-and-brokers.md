# Accounts and brokers

OpenTerm5 works with MetaTrader 5 accounts at brokers that offer MT5 web trading. Most MT5 brokers do.

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
