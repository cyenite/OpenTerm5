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
2. **Known addresses.** OpenTerm5 ships with verified addresses for about 290 servers, listed below.
   Each broker server has its own web address, so a server is only ever sent to the address that
   serves it.
3. **Previous logins.** An address that has logged in successfully for a server is remembered.
4. **Discovery.** For other servers, OpenTerm5 checks the usual hosts on the broker's domain. An
   address is used only if that host's page lists your exact server name. If that host is on the
   same domain as a verified address of the same broker, it counts as verified too.

### Brokers with verified addresses

Checked on 27 and 28 October 2026: each address lists its server and completes the MT5 connection.

| Broker | Servers |
| --- | --- |
| Admirals | AdmiralsGroup-Demo, AdmiralsGroup-Live |
| Axi | Axi-US50-Demo, Axi-US50-Live to Axi-US54-Live, Axi-US88-Live, Axi-UK55-Live |
| BlackBull Markets | BlackBullMarkets-Live |
| Blueberry Markets | BlueberryMarkets-Demo, -Live, -Live02, BlueberryMarketsV-Live3 |
| Deriv | Deriv-Demo, DerivSVG-Server, -02, -03, DerivBVI-Server, -02, -03 |
| Equiti (EGMLabs) | EGMLabsLtd-Demo, -Live, -Live 2 |
| Exness | Exness-MT5Real to Exness-MT5Real51 and Exness-MT5Trial to Exness-MT5Trial17 (the ones Exness offers on the web) |
| FBS | FBS-Demo, FBS-Real, FBS-Real-1 to FBS-Real-18, FBSInc-Real-11 to -18 |
| FP Markets | FPMarketsKE-Demo, FPMarketsKE-Live (Kenya), FPMarketsSC-Demo, FPMarketsSC-Live, FirstPrudentialMarketsCY-Live |
| FTMO | FTMO-Demo, FTMO-Server, FTMO-Server2 to FTMO-Server5 |
| FundedNext | FundedNext-Server |
| FundingPips | FundingPips-Prime, -SIM1, -Trial |
| Fusion Markets | FusionMarkets-Demo, -Live |
| FxPro | FxPro-MT5 |
| HFM | HFMarketsKE-Demo2, -Live2, -Live10, -Live11, -Live15, -Live20; HFMarketsSC-Demo2, -Live1 to -Live5, -Live7 to -Live11, -Live20 |
| IC Markets | ICMarketsSC-Demo, -Demo02, -MT5, -MT5-2, -MT5-3, -MT5-4, -MT5-6; ICMarketsKE-Demo, ICMarketsKE-MT5-7 |
| IG | IG-DEMO, IG-LIVE |
| Infinox | InfinoxLimited-MT5Live, InfinoxCapitalLimited-MT5Live |
| INGOT Brokers | INGOTSC-Demo2, INGOTSC-Server |
| IUX | IUXMarkets-Live to -Live5 |
| JustMarkets | JustMarkets-Demo, -Demo2, -Demo3, -Demo6, -Live, -Live2, -Live3, -Live6, -Live7 |
| MetaQuotes | MetaQuotes-Demo |
| Moneta Markets | MonetaMarkets-Demo, MonetaMarkets-Live |
| MultiBank (MEX) | MEXIntGroup-Real, MEXMarkets-Real-3 |
| OANDA | OANDA-Prop Trader |
| Pepperstone | Pepperstone-Demo, Pepperstone-MT5-Live01, PepperstoneUK-Demo, PepperstoneUK-Live |
| PU Prime | PUPrime-Demo, PUPrime-Live, -Live2, -Live 4 to -Live 7, PUPrimeTrading-Live |
| RoboForex | RoboForex-ECN, RoboForex-Pro |
| Scope Markets | ScopeMarkets-Live, SCFMLimited-Live2 (Kenya) |
| Startrader | STARTRADERFinancial-Demo, -Live, -Live 3 to -Live 6, -Live7, -Live8, STARTRADERPrimeGlobal-Live |
| Swissquote | Swissquote-Server |
| The5ers | FivePercentOnline-Real |
| Tickmill | Tickmill-Demo, Tickmill-Live, TickmillUK-Demo, TickmillUK-Live, TickmillEU-Demo, TickmillEU-Live |
| Ultima Markets | UltimaMarkets-Demo, -Live 1, -Live 2, UltimaMarketsUK-Live |
| Valetax | ValetaxIntl-Live2 |
| Vantage | VantageMarkets-Demo, -Live, -Live 3 to -Live 8, -Live 10, -Live 11, -Live 13, -Live 14, -Live 15, -Live 19, -Live 21; VantageGlobalPrimeAU-Demo, -Live; VantageMarketsMU-Demo, -Live; VantageMarketsFutures-Demo, -Live |
| VT Markets | VTMarkets-Live, -Live 2, -Live 3, -Live 5 to -Live 9, VTMarketsLtd-Live 4 |
| XM | XM.COM-MT5, XMMena-MT5; XMGlobal-MT5, XMGlobal-MT5 2, XMGlobal-MT5 4 to 20; XMGlobalKE-MT5 2, 4, 16 (Kenya); XMZA-MT5 2, 4 to 16 |

The5ers, FxPro and JustMarkets put a Cloudflare check in front of their terminals, so the first login
may open a window where you confirm you are not a robot. FBS's own web page sends all of its
FBS-Real servers to one address that names only FBS-Real, so the login dialog says the address does
not list your server; the login itself confirms it.

Some servers have no MT5 web terminal that OpenTerm5 could find, because the broker offers MT5 on
desktop and mobile only, only its own web platform, or a terminal whose certificate has expired: for
example ExnessKE, FXTM, Octa, Eightcap, FXPesa (EGM Securities), AvaTrade, Alpari, ThinkMarkets,
TMGM, Doo Prime, ACY, Windsor, Pepperstone's regional servers other than the ones above, and a few
numbered servers of the brokers listed (Vantage Live 2, 9, 12 and 17, for instance). If your broker
gives you an MT5 web address for one of these, enter it under **Advanced**.

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
to `electron/known-terminals.ts`, and `npm run verify:terminals` checks every entry again.

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
  safety. With cross margin and a small position the preview can say **No liquidation at this size**:
  your free margin would cover a fall all the way to zero.
- **Fees count inside the risk.** The risk includes your own Bybit taker fee on the entry and at the
  stop, read from Bybit.
- **Stops as a percentage.** The risk ticket offers **% of price** as a stop unit, and on Bybit it
  starts at a 1% stop. Its settings, like your watchlists, are kept apart from your MT5 ones.
- **Watchlists and charts.** Crypto accounts (Bybit and Binance) share their own watchlists, starting
  with BTC, ETH, SOL, XRP, BNB and DOGE contracts, and their own chart tabs. Your MT5 lists and tabs
  come back when you switch to an MT5 account.
- **Limit prices stay near the market.** Bybit only accepts limit orders within a band around the
  market price (about 1% for BTC): a buy limit cannot be far above the price, nor a sell limit far
  below it. OpenTerm5 tells you the limit before sending. To enter beyond it, use a stop order.
  Orders Bybit refuses are listed in the Journal with what was sent.
- **Not available yet:** market depth, order expiry, close by, and Journaling sync.

## Binance accounts

OpenTerm5 trades the USDT-margined perpetual and quarterly contracts of Binance USDⓈ-M futures. In
Multi-Assets mode the USDC contracts are listed too. COIN-M, spot and margin are not supported yet.

### Creating an API key

1. On Binance (or demo.binance.com for **Demo trading**), open **API Management** and create a key.
2. Turn on **Enable Futures** and leave **Enable Withdrawals** off. On live accounts OpenTerm5
   refuses a key that can withdraw funds; demo keys cannot be checked, so make sure yourself.
3. An HMAC (system-generated) key needs an IP restriction before Binance lets it trade. A
   **self-generated Ed25519** key trades without one: generate the key pair (Binance's key
   generator, or `openssl genpkey -algorithm ed25519`), register the public key on Binance, and
   keep the private key.

### Logging in

Choose **File → Login to Trade Account**, set **Platform** to **Binance**, pick **Demo trading** or
**Live**, paste the API key, and paste either the HMAC secret or the whole Ed25519 private key PEM
block (including its BEGIN and END lines).

### How Binance trading differs

Most of [How Bybit trading differs](#how-bybit-trading-differs) applies: coin quantities, one
position per contract (unless the account uses Hedge Mode), whole-number leverage set per contract,
the suggested leverage, margin and liquidation checks, and the taker fee inside the risk. Beyond
that:

- **Stops and targets are separate orders.** Binance attaches no SL or TP to an order, so OpenTerm5
  places a reduce-only stop and take profit for each fill. A stop or target on the wrong side of the
  price is refused before anything is sent. If Binance still refuses the stop, the fill is closed
  again at once and the order reports why.
- **Pending orders keep their SL and TP until they fill**, then get them for each fill. A limit or
  stop order that fills while OpenTerm5 is closed gets no stop: check the position when you return.
- **Changing a pending order's SL, TP or a stop order's price replaces the order**, so it gets a new
  ticket. A limit order's price changes in place.
- **When a position closes**, OpenTerm5 cancels the stops and targets it placed for it.
- **Limit prices stay within Binance's band around the mark price** (5% on BTCUSDT); OpenTerm5 tells
  you the limit before sending.
- **History covers the last three months**, which is what Binance keeps.
- **Not available yet:** market depth, order expiry, close by, COIN-M contracts and Journaling sync.
