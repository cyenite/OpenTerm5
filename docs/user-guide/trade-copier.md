# Trade Copier

The **Trade Copier** workspace (Ctrl+2) copies trades from a master account to any number of follower
accounts. The accounts can be at the same broker or at different brokers.

> The copier runs inside OpenTerm5 and copies only while OpenTerm5 is running and connected to every
> account involved. It observes the master through its own session, so copies are not as fast as a
> copier running on the broker's server.

## Before you start

Every account needs its own broker session. Log in to each account once, from **File → Login to
Trade Account**, and tick **Save password securely**. Then OpenTerm5 can reconnect to all of them when
it starts. An account without a saved password can be unlocked from the copier's connection list after
a restart.

## Creating a copier

1. Open **Trade Copier** and choose **Create a copier**.
2. Choose the **master** account.
3. Under **Followers**, pick an account from **+ Add follower**. Repeat for more followers.
4. Configure each follower (see below), then set the copier's status to **Enabled**.

A copier that would copy trades back to its own master, directly or through another copier, is
refused.

### Statuses

| Status | Behaviour |
|---|---|
| Enabled | Opens, modifies and closes copies |
| Monitor existing | Manages copies that are already open, but opens no new ones |
| Disabled | Does nothing |

The status can be set for the whole copier and for each follower.

## Follower settings

### Volume

| Risk type | Volume of each copy |
|---|---|
| Fixed lot | Always the same volume |
| Lot multiplier | The master's volume × a percentage (100% copies it exactly) |
| Balance multiplier | Scaled by the ratio of follower balance to master balance |
| Equity multiplier | Scaled by the ratio of follower equity to master equity |
| Fixed master balance | Scaled against a fixed master balance, so the follower compounds |
| Fixed % risk | Risks a percentage of the follower's balance; the master trade needs a stop loss |

Further options:

- **Lot refiner** adds a fixed amount (which can be negative) to every calculated volume.
- **Minimum and maximum lot** clamp the result.
- **Contract-size alignment** adjusts for brokers whose contract sizes differ.
- **Reverse copying** opens the opposite side.

### Stops and orders

- Copy the stop loss and take profit at the **same price** as the master, or at the **same distance**
  from the follower's own fill.
- Set fixed stop loss and take profit distances instead.
- Copy pending orders and their expiry.
- **Strict close** ignores the master's closes: copies close only at their own stop loss or take
  profit. It needs copied or fixed stop losses, otherwise a copy would never close.
- A copy closed on the follower itself (its own stop, or by hand) is recognised once it has been
  missing from the follower for 10 seconds; the copier then stops following it and never reopens it.

### Filters and trading hours

- Copy only buys or only sells.
- Copy only trades within a range of master volumes.
- Include or exclude trades by magic number, comment or symbol.
- Set trading hours per weekday, in local time.

### Symbol mapping

Brokers name symbols differently. OpenTerm5 matches broker suffixes automatically, for example `EURUSD`
to `EURUSD.m`. Add explicit mappings for other differences, such as `DE40` to `GER40`.

### Equity protection

Each follower can stop copying when its equity falls below a minimum, or when its daily loss exceeds
a percentage. It can then either block new copies or close every copy. The daily loss resets on the
clock and is measured from the value you choose, as for an
[equity guard](risk-and-automation.md#when-the-trading-day-starts).

## How copying works

The copier reconciles three things on every update: the master's positions, the stored link between
each master position and its copies, and the follower's positions. The master is polled every 500 ms.

- Restarts, reconnections and missed updates therefore settle to the right state without duplicating
  trades.
- Temporary rejections, such as a requote, off quotes or a closed market, are retried for up to about
  15 minutes.
- If the outcome of a copy request is unknown, the copier never sends it again. It looks for a
  matching position on the follower and adopts it, or gives up and reports the problem.

The **Activity** section lists the open copies and a **Log** of every action with its result. The
connection list shows the state of each account's session.

## Audit export

**Export audit** saves one copier's settings, copies and full log as a JSON file, together with the
account logins and holder names and the client ID this computer sends at login. Every copy pairs a
master ticket with a follower ticket and a time, so a prop firm can check it against the broker's own
records. Use it to show that you copied between your own accounts if a firm asks.

The file is a record, not a proof: it is not signed, and you could edit it. Its value is that every
ticket and time in it can be verified on the broker's side.
