# Design principles

These principles guide OpenTerm's product and interface decisions. Use them to resolve questions that
the code and the issue tracker do not answer.

## Who it is for

Traders with MetaTrader 5 accounts who work on Linux, macOS or Windows and want the familiar MT5
desktop workflow without Wine, a virtual machine or a separate Windows machine. Many also need tools
that MT5 lacks: risk-based sizing, trade management, copying between accounts and signal automation.

## Familiar first

- Keep MT5's layout and vocabulary: the menu bar, Market Watch, Navigator, charts and Toolbox, the
  order and modify dialogs, context menus and keyboard shortcuts. A trader who knows MT5 should feel
  at home immediately.
- Modernise the surfaces, not the workflow. OpenTerm borrows the clarity of the macOS design language
  (system fonts, softer separators, rounded controls, light and dark themes) while keeping MT5's
  density and keeping buy and sell in their conventional colours.

## Honest about money

- Show only real broker data. When a value cannot be calculated, show it as unavailable instead of
  showing zero or an estimate.
- Never guess the outcome of an order. A request whose result is unknown is reported as unknown and
  is never sent again automatically.
- Show the consequence before the action: the money at a stop, the risk of a planned trade, the profit
  realised by a partial close.
- Ask for confirmation where a mistake is costly and hard to undo. Respect one-click trading when the
  user has chosen it.

## Safe with credentials

- Keep passwords out of the interface process and off the disk unless the user asks to save them, and
  then only with the operating system's keychain.
- Send a password only to an address that is verified, or that the user has explicitly approved.

## Clear about what runs where

- Automation runs inside OpenTerm. Make it visible what is running, for which account, and what it
  needs (OpenTerm open and connected).
- Keep the active account, its connection and whether it is a demo or real account visible at all
  times.

## Accessible

- Every control has an accessible name and can be reached with the keyboard.
- Text meets readable contrast in both themes.
- Desktop conventions apply: single click selects or acts, double-click opens, right-click shows a
  context menu.
