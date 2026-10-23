# Phone Access

**File → Phone Access** lets a phone use OpenTerm5 on your computer: the same charts, drawings,
quotes, positions and account, and, if you allow it, trading. The phone does not log in to your
broker. It sends every request to OpenTerm5 on the computer, which uses the session it already has.

This matters for three reasons:

- A broker allows one web session per login. A phone opening its own would log the computer out.
- Every order from the phone passes the same equity guards, request caps and news blackouts as an
  order placed on the computer.
- Your broker passwords and API keys never leave the computer.

> OpenTerm5 must be open on the computer, and the phone must be able to reach it over the network.
> When the computer sleeps or OpenTerm5 closes, the phone shows the computer as unreachable.

## Turning it on

1. On the computer, open **File → Phone Access**.
2. Turn on **Allow paired phones to connect**. The dialog shows the address phones connect to, for
   example `192.168.1.20:8788`. Change **Port** if another program uses 8788.
3. Choose what the phone may do:
   - **Charts only**: charts, drawings, quotes, positions and history. The phone cannot trade.
   - **Charts and trading**: also placing, changing and closing orders.
4. Choose **Show pairing code**.
5. Scan the code with the phone's camera and open the link. The phone pairs and shows your charts.

A pairing code works once and expires after five minutes. If you cannot scan it, choose **Copy link**
and open the link on the phone some other way, or paste it into the phone's pairing screen.

Add the page to the phone's home screen to open it like an app.

## On the phone

- **Charts** lists the charts of your layouts on the computer, for the account in use. Open one to
  see it with its studies and drawings. Change its symbol or timeframe and the chart on the computer
  changes too. Drawings you add, move or remove on the phone appear on the computer, and the other
  way round. A new drawing goes where one drawn on the computer would, following **Drawing sync**
  (this chart, this layout or all layouts). Pinch with two fingers to zoom; the pencil button shows
  the drawing tools. Pine Script studies run only on the computer.
- **Quotes** shows a list of symbols kept on the phone. It starts with the symbols of your charts.
  Tap a price to open an order.
- **Trade** shows the account, open positions and pending orders. Tap a position to change its stop
  loss and take profit or to close it.
- **More** shows which computer the phone is paired with, and unpairs it.

### Placing an order

The order sheet sizes a market order in one of two ways:

- **By risk**: enter the stop loss price. The computer works out the lots from your risk setting
  (the chart risk planner's mode and amount), commission included, and shows them before you send.
- **Lots**: a fixed volume, with an optional stop loss and take profit.

Every trading button takes two taps. The first says exactly what the second will do.

## Managing phones

The **Paired phones** list in **Phone Access** shows each phone, whether it is connected, and when it
was last seen.

- Change **Access** to switch a phone between charts only and trading. The phone reconnects and
  shows its new access at once.
- **Unpair** removes a phone. It is disconnected immediately and cannot reconnect without a new
  pairing code. Unpair a phone you lose.

Unpairing on the phone (**More → Unpair**) only forgets the computer on the phone. Remove it on the
computer as well.

If the computer has no secure credential storage (some Linux desktops without a keyring),
pairings last only until OpenTerm5 quits.

## Security

- The phone and the computer use an encrypted channel (X25519 key agreement and AES-256-GCM). The
  pairing code carries the computer's public key, and each phone has its own key, so nobody else on
  the network can read the traffic, pretend to be the computer, or reuse a phone's connection.
- The phone can call only a fixed list of requests. It cannot log in to or remove accounts, read
  saved passwords, change connection settings, or change copiers, signal sources or guards.
- **Use it on a network you trust.** When the phone opens OpenTerm5 from the computer's address, the
  page itself comes over plain HTTP. On a public or shared Wi-Fi network someone could alter that
  page before it reaches the phone. Your home or office network is fine. A native app, which does
  not download its code from the computer, is planned.

## Reaching the computer from elsewhere

Phones connect directly to the computer, so they must be on the same network. To use your phone
away from home, put the phone and the computer on the same private network, for example with
[Tailscale](https://tailscale.com) or a VPN to your home router. The pairing code then includes the
computer's Tailscale address. Do not forward the port to the internet.

## Troubleshooting

| Problem | What to do |
|---|---|
| The phone says the computer is unreachable | Check that OpenTerm5 is open, phone access is on, and the phone is on the same Wi-Fi as the computer. Allow the port through the computer's firewall. |
| "The pairing code has expired" | Show a new code. A code works once, for five minutes. |
| "This phone is no longer paired" | The phone was unpaired, or the computer lost its pairings (no secure storage). Pair again. |
| "Port 8788 is already in use" | Choose another port and select **Use port**. |
| The phone shows no charts | The computer's layouts for the account in use are empty, or no account is signed in on the computer. |
