# Signal API

The signal API turns HTTP requests into trades. It is designed for TradingView alerts, trading bots
and scripts. Configure it in the **Signals** workspace (Ctrl+3).

> Signals execute only while OpenTerm is running and connected to the source's account. New sources
> start in dry-run mode. Test every source on a demo account first.

## Concepts

- The **server** listens on `127.0.0.1:8787` by default and is off until you enable it. A kill switch
  pauses all signals at once.
- A **source** is one sender, such as a TradingView strategy or a bot. Each source has its own:
  - secret;
  - target account;
  - sizing policy;
  - allowed symbols and actions;
  - rate limit and symbol mapping;
  - dry-run and required-stop settings.
- Every accepted signal is recorded in the Signals workspace with its result. Secrets are never
  logged.

## Endpoints

| Method and path | Authentication | Use |
|---|---|---|
| `POST /v1/hooks/{sourceId}` | `secret` in the body, bearer token, or HMAC | TradingView and senders that cannot set headers |
| `POST /v1/signals` | Bearer token, or HMAC headers | Bots and scripts |
| `GET /v1/signals/{id}` | Bearer token | The final status of an accepted signal |
| `GET /v1/health` | None | Liveness check |

Requests return `202 Accepted` at once, with the signal's `id`. Add `?wait=1` to wait up to 10 seconds
for the result instead; the response is then `200` with the full record.

## Authentication

Each source uses one of two methods.

**Token.** Send the source's secret in one of these ways:

- the header `Authorization: Bearer <secret>`;
- a `secret` field in the JSON body (for TradingView);
- the query parameter `?token=<secret>`.

**HMAC.** Sign each request so that the secret never travels with it:

```
X-OpenTerm-Source:    <source id>
X-OpenTerm-Timestamp: <unix time in seconds>
X-OpenTerm-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" with the secret>
```

The timestamp must be within 5 minutes of OpenTerm's clock, which prevents replays. The older
`X-T5-Source`, `X-T5-Timestamp` and `X-T5-Signature` headers are also accepted.

Example with `curl` and `openssl`:

```bash
BODY='{"id":"order-1","action":"buy","symbol":"EURUSD","risk":1,"sl_pips":20,"tp_r":2}'
TS=$(date +%s)
SIG=sha256=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')
curl -X POST 'http://127.0.0.1:8787/v1/signals?wait=1' \
  -H "X-OpenTerm-Source: $SOURCE_ID" -H "X-OpenTerm-Timestamp: $TS" -H "X-OpenTerm-Signature: $SIG" \
  -H 'Content-Type: application/json' -d "$BODY"
```

After 20 failed authentication attempts within 10 minutes, the caller is locked out for the rest of
that window.

## Signal format

Signals are JSON objects. A plain-text form is also accepted:

```
buy EURUSD risk=1 sl_pips=20 tp_r=1,2
```

### Actions

| Action | Effect |
|---|---|
| `buy`, `sell` | Open a position at market |
| `buy_limit`, `sell_limit`, `buy_stop`, `sell_stop` | Place a pending order at `price` |
| `reverse` | Close the source's position in the symbol and open the opposite side |
| `close`, `close_buy`, `close_sell` | Close the source's positions in the symbol (all, buys only or sells only) |
| `close_all` | Close all of the source's positions (no symbol needed) |
| `cancel`, `cancel_all` | Delete the source's pending orders, in the symbol or everywhere |
| `modify` | Change the stop loss and take profit of the source's positions |
| `breakeven` | Move the stop loss to the open price on the source's profitable positions |

Common aliases are understood, including `long`, `short`, `exit`, `flat`, `close_long`, `close_short`
and `be`.

### Fields

| Field | Description |
|---|---|
| `action` | Required. One of the actions above (also accepted as `side` or `order`) |
| `symbol` | The symbol (also `ticker` or `instrument`). The source's symbol map is applied first. Otherwise exchange prefixes such as `FX:` and perpetual suffixes such as `.P` are removed, and the source's suffix is added |
| `id` | An idempotency key (also `signal_id`, or the `Idempotency-Key` header). A repeated `id` within 24 hours is not executed again |
| `volume` | Volume in lots (also `lots`, `qty`, `quantity`) |
| `risk` | Risk as a % of balance (also `risk_percent`) |
| `risk_money` | Risk as an amount of account currency |
| `sl`, `sl_points`, `sl_pips` | Stop loss as a price, or as a distance in points or pips |
| `tp`, `tp_points`, `tp_pips` | Up to 5 take-profit levels, as a list or comma-separated |
| `tp_r` | Up to 5 targets as multiples of the stop distance. Cannot be combined with `tp` fields |
| `price` | Entry price for pending orders |
| `expiration_minutes` | Pending order lifetime |
| `trailing_points` | Attach a trailing stop at this distance. Tune it with `trailing_start_points` and `trailing_step_points` |
| `breakeven_r` | Move the stop to break-even after this multiple of the risk |
| `close_percent` | Close only this percentage of each position |
| `ticket` | Limit an exit or modification to one position or order |
| `scope` | `source` (default) or `symbol`; see below |
| `comment` | Order comment, up to 31 characters |

How the volume is chosen depends on the source's sizing policy. A source can use a fixed policy
(fixed lots, % of balance, % of equity, or money), or **From signal**, which uses `volume`, `risk` or
`risk_money` from each message. A maximum volume per signal can be set either way.

### Scope

Exits and modifications affect only the trades that **this source** opened. OpenTerm remembers each
source's order tickets locally, so a strategy's `close` never touches positions you opened by hand.
Send `"scope": "symbol"` to act on every position in the symbol instead.

## TradingView

1. In the Signals workspace, create a source with **Token** authentication and choose the account and
   sizing.
2. Copy the **TradingView webhook URL** and **TradingView alert message** shown for the source.
3. In TradingView, create an alert, paste the URL into **Webhook URL** and the message into
   **Message**. A typical message:

   ```json
   {
     "secret": "<your secret>",
     "id": "{{timenow}}-{{ticker}}",
     "action": "{{strategy.order.action}}",
     "symbol": "{{ticker}}",
     "risk": 1,
     "sl_pips": 20,
     "tp_r": [1, 2],
     "comment": "{{strategy.order.id}}"
   }
   ```

TradingView sends webhooks from the internet, but the signal server listens only on your computer.
Keep the server on `127.0.0.1` and publish it through an HTTPS tunnel or a TLS reverse proxy, such as
Cloudflare Tunnel, ngrok or Tailscale Funnel. The server itself speaks plain HTTP, so do not expose it
to the internet directly.

## Safety controls

Every signal passes through these checks, in order:

1. Body size limit (64 KB) and authentication, with lockout after repeated failures.
2. Signal validation and idempotency on `id` for 24 hours.
3. The global kill switch and the per-source rate limit.
4. The source's allowed symbols and actions, and its required-stop policy.
5. The account's equity guard and risk sizing (see
   [Risk and automation](risk-and-automation.md#equity-guards)).

Signals for the same account execute one at a time, in the order they arrive.

## Notifications

A source can report results to Discord, Slack or Telegram, or to any HTTPS endpoint as JSON.

```json
{ "event": "executed", "title": "...", "message": "...", "time": "2026-10-14T08:00:00.000Z", "source": "openterm" }
```

## Responses and errors

| Status | Meaning |
|---|---|
| `200` | With `?wait=1`: the final record (see its `status`: executed, failed, rejected or dryRun). For a repeated `id`: `"status": "duplicate"` with the original record |
| `202` | Accepted for execution |
| `400` | The body could not be read as a signal |
| `401` | Authentication failed, or the signature timestamp is outside the 5 minute window |
| `403` | The source is disabled |
| `404` | Unknown path, source or signal |
| `413` | Body larger than 64 KB |
| `422` | The signal is invalid; the message names the field |
| `429` | Rate limit reached or caller locked out |
| `503` | Signal intake is paused by the kill switch |
