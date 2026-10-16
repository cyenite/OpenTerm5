# MT5 web protocol notes

OpenTerm5 talks to brokers with the same protocol that MT5 web trading uses. The protocol is not
publicly documented. This page records what the client relies on, so that contributors can maintain
it. Each statement is backed by a parser or encoder and its tests under `electron/mt5-web-*`.

> The protocol can change when brokers update their servers. Parsers validate sizes and values
> strictly, and fail loudly rather than guess.

## Connection

- Each broker serves the protocol at `wss://<broker host>/terminal`. The host selects the broker; the
  login request has no server field.
- Frames are encrypted. `mt5-web-transport.ts` performs the handshake and frames every message as a
  little-endian length, a marker and the encrypted body.
- Requests carry a command number and are matched to responses by command. Only one request per
  command is in flight at a time. Notifications arrive unrequested.
- A heartbeat (command 51) runs every 5 seconds after login.

## Commands used

| Command | Direction | Purpose |
|---|---|---|
| 28 | request | Log in with login, password and optional one-time code |
| 3 | request | Account details (balance, credit, leverage, currency, rights) |
| 4 | request | Snapshot of open positions and orders, **captured at login** |
| 5 | request | History of deals and orders for a time range |
| 11 | request | Chart bars for a symbol, timeframe and range |
| 12 | request | Trade request; the response only admits it for processing |
| 22, 23 | request, notification | Market depth subscription and updates |
| 8, 17 | notification | Quotes |
| 10 | notification | Trade transactions: orders, history orders, deals with positions and balance |
| 19 | notification | Final result of a trade request |
| 51 | request | Heartbeat |

## Login (command 28)

The 912-byte login body, in order: version (u32, 0), password (32 characters), one-time code
(64 characters), client ID (16 bytes), `utm_campaign` and `utm_source` from the page address
(32 characters each), two fields the official client leaves empty, the length and text of the
referrer's host name, the account login (u64), a 160-byte remembered credential and the previous
session ID (u64). OpenTerm5 fills the password, code, client ID and login; the rest are empty or zero.

The official web terminal derives the client ID as the first 16 bytes of the SHA-1 of
`platform;devicePixelRatio;language;<larger>x<smaller screen side>;<stored random number>`, and keeps
it in browser storage, so one browser sends the same ID every time. OpenTerm5 computes it the same way
once, stores it in `device.json` in the profile and sends it from every connection and account
(`device-identity.ts`).

## Records

All integers are little-endian. Strings are fixed-size UTF-16LE fields. Prices are 64-bit floats.
Volumes are 64-bit integers in units of 10⁻⁸ lots. Times are seconds, with a separate milliseconds
field where shown.

| Record | Size | Parser |
|---|---|---|
| Position | 344 bytes | `parseWebPosition` |
| Order | 356 bytes | `parseWebOrder` |
| Deal | 356 bytes | `decodeDealRecord` |
| Trade request | 248 bytes | `encodeTradeRequest` |

Position and order records carry the symbol's price digits. Parsers round every price to those
digits, because servers send values such as `1.1167799999999999`.

### The position snapshot (command 4)

A count and positions, then a count and orders. Servers may append padding after the order list,
which is ignored.

The snapshot reflects the state at login. Positions opened afterwards in the same session do **not**
appear in later snapshots. The client therefore reads command 4 once per session and keeps state from
notification 10.

### Trade transactions (notification 10)

A frame contains one or more records, each starting with a kind and an action
(0 added, 1 updated, 2 removed):

| Kind | Body |
|---|---|
| 0 | Open order record |
| 1 | History order record |
| 2 | Deal record, position record, balance, credit and three more account values, then a list of deals and a list of positions |

A single fill produces a frame that mixes kinds: the open order's removal followed by a history order.
The kind must therefore be read for every record. A position record with zero volume means the
position closed. See `parseTradeTransactions`, `applyOrderChange` and `applyPositionChange`.

### Trade requests (command 12)

The request carries the action, symbol, volume, order type, filling mode, expiration mode, prices,
stop loss and take profit, a comment of up to 31 characters, and position identifiers. There is no
magic number or client identification field. Market orders choose their filling mode from the
symbol's execution mode and allowed filling flags.

The response to command 12 only admits the request. The result arrives later in notification 19,
correlated by request ID. Final return codes include 10008 (placed), 10009 (done), 10010 (partially
done) and the rejection codes listed in MT5's documentation.

## Broker addresses

`broker-directory.ts` resolves a trade server name to a host. MetaQuotes' public directory at
`https://metatraderweb.app/trade/servers?version=5` supplies server names. A host's
`/terminal` page declares its broker and servers in `window.__terminal_params`;
`mt5-web-discovery.ts` reads and validates that metadata.

## Diagnostics

`npm run probe:mt5-web` opens a session against the public MetaQuotes endpoint and prints the server
build. With `-- --credentials /path/to/file.json` it also logs in and prints live quotes for 15
seconds. It never sends orders. Keep the credentials file outside the repository.
